/**
 * Mock Failure Scenario
 * Simulates a cascading failure: RDBMS primary outage → MCP host degradation.
 *
 * Usage:
 *   node scripts/mock_failure_scenario.js [--host http://localhost:8000] [--burst 100]
 */

const args   = process.argv.slice(2);
const HOST   = args.includes('--host')  ? args[args.indexOf('--host')  + 1] : 'http://localhost:8000';
const BURST  = args.includes('--burst') ? parseInt(args[args.indexOf('--burst') + 1], 10) : 100;

async function postSignal(signal) {
  const res = await fetch(`${HOST}/api/v1/signals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(signal),
  });
  return res.status;
}

async function burst(signals, label) {
  console.log(`\n[SCENARIO] Firing ${signals.length} signals — ${label}`);
  const results = await Promise.allSettled(signals.map(postSignal));
  const ok  = results.filter(r => r.status === 'fulfilled' && r.value === 202).length;
  const err = results.length - ok;
  console.log(`  ✓ Accepted: ${ok}  ✗ Errors: ${err}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log(`\n🔥 IMS Failure Simulation → ${HOST}`);
  console.log(`   Burst size: ${BURST} signals per event\n`);

  // Phase 1: RDBMS Primary outage — P0
  const rdbmsSignals = Array.from({ length: BURST }, (_, i) => ({
    componentId:   'RDBMS_PRIMARY',
    componentType: 'RDBMS',
    signalType:    i % 3 === 0 ? 'OUTAGE' : 'ERROR',
    severity:      'P0',
    payload: {
      errorCode: 'CONN_REFUSED',
      message:   'Primary database unreachable',
      host:      'db-primary.internal',
      attempt:   i + 1,
    },
    timestamp: new Date().toISOString(),
  }));

  await burst(rdbmsSignals, 'RDBMS_PRIMARY — P0 OUTAGE');
  await sleep(2000);

  // Phase 2: MCP Host degradation triggered by DB failure — P1
  const mcpSignals = Array.from({ length: Math.floor(BURST / 2) }, (_, i) => ({
    componentId:   'MCP_HOST_01',
    componentType: 'MCP_HOST',
    signalType:    'DEGRADED',
    severity:      'P1',
    payload: {
      errorCode: 'DB_TIMEOUT',
      message:   'MCP host failing due to DB unavailability',
      latencyMs: 8000 + i * 100,
    },
    timestamp: new Date().toISOString(),
  }));

  await burst(mcpSignals, 'MCP_HOST_01 — P1 DEGRADED (cascading from DB)');
  await sleep(2000);

  // Phase 3: Cache cluster latency spike — P2
  const cacheSignals = Array.from({ length: 30 }, () => ({
    componentId:   'CACHE_CLUSTER_01',
    componentType: 'DISTRIBUTED_CACHE',
    signalType:    'LATENCY_SPIKE',
    severity:      'P2',
    payload: { message: 'Cache latency elevated — possible memory pressure', latencyMs: 450 },
    timestamp: new Date().toISOString(),
  }));

  await burst(cacheSignals, 'CACHE_CLUSTER_01 — P2 LATENCY SPIKE');
  await sleep(1000);

  // Phase 4: API gateway errors — P0
  const apiSignals = Array.from({ length: 20 }, () => ({
    componentId:   'API_GATEWAY',
    componentType: 'API',
    signalType:    'ERROR',
    severity:      'P0',
    payload: { errorCode: '503', message: 'API gateway returning 503s', upstreamFailed: 'RDBMS_PRIMARY' },
    timestamp: new Date().toISOString(),
  }));

  await burst(apiSignals, 'API_GATEWAY — P0 ERROR (upstream failure)');

  console.log('\n✅ Scenario complete. Check the IMS dashboard at http://localhost:3000\n');
  console.log('Expected: 4 Work Items created (one per component), each debounced from the signal burst.');
})();
