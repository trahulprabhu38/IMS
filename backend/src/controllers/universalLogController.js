import { classifyLog, normalizeLogEntry } from '../services/LogClassifier.js';
import { RawLog }    from '../models/RawLog.js';
import { signalQueue } from '../core/BoundedQueue.js';

// ── Ingest logs ───────────────────────────────────────────────────────────────
export async function ingestLogs(req, reply) {
  let entries = [];

  // Accept: array, single object, or plain text
  const body = req.body;
  if (Array.isArray(body)) {
    entries = body;
  } else if (body && typeof body === 'object') {
    entries = [body];
  } else if (typeof body === 'string') {
    // plain text — wrap with query params as context
    const service = req.query.service || 'unknown';
    const level   = req.query.level   || 'info';
    entries = [{ message: body, service, level }];
  } else {
    return reply.status(400).send({ error: 'Body must be a JSON object, array, or plain text' });
  }

  if (entries.length > 500) {
    return reply.status(400).send({ error: 'Maximum 500 log entries per request' });
  }

  const results = [];
  let accepted  = 0;
  let stored    = 0;
  let rejected  = 0;

  for (const raw of entries) {
    try {
      const norm       = normalizeLogEntry(raw);
      const classified = classifyLog(norm);

      const logDoc = await RawLog.create({
        message:              norm.message,
        level:                norm.level,
        service:              norm.service,
        host:                 norm.host,
        timestamp:            norm.timestamp,
        score:                classified.score,
        classifiedSeverity:   classified.severity,
        classifiedSignalType: classified.signalType,
        componentType:        classified.componentType,
        workItemCreated:      false,
        metadata:             norm.metadata,
        raw,
      });

      stored++;

      if (classified.shouldCreateWorkItem) {
        const signal = {
          componentId:   norm.service,
          componentType: classified.componentType,
          signalType:    classified.signalType,
          severity:      classified.severity,
          timestamp:     norm.timestamp,
          payload: {
            source:   'log-webhook',
            message:  norm.message,
            level:    norm.level,
            host:     norm.host,
            logId:    logDoc._id.toString(),
            ...norm.metadata,
          },
        };

        if (signalQueue.put(signal)) {
          accepted++;
          // Mark the log as having triggered a work item (best-effort update)
          RawLog.updateOne({ _id: logDoc._id }, { workItemCreated: true }).catch(() => {});
        } else {
          rejected++;
        }
      }

      results.push({
        service:             norm.service,
        severity:            classified.severity,
        score:               classified.score,
        signalType:          classified.signalType,
        willCreateWorkItem:  classified.shouldCreateWorkItem,
        reason:              describeScore(classified.score, norm.level),
      });
    } catch (err) {
      rejected++;
      results.push({ error: err.message });
    }
  }

  req.server.log.info(`[log-webhook] total=${entries.length} stored=${stored} work_items_queued=${accepted}`);
  return reply.status(202).send({ total: entries.length, stored, accepted, rejected, results });
}

// ── Query stored logs ─────────────────────────────────────────────────────────
export async function queryLogs(req, reply) {
  const {
    service, severity, from, to,
    limit  = 100,
    offset = 0,
  } = req.query;

  const filter = {};
  if (service)  filter.service              = { $regex: service, $options: 'i' };
  if (severity) filter.classifiedSeverity   = severity.toUpperCase();
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to)   filter.timestamp.$lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    RawLog.find(filter).sort({ timestamp: -1 }).skip(Number(offset)).limit(Number(limit)).lean(),
    RawLog.countDocuments(filter),
  ]);

  return reply.send({ total, offset: Number(offset), limit: Number(limit), logs });
}

// ── Log stats ─────────────────────────────────────────────────────────────────
export async function logStats(req, reply) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

  const [bySeverity, byService] = await Promise.all([
    RawLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$classifiedSeverity', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    RawLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$service', count: { $sum: 1 }, p0: { $sum: { $cond: [{ $eq: ['$classifiedSeverity','P0'] }, 1, 0] } } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
  ]);

  return reply.send({ period: '24h', bySeverity, byService });
}

function describeScore(score, level) {
  if (score >= 50) return 'critical keywords + level';
  if (score >= 30) return 'error-level keywords detected';
  if (score >= 15) return 'warning patterns detected';
  return `noise — score ${score} below threshold (level: ${level})`;
}
