#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh — IMS one-command launcher
#
# Usage:
#   ./start.sh                  # start all services
#   ./start.sh --seed           # start + run mock failure scenario
#   ./start.sh --seed --logs    # start + seed + tail backend logs
#   ./start.sh --down           # stop all services
#   ./start.sh --down --volumes # stop and wipe all data volumes
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}${BOLD}[IMS]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[OK]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[ERR]${RESET} $*" >&2; }

# ── Parse flags ───────────────────────────────────────────────────────────────
SEED=false
TAIL_LOGS=false
BRING_DOWN=false
WIPE_VOLUMES=false

for arg in "$@"; do
  case $arg in
    --seed)    SEED=true ;;
    --logs)    TAIL_LOGS=true ;;
    --down)    BRING_DOWN=true ;;
    --volumes) WIPE_VOLUMES=true ;;
  esac
done

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗"
echo -e "║          IMS — Incident Management System               ║"
echo -e "╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Handle --down ─────────────────────────────────────────────────────────────
if $BRING_DOWN; then
  if $WIPE_VOLUMES; then
    warn "Stopping all services and wiping data volumes..."
    docker compose down -v
    success "All services stopped. Data volumes removed."
  else
    info "Stopping all services..."
    docker compose down
    success "All services stopped. Data volumes preserved."
  fi
  exit 0
fi

# ── Check Docker is running ───────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  error "Docker is not running. Start Docker Desktop and try again."
  exit 1
fi
success "Docker is running"

# ── Check docker compose is available ────────────────────────────────────────
if ! docker compose version > /dev/null 2>&1; then
  error "docker compose (v2) not found. Update Docker Desktop or install the Compose plugin."
  exit 1
fi

# ── Check we're in the right directory ───────────────────────────────────────
if [[ ! -f "docker-compose.yml" ]]; then
  error "docker-compose.yml not found. Run this script from the ims/ root directory."
  exit 1
fi

# ── Pull latest images + build ────────────────────────────────────────────────
info "Building images and pulling dependencies..."
docker compose build --quiet
success "Images ready"

# ── Start infrastructure first ────────────────────────────────────────────────
info "Starting infrastructure (PostgreSQL, MongoDB, Redis)..."
docker compose up -d timescaledb mongodb redis

# ── Wait for health checks ────────────────────────────────────────────────────
info "Waiting for databases to be healthy..."

wait_healthy() {
  local service=$1
  local max_wait=${2:-60}
  local elapsed=0

  while true; do
    status=$(docker compose ps --format json "$service" 2>/dev/null | \
             python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")

    if [[ "$status" == "healthy" ]]; then
      success "$service is healthy"
      return 0
    fi

    if [[ $elapsed -ge $max_wait ]]; then
      warn "$service health check timed out after ${max_wait}s — continuing anyway"
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
    echo -ne "\r  Waiting for $service... ${elapsed}s"
  done
}

wait_healthy timescaledb 90
wait_healthy mongodb 90
wait_healthy redis 30

# ── Start application services ────────────────────────────────────────────────
info "Starting backend and frontend..."
docker compose up -d backend frontend

# ── Wait for backend to be ready ─────────────────────────────────────────────
info "Waiting for backend API to be ready..."
max_attempts=30
attempt=0

while true; do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    success "Backend API is ready"
    break
  fi

  attempt=$((attempt + 1))
  if [[ $attempt -ge $max_attempts ]]; then
    warn "Backend not responding after ${max_attempts} attempts — check logs with: docker compose logs backend"
    break
  fi

  sleep 2
  echo -ne "\r  Waiting for backend... attempt $attempt/$max_attempts"
done
echo ""

# ── Print service URLs ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗"
echo -e "║                   Services Ready                        ║"
echo -e "╠══════════════════════════════════════════════════════════╣"
echo -e "║  Dashboard    →  http://localhost:3000                  ║"
echo -e "║  Backend API  →  http://localhost:8000                  ║"
echo -e "║  Health       →  http://localhost:8000/health           ║"
echo -e "╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Run health check ─────────────────────────────────────────────────────────
health=$(curl -sf http://localhost:8000/health 2>/dev/null || echo '{"status":"unreachable"}')
echo -e "${BOLD}Health:${RESET} $health"
echo ""

# ── Seed mock data ────────────────────────────────────────────────────────────
if $SEED; then
  if ! command -v node > /dev/null 2>&1; then
    warn "Node.js not found — skipping mock scenario. Install Node.js 20+ to run scripts."
  else
    echo ""
    info "Running mock failure scenario..."
    sleep 2
    node scripts/mock_failure_scenario.js --host http://localhost:8000 --burst 50
    echo ""
    info "Running RDBMS + MCP focused scenario..."
    sleep 1
    node scripts/mock_rdbms_mcp_scenario.js --host http://localhost:8000 --count 30
  fi
fi

# ── Tail logs ─────────────────────────────────────────────────────────────────
if $TAIL_LOGS; then
  echo ""
  info "Tailing backend logs (Ctrl+C to stop)..."
  docker compose logs -f backend
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
success "IMS is running. Open http://localhost:3000 to start."
echo ""
echo -e "${BOLD}Useful commands:${RESET}"
echo "  docker compose logs -f backend          # backend logs"
echo "  docker compose logs -f                  # all logs"
echo "  docker compose ps                       # service status"
echo "  node scripts/mock_failure_scenario.js   # fire test signals"
echo "  node scripts/mock_rdbms_mcp_scenario.js # focused RDBMS+MCP test"
echo "  ./start.sh --down                       # stop all services"
echo ""
