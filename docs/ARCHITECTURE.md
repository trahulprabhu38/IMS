# Architecture — IMS Incident Management System

---

## System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         EXTERNAL SIGNAL SOURCES                         ║
║  Coolify Services · Uptime Kuma · CI/CD Pipelines · Manual curl/POST    ║
╚══════════╤═══════════════════════════════════════════╤═══════════════════╝
           │ POST /api/v1/signals                      │ POST /api/v1/webhooks/*
           │ POST /api/v1/webhooks/logs                │ (Uptime Kuma DOWN/UP)
           ▼                                           ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                     FASTIFY API SERVER  (Node.js 20)                    ║
║                                                                          ║
║  ┌─────────────────────────────────────────────────────────────────┐    ║
║  │               Ingestion Pipeline                                 │    ║
║  │                                                                  │    ║
║  │  ① Token-Bucket Rate Limiter (10,000 req/sec)                   │    ║
║  │         │ 429 Too Many Requests if exhausted                     │    ║
║  │         ▼                                                        │    ║
║  │  ② BoundedQueue (maxSize=50,000 items)                          │    ║
║  │         │ 503 Service Unavailable if full (backpressure)         │    ║
║  │         ▼                                                        │    ║
║  │  ③ 10 × Async Worker Loops (drain queue concurrently)           │    ║
║  │         │                                                        │    ║
║  │         ├──④ Redis SETNX Debounce (10s sliding window)          │    ║
║  │         │       │ isNew=true  → create Work Item in PostgreSQL   │    ║
║  │         │       │ isNew=false → increment signal_count only      │    ║
║  │         │                                                        │    ║
║  │         ├──⑤ MongoDB: store raw signal (always)                 │    ║
║  │         ├──⑥ TimescaleDB: insert signal_metrics hypertable      │    ║
║  │         └──⑦ WebSocket broadcast → all dashboard clients        │    ║
║  └─────────────────────────────────────────────────────────────────┘    ║
║                                                                          ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐     ║
║  │  State Machine   │  │ Alert Strategies  │  │ Escalation Worker │     ║
║  │  OPEN            │  │  P0 → CRITICAL    │  │  60s interval     │     ║
║  │  INVESTIGATING   │  │  P1 → ERROR       │  │  SLA: P0=5m       │     ║
║  │  RESOLVED        │  │  P2 → WARN        │  │       P1=15m      │     ║
║  │  CLOSED          │  │  P3 → INFO        │  │       P2=1h       │     ║
║  └──────────────────┘  └──────────────────┘  └───────────────────┘     ║
║                                                                          ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐     ║
║  │  Log Classifier  │  │ Timeline Writer  │  │  Audit Logger     │     ║
║  │  Score → P0-P3   │  │  incident_events │  │  before/after diff│     ║
║  └──────────────────┘  └──────────────────┘  └───────────────────┘     ║
╚═══════╤════════════════════╤═════════════════════╤════════════════════════╝
        │                    │                     │
        ▼                    ▼                     ▼
╔═══════════════╗  ╔═════════════════════╗  ╔═════════════════╗
║   Redis 7     ║  ║ PostgreSQL 16 +     ║  ║  MongoDB 7      ║
║               ║  ║ TimescaleDB         ║  ║                 ║
║ debounce:*    ║  ║                     ║  ║ signals         ║
║ workitem:*    ║  ║ work_items          ║  ║ (raw documents) ║
║ uptime:*      ║  ║ rca_records         ║  ║                 ║
║ (TTL-based)   ║  ║ incident_events     ║  ║ raw_logs        ║
║               ║  ║ audit_log           ║  ║ (all log ingest)║
║               ║  ║ signal_metrics      ║  ║                 ║
║               ║  ║ (hypertable)        ║  ║                 ║
╚═══════════════╝  ╚═════════════════════╝  ╚═════════════════╝
        ▲                    ▲                     ▲
        └────────────────────┴─────────────────────┘
                             │  REST/WS
╔══════════════════════════════════════════════════════════════════════════╗
║                       REACT DASHBOARD  (Vite)                            ║
║                                                                          ║
║  ┌──────────────┐  ┌───────────────────┐  ┌────────────────────────┐   ║
║  │  Live Feed   │  │  Incident Detail  │  │  Logs Viewer           │   ║
║  │              │  │  · Signals tab    │  │  · Stats bar           │   ║
║  │  P0–P3 cards │  │  · Timeline tab   │  │  · Severity filter     │   ║
║  │  escalation  │  │  · Audit tab      │  │  · Paginated stream    │   ║
║  │  badges      │  │  · Owner strip    │  └────────────────────────┘   ║
║  └──────────────┘  │  · SLA countdown  │                                ║
║                    │  · RCA form       │  ┌────────────────────────┐   ║
║  WebSocket hook:   └───────────────────┘  │  Integration Panel     │   ║
║  auto-reconnect,                          │  · Loki / Datadog      │   ║
║  refreshKey on                            │  · PagerDuty           │   ║
║  WORK_ITEM_UPDATED                        │  · Uptime Kuma         │   ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Component Responsibilities

### Fastify API Server

The single backend process handles all concerns via async Node.js. There are no threads — all concurrency is managed through the event loop and the worker queue pattern.

- **Routes** — thin, validates input, delegates to controllers
- **Controllers** — parse request, call services, format response
- **Services** — orchestrate business logic (WorkItemService, SignalProcessor, EscalationWorker)
- **Repositories** — pure DB access functions, no business logic
- **Patterns** — WorkItemState (state machine), AlertStrategy (dispatch by severity)
- **Core** — BoundedQueue, TokenBucketRateLimiter, DebounceManager, MetricsReporter

### PostgreSQL + TimescaleDB

The authoritative source of truth. Every work item lifecycle event, RCA, and audit entry lives here. TimescaleDB is installed as an extension on the same PostgreSQL instance; the `signal_metrics` table is a hypertable partitioned by time, enabling fast range queries over signal volume without impacting the relational tables.

**Tables:**

| Table | Purpose |
|---|---|
| `work_items` | One row per unique incident, including owner, SLA state, MTTR |
| `rca_records` | Root cause analysis linked to a work item |
| `incident_events` | Append-only timeline: created, status_changed, rca_submitted, escalated, ack |
| `audit_log` | Structured before/after diff for every mutation |
| `signal_metrics` | TimescaleDB hypertable: one row per signal for time-series aggregation |

### MongoDB

Write-optimized store for high-volume, schemaless data:

- **signals collection** — every raw signal ever received, linked to a work item by `workItemId`. Indexed on `{ componentId, timestamp }` and `{ workItemId }` for fast retrieval.
- **raw_logs collection** — every log line received via the universal webhook, including the computed severity score. Never deleted; forms a searchable audit trail of external log activity.

### Redis

In-memory, TTL-driven state:

- `debounce:<componentId>` — the active work item ID for a component; expires after 10s. The critical SETNX guard that prevents signal storms from creating duplicate work items.
- `workitem:<id>` — cached work item JSON for fast dashboard reads without hitting PostgreSQL on every poll.
- `uptime:active:<monitorId>` — maps an Uptime Kuma monitor to the active work item ID; used to auto-resolve on UP events. 1h TTL.

### WebSocket Connection Manager

`ConnectionManager` holds a `Set` of active WebSocket sockets. On any state change (work item created, status changed, RCA submitted, escalated), the service layer calls `broadcast(eventType, payload)`, which serialises the event to JSON and sends it to every connected client. The React `useWebSocket` hook handles reconnect with exponential backoff.

---

## Data Flow — Signal Ingestion

```
Client POSTs signal
        │
        ▼
[Rate Limiter] — 429 if bucket empty
        │
        ▼
[BoundedQueue.put()] — 503 if queue >= 50,000
        │
        ▼ (async, decoupled)
[Worker Loop — 10 concurrent]
        │
        ├──[MongoDB] insertSignal (always)
        ├──[Redis] debounceManager.check(componentId)
        │       │
        │       ├── isNew=true  → [PostgreSQL] createWorkItem
        │       │                → [Redis] register debounce key
        │       │                → [Alert] sendAlert(severity)
        │       │                → [Timeline] insertTimelineEvent(CREATED)
        │       │                → [WS] broadcast(WORK_ITEM_CREATED)
        │       │
        │       └── isNew=false → [PostgreSQL] incrementSignalCount
        │
        └──[TimescaleDB] insertSignalMetric
```

---

## Data Flow — State Transition

```
PATCH /api/v1/work-items/:id/status  { status: "INVESTIGATING" }
        │
        ▼
[WorkItemService.transitionWorkItem]
        │
        ├──[stateFromStatus(current)] → validateTransition → new state
        ├──[PostgreSQL] updateWorkItemStatus
        ├──[Redis] setWorkItem (invalidate cache)
        ├──[PostgreSQL] insertTimelineEvent (STATUS_CHANGED)
        ├──[PostgreSQL] insertAuditEntry (before/after diff)
        └──[WS] broadcast(WORK_ITEM_UPDATED)
```

---

## Backpressure Strategy

See [docs/LLD.md — Backpressure](./LLD.md#backpressure) for full detail.

In short: two layers protect the system from being overwhelmed.

1. **Token bucket** — drops requests above 10,000/sec at the HTTP layer (429). No queue entry is made.
2. **BoundedQueue** — if the 10 workers can't drain fast enough and the queue reaches 50,000 items, new signals get a 503 with `Retry-After: 1`. The in-memory queue never grows beyond its cap, preventing heap exhaustion.

---

## Design Patterns

### State Pattern

`WorkItemState.js` implements a functional state machine. Each status (OPEN, INVESTIGATING, RESOLVED, CLOSED) is represented by an object with `transition(targetStatus, rca)`. Calling `transition` with an illegal target throws `InvalidTransitionError(422)`. The CLOSED state additionally validates RCA completeness before accepting the transition.

### Strategy Pattern

`AlertStrategy.js` maps severity to a handler function. `P0` logs CRITICAL and structures the alert for an on-call page. `P1` logs ERROR. `P2` logs WARN. `P3` logs INFO. The strategy is selected at runtime based on the signal's severity — adding a new severity level or changing dispatch behaviour (e.g., adding PagerDuty calls) requires only a change to the handler map, not the calling code.
