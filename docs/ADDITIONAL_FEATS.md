# Integrations & Additional Features — IMS

This document covers all external service integrations and additional platform features beyond the core incident lifecycle.

---

## Integration Management API

All integrations are managed through a unified REST API. Configuration is persisted to `backend/data/integrations.json` and credentials are never returned in plaintext after being stored.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/integrations` | List all integrations with status |
| `PUT` | `/api/v1/integrations/:type` | Configure an integration |
| `POST` | `/api/v1/integrations/:type/test` | Test live connectivity |
| `DELETE` | `/api/v1/integrations/:type` | Remove an integration |

Supported types: `aws`, `prometheus`, `alloy`, `loki`, `uptime_kuma`

---

## Prometheus

Prometheus is the primary alerting source. IMS accepts alerts from both **Prometheus Alertmanager** (the standard alert routing layer) and **Grafana** (when Grafana is used as an alert evaluator).

### Alertmanager webhook

```
POST /api/v1/webhooks/alertmanager
```

Accepts the standard Alertmanager webhook payload. Only `firing` alerts are enqueued — `resolved` alerts are ignored at this endpoint (resolution is handled via Uptime Kuma or manual state transitions).

### Grafana alerts webhook

```
POST /api/v1/webhooks/grafana
```

Accepts the Grafana unified alerting webhook payload, same mapping logic as Alertmanager.

### Alert-to-signal mapping

| Alert field | IMS field | Logic |
|---|---|---|
| `labels.severity` / `labels.priority` | `severity` | `critical`/`p0` → P0, `high`/`p1` → P1, `warning`/`p2` → P2, else P3 |
| `labels.service` / `labels.job` / `labels.instance` | `componentId` | First non-empty wins |
| `labels.job` keyword | `componentType` | `postgres` → RDBMS, `redis` → DISTRIBUTED_CACHE, `kafka` → ASYNC_QUEUE, etc. |
| Alert name keyword | `signalType` | `down`/`outage` → OUTAGE, `latency`/`slow` → LATENCY_SPIKE, `error`/`5xx` → ERROR |

### Connectivity test

Configure and verify a Prometheus instance:

```bash
# Configure
curl -X PUT http://localhost:4000/api/v1/integrations/prometheus \
  -H 'Content-Type: application/json' \
  -d '{"url": "http://prometheus:9090"}'

# Test (hits /api/v1/query?query=1)
curl -X POST http://localhost:4000/api/v1/integrations/prometheus/test
```

---

## Grafana Alloy

Grafana Alloy (formerly Grafana Agent) is a collector for metrics, logs, and traces. IMS can verify that an Alloy instance is reachable before assuming it is actively forwarding data.

### Connectivity test

```bash
# Configure
curl -X PUT http://localhost:4000/api/v1/integrations/alloy \
  -H 'Content-Type: application/json' \
  -d '{"url": "http://alloy:12345"}'

# Test (hits /-/ready)
curl -X POST http://localhost:4000/api/v1/integrations/alloy/test
```

---

## Loki

Loki is Grafana's log aggregation system. IMS can verify Loki reachability and is architected to receive log streams from Loki-compatible sources via the universal log webhook.

### Connectivity test

```bash
# Configure
curl -X PUT http://localhost:4000/api/v1/integrations/loki \
  -H 'Content-Type: application/json' \
  -d '{"url": "http://loki:3100"}'

# Test (hits /ready)
curl -X POST http://localhost:4000/api/v1/integrations/loki/test
```

### Authenticated instances

```bash
curl -X PUT http://localhost:4000/api/v1/integrations/loki \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://loki.corp.internal", "username": "admin", "password": "secret"}'
```

Basic Auth or Bearer token (`token` field) are both supported for connectivity tests.

---

## Uptime Kuma

Uptime Kuma is a self-hosted monitoring tool. IMS has a first-class bidirectional integration: **DOWN events auto-create incidents, UP events auto-resolve them.**

### Webhook endpoint

```
POST /api/v1/webhooks/uptime-kuma
```

Configure Uptime Kuma's notification to point at this URL. No additional authentication is required within a private network.

### DOWN event flow

1. Uptime Kuma sends a heartbeat with `status: 0`.
2. IMS creates a signal with `signalType: OUTAGE` and routes it through the standard ingestion pipeline (rate limiter → queue → debounce → work item).
3. Severity is inferred from the monitor name: `postgres`/`database`/`redis` keywords → P0; `api`/`backend`/`service` → P1; staging/dev → P2.
4. A Redis key `uptime:pending:<monitorId>` is written so the UP event can find the work item.

### UP event flow

1. Uptime Kuma sends a heartbeat with `status: 1`.
2. IMS looks up the active work item via Redis.
3. If found, IMS walks the state machine (`OPEN → INVESTIGATING → RESOLVED`) automatically, writing timeline events and audit entries for each transition.
4. The dashboard updates in real time via WebSocket broadcast.

### Connectivity test

```bash
# Configure (points at your Uptime Kuma instance for health polling)
curl -X PUT http://localhost:4000/api/v1/integrations/uptime_kuma \
  -H 'Content-Type: application/json' \
  -d '{"url": "http://uptime-kuma:3001"}'

# Test (hits /api/v1/info)
curl -X POST http://localhost:4000/api/v1/integrations/uptime_kuma/test
```

---

## AWS

AWS credentials can be registered with IMS for future cloud-native signal sources (CloudWatch alarms, SNS topics, EventBridge rules). Credential validity is checked structurally — IMS confirms that `region`, `accessKeyId`, and `secretAccessKey` are all present.

```bash
curl -X PUT http://localhost:4000/api/v1/integrations/aws \
  -H 'Content-Type: application/json' \
  -d '{
    "region": "us-east-1",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "..."
  }'
```

The `secretAccessKey` is stored server-side but is never returned in GET responses (replaced with `***`).

```bash
# Check status
curl -X POST http://localhost:4000/api/v1/integrations/aws/test
# → {"ok": true, "message": "Credentials configured"}
```

---

## Universal Log Webhook

Any service can ship log lines to IMS without a custom adapter. The endpoint accepts JSON objects, JSON arrays, and plain text.

```
POST /api/v1/webhooks/logs
```

### Log classification

Every inbound log record is scored by `LogClassifier`:

| Score | Severity | Action |
|---|---|---|
| < 15 | P3 | Stored in MongoDB only, no work item |
| 15–29 | P2 | Stored + creates DEGRADED work item |
| 30–49 | P1 | Stored + creates ERROR/OUTAGE work item |
| ≥ 50 | P0 | Stored + creates CRITICAL work item |

Scoring factors:

- **Log level** — `fatal`/`panic`/`critical` +40, `error` +25, `warn` +12, `debug` -5
- **Crash keywords** — `crash`, `OOM kill`, `segfault`, `core dump` +35
- **Connectivity failure** — `ECONNREFUSED`, `service unavailable`, `node down` +28
- **HTTP 5xx in message** — +22
- **Timeout / resource exhaustion** — `timeout`, `out of memory`, `deadlock`, `pool exhausted` +20
- **Circuit breaker** — `circuit open`, `max retries` +18
- **Generic failure** — `exception`, `unhandled error` +18, `fail`/`error` +14
- **Latency / degradation** — `slow query`, `p99`, `degraded` +12
- **Stack traces** — presence of `at ` lines +10

### Accepted formats

```bash
# Single JSON object
curl -X POST http://localhost:4000/api/v1/webhooks/logs \
  -H 'Content-Type: application/json' \
  -d '{"level": "error", "message": "ECONNREFUSED postgres:5432", "service": "api"}'

# JSON array (batch)
curl -X POST http://localhost:4000/api/v1/webhooks/logs \
  -H 'Content-Type: application/json' \
  -d '[{"level":"warn","msg":"slow query 2300ms"},{"level":"error","message":"timeout"}]'

# Plain text
curl -X POST http://localhost:4000/api/v1/webhooks/logs \
  -H 'Content-Type: text/plain' \
  -d 'FATAL: kernel panic — not syncing: VFS'
```

### Querying stored logs

```
GET /api/v1/logs?severity=P0&service=api&limit=50&offset=0
GET /api/v1/logs/stats
```

---

## Raw Signal Webhook

For services that don't speak Alertmanager or Grafana format, IMS exposes a generic signal endpoint:

```
POST /api/v1/webhooks/signal
```

```json
{
  "componentId": "payments-service",
  "componentType": "API",
  "signalType": "LATENCY_SPIKE",
  "severity": "P1",
  "payload": { "p99_ms": 4200, "region": "eu-west-1" }
}
```

This bypasses the label-mapping layer and goes directly into the ingestion queue.

---

## Real-Time WebSocket

All state changes are pushed to every connected dashboard client immediately — no polling required.

```
WS /ws
```

### Events

| Event | Trigger |
|---|---|
| `WORK_ITEM_CREATED` | New work item from any signal source |
| `WORK_ITEM_UPDATED` | Status change, escalation, RCA submit, owner reassign, auto-resolve |

The React dashboard's `useWebSocket` hook reconnects automatically with exponential backoff on disconnect.

---

## Escalation Worker

A background worker runs every 60 seconds and escalates any unacknowledged OPEN work item that has exceeded its SLA window.

| Severity | SLA window |
|---|---|
| P0 | 5 minutes |
| P1 | 15 minutes |
| P2 | 60 minutes |
| P3 | 4 hours |

Each escalation increments `escalationLevel`, writes a `ESCALATED` timeline event, writes an audit diff, and broadcasts `WORK_ITEM_UPDATED` to the dashboard. Acknowledging a work item (`POST /api/v1/work-items/:id/acknowledge`) stops the SLA clock.

---

## Metrics Reporter

A server-side logger prints ingestion throughput every 5 seconds:

```
[METRICS] Signals/sec: 9847.2 | Queue depth: 312/50000
```

This is visible in container logs and can be piped to any log aggregation tool (Loki, Datadog, CloudWatch).

---

## Simulation Scripts

Two scripts exercise the full integration stack end-to-end:

```bash
# Multi-service cascading failure: RDBMS → MCP → Cache → API
node scripts/mock_failure_scenario.js

# Focused RDBMS outage then MCP failure with timing gaps and recovery signals
node scripts/mock_rdbms_mcp_scenario.js
```

These send real signals to the running IMS instance and are useful for load testing the ingestion pipeline, verifying Uptime Kuma auto-resolution, and demoing the escalation worker under time pressure.
