/**
 * Webhook adapters for Prometheus Alertmanager and Grafana unified alerting.
 * Translates their payloads into IMS signal format and enqueues them.
 *
 * Alertmanager → POST /api/v1/webhooks/alertmanager
 * Grafana       → POST /api/v1/webhooks/grafana
 */
import { signalQueue } from '../core/BoundedQueue.js';

// Map Prometheus/Grafana severity labels → IMS severity
function mapSeverity(labels = {}) {
  const raw = (labels.severity || labels.priority || '').toLowerCase();
  if (raw === 'critical' || raw === 'p0') return 'P0';
  if (raw === 'high'     || raw === 'p1') return 'P1';
  if (raw === 'warning'  || raw === 'p2') return 'P2';
  return 'P3';
}

// Map alert labels to IMS component type
function mapComponentType(labels = {}) {
  const job = (labels.job || labels.service || '').toLowerCase();
  if (job.includes('rdbms')   || job.includes('postgres') || job.includes('mysql'))  return 'RDBMS';
  if (job.includes('cache')   || job.includes('redis') || job.includes('memcache'))  return 'DISTRIBUTED_CACHE';
  if (job.includes('mongo')   || job.includes('elastic') || job.includes('dynamo'))  return 'NOSQL';
  if (job.includes('queue')   || job.includes('kafka') || job.includes('sqs') || job.includes('rabbit')) return 'ASYNC_QUEUE';
  if (job.includes('mcp')     || job.includes('host'))  return 'MCP_HOST';
  return 'API';
}

// Determine signal type from alert name / labels
function mapSignalType(labels = {}, alertname = '') {
  const name = (alertname || labels.alertname || '').toLowerCase();
  if (name.includes('outage')  || name.includes('down'))    return 'OUTAGE';
  if (name.includes('latency') || name.includes('slow'))    return 'LATENCY_SPIKE';
  if (name.includes('error')   || name.includes('5xx') || name.includes('500')) return 'ERROR';
  return 'DEGRADED';
}

function alertToSignal(alert, source) {
  const { labels = {}, annotations = {}, startsAt } = alert;
  const alertname  = labels.alertname || 'unknown-alert';
  const componentId = labels.service || labels.job || labels.instance || labels.pod || alertname;

  return {
    componentId,
    componentType: mapComponentType(labels),
    signalType:    mapSignalType(labels, alertname),
    severity:      mapSeverity(labels),
    timestamp:     startsAt ? new Date(startsAt) : new Date(),
    payload: {
      source,
      alertname,
      summary:     annotations.summary     || alertname,
      description: annotations.description || '',
      labels,
      rawValues:   alert.values || {},
    },
  };
}

export default async function webhookRoutes(app) {
  // ── Prometheus Alertmanager ───────────────────────────────────────────────
  app.post('/webhooks/alertmanager', async (req, reply) => {
    const { alerts = [], status } = req.body || {};

    const firing = alerts.filter(a => a.status === 'firing' || status === 'firing');
    if (firing.length === 0) return reply.send({ accepted: 0 });

    let accepted = 0;
    for (const alert of firing) {
      const signal = alertToSignal(alert, 'alertmanager');
      if (signalQueue.put(signal)) accepted++;
    }

    app.log.info(`[webhook/alertmanager] received ${firing.length}, enqueued ${accepted}`);
    return reply.status(202).send({ accepted, total: firing.length });
  });

  // ── Grafana Unified Alerting ──────────────────────────────────────────────
  app.post('/webhooks/grafana', async (req, reply) => {
    const { alerts = [], status } = req.body || {};

    const firing = alerts.filter(a => a.status === 'firing' || status === 'firing');
    if (firing.length === 0) return reply.send({ accepted: 0 });

    let accepted = 0;
    for (const alert of firing) {
      const signal = alertToSignal(alert, 'grafana');
      if (signalQueue.put(signal)) accepted++;
    }

    app.log.info(`[webhook/grafana] received ${firing.length}, enqueued ${accepted}`);
    return reply.status(202).send({ accepted, total: firing.length });
  });

  // ── Generic signal ingestion (raw IMS format, for custom exporters) ───────
  app.post('/webhooks/signal', async (req, reply) => {
    const { componentId, componentType, signalType, severity, payload, timestamp } = req.body || {};
    if (!componentId || !componentType || !signalType || !severity) {
      return reply.status(400).send({ error: 'componentId, componentType, signalType, severity are required' });
    }

    const signal = {
      componentId,
      componentType,
      signalType,
      severity,
      payload: payload || {},
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    if (!signalQueue.put(signal)) {
      return reply.status(503).header('Retry-After', '1').send({ error: 'Queue full, retry later' });
    }

    return reply.status(202).send({ accepted: 1 });
  });
}
