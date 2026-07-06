# Operations Guide

> **Control plane scripts:** `ops.sh` (Bash — Linux/macOS/WSL) and `ops.ps1` (PowerShell — Windows)

## Prerequisites

- Docker Engine (with Compose v2 plugin `docker compose`)
- Bash 4+ (Linux, macOS, or WSL on Windows) — for `ops.sh`
- **PowerShell 5+ (Windows 11 built-in)** — for `ops.ps1`
- `curl` (for `seed` subcommand)

## Quick Start

```bash
# 1. Copy environment config (if not already present)
cp .env.example .env
# Edit .env as needed

# 2. Start the ecosystem
./ops.sh start

# 3. Check status
./ops.sh status

# 4. Seed test data
./ops.sh seed

# 5. Start the heartbeat feeder (continuous telemetry)
./ops.sh feeder start

# 6. Query the fleet
curl http://localhost:3000/fleet

# 7. View logs
./ops.sh logs
```

## Subcommands Reference

### `start` — Build and boot the stack

```
./ops.sh start            # Database + app only (production-safe default)
./ops.sh start --feeder   # Database + app + heartbeat simulator (development)
```

- Builds Docker image (multi-stage)
- Creates Docker network and volumes
- Starts PostgreSQL first, waits for health check
- Starts the app container (which also does its own DB readiness poll)
- The heartbeat feeder is **opt-in** via `--feeder` — it is NOT started by default
- Runs in detached mode

**What happens internally:**
1. Ensures `.env` exists (copies from `.env.example` if missing)
2. Without `--feeder`: runs `docker compose up --build -d` (database + app only)
3. With `--feeder`: runs `docker compose --profile feeder up --build -d` (all three services)
4. Containers boot: `database` → `app` → (optionally) `feeder`

### `stop` — Gracefully shut down

```
./ops.sh stop
```

- Sends SIGTERM to containers
- Removes the network (but **preserves** the `pgdata` volume)
- Removes orphan containers if any

### `restart` — Cycle the stack

```
./ops.sh restart
```

- Runs `stop` followed by `start`

### `status` — Container runtime health

```
./ops.sh status
```

- Outputs `docker compose ps` table showing container state, ports, uptime

**Expected output (healthy):**

```
NAME                IMAGE                      COMMAND                  SERVICE    CREATED     STATUS                    PORTS
fleet-app           dev-ops-assessment-app     "docker-entrypoint.s…"   app        2 min ago   Up 2 minutes (healthy)   0.0.0.0:3000->3000/tcp
fleet-database      postgres:16-alpine         "docker-entrypoint.s…"   database   2 min ago   Up 2 minutes (healthy)   0.0.0.0:5432->5432/tcp
```

### `logs` — Tail aggregated logs

```
./ops.sh logs                  # Tail last 50 lines from all containers
./ops.sh logs --filter api-01  # Filter logs for a specific host string
```

- When no filter is provided, streams all logs (DB + app) with `--tail=50 -f`
- With `--filter`, pipes logs through `grep` for the given string
- Press `Ctrl+C` to exit log streaming

### `feeder` — Manage the heartbeat feeder container

```
./ops.sh feeder start        # Build and start the continuous feeder
./ops.sh feeder stop         # Stop the feeder (app/database unaffected)
./ops.sh feeder restart      # Cycle the feeder
./ops.sh feeder logs         # Tail feeder heartbeat output
./ops.sh feeder status       # Feeder container runtime health
```

The feeder is a lightweight containerized Node.js process that simulates fleet hosts sending telemetry payloads every N seconds. It automatically starts after the app is healthy when you run `./ops.sh start`, but you can also manage it independently.

**Configuration (via `.env`):**

| Variable | Default | Description |
|---|---|---|
| `FEEDER_INTERVAL` | `5` | Seconds between heartbeat cycles |
| `FEEDER_HOSTS` | `7` | Number of simulated hosts |
| `FEEDER_EVENTS` | `true` | Also send random event signals (`true`/`false`) |

The feeder uses only Node.js built-in modules (zero npm dependencies) and lives in its own Docker image built from `Dockerfile.feeder`. It communicates with the app over the internal Docker network at `http://app:3000`.

### `seed` — Inject synthetic telemetry

```
./ops.sh seed
```

Injects 6 telemetry payloads across 5 hosts, plus 2 error/incident event signals:

| Host | Data Type | Details | Fleet Health |
|---|---|---|---|
| `api-01` | Telemetry | nginx, node-app, redis-cache (all healthy) | ✅ |
| `api-02` | Telemetry | nginx, **node-app (unhealthy)**, sidekiq-worker | ❌ |
| `web-01` | Telemetry | apache2, php-fpm (all healthy) | ✅ |
| `db-01` | Telemetry | postgresql, pgbouncer, wal-g (all healthy) | ✅ |
| `worker-01` | Telemetry | **celery-worker (unhealthy)**, rabbitmq, **redis (unhealthy)** | ❌ |
| `api-01` | Telemetry | Second heartbeat (updated timestamp + load) | ✅ |
| `api-02` | Event | `type: error` — "upstream timeout contacting db" | — |
| `worker-01` | Event | `type: warning` — "memory usage above 90% threshold" | — |

The script waits for the app to be healthy before seeding (up to 60s).

### `remote` — Remote host diagnostic

```
./ops.sh remote
```

Runs `docker ps` on a remote host via SSH.

**Configuration (via `.env`):**

| Variable | Description |
|---|---|
| `SSH_HOST` | Remote server hostname or IP |
| `SSH_USER` | SSH username |
| `SSH_KEY_PATH` | Path to SSH private key (optional) |

**Dry-run mode:** If `SSH_HOST` and/or `SSH_USER` are not set, the command prints a dry-run message showing what would be executed — safe to run without credentials.

**With credentials configured:**

```bash
# .env
SSH_HOST=prod-server.example.com
SSH_USER=ubuntu
SSH_KEY_PATH=/home/user/.ssh/prod_key

# Run
./ops.sh remote
```

Executes: `ssh ubuntu@prod-server.example.com 'docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}"'`

### `snapshot` — Database backup

```
./ops.sh snapshot
```

- Runs `pg_dump` in custom format (`--format=custom`)
- Saves to `backups/fleet_health_YYYYMMDD_HHMMSS.sql`
- Uses environment variables from `.env` for connection
- Reports file size on completion

**Restore example:**

```bash
pg_restore -h localhost -p 5432 -U fleet_user -d fleet_health \
  --format=custom backups/fleet_health_20260703_150000.sql
```

## Environment Configuration

The `.env` file is sourced by both Docker Compose and `ops.sh`.

**Required variables with defaults:**

```bash
PORT=3000
LOG_LEVEL=info
DB_HOST=localhost        # Overridden to "database" inside compose
DB_PORT=5432
DB_NAME=fleet_health
DB_USER=fleet_user
DB_PASSWORD=fleet_pass
DB_POOL_SIZE=10
```

**Optional variables (for `remote` subcommand):**

```bash
SSH_HOST=
SSH_USER=
SSH_KEY_PATH=
```

> **Security:** Change `DB_PASSWORD` in `.env` before deploying to any shared environment. The `.env` file is not committed (in `.dockerignore`).

## Troubleshooting

### Containers exit immediately

```bash
# Check logs
./ops.sh logs

# Common causes:
# - PostgreSQL not ready yet (app exits with DB connection error)
# - Port 3000 already in use (change PORT in .env)
# - Port 5432 already in use (change DB_PORT in .env)
```

### Database not initializing

```bash
# Check if the init.sql ran
docker compose exec database psql -U fleet_user -d fleet_health -c '\dt'

# If table missing, init.sql may have failed silently.
# The schema is only applied on first startup (empty volume).
# To re-initialize: destroy the volume
./ops.sh stop
docker volume rm dev-ops-assessment_pgdata
./ops.sh start
```

### "Port is already allocated" error

Change the host port mappings in `.env`:
```bash
PORT=3001        # Map app to 3001
DB_PORT=5433     # Map DB to 5433
```

Then restart:
```bash
./ops.sh restart
```

### App shows "Database not ready"

The app has a built-in retry loop (30 attempts, 1s apart). If it still fails:
- Verify the `database` container is healthy: `./ops.sh status`
- Check DB logs: `./ops.sh logs | grep database`
- Verify `DB_HOST` is set to `database` (inside compose network, it must be the service name, not `localhost`)

### Clean slate (destroy everything)

```bash
./ops.sh stop
docker volume rm dev-ops-assessment_pgdata
docker image rm dev-ops-assessment-app
./ops.sh start
```

## Windows PowerShell (`ops.ps1`)

On Windows, use `ops.ps1` instead of `ops.sh` (which requires WSL):

```powershell
.\ops.ps1 start            # Build (no cache) and boot the stack
.\ops.ps1 stop             # Gracefully shut down
.\ops.ps1 restart          # Cycle the stack
.\ops.ps1 status           # Container runtime health
.\ops.ps1 logs             # Tail aggregated logs
.\ops.ps1 logs -Filter x   # Filter logs by host string
.\ops.ps1 seed             # Inject synthetic telemetry data
.\ops.ps1 snapshot         # Database backup via pg_dump
.\ops.ps1 remote           # Remote diagnostic via SSH (dry-run)
```

The `start` command runs `docker compose build --no-cache` first to always pick up code changes.

### `feeder` subcommand

```powershell
.\ops.ps1 feeder start        # Build and start the continuous feeder
.\ops.ps1 feeder stop         # Stop the feeder
.\ops.ps1 feeder restart      # Cycle the feeder
.\ops.ps1 feeder logs         # Tail feeder logs
.\ops.ps1 feeder status       # Feeder container health
```

## Quick Start (Windows)

```powershell
# Double-click start.bat OR run:
.\ops.ps1 start
.\ops.ps1 status
.\ops.ps1 seed
curl http://localhost:3000/dashboard
```

## Continuous Heartbeat Feeder

The `heartbeats/feeder.js` script simulates a fleet sending telemetry every N seconds:

```bash
# Run with 5 hosts every 5 seconds (default)
node heartbeats/feeder.js

# Run with all 7 hosts every 3 seconds with event signals
node heartbeats/feeder.js --hosts 7 --interval 3 --events

# Custom URL
node heartbeats/feeder.js --url http://localhost:3000
```

The feeder randomly varies CPU load, memory usage, and has an 8% chance per cycle of flipping a service's health status to simulate real incidents.

## File Layout (Operational Files)

```
./
├── .env                 # Local configuration (not committed)
├── .env.example         # Configuration template (committed)
├── .gitignore           # Git ignore rules (node_modules, .env, backups, etc.)
├── docker-compose.yml   # Container orchestration
├── Dockerfile           # Application image build
├── ops.sh               # Bash control plane (Linux/macOS/WSL)
├── ops.ps1              # PowerShell control plane (Windows)
├── start.bat            # Double-click Windows launcher
├── backups/             # Database snapshots (gitignored)
│   └── fleet_health_*.sql
├── heartbeats/
│   └── feeder.js        # Continuous heartbeat simulator
└── init/
    └── init.sql         # Database schema (auto-executed on first DB start)
