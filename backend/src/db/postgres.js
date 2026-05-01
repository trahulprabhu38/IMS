import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

export function getPool() {
  return pool;
}

export async function connectPostgres() {
  pool = new Pool({ connectionString: config.databaseUrl });
  await pool.query('SELECT 1');
  console.log('[DB] PostgreSQL connected');
}

export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS work_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        component_id VARCHAR(100) NOT NULL,
        component_type VARCHAR(50) NOT NULL,
        severity VARCHAR(5) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        signal_count INTEGER DEFAULT 1,
        start_time TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        mttr_seconds FLOAT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rca_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID REFERENCES work_items(id),
        incident_start TIMESTAMPTZ NOT NULL,
        incident_end TIMESTAMPTZ NOT NULL,
        root_cause_category VARCHAR(50) NOT NULL,
        fix_applied TEXT NOT NULL,
        prevention_steps TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_metrics (
        time TIMESTAMPTZ NOT NULL,
        component_id VARCHAR(100),
        component_type VARCHAR(50),
        severity VARCHAR(5),
        signal_count INTEGER DEFAULT 1
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID REFERENCES work_items(id),
        event_type VARCHAR(50) NOT NULL,
        actor VARCHAR(100) NOT NULL DEFAULT 'system',
        metadata JSONB,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_incident_events_work_item
        ON incident_events (work_item_id, occurred_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID REFERENCES work_items(id),
        action VARCHAR(50) NOT NULL,
        actor VARCHAR(100) NOT NULL DEFAULT 'system',
        before_state JSONB,
        after_state JSONB,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_work_item
        ON audit_log (work_item_id, occurred_at DESC)
    `);

    // Add owner / escalation columns to existing work_items
    await client.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS owner VARCHAR(100)`);
    await client.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE work_items ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0`);

    await client.query('COMMIT');

    // Attempt TimescaleDB hypertable (non-fatal if extension unavailable)
    try {
      await pool.query(`SELECT create_hypertable('signal_metrics','time',if_not_exists=>TRUE)`);
      console.log('[DB] TimescaleDB hypertable enabled for signal_metrics');
    } catch {
      console.warn('[DB] TimescaleDB extension not available — signal_metrics is a plain table');
    }

    console.log('[DB] Schema initialised');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function withRetry(fn, retries = 3) {
  let delay = 500;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[DB] Retry ${attempt}/${retries} after ${delay}ms — ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
