import { getPool } from '../db/postgres.js';

export async function insertAuditEntry({ workItemId, action, actor = 'system', beforeState, afterState }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO audit_log (work_item_id, action, actor, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [workItemId, action, actor, JSON.stringify(beforeState ?? null), JSON.stringify(afterState ?? null)]
  );
  return rows[0];
}

export async function getAuditLog(workItemId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM audit_log
     WHERE work_item_id = $1
     ORDER BY occurred_at DESC`,
    [workItemId]
  );
  return rows;
}
