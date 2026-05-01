// Functional repository — named function exports, no class.
import { Signal } from '../models/Signal.js';
import { getPool, withRetry } from '../db/postgres.js';

export async function insertSignal(signalData, workItemId) {
  const doc = await withRetry(() => new Signal({ ...signalData, workItemId }).save());
  return doc._id.toString();
}

export async function findSignalsByWorkItemId(workItemId, limit = 200) {
  return Signal.find({ workItemId }).sort({ timestamp: -1 }).limit(limit).lean();
}

export async function insertSignalMetric(signal) {
  const pool = getPool();
  await withRetry(() =>
    pool.query(
      `INSERT INTO signal_metrics (time, component_id, component_type, severity, signal_count)
       VALUES ($1, $2, $3, $4, 1)`,
      [signal.timestamp || new Date(), signal.componentId, signal.componentType, signal.severity]
    )
  );
}

// Legacy compat
export const SignalRepository = {
  insert:       insertSignal,
  findByWorkItemId: findSignalsByWorkItemId,
  insertMetric: insertSignalMetric,
};
