# IMS — Incident Management System

A production-grade, full-stack Incident Management System built to ingest signals at 10,000/sec, apply intelligent debouncing, manage incident lifecycles through design patterns, and surface everything in a real-time React dashboard.

---

## Quick Start

```bash
# Clone and launch everything in one command
./start.sh
```

Then open **http://localhost:3000** — the dashboard is live.

> See [NOTES.md](./NOTES.md) for detailed run instructions, environment variables, and script usage.

---

## Navigation

| Document | Description |
|---|---|
| [NOTES.md](./NOTES.md) | Running the system — Docker Compose, scripts, env vars, test commands |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture diagram, component responsibilities, data flow |
| [docs/LLD.md](./docs/LLD.md) | Low-level design: signal pipeline, concurrency, backpressure, scaling |
| [docs/MTTR.md](./docs/MTTR.md) | MTTR calculation — definition, formula, implementation, edge cases |
| [docs/KUBERNETES.md](./docs/KUBERNETES.md) | Kubernetes deployment manifests and operational guide |
| [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) | External service integrations — Prometheus, Loki, Alloy, Uptime Kuma, AWS, universal log webhook |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Dashboard                               │
│           Live Feed · Incident Detail · RCA Form · Logs             │
└─────────────────────┬───────────────────────────────────────────────┘
                      │  REST + WebSocket (ws://)
┌─────────────────────▼───────────────────────────────────────────────┐
│                     Fastify API  (Node.js)                           │
│  Token-Bucket Rate Limiter → BoundedQueue → 10× Async Workers        │
│  State Machine · Alert Strategy · Escalation Worker · Log Classifier │
└──────┬──────────────┬──────────────────────┬────────────────────────┘
       │              │                      │
┌──────▼──────┐ ┌─────▼──────┐  ┌───────────▼──────────┐
│   Redis 7   │ │ PostgreSQL │  │     MongoDB 7         │
│  Debounce   │ │ TimescaleDB│  │  Raw Signals + Logs   │
│  Dashboard  │ │ Work Items │  │  (schemaless, fast)   │
│  Cache      │ │ RCA Records│  └──────────────────────┘
│  WS State   │ │ Audit Log  │
└─────────────┘ │ TimeSeries │
                └────────────┘
```

Full architecture details → [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| API Server | **Node.js 20 + Fastify** | Non-blocking I/O, native async, fastest Node HTTP framework |
| Source of Truth | **PostgreSQL 16 + TimescaleDB** | ACID for work items and RCA; hypertable for signal time-series |
| Data Lake | **MongoDB 7** | Schemaless, high-volume raw signal and log writes |
| Hot-Path Cache | **Redis 7** | Debounce windows, dashboard state, sub-millisecond reads |
| In-Memory Buffer | **BoundedQueue** (asyncio pattern) | Decouples 10k/sec ingestion from slower DB writes |
| Frontend | **React + Vite** | Component-driven, WebSocket live updates |
| Containers | **Docker Compose** | One-command orchestration of all 5 services |

---

## Key Features

- **10,000 signals/sec ingestion** — token-bucket rate limiter + bounded in-memory queue with backpressure
- **Intelligent debouncing** — Redis SETNX sliding window collapses burst signals into one work item per component
- **State machine lifecycle** — OPEN → INVESTIGATING → RESOLVED → CLOSED with enforced transitions
- **RCA-gated closure** — work items cannot be closed without a complete Root Cause Analysis
- **Auto MTTR calculation** — computed atomically in a PostgreSQL transaction at closure
- **Escalation worker** — SLA-aware background loop escalates unacknowledged incidents (P0: 5m, P1: 15m)
- **Universal log webhook** — classifies logs from any source by score → P0–P3 severity
- **Uptime Kuma integration** — DOWN events auto-create incidents; UP events auto-resolve them
- **Real-time dashboard** — WebSocket broadcasts every state change to all connected clients
- **Full audit trail** — before/after diff log for every action, accessible per incident

---

## API Reference (Summary)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/signals` | Ingest a signal (rate-limited, queued) |
| `GET` | `/api/v1/work-items` | List all work items (Redis cache) |
| `GET` | `/api/v1/work-items/:id` | Work item detail + raw signals |
| `PATCH` | `/api/v1/work-items/:id/status` | Trigger state transition |
| `POST` | `/api/v1/work-items/:id/rca` | Submit RCA (gates CLOSED transition) |
| `GET` | `/api/v1/work-items/:id/timeline` | Chronological event timeline |
| `GET` | `/api/v1/work-items/:id/audit` | Structured before/after audit log |
| `PATCH` | `/api/v1/work-items/:id/owner` | Reassign owner |
| `POST` | `/api/v1/work-items/:id/acknowledge` | Acknowledge incident (stops SLA clock) |
| `POST` | `/api/v1/webhooks/logs` | Universal log ingest (any format) |
| `POST` | `/api/v1/webhooks/uptime-kuma` | Uptime Kuma DOWN/UP webhook |
| `GET` | `/api/v1/logs` | Query stored logs |
| `GET` | `/api/v1/logs/stats` | Log stats by severity |
| `GET` | `/health` | Health check (all stores) |
| `WS` | `/ws` | Live dashboard updates |

---

## Simulation Scripts

```bash
# Full cascading failure: RDBMS → MCP → Cache → API
node scripts/mock_failure_scenario.js

# Focused RDBMS outage then MCP failure, with timing gaps and recovery signals
node scripts/mock_rdbms_mcp_scenario.js
```

See [NOTES.md](./NOTES.md) for full script options.
