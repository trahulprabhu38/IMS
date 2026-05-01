// Functional repository — named function exports, no class.
import { getPool, withRetry } from '../db/postgres.js';

const SELECT_COLS = `
  id, title, component_id, component_type, severity, status,
  signal_count, start_time, updated_at, closed_at, mttr_seconds,
  owner, acknowledged_at, escalated, escalation_level
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id:               row.id,
    title:            row.title,
    componentId:      row.component_id,
    componentType:    row.component_type,
    severity:         row.severity,
    status:           row.status,
    signalCount:      row.signal_count,
    startTime:        row.start_time,
    updatedAt:        row.updated_at,
    closedAt:         row.closed_at,
    mttrSeconds:      row.mttr_seconds,
    owner:            row.owner,
    acknowledgedAt:   row.acknowledged_at,
    escalated:        row.escalated,
    escalationLevel:  row.escalation_level,
  };
}

const OWNER_MAP = {
  RDBMS:             'dba-team',
  DISTRIBUTED_CACHE: 'infra-team',
  API:               'backend-team',
  ASYNC_QUEUE:       'platform-team',
  MCP_HOST:          'platform-team',
  NOSQL:             'infra-team',
};

function autoOwner(componentType) {
  return OWNER_MAP[componentType] || 'ops-team';
}

export async function createWorkItem({ title, componentId, componentType, severity, startTime }) {
  const pool  = getPool();
  const owner = autoOwner(componentType);
  const { rows } = await withRetry(() =>
    pool.query(
      `INSERT INTO work_items (title, component_id, component_type, severity, start_time, updated_at, owner)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING ${SELECT_COLS}`,
      [title, componentId, componentType, severity, startTime, owner]
    )
  );
  return mapRow(rows[0]);
}

export async function findWorkItemById(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM work_items WHERE id = $1`, [id]
  );
  return mapRow(rows[0]);
}

export async function findAllWorkItems({ limit = 100, offset = 0 } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM work_items
     ORDER BY
       CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
       start_time DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(mapRow);
}

export async function updateWorkItemStatus(id, status, extra = {}) {
  const pool = getPool();
  const sets = ['status = $2', 'updated_at = NOW()'];
  const vals = [id, status];

  if (extra.closedAt)              sets.push(`closed_at = $${vals.push(extra.closedAt)}`);
  if (extra.mttrSeconds != null)   sets.push(`mttr_seconds = $${vals.push(extra.mttrSeconds)}`);

  const { rows } = await withRetry(() =>
    pool.query(
      `UPDATE work_items SET ${sets.join(', ')} WHERE id = $1 RETURNING ${SELECT_COLS}`,
      vals
    )
  );
  return mapRow(rows[0]);
}

export async function incrementSignalCount(id) {
  const pool = getPool();
  await withRetry(() =>
    pool.query(
      `UPDATE work_items SET signal_count = signal_count + 1, updated_at = NOW() WHERE id = $1`,
      [id]
    )
  );
}

export async function createRCA({ workItemId, incidentStart, incidentEnd, rootCauseCategory, fixApplied, preventionSteps }) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: rcaRows } = await client.query(
      `INSERT INTO rca_records (work_item_id, incident_start, incident_end, root_cause_category, fix_applied, prevention_steps)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [workItemId, incidentStart, incidentEnd, rootCauseCategory, fixApplied, preventionSteps]
    );

    const mttrSeconds = (new Date(incidentEnd) - new Date(incidentStart)) / 1000;

    const { rows: wiRows } = await client.query(
      `UPDATE work_items
       SET status = 'CLOSED', updated_at = NOW(), closed_at = NOW(), mttr_seconds = $2
       WHERE id = $1 RETURNING ${SELECT_COLS}`,
      [workItemId, mttrSeconds]
    );

    await client.query('COMMIT');
    return { rca: rcaRows[0], workItem: mapRow(wiRows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getRCA(workItemId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM rca_records WHERE work_item_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [workItemId]
  );
  return rows[0] || null;
}

export async function acknowledgeWorkItem(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE work_items SET acknowledged_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND acknowledged_at IS NULL
     RETURNING ${SELECT_COLS}`,
    [id]
  );
  return mapRow(rows[0]);
}

export async function setWorkItemOwner(id, owner) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE work_items SET owner = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SELECT_COLS}`,
    [id, owner]
  );
  return mapRow(rows[0]);
}

export async function setEscalated(id, level) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE work_items SET escalated = TRUE, escalation_level = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SELECT_COLS}`,
    [id, level]
  );
  return mapRow(rows[0]);
}

export async function findUnacknowledgedOpenItems() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM work_items
     WHERE status IN ('OPEN', 'INVESTIGATING')
       AND acknowledged_at IS NULL
     ORDER BY start_time ASC`
  );
  return rows.map(mapRow);
}

// Legacy compat: some files import `new WorkItemRepository()`
export const WorkItemRepository = {
  create:               createWorkItem,
  findById:             findWorkItemById,
  findAll:              findAllWorkItems,
  updateStatus:         updateWorkItemStatus,
  incrementSignalCount,
  createRCA,
  getRCA,
};
