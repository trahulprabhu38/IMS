import { getPool } from '../db/postgres.js';

export async function insertTimelineEvent({ workItemId, eventType, actor = 'system', metadata = {} }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO incident_events (work_item_id, event_type, actor, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workItemId, eventType, actor, JSON.stringify(metadata)]
  );
  return rows[0];
}

export async function getTimeline(workItemId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM incident_events
     WHERE work_item_id = $1
     ORDER BY occurred_at ASC`,
    [workItemId]
  );
  return rows;
}
