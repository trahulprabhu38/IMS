import { signalQueue }    from '../core/BoundedQueue.js';
import { getRedis }      from '../db/redis.js';
import { findWorkItemById, updateWorkItemStatus } from '../repositories/WorkItemRepository.js';
import { setWorkItem }   from '../repositories/CacheRepository.js';
import { stateFromStatus } from '../patterns/WorkItemState.js';
import { insertTimelineEvent } from '../repositories/TimelineRepository.js';
import { insertAuditEntry }    from '../repositories/AuditRepository.js';
import { broadcast }     from '../websocket/ConnectionManager.js';

function mapSeverity(labels = {}) {
  const raw = (labels.severity || labels.priority || '').toLowerCase();
  if (raw === 'critical' || raw === 'p0') return 'P0';
  if (raw === 'high'     || raw === 'p1') return 'P1';
  if (raw === 'warning'  || raw === 'p2') return 'P2';
  return 'P3';
}

function mapComponentType(labels = {}) {
  const job = (labels.job || labels.service || '').toLowerCase();
  if (job.includes('postgres') || job.includes('rdbms') || job.includes('mysql'))   return 'RDBMS';
  if (job.includes('redis')    || job.includes('cache') || job.includes('memcache')) return 'DISTRIBUTED_CACHE';
  if (job.includes('mongo')    || job.includes('dynamo')|| job.includes('elastic'))  return 'NOSQL';
  if (job.includes('kafka')    || job.includes('sqs')   || job.includes('queue'))    return 'ASYNC_QUEUE';
  if (job.includes('mcp')      || job.includes('host'))                              return 'MCP_HOST';
  return 'API';
}

function mapSignalType(labels = {}, alertname = '') {
  const name = (alertname || labels.alertname || '').toLowerCase();
  if (name.includes('outage')  || name.includes('down'))                       return 'OUTAGE';
  if (name.includes('latency') || name.includes('slow'))                       return 'LATENCY_SPIKE';
  if (name.includes('error')   || name.includes('5xx') || name.includes('500')) return 'ERROR';
  return 'DEGRADED';
}

function alertToSignal(alert, source) {
  const { labels = {}, annotations = {}, startsAt } = alert;
  const alertname   = labels.alertname || 'unknown-alert';
  const componentId = labels.service || labels.job || labels.instance || alertname;
  return {
    componentId,
    componentType: mapComponentType(labels),
    signalType:    mapSignalType(labels, alertname),
    severity:      mapSeverity(labels),
    timestamp:     startsAt ? new Date(startsAt) : new Date(),
    payload: {
      source, alertname,
      summary:     annotations.summary     || alertname,
      description: annotations.description || '',
      labels,
      values:      alert.values || {},
    },
  };
}

function enqueueAlerts(alerts, status, source, app) {
  const firing   = alerts.filter(a => a.status === 'firing' || status === 'firing');
  let accepted = 0;
  for (const alert of firing) {
    if (signalQueue.put(alertToSignal(alert, source))) accepted++;
  }
  app.log.info(`[webhook/${source}] received=${firing.length} accepted=${accepted}`);
  return { accepted, total: firing.length };
}

export async function handleAlertmanager(req, reply) {
  const { alerts = [], status } = req.body || {};
  return reply.status(202).send(enqueueAlerts(alerts, status, 'alertmanager', req.server));
}

export async function handleGrafana(req, reply) {
  const { alerts = [], status } = req.body || {};
  return reply.status(202).send(enqueueAlerts(alerts, status, 'grafana', req.server));
}

export async function handleRawSignal(req, reply) {
  const { componentId, componentType, signalType, severity, payload, timestamp } = req.body || {};
  if (!componentId || !componentType || !signalType || !severity) {
    return reply.status(400).send({ error: 'componentId, componentType, signalType, severity are required' });
  }
  const signal = { componentId, componentType, signalType, severity, payload: payload || {}, timestamp: timestamp ? new Date(timestamp) : new Date() };
  if (!signalQueue.put(signal)) {
    return reply.status(503).header('Retry-After', '1').send({ error: 'Queue full' });
  }
  return reply.status(202).send({ accepted: 1 });
}

// ── Uptime Kuma webhook ───────────────────────────────────────────────────────
const UK_SEVERITY_PATTERNS = [
  [/postgres|mysql|redis|primary|database|db/i, 'P0'],
  [/api|backend|service|worker/i,               'P1'],
  [/cdn|static|dev|staging|test/i,              'P2'],
];

function ukSeverity(monitorName = '') {
  for (const [re, sev] of UK_SEVERITY_PATTERNS) {
    if (re.test(monitorName)) return sev;
  }
  return 'P1';
}

export async function handleUptimeKuma(req, reply) {
  const body = req.body || {};
  const heartbeat = body.heartbeat || {};
  const monitor   = body.monitor   || {};

  const monitorId   = heartbeat.monitorID ?? monitor.id;
  const status      = heartbeat.status;   // 0 = down, 1 = up
  const monitorName = monitor.name || `monitor-${monitorId}`;
  const monitorUrl  = monitor.url  || '';
  const msg         = heartbeat.msg || body.msg || '';

  if (monitorId == null || status == null) {
    return reply.status(400).send({ error: 'heartbeat.monitorID and heartbeat.status are required' });
  }

  const redis   = getRedis();
  const redisKey = `uptime:active:${monitorId}`;

  // ── Service went DOWN ──────────────────────────────────────────────────────
  if (status === 0) {
    const severity  = ukSeverity(monitorName);
    const signal = {
      componentId:   monitorName,
      componentType: 'API',
      signalType:    'OUTAGE',
      severity,
      timestamp:     new Date(),
      payload: {
        source:      'uptime-kuma',
        monitorId,
        monitorName,
        monitorUrl,
        message:     msg,
      },
    };

    if (!signalQueue.put(signal)) {
      return reply.status(503).header('Retry-After', '1').send({ error: 'Queue full' });
    }

    // The signal processor will create the work item asynchronously.
    // We store a placeholder in Redis so we can resolve it later.
    // The debounce key will match monitorName → we'll look it up by that.
    await redis?.set(`uptime:pending:${monitorId}`, monitorName, 'EX', 3600);
    req.server.log.warn(`[uptime-kuma] DOWN: ${monitorName} (${monitorUrl})`);
    return reply.status(202).send({ action: 'incident_queued', monitor: monitorName, severity });
  }

  // ── Service came back UP ───────────────────────────────────────────────────
  if (status === 1) {
    req.server.log.info(`[uptime-kuma] UP: ${monitorName}`);

    const workItemId = await redis?.get(redisKey);
    if (workItemId) {
      try {
        await autoResolveWorkItem(workItemId, monitorName);
        await redis?.del(redisKey);
      } catch (err) {
        req.server.log.warn(`[uptime-kuma] Auto-resolve failed for ${workItemId}: ${err.message}`);
      }
    }

    return reply.status(202).send({ action: 'auto_resolved', monitor: monitorName, workItemId: workItemId || null });
  }

  return reply.status(400).send({ error: `Unknown status: ${status}` });
}

// Walk through states to reach RESOLVED regardless of where we start.
async function autoResolveWorkItem(id, actor = 'uptime-kuma') {
  const workItem = await findWorkItemById(id);
  if (!workItem) return;
  if (['RESOLVED', 'CLOSED'].includes(workItem.status)) return;

  const path = workItem.status === 'OPEN'
    ? ['INVESTIGATING', 'RESOLVED']
    : ['RESOLVED'];

  let current = workItem;
  for (const target of path) {
    try {
      const state   = stateFromStatus(current.status);
      const next    = state.transition(target);
      current       = await updateWorkItemStatus(id, next.getStatus());
      await setWorkItem(current);
      await insertTimelineEvent({
        workItemId: id,
        eventType:  'STATUS_CHANGED',
        actor,
        metadata:   { from: target === 'INVESTIGATING' ? 'OPEN' : 'INVESTIGATING', to: target, autoResolved: true },
      });
      await insertAuditEntry({
        workItemId:  id,
        action:      'STATUS_TRANSITION',
        actor,
        beforeState: { status: workItem.status },
        afterState:  { status: target, autoResolved: true },
      });
      broadcast('WORK_ITEM_UPDATED', current);
    } catch { break; }
  }
}
