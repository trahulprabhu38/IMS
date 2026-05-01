/**
 * mock_rdbms_mcp_scenario.js
 *
 * Focused scenario: RDBMS primary goes down, cascades into MCP host failure,
 * then a recovery phase begins.
 *
 * Unlike mock_failure_scenario.js (which fires everything at once), this script
 * uses realistic timing gaps between phases and sends signals of different types
 * within each phase to mimic a real outage pattern.
 *
 * Usage:
 *   node scripts/mock_rdbms_mcp_scenario.js
 *   node scripts/mock_rdbms_mcp_scenario.js --host http://localhost:8000 --count 50
 */

const args  = process.argv.slice(2);
const HOST  = args.includes('--host')  ? args[args.indexOf('--host')  + 1] : 'http://localhost:8000';
const COUNT = args.includes('--count') ? parseInt(args[args.indexOf('--count') + 1], 10) : 50;

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function log(color, prefix, msg) {
  console.log(`${color}${BOLD}${prefix}${RESET} ${msg}`);
}

async function post(path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fireSignals(signals, label) {
  log(BLUE, '[FIRE]', `${signals.length} signals — ${label}`);
  const results = await Promise.allSettled(
    signals.map(s => post('/api/v1/signals', s))
  );
  const ok      = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  const rate503 = results.filter(r => r.status === 'fulfilled' && r.value.status === 503).length;
  const errors  = results.length - ok - rate503;
  log(GREEN,  '  →', `Accepted: ${ok}`);
  if (rate503) log(YELLOW, '  →', `Backpressure 503: ${rate503} (queue full — expected under high load)`);
  if (errors)  log(RED,    '  →', `Failed: ${errors}`);
  return ok;
}

async function postLog(payload) {
  return post('/api/v1/webhooks/logs', payload);
}

// ── Signal factories ────────────────────────────────────────────────────────

function makeRdbmsSignal(type, i) {
  const types = {
    OUTAGE:  { signalType: 'OUTAGE',       severity: 'P0', errorCode: 'CONN_REFUSED', message: `DB primary unreachable — attempt ${i}` },
    LATENCY: { signalType: 'LATENCY_SPIKE', severity: 'P1', errorCode: 'SLOW_QUERY',  message: `Query timeout after ${3000 + i * 200}ms` },
    ERROR:   { signalType: 'ERROR',         severity: 'P0', errorCode: 'DEADLOCK',    message: `Transaction deadlock on table orders (attempt ${i})` },
  };
  const t = types[type] || types.OUTAGE;
  return {
    componentId:   'RDBMS_PRIMARY',
    componentType: 'RDBMS',
    signalType:    t.signalType,
    severity:      t.severity,
    payload: {
      errorCode: t.errorCode,
      message:   t.message,
      host:      'db-primary.internal',
      port:      5432,
    },
    timestamp: new Date().toISOString(),
  };
}

function makeMcpSignal(type, i) {
  const types = {
    DEGRADED: { signalType: 'DEGRADED', severity: 'P1', message: `MCP host degraded — DB unavailable, queuing requests (depth=${i * 10})` },
    ERROR:    { signalType: 'ERROR',    severity: 'P1', message: `MCP host failing health checks — upstream DB timeout after ${5000 + i * 100}ms` },
  };
  const t = types[type] || types.DEGRADED;
  return {
    componentId:   'MCP_HOST_01',
    componentType: 'MCP_HOST',
    signalType:    t.signalType,
    severity:      t.severity,
    payload: {
      message:        t.message,
      upstreamFailed: 'RDBMS_PRIMARY',
      latencyMs:      5000 + i * 50,
    },
    timestamp: new Date().toISOString(),
  };
}

function makeRecoveryLog(service, message) {
  return {
    level:     'info',
    message,
    service,
    source:    'recovery-monitor',
    timestamp: new Date().toISOString(),
  };
}

// ── Main scenario ────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${BOLD}╔════════════════════════════════════════════════════════╗`);
  console.log(`║   IMS — RDBMS + MCP Failure Scenario                   ║`);
  console.log(`╚════════════════════════════════════════════════════════╝${RESET}\n`);
  console.log(`  Target : ${HOST}`);
  console.log(`  Signals: ~${COUNT} per phase\n`);

  // ── Phase 1: Precursor — latency spike before full outage ────────────────
  log(YELLOW, '[PHASE 1]', 'RDBMS latency spike (precursor)');
  const precursorSignals = Array.from({ length: Math.floor(COUNT / 5) }, (_, i) =>
    makeRdbmsSignal('LATENCY', i)
  );
  await fireSignals(precursorSignals, 'RDBMS_PRIMARY — latency spike warning');
  await sleep(2000);

  // ── Phase 2: RDBMS full outage ───────────────────────────────────────────
  log(RED, '[PHASE 2]', 'RDBMS PRIMARY full outage — P0 burst');
  const outageSignals = Array.from({ length: COUNT }, (_, i) =>
    makeRdbmsSignal(i % 4 === 0 ? 'ERROR' : 'OUTAGE', i)
  );
  await fireSignals(outageSignals, 'RDBMS_PRIMARY — P0 OUTAGE');

  // Also send as structured log to the universal webhook
  await postLog({
    level:   'fatal',
    message: 'CRITICAL: Primary database RDBMS_PRIMARY is unreachable. ECONNREFUSED db-primary.internal:5432. All write operations failing.',
    service: 'order-service',
    source:  'order-service-pod-1',
  });
  log(BLUE, '[LOG]', 'Fatal log sent to universal webhook');

  await sleep(3000);

  // ── Phase 3: MCP cascade — triggered by DB failure ───────────────────────
  log(RED, '[PHASE 3]', 'MCP_HOST_01 cascade failure — P1 burst');
  const mcpSignals = Array.from({ length: COUNT }, (_, i) =>
    makeMcpSignal(i % 3 === 0 ? 'ERROR' : 'DEGRADED', i)
  );
  await fireSignals(mcpSignals, 'MCP_HOST_01 — P1 DEGRADED (cascade from DB)');

  await postLog({
    level:   'error',
    message: 'MCP_HOST_01 connection pool exhausted. max retries exceeded. upstream RDBMS_PRIMARY timeout 5s.',
    service: 'mcp-host',
    source:  'mcp-host-pod-0',
  });
  log(BLUE, '[LOG]', 'Error log sent to universal webhook');

  await sleep(4000);

  // ── Phase 4: Secondary RDBMS signals (same work item, just increments counter)
  log(YELLOW, '[PHASE 4]', 'Continued RDBMS signals — debounce window active');
  const continuedSignals = Array.from({ length: Math.floor(COUNT / 2) }, (_, i) =>
    makeRdbmsSignal('OUTAGE', COUNT + i)
  );
  await fireSignals(continuedSignals, 'RDBMS_PRIMARY — continued outage signals (debounced → same work item)');
  await sleep(1000);

  // ── Phase 5: Recovery signals (as logs — no new work items) ─────────────
  log(GREEN, '[PHASE 5]', 'Recovery phase — sending info logs');

  await postLog(makeRecoveryLog('db-monitor',   'DB replica promoted to primary. Accepting connections on db-replica-1.internal:5432'));
  await postLog(makeRecoveryLog('order-service','RDBMS connection re-established. Resuming normal operations.'));
  await postLog(makeRecoveryLog('mcp-host',     'MCP_HOST_01 health checks passing. Upstream DB latency 12ms. Draining queue.'));

  log(GREEN, '[LOG]', '3 recovery logs sent (info-level → P3 → stored only, no new work items)');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}${GREEN}✅ Scenario complete${RESET}`);
  console.log(`\n${BOLD}Expected dashboard state:${RESET}`);
  console.log(`  • Work Item 1: RDBMS_PRIMARY — P0 OUTAGE`);
  console.log(`      signal_count ≈ ${COUNT + Math.floor(COUNT / 5) + Math.floor(COUNT / 2)} (all phases collapsed by debounce)`);
  console.log(`      owner: dba-team`);
  console.log(`  • Work Item 2: MCP_HOST_01 — P1 DEGRADED`);
  console.log(`      signal_count ≈ ${COUNT}`);
  console.log(`      owner: platform-team`);
  console.log(`\n  • Timeline tab: shows CREATED event for each work item`);
  console.log(`  • Logs Viewer: shows 5 log entries (2× fatal/error → linked to work items, 3× info → P3 stored only)`);
  console.log(`\n  Open http://localhost:3000 to see the live dashboard\n`);
  console.log(`${BOLD}Next steps to test the full lifecycle:${RESET}`);
  console.log(`  1. Click RDBMS_PRIMARY work item → Acknowledge → Transition to INVESTIGATING`);
  console.log(`  2. Transition to RESOLVED`);
  console.log(`  3. Submit RCA form → work item closes, MTTR is calculated and displayed`);
  console.log(`  4. Check Timeline tab — see every event in chronological order\n`);
})();
