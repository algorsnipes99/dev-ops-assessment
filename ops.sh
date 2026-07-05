#!/usr/bin/env bash
# ============================================================================
# ops.sh — Fleet Health Monitor Control Plane
# POSIX-compliant Bash utility script for local ecosystem management.
# Usage: ./ops.sh <subcommand> [options]
# ============================================================================

set -o errexit
set -o nounset
set -o pipefail

# --- Color helpers (optional, degraded gracefully) ---------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  NC='\033[0m' # No Color
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi

# --- Constants ---------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
ENV_FILE="${PROJECT_ROOT}/.env"
BACKUP_DIR="${PROJECT_ROOT}/backups"
SNAPSHOT_FILE="${BACKUP_DIR}/fleet_health_$(date +%Y%m%d_%H%M%S).sql"

# --- Helper Functions --------------------------------------------------------

info()    { printf "${GREEN}[INFO]${NC}  %s\n" "$*"; }
warn()    { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
error()   { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }
header()  { printf "\n${CYAN}=== %s ===${NC}\n" "$*"; }

# Check if docker compose (v2) or docker-compose (v1) is available
find_compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    error "Docker Compose is not installed."
    exit 1
  fi
}

# Ensure the .env file exists
ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "${PROJECT_ROOT}/.env.example" ]; then
      warn ".env file not found — copying from .env.example"
      cp "${PROJECT_ROOT}/.env.example" "$ENV_FILE"
      info "Edit ${ENV_FILE} to match your environment and re-run."
    else
      error "No .env or .env.example found. Create one first."
      exit 1
    fi
  fi
}

# Load environment variables from .env file (exported for subprocesses)
load_env() {
  ensure_env
  set -o allexport
  # shellcheck source=.env
  . "$ENV_FILE"
  set +o allexport
}

# --- Subcommand: start -------------------------------------------------------
cmd_start() {
  header "Starting Fleet Health Monitor"
  ensure_env
  COMPOSE_CMD="$(find_compose_cmd)"
  info "Building images and starting containers in detached mode..."
  # shellcheck disable=SC2086
  $COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d
  info "Containers are booting. Use './ops.sh status' to check health."
}

# --- Subcommand: stop --------------------------------------------------------
cmd_stop() {
  header "Stopping Fleet Health Monitor"
  COMPOSE_CMD="$(find_compose_cmd)"
  info "Gracefully bringing down workloads and cleaning up networks..."
  # shellcheck disable=SC2086
  $COMPOSE_CMD -f "$COMPOSE_FILE" down --remove-orphans
  info "All containers stopped and networks removed."
}

# --- Subcommand: restart -----------------------------------------------------
cmd_restart() {
  header "Restarting Fleet Health Monitor"
  cmd_stop
  cmd_start
}

# --- Subcommand: status ------------------------------------------------------
cmd_status() {
  header "Container Runtime Status"
  COMPOSE_CMD="$(find_compose_cmd)"
  # shellcheck disable=SC2086
  $COMPOSE_CMD -f "$COMPOSE_FILE" ps
}

# --- Subcommand: logs --------------------------------------------------------
cmd_logs() {
  header "Aggregated Log Streams"
  COMPOSE_CMD="$(find_compose_cmd)"

  FILTER=""
  if [ "${1:-}" = "--filter" ] && [ -n "${2:-}" ]; then
    FILTER="$2"
    info "Filtering logs for host: ${FILTER}"
    # shellcheck disable=SC2086
    $COMPOSE_CMD -f "$COMPOSE_FILE" logs --tail=100 -f 2>&1 | \
      grep -E "(host.*${FILTER}|${FILTER})" || true
  else
    # shellcheck disable=SC2086
    $COMPOSE_CMD -f "$COMPOSE_FILE" logs --tail=50 -f
  fi
}

# --- Subcommand: feeder ------------------------------------------------------
cmd_feeder() {
  header "Heartbeat Feeder Container"
  COMPOSE_CMD="$(find_compose_cmd)"

  case "${1:-}" in
    start|up)
      info "Starting heartbeat feeder container..."
      # shellcheck disable=SC2086
      $COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d feeder
      info "Feeder is running. Use './ops.sh logs --filter feeder' to see heartbeats."
      ;;
    stop|down)
      info "Stopping heartbeat feeder container..."
      # shellcheck disable=SC2086
      $COMPOSE_CMD -f "$COMPOSE_FILE" stop feeder
      info "Feeder stopped."
      ;;
    restart)
      cmd_feeder stop
      cmd_feeder start
      ;;
    logs)
      shift
      # shellcheck disable=SC2086
      $COMPOSE_CMD -f "$COMPOSE_FILE" logs --tail=50 -f feeder
      ;;
    status)
      # shellcheck disable=SC2086
      $COMPOSE_CMD -f "$COMPOSE_FILE" ps feeder
      ;;
    *)
      echo "Usage: $(basename "$0") feeder <start|stop|restart|logs|status>"
      echo ""
      echo "  start     Build and start the continuous heartbeat feeder container."
      echo "  stop      Stop the feeder container without affecting app/database."
      echo "  restart   Cycle the feeder (stop + start)."
      echo "  logs      Tail feeder logs (heartbeat output)."
      echo "  status    Show feeder container runtime status."
      echo ""
      echo "The feeder simulates fleet hosts sending telemetry every N seconds."
      echo "Configure via .env: FEEDER_INTERVAL, FEEDER_HOSTS, FEEDER_EVENTS"
      return 0
      ;;
  esac
}

# --- Subcommand: seed --------------------------------------------------------
cmd_seed() {
  header "Seeding Synthetic Metrics"
  load_env

  PORT="${PORT:-3000}"
  BASE_URL="http://localhost:${PORT}"

  # Wait for the app to be ready
  info "Waiting for application to be ready at ${BASE_URL}..."
  for i in $(seq 1 30); do
    if curl -s -f "${BASE_URL}/health" >/dev/null 2>&1; then
      info "Application is ready."
      break
    fi
    if [ "$i" -eq 30 ]; then
      error "Application did not become ready in time. Is it running?"
      exit 1
    fi
    sleep 2
  done

  # ---- Seed Data Definitions ----
  # Each host has a diverse set of service statuses to test the fleet health
  # computation (all healthy = true, any unhealthy = false).

  info "Injecting telemetry payloads for multiple mock hosts..."

  # Host: api-01  — All services healthy
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "api-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.42,
      "mem_used_mb": 2048,
      "services": [
        {"name": "nginx", "healthy": true},
        {"name": "node-app", "healthy": true},
        {"name": "redis-cache", "healthy": true}
      ],
      "ip": "10.0.1.10"
    }' && info "api-01 seeded (healthy)"

  sleep 0.5

  # Host: api-02  — One service unhealthy => fleet health = false
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "api-02",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.87,
      "mem_used_mb": 4096,
      "services": [
        {"name": "nginx", "healthy": true},
        {"name": "node-app", "healthy": false},
        {"name": "sidekiq-worker", "healthy": true}
      ],
      "ip": "10.0.1.11"
    }' && info "api-02 seeded (unhealthy — node-app down)"

  sleep 0.5

  # Host: web-01  — All services healthy
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "web-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.15,
      "mem_used_mb": 1024,
      "services": [
        {"name": "apache2", "healthy": true},
        {"name": "php-fpm", "healthy": true}
      ],
      "ip": "10.0.2.20"
    }' && info "web-01 seeded (healthy)"

  sleep 0.5

  # Host: db-01  — All services healthy
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "db-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.63,
      "mem_used_mb": 8192,
      "services": [
        {"name": "postgresql", "healthy": true},
        {"name": "pgbouncer", "healthy": true},
        {"name": "wal-g", "healthy": true}
      ],
      "ip": "10.0.3.30"
    }' && info "db-01 seeded (healthy)"

  sleep 0.5

  # Host: worker-01  — Multiple services unhealthy
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "worker-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.95,
      "mem_used_mb": 6144,
      "services": [
        {"name": "celery-worker", "healthy": false},
        {"name": "rabbitmq", "healthy": true},
        {"name": "redis", "healthy": false}
      ],
      "ip": "10.0.4.40"
    }' && info "worker-01 seeded (unhealthy — celery-worker & redis down)"

  sleep 0.5

  # Host: api-01  — Send a second (newer) payload to test latest-record logic
  curl -s -X POST "${BASE_URL}/ingest" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "api-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "cpu_load": 0.55,
      "mem_used_mb": 2304,
      "services": [
        {"name": "nginx", "healthy": true},
        {"name": "node-app", "healthy": true},
        {"name": "redis-cache", "healthy": true}
      ],
      "ip": "10.0.1.10"
    }' && info "api-01 updated (second heartbeat)"

  echo ""

  # ------------------------------------------------------------------
  # Error/Incident Signals — POST /events
  # ------------------------------------------------------------------
  header "Injecting Error/Incident Event Signals"

  info "Sending error event for api-02 (upstream timeout)..."
  curl -s -X POST "${BASE_URL}/events" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "api-02",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "type": "error",
      "message": "upstream timeout contacting db"
    }' && info "api-02 error event sent"

  sleep 0.5

  info "Sending warning event for worker-01 (high memory pressure)..."
  curl -s -X POST "${BASE_URL}/events" \
    -H "Content-Type: application/json" \
    -d '{
      "host": "worker-01",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "type": "warning",
      "message": "memory usage above 90% threshold"
    }' && info "worker-01 warning event sent"

  echo ""
  info "Seed complete! Ingested metrics for 5 hosts (api-01 x2, api-02, web-01, db-01, worker-01) plus 2 event signals."
  info "Try: curl http://localhost:${PORT}/fleet"
  info " Or: curl http://localhost:${PORT}/host/api-02"
  info " Or: curl -X POST http://localhost:${PORT}/events -H 'Content-Type: application/json' -d '{\"host\":\"test\",\"timestamp\":\"2026-07-03T13:00:00Z\",\"type\":\"error\",\"message\":\"manual test\"}'"
}

# --- Subcommand: remote ------------------------------------------------------
cmd_remote() {
  header "Remote Host Diagnostic"
  load_env

  SSH_HOST="${SSH_HOST:-}"
  SSH_USER="${SSH_USER:-}"
  SSH_KEY_PATH="${SSH_KEY_PATH:-}"

  if [ -z "$SSH_HOST" ] || [ -z "$SSH_USER" ]; then
    warn "SSH_HOST and/or SSH_USER not set in .env — running dry-run diagnostic."
    echo ""
    echo "  To enable remote diagnostics, add to your .env:"
    echo "    SSH_HOST=your-server.example.com"
    echo "    SSH_USER=ubuntu"
    echo "    SSH_KEY_PATH=/path/to/private/key (optional)"
    echo ""
    echo "  Dry-run: would execute 'docker ps' on remote host via SSH."
    echo "  Command: ssh ${SSH_USER:-\$SSH_USER}@${SSH_HOST:-\$SSH_HOST} ${SSH_KEY_PATH:+-i \$SSH_KEY_PATH} 'docker ps --format \"table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}\"'"
    return 0
  fi

  info "Running 'docker ps' on ${SSH_USER}@${SSH_HOST}..."

  SSH_CMD="ssh"
  if [ -n "$SSH_KEY_PATH" ]; then
    SSH_CMD="ssh -i ${SSH_KEY_PATH}"
  fi

  # shellcheck disable=SC2086
  if $SSH_CMD "${SSH_USER}@${SSH_HOST}" 'docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"'; then
    info "Remote diagnostic completed successfully."
  else
    error "Remote diagnostic failed. Check SSH credentials and network connectivity."
    exit 1
  fi
}

# --- Subcommand: snapshot ----------------------------------------------------
cmd_snapshot() {
  header "Database Snapshot (Backup)"
  load_env

  # Ensure backup directory exists
  mkdir -p "$BACKUP_DIR"

  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-fleet_health}"
  DB_USER="${DB_USER:-fleet_user}"
  DB_PASSWORD="${DB_PASSWORD:-fleet_pass}"

  info "Dumping database '${DB_NAME}' to snapshot file..."

  # Use PGPASSWORD for non-interactive authentication
  export PGPASSWORD="$DB_PASSWORD"
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --format=custom --no-owner --verbose \
    -f "$SNAPSHOT_FILE"

  unset PGPASSWORD

  if [ -f "$SNAPSHOT_FILE" ]; then
    SNAPSHOT_SIZE="$(du -h "$SNAPSHOT_FILE" | cut -f1)"
    info "Snapshot saved: ${SNAPSHOT_FILE} (${SNAPSHOT_SIZE})"
  else
    error "Snapshot failed — file not created."
    exit 1
  fi
}

# --- Usage / Help ------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") <subcommand> [options]

Subcommands:

  start       Build images and boot the multi-container stack (detached).
  stop        Gracefully stop containers and clean up networks.
  restart     Cycle the application (stop + start).
  status      Query runtime health of active containers.
  logs        Tail aggregated logs (both DB and app).
              Optional: --filter <host_string>
  feeder      Manage the continuous heartbeat feeder container.
              Subcommands: start, stop, restart, logs, status
  seed        Inject diverse synthetic telemetry metrics via curl.
  snapshot    Run pg_dump to save database backup to local filesystem.
  remote      Run 'docker ps' diagnostic on a remote host via SSH.
              Requires SSH_HOST and SSH_USER in .env.
              Runs dry-run safely without credentials.

Options:
  -h, --help  Show this help message.

Examples:
  ./ops.sh start
  ./ops.sh logs --filter api-01
  ./ops.sh feeder start
  ./ops.sh feeder logs
  ./ops.sh seed
  ./ops.sh snapshot
  ./ops.sh remote
EOF
}

# --- Main Entry Point --------------------------------------------------------
main() {
  if [ $# -eq 0 ]; then
    usage
    exit 0
  fi

  SUBCOMMAND="${1:-}"

  case "$SUBCOMMAND" in
    start)
      cmd_start
      ;;
    stop)
      cmd_stop
      ;;
    restart)
      cmd_restart
      ;;
    status)
      cmd_status
      ;;
    logs)
      shift
      cmd_logs "$@"
      ;;
    feeder)
      shift
      cmd_feeder "$@"
      ;;
    seed)
      cmd_seed
      ;;
    snapshot)
      cmd_snapshot
      ;;
    remote)
      cmd_remote
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      error "Unknown subcommand: ${SUBCOMMAND}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
