import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }  from 'path';
import { fileURLToPath }  from 'url';

const __dir      = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dir, '../../data');
const STORE_FILE = join(DATA_DIR, 'integrations.json');

const TYPES = ['aws', 'prometheus', 'alloy', 'loki', 'uptime_kuma'];

// ── Persistence ───────────────────────────────────────────────────────────────
function loadStore() {
  if (!existsSync(STORE_FILE)) return {};
  try { return JSON.parse(readFileSync(STORE_FILE, 'utf8')); } catch { return {}; }
}

function saveStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

let store = loadStore();

// ── Connectivity tests ────────────────────────────────────────────────────────
const TEST_ENDPOINTS = {
  prometheus:  (cfg) => `${cfg.url}/api/v1/query?query=1`,
  alloy:       (cfg) => `${cfg.url}/-/ready`,
  loki:        (cfg) => `${cfg.url}/ready`,
  uptime_kuma: (cfg) => `${cfg.url}/api/v1/info`,
};

async function testConnectivity(type, cfg) {
  if (type === 'aws') {
    const ok = !!(cfg.region && cfg.accessKeyId && cfg.secretAccessKey);
    return { ok, message: ok ? 'Credentials configured' : 'Missing region / credentials' };
  }

  const urlFn = TEST_ENDPOINTS[type];
  if (!urlFn || !cfg.url) return { ok: false, message: 'No URL configured' };

  try {
    const headers = {};
    if (cfg.username && cfg.password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    }
    if (cfg.token)  headers['Authorization'] = `Bearer ${cfg.token}`;
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

    const res = await fetch(urlFn(cfg), { headers, signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, message: `HTTP ${res.status}`, statusCode: res.status };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ── Controller handlers ───────────────────────────────────────────────────────
export async function getAllIntegrations(req, reply) {
  const result = {};
  for (const type of TYPES) {
    const cfg = store[type] || null;
    result[type] = {
      configured: cfg !== null,
      status:     cfg ? (store[`${type}_status`] || 'unknown') : 'not_configured',
      lastTested: store[`${type}_tested`] || null,
      config:     cfg ? sanitize(type, cfg) : null,
    };
  }
  return reply.send(result);
}

export async function configureIntegration(req, reply) {
  const { type } = req.params;
  if (!TYPES.includes(type)) return reply.status(400).send({ error: `Unknown type: ${type}. Allowed: ${TYPES.join(', ')}` });

  store[type] = req.body;
  store[`${type}_status`] = 'unknown';
  saveStore(store);
  return reply.send({ success: true, type, message: `${type} integration configured. Run /test to verify connectivity.` });
}

export async function testIntegration(req, reply) {
  const { type } = req.params;
  if (!TYPES.includes(type)) return reply.status(400).send({ error: `Unknown type: ${type}` });

  const cfg = store[type];
  if (!cfg) return reply.status(404).send({ error: `${type} is not configured` });

  const result = await testConnectivity(type, cfg);
  store[`${type}_status`] = result.ok ? 'ok' : 'error';
  store[`${type}_tested`] = new Date().toISOString();
  saveStore(store);

  return reply.status(result.ok ? 200 : 503).send({ type, ...result, testedAt: store[`${type}_tested`] });
}

export async function removeIntegration(req, reply) {
  const { type } = req.params;
  if (!TYPES.includes(type)) return reply.status(400).send({ error: `Unknown type: ${type}` });

  delete store[type];
  delete store[`${type}_status`];
  delete store[`${type}_tested`];
  saveStore(store);
  return reply.send({ success: true, type });
}

// Strip secrets from outbound config
function sanitize(type, cfg) {
  const safe = { ...cfg };
  if (safe.secretAccessKey) safe.secretAccessKey = '***';
  if (safe.password)        safe.password        = '***';
  if (safe.token)           safe.token           = '***';
  if (safe.apiKey)          safe.apiKey          = '***';
  return safe;
}
