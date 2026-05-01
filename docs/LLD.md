# LLD — Low-Level Design

Data handling, concurrency model, backpressure, and scaling decisions.

---

## 1. Signal Ingestion Pipeline

### End-to-End Path

```
POST /api/v1/signals
      │
      │  Fastify parses JSON body — synchronous, O(1)
      ▼
[TokenBucketRateLimiter.allow()]
      │  true  → continue
      │  false → HTTP 429, X-RateLimit-Reset header
      ▼
[BoundedQueue.put(signal)]
      │  true  → HTTP 202 Accepted (signal is queued, not yet persisted)
      │  false → HTTP 503, Retry-After: 1 (queue full — backpressure)
      ▼
[return to caller immediately]     ← HTTP response already sent

...concurrently, in the background...

[workerLoop() — 10 instances]
      │
      await signalQueue.get()      ← blocks until item available
      │
      await processOne(signal)
            ├── insertSignal(MongoDB)         — raw document, always
            ├── debounceManager.check()       — Redis SETNX
            │       ├── isNew → createWorkItem(PostgreSQL) + alert + timeline + broadcast
            │       └── exists → incrementSignalCount(PostgreSQL)
            └── insertSignalMetric(TimescaleDB)
```

### Why 202, Not 200?

The HTTP 202 Accepted response is intentional. The signal has been accepted into the queue but not yet written to any database. This is honest — the caller knows persistence is asynchronous. If the process crashes between 202 and the DB write, the signal is lost (this is an acceptable trade-off for 10k/sec throughput; a durable queue like Kafka would be the upgrade path for zero-loss requirements).

---

## 2. Backpressure

Backpressure is the mechanism that prevents the system from accepting more work than it can process, avoiding memory exhaustion and cascade failures.

### Layer 1 — Token Bucket Rate Limiter

```
Class: TokenBucketRateLimiter
File:  src/core/RateLimiter.js

State:
  _tokens     = rate (starts full)
  _maxTokens  = rate (10,000)
  _refillRate = rate tokens / second
  _lastRefill = Date.now()

allow():
  _refill()                           // top up tokens proportional to elapsed time
  if (_tokens < 1) return false       // bucket empty → reject
  _tokens -= 1
  return true
```

This is a **leaky-bucket** variant — the bucket refills continuously over time rather than at discrete tick boundaries, giving a smooth rate rather than a burst at the start of each second.

**At the API layer**, the Fastify hook checks `rateLimiter.allow()` before any route handler runs. If false, the request gets a 429 immediately — no queue entry, no DB hit.

### Layer 2 — BoundedQueue

```
Class: BoundedQueue
File:  src/core/BoundedQueue.js

put(item):
  if queue.length >= maxSize: return false   ← caller sends 503
  queue.push(item)
  wake any blocked get() waiter
  return true

get():  (async)
  while queue is empty: await new Promise(...)  ← worker sleeps
  return queue.shift()
```

The queue has `maxSize = 50,000`. This caps the heap impact of buffered signals. If all 10 workers are fully occupied writing to slow databases, the queue will fill up; once it does, the HTTP layer returns 503 with `Retry-After: 1` to signal the client to back off. This turns memory pressure into an explicit HTTP status rather than an out-of-memory crash.

**Why 50,000?** At an average signal JSON payload of ~300 bytes, 50,000 items = ~15 MB of heap — safe. At 10,000 items/sec intake and 10 workers each processing ~1,000 items/sec (conservative), the queue would drain as fast as it fills at steady state, giving a 5-second burst buffer.

### What Happens During a Slow DB Write?

```
Workers = 10
DB write latency spike = 500ms (e.g., PostgreSQL overloaded)
Queue fill rate = 10,000 signals/sec
Worker throughput during spike = 10 workers / 0.5s = 20 writes/sec

Queue fills at 10,000 - 20 = 9,980 items/sec
Time to fill 50,000-item queue = ~5 seconds
After 5 seconds, HTTP 503s begin

When DB recovers → workers drain queue → 503s stop
```

This gives operators a 5-second window to notice a DB issue before external callers see errors. The queue depth is available on `/health` as `queueDepth`.

---

## 3. Debounce Logic

The purpose of debouncing is to collapse a storm of identical signals (e.g., 1,000 "RDBMS_PRIMARY CONN_REFUSED" events from 10 services retrying in a loop) into exactly one Work Item.

### Redis SETNX Pattern

```
Key:   debounce:<componentId>
Value: workItemId (UUID)
TTL:   DEBOUNCE_WINDOW_SECONDS (default: 10)

On signal for componentId "RDBMS_PRIMARY":
  1. GET debounce:RDBMS_PRIMARY
     → value exists → return { workItemId: existing, isNew: false }
     → nil          → continue

  2. In-process guard: check _inFlight Map
     → same componentId already being created in this process?
        → await the in-flight promise → return { workItemId, isNew: false }
     → not in flight → mark as in-flight

  3. Create Work Item in PostgreSQL → returns workItemId

  4. SET debounce:RDBMS_PRIMARY = workItemId EX 10
     DELETE _inFlight entry
     Resolve in-flight promise (unblocks any concurrent waiters)
     → return { workItemId, isNew: true }
```

The dual guard (Redis SETNX + in-process `_inFlight` Map) handles two concurrency scenarios:
- **Cross-request**: two HTTP requests arrive simultaneously for the same component. The second one hits Redis and finds the key set by the first.
- **Intra-process**: two worker iterations running concurrently in the same event loop both call `check()` before either has created the Work Item. The `_inFlight` Map serializes them.

### TTL Semantics

The 10-second TTL means: if no signal for `RDBMS_PRIMARY` arrives for 10 seconds, the debounce key expires. The next signal will create a new Work Item. This is intentional — a brief recovery followed by re-degradation should be a separate incident.

---

## 4. Concurrency Model

Node.js uses a single-threaded event loop with non-blocking I/O. There are no OS threads for request handling.

### Worker Loop Pattern

```javascript
async function workerLoop() {
  while (true) {
    const signal = await signalQueue.get();   // suspends here when queue empty
    await processOne(signal);                  // suspends during DB I/O
  }
}

// 10 instances started at boot
for (let i = 0; i < count; i++) workerLoop();
```

Each `workerLoop()` call returns a Promise that never resolves — it runs forever as an async loop. When `signalQueue.get()` awaits, control returns to the event loop, allowing other workers or incoming HTTP requests to run. This is cooperative multitasking: the event loop runs all 10 workers interleaved without OS-level threads.

**Why 10 workers?** Each worker spends most of its time awaiting DB I/O (MongoDB writes ~1-2ms, PostgreSQL writes ~2-5ms). With 10 workers each processing ~400 items/sec (accounting for await pauses), total throughput is ~4,000 items/sec — well within the 10k ingestion rate, with headroom for burst. `WORKER_COUNT` is configurable.

### Parallel DB Writes

Inside `processOne`, some writes are independent and run in parallel:

```javascript
await Promise.all([
  insertTimelineEvent(...),
  insertAuditEntry(...),
]);
```

PostgreSQL timeline + audit entries write concurrently. The single mandatory sequential dependency is: debounce check → (if new) create Work Item → register debounce key. Everything after that can be parallelised.

---

## 5. Data Layer Design

### Why Three Different Databases?

Each store is chosen for its access pattern, not vendor loyalty.

| Store | Access Pattern | Why It Fits |
|---|---|---|
| **PostgreSQL** | ACID transactions, complex joins, foreign keys | Work item lifecycle requires exact state; RCA → closure must be atomic |
| **MongoDB** | High-volume writes, flexible schema, no joins needed | Raw signals and logs are written once, read occasionally; schema varies by signal type |
| **Redis** | Sub-millisecond key lookups, TTL-based expiry | Debounce windows must be checked on every signal; TTL maps perfectly to sliding window |
| **TimescaleDB** | Time-range aggregations over millions of rows | `signal_metrics` hypertable enables `COUNT(*) WHERE time > NOW() - INTERVAL '1h'` without full-table scans |

### Repository Pattern

Every database interaction lives in a repository file. Services never call `pg.query()` directly. This means:

- DB query logic is tested in isolation
- Swapping the DB (e.g., PostgreSQL → CockroachDB) touches only the repository
- Retry logic lives in one place (`withRetry` in `postgres.js`), not scattered across services

### Retry Logic

```javascript
// postgres.js
export async function withRetry(fn, retries = 3, delayMs = 200) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(delayMs * attempt);  // 200ms, 400ms, 600ms
    }
  }
}
```

All PostgreSQL writes are wrapped in `withRetry`. Transient errors (connection reset, pool timeout) are retried up to 3 times with linear backoff. MongoDB writes use the Motor driver's built-in retry.

---

## 6. State Machine

```
States:      OPEN → INVESTIGATING → RESOLVED → CLOSED
Transitions: strict — only forward, no skips, no rollback

TRANSITIONS map:
  OPEN          → ['INVESTIGATING']
  INVESTIGATING → ['RESOLVED']
  RESOLVED      → ['CLOSED']   (requires complete RCA)
  CLOSED        → []           (terminal)
```

**Why functional (not class-based)?** The state machine is implemented as plain objects returned by a factory function (`stateFromStatus(status)`). Each "state" is an object with `transition()` and `allowedTransitions()`. There is no inheritance, no `this`, no class hierarchy. This makes the state machine:

- Easier to test — call `stateFromStatus('OPEN').transition('CLOSED')`, assert it throws
- Easier to serialise — the state is just the status string; no object instance to persist
- Easier to reason about — no hidden instance state

**RCA gate on CLOSED:** The `RESOLVED → CLOSED` transition validates that all five RCA fields are non-empty and that `incidentEnd > incidentStart`. If validation fails, `RCAValidationError(422)` is thrown before any DB write occurs.

---

## 7. Log Classification Engine

The `LogClassifier.js` service scores incoming log records to determine severity without relying on the sender to self-report severity accurately.

### Scoring Algorithm

```
score = LEVEL_SCORE[log.level] + sum(KEYWORD_RULES where pattern matches log.message)

LEVEL_SCORE:
  fatal / panic / critical  → +40
  error                     → +25
  warn                      → +12
  info                      → 0
  debug / trace             → -5

KEYWORD_RULES (examples):
  /crash|oom.?kill/i        → +35
  /connection refused/i     → +28
  /5[0-9]{2}/               → +22  (HTTP 5xx in message)
  /timeout|timed.?out/i     → +20
  /fail(ed|ure)?/i          → +14

Score thresholds:
  ≥ 50  → P0 (critical, create work item)
  30-49 → P1 (high, create work item)
  15-29 → P2 (medium, create work item)
  < 15  → P3 (store only, no work item)
```

**Why store P3 at all?** P3 logs are stored in MongoDB's `raw_logs` collection but do not create work items. This ensures audit completeness — every log that came in is retrievable — without flooding the incident feed with noise.

---

## 8. Escalation Worker

The escalation worker is a background loop that runs every 60 seconds. It queries PostgreSQL for all open, unacknowledged work items older than their SLA threshold:

```
SLA thresholds:
  P0 → 5 minutes  (300s)
  P1 → 15 minutes (900s)
  P2 → 1 hour     (3600s)
  P3 → 4 hours    (14400s)
```

For each breached item, it increments `escalation_level`, writes a ESCALATED timeline event, broadcasts via WebSocket, and logs a warning. The escalation badge on the dashboard pulsing red gives operators immediate visual priority.

**Why 60s interval?** It's a balance between SLA granularity and DB query load. A P0 SLA of 5 minutes with a 60s check interval means worst-case escalation lag is 60s after breach — acceptable for ops tooling.

---

## 9. Scaling Considerations

### Vertical Scaling (current model)

The current single-process Node.js backend scales well vertically:

- Increasing `WORKER_COUNT` adds more concurrent DB writers
- Increasing `QUEUE_MAX_SIZE` extends the burst buffer
- Increasing `RATE_LIMIT_PER_SEC` allows higher ingestion

### Horizontal Scaling

To run multiple backend instances:

1. **Rate limiter** — move token bucket to Redis (`INCR` + `EXPIRE` pattern). The current in-process bucket can't be shared across instances.
2. **BoundedQueue** — replace with Redis list (`LPUSH`/`BRPOP`) or a real message queue (Kafka, SQS). Workers become independent consumer processes.
3. **Debounce** — already Redis-based; the in-process `_inFlight` guard would need to be replaced with a Redis `SET NX` with a short TTL to handle cross-instance races.
4. **WebSocket** — use Redis Pub/Sub as the broadcast bus. Each instance subscribes and broadcasts to its own connections. The `ConnectionManager` publish method would call `redis.publish('ws:events', payload)` instead of directly iterating sockets.

### TimescaleDB for Signal Analytics

The `signal_metrics` hypertable enables queries like:

```sql
SELECT component_id, COUNT(*) as signal_count
FROM signal_metrics
WHERE time > NOW() - INTERVAL '1 hour'
GROUP BY component_id
ORDER BY signal_count DESC;
```

TimescaleDB automatically partitions by time, so this query scans only the relevant chunks rather than the entire table. Continuous aggregates can pre-compute hourly rollups for dashboard charts.
