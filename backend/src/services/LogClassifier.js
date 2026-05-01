// Scores incoming log records and decides severity + signal type.
// Score < 15  → P3  (store only, no work item)
// Score 15-29 → P2  (warning)
// Score 30-49 → P1  (high)
// Score >= 50 → P0  (critical)

const LEVEL_SCORE = {
  fatal:    40, panic:    40, critical: 40,
  error:    25, err:      25,
  warn:     12, warning:  12,
  info:      0, notice:    0,
  debug:    -5, trace:    -5, verbose: -5,
};

const KEYWORD_RULES = [
  // crash / total outage — highest weight
  { pattern: /\b(crash(ed)?|kernel panic|oom.?kill(ed)?|killed by signal)\b/i,       score: 35 },
  { pattern: /\b(segfault|segmentation fault|core dump)\b/i,                          score: 35 },
  // connectivity failure
  { pattern: /\b(connection refused|econnrefused|enotfound)\b/i,                      score: 28 },
  { pattern: /\b(service unavailable|server down|host unreachable|node down)\b/i,     score: 28 },
  // HTTP 5xx in message
  { pattern: /\b(5[0-9]{2})\b/,                                                       score: 22 },
  // timeout / resource exhaustion
  { pattern: /\b(timeout|timed.?out|deadline exceeded)\b/i,                           score: 20 },
  { pattern: /\b(out of memory|oom|memory exhausted|disk full|no space left)\b/i,    score: 20 },
  { pattern: /\b(deadlock|lock timeout|pool exhausted|connection pool)\b/i,           score: 20 },
  // generic failure
  { pattern: /\b(exception|unhandled error|uncaught|panic:)\b/i,                      score: 18 },
  { pattern: /\b(fail(ed|ure)?|error(ed)?)\b/i,                                       score: 14 },
  // circuit breaker / retry saturation
  { pattern: /\b(circuit.?open|circuit.?breaker|max retries|retry.?exhausted)\b/i,   score: 18 },
  // latency / degradation
  { pattern: /\b(slow query|high latency|p99|p95|response time)\b/i,                 score: 12 },
  { pattern: /\b(degraded|partial outage|reduced capacity)\b/i,                       score: 12 },
  // HTTP 4xx (client errors, generally lower severity)
  { pattern: /\b(40[0-9]|429)\b/,                                                     score:  8 },
  // stack traces (multi-line hint — presence of "    at " is a strong signal)
  { pattern: /^\s+at\s+/m,                                                            score: 10 },
];

const OUTAGE_PATTERNS  = /\b(down|crash|unavailable|unreachable|refused|killed|outage|node down)\b/i;
const LATENCY_PATTERNS = /\b(timeout|slow|latency|response.?time|p99|p95|delay)\b/i;
const ERROR_PATTERNS   = /\b(error|exception|fail|5[0-9]{2}|circuit.?open)\b/i;

const COMPONENT_MAP = [
  [/postgres|mysql|rds|rdbms|mariadb/i,     'RDBMS'],
  [/redis|cache|memcache|valkey/i,           'DISTRIBUTED_CACHE'],
  [/mongo|dynamo|elastic|opensearch/i,       'NOSQL'],
  [/kafka|sqs|rabbitmq|nats|queue|pubsub/i,  'ASYNC_QUEUE'],
  [/mcp|host/i,                              'MCP_HOST'],
];

function detectComponentType(service = '') {
  for (const [re, type] of COMPONENT_MAP) {
    if (re.test(service)) return type;
  }
  return 'API';
}

function detectSignalType(message = '') {
  if (OUTAGE_PATTERNS.test(message))  return 'OUTAGE';
  if (LATENCY_PATTERNS.test(message)) return 'LATENCY_SPIKE';
  if (ERROR_PATTERNS.test(message))   return 'ERROR';
  return 'DEGRADED';
}

function scoreToSeverity(score) {
  if (score >= 50) return 'P0';
  if (score >= 30) return 'P1';
  if (score >= 15) return 'P2';
  return 'P3';
}

export function classifyLog({ level = '', message = '', service = '', source = '' }) {
  let score = 0;

  // Level bonus
  const levelKey = level.toLowerCase().trim();
  score += LEVEL_SCORE[levelKey] ?? 0;

  // Keyword scanning
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(message)) score += rule.score;
  }

  // Floor at 0
  score = Math.max(0, score);

  const severity      = scoreToSeverity(score);
  const signalType    = detectSignalType(message);
  const componentType = detectComponentType(service || source);

  return { score, severity, signalType, componentType, shouldCreateWorkItem: severity !== 'P3' };
}

export function normalizeLogEntry(raw) {
  // Accept multiple shapes:
  // { level, message/msg/log, service/app/source, host, timestamp/time/ts, metadata }
  const message   = raw.message || raw.msg   || raw.log   || raw.text    || String(raw);
  const level     = raw.level   || raw.lvl   || raw.severity || 'info';
  const service   = raw.service || raw.app   || raw.source || raw.job    || 'unknown';
  const host      = raw.host    || raw.hostname || raw.node  || null;
  const timestamp = raw.timestamp || raw.time || raw.ts   || new Date().toISOString();

  // Scrub known fields to form metadata
  const { message: _m, msg: _ms, log: _l, text: _t,
          level: _lv, lvl: _lvl, severity: _sv,
          service: _s, app: _a, source: _src, job: _j,
          host: _h, hostname: _hn, node: _n,
          timestamp: _ts, time: _ti, ts: _t2, ...rest } = raw;

  return { message, level, service, host, timestamp: new Date(timestamp), metadata: rest };
}
