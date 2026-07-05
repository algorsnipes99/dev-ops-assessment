# Operations Guide

> **Control plane script:** `ops.sh` — POSIX-compliant Bash utility for local ecosystem management.

## Prerequisites

- Docker Engine (with Compose v2 plugin or `docker-compose` v1)
- Bash 4+ (or any POSIX-compliant shell)
- `curl` (for `seed` subcommand)
- `pg_dump` (for `snapshot` subcommand, installed locally)

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

# 5. Query the fleet
curl http://localhost:3000/fleet

# 6. View logs
./ops.sh logs
```

## Subcommands Reference

### `start` — Build and boot the stack

```
./ops.sh start
```

- Builds Docker image (multi-stage)
- Creates Docker network and volumes
- Starts PostgreSQL first, waits for health check
- Starts the app container (which also does its own DB readiness poll)
- Runs in detached mode

**What happens internally:**
1. Ensures `.env` exists (copies from `.env.example` if missing)
2. Runs `docker compose up --build -d`
3. Containers boot: `database` → `app`

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

## File Layout (Operational Files)

```
./
├── .env                 # Local configuration (not committed)
├── .env.example         # Configuration template (committed)
├── docker-compose.yml   # Container orchestration
├── Dockerfile           # Application image build
├── ops.sh               # Control plane script
├── backups/             # Database snapshots (gitignored)
│   └── fleet_health_*.sql
└── init/
    └── init.sql         # Database schema (auto-executed on first DB start)