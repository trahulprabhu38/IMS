# NOTES — Running IMS

Everything you need to start, test, and operate the system.

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker | 24+ | `docker --version` |
| Docker Compose | v2 (bundled with Docker Desktop) | `docker compose version` |
| Node.js | 20+ (for scripts only) | `node --version` |

---

## 1. One-Command Start

```bash
chmod +x start.sh
./start.sh
```

This script:
1. Checks Docker is running
2. Pulls images and builds containers
3. Waits for all health checks to pass (Postgres, MongoDB, Redis)
4. Prints live URLs when ready
5. Optionally runs the mock scenario if you pass `--seed`

```bash
./start.sh --seed        # also fires mock failure scenario after startup
./start.sh --seed --logs # also tails backend logs
```

---

## 2. Manual Docker Compose

```bash
# Start all services (detached)
docker compose up -d

# Check service health
docker compose ps

# View backend logs
docker compose logs -f backend

# View all logs
docker compose logs -f

# Stop everything
docker compose down

# Stop and wipe all data volumes
docker compose down -v
```

### Service URLs

| Service | URL |
|---|---|
| Frontend Dashboard | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Health Check | http://localhost:8000/health |
| PostgreSQL | localhost:5432 (user: ims / pass: ims_secret / db: ims) |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |

---

## 3. Environment Variables

Configured in `docker-compose.yml` for containers. For local development, copy `backend/.env.example`:

```bash
cp backend/.env.example backend/.env
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://ims:ims_secret@localhost:5432/ims` | PostgreSQL connection string |
| `MONGODB_URL` | `mongodb://localhost:27017/ims` | MongoDB connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `WORKER_COUNT` | `10` | Number of concurrent async signal-processor workers |
| `RATE_LIMIT_PER_SEC` | `10000` | Token-bucket capacity and refill rate |
| `QUEUE_MAX_SIZE` | `50000` | Max items in the in-memory BoundedQueue before 503 |
| `DEBOUNCE_WINDOW_SECONDS` | `10` | Sliding window for Redis-based deduplication |
| `PORT` | `8000` | API server port |

---

## 4. Simulation Scripts

All scripts target `http://localhost:8000` by default. Run them **after** the system is up.

### Script 1 — Full Cascading Failure

Fires signals simulating a full stack meltdown: RDBMS → MCP → Cache → API Gateway.

```bash
node scripts/mock_failure_scenario.js

# Options
node scripts/mock_failure_scenario.js --host http://localhost:8000 --burst 100
```

**What to observe:**
- 4 work items created (one per component), each debounced from burst
- P0 alerts printed to backend logs for RDBMS and API Gateway
- Dashboard shows live escalation as incidents go unacknowledged

### Script 2 — Focused RDBMS + MCP Scenario (with Recovery)

A more realistic scenario with timing gaps and a recovery phase.

```bash
node scripts/mock_rdbms_mcp_scenario.js

# Options
node scripts/mock_rdbms_mcp_scenario.js --host http://localhost:8000 --count 50
```

**What to observe:**
- Phase 1: RDBMS P0 burst → 1 work item created
- Phase 2: Wait 5s → MCP P1 burst → 1 work item created
- Phase 3: Recovery signals logged but no new work items (different signal types don't change lifecycle)
- Timeline tab in dashboard shows event sequence

### Script 3 — Direct JSON (curl)

Send a single signal manually:

```bash
curl -X POST http://localhost:8000/api/v1/signals \
  -H "Content-Type: application/json" \
  -d '{
    "componentId": "RDBMS_PRIMARY",
    "componentType": "RDBMS",
    "signalType": "OUTAGE",
    "severity": "P0",
    "payload": {
      "errorCode": "CONN_REFUSED",
      "message": "Primary database unreachable"
    },
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

### Send a log to the universal webhook

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/logs \
  -H "Content-Type: application/json" \
  -d '{
    "level": "error",
    "message": "Connection refused to RDBMS_PRIMARY: ECONNREFUSED",
    "service": "order-service",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

### Trigger Uptime Kuma DOWN event

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/uptime-kuma \
  -H "Content-Type: application/json" \
  -d '{
    "monitorId": 42,
    "monitorName": "RDBMS Primary",
    "status": 0,
    "msg": "Timeout - No response in 10s"
  }'
```

---

## 5. Running Backend Tests

```bash
cd backend
npm test

# Individual test files
node --test tests/rca.test.js
node --test tests/stateMachine.test.js
node --test tests/debounce.test.js
```

---

## 6. Local Backend Development (without Docker)

```bash
# Start infrastructure only
docker compose up -d timescaledb mongodb redis

# Install deps and run backend locally
cd backend
npm install
node src/index.js

# In another terminal, run frontend
cd frontend
npm install
npm run dev
```

---

## 7. Health Check

```bash
curl http://localhost:8000/health | jq
```

Expected response when all systems are healthy:

```json
{
  "status": "ok",
  "postgres": true,
  "mongodb": true,
  "redis": true,
  "queueDepth": 0,
  "uptime": 42.3
}
```

---

## 8. Verifying Backpressure

Send more than 50,000 signals in rapid succession — the 50,001st should return HTTP 503:

```bash
# Fire 50,001 requests as fast as possible (requires wrk or similar)
# The queue fills and the API returns 503 with Retry-After: 1 header
curl -I -X POST http://localhost:8000/api/v1/signals \
  -H "Content-Type: application/json" \
  -d '{"componentId":"TEST","componentType":"API","signalType":"ERROR","severity":"P3","payload":{}}'
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `backend` container keeps restarting | Check `docker compose logs backend` — usually a DB not-ready race; `docker compose restart backend` after DBs are healthy |
| Dashboard shows "Disconnected" | Backend WebSocket not reachable — confirm port 8000 is open |
| No work items after running script | Check backend logs for `[WORKER]` lines; confirm Redis debounce key not stale from a previous run (`redis-cli DEL debounce:RDBMS_PRIMARY`) |
| Port 5432 already in use | Stop local PostgreSQL: `brew services stop postgresql` or `sudo systemctl stop postgresql` |
