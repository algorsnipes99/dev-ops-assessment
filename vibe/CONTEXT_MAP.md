# Context Map

> **Purpose:** Maps concepts, features, and behaviors to their exact code locations. Any agent can find what they need to modify, debug, or understand without reading unrelated files.

## How to Use This Map

Concepts are grouped by category. Each entry includes:
- **File** — relative path from project root
- **Lines** — line numbers (1-indexed)
- **Key symbols** — function/class/variable names
- **What it does** — brief description

---

## 1. Application Entry & Lifecycle

### Server Startup Sequence
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 82-123 | `start()` | Async startup: waitForDatabase → listen → register signal handlers |
| `src/app.js` | 80 | `PORT` | Port from env var, defaults to 3000 |
| `src/app.js` | 94-114 | `shutdown()` | Graceful shutdown: close server → drain pool → exit |

### Process Signal Handling
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 116-117 | `process.on('SIGTERM')`, `process.on('SIGINT')` | Register lifecycle signal handlers |
| `src/app.js` | 110-113 | `setTimeout(10000).unref()` | Force exit after 10s if graceful shutdown hangs |

---

## 2. HTTP Routes

### POST /ingest — Telemetry Ingestion
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 17-36 | `app.post('/ingest', ...)` | Route handler: validate → insert → respond 201/400/500 |
| `src/app.js` | 19 | `validateTelemetryPayload(req.body)` | Call validation module |
| `src/app.js` | 28 | `db.insertTelemetry(...)` | Persist validated payload |

### GET /host/:id — Single Host Query
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 41-55 | `app.get('/host/:id', ...)` | Route handler: query by host ID → 200/404/500 |
| `src/app.js` | 44 | `db.getLatestTelemetry(hostId)` | Fetch latest record for host |

### GET /fleet — Fleet Summary
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 60-68 | `app.get('/fleet', ...)` | Route handler: query all hosts summary → 200/500 |
| `src/app.js` | 62 | `db.getAllHostsSummary()` | Fetch latest per host with computed health |

### GET /events/fleet — SSE Live Fleet Updates
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 72-110 | `app.get('/events/fleet', ...)` | SSE endpoint: keeps HTTP connection open, pushes fleet updates every 2s |
| `src/app.js` | 76-91 | `broadcastFleetUpdate()` | Queries `getAllHostsSummary()` and pushes data to all connected SSE clients |
| `src/app.js` | 93-101 | `startSSEBroadcast()` / `stopSSEBroadcast()` | Manages the 2s interval timer (starts on first client, stops when last disconnects) |

### GET /dashboard — Fleet Dashboard HTML View
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 116-226 | `app.get('/dashboard', ...)` | Enhanced dashboard with live SSE feed, animated pulse dot, auto-updating table |

### POST /events — Incident Ingestion
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 73-88 | `app.post('/events', ...)` | Route handler: validate event → insert → respond 201/400/500 |
| `src/app.js` | 75 | `validateEventPayload(req.body)` | Call event validation module |
| `src/app.js` | 83 | `db.insertEvent(...)` | Persist validated event |

### GET /health — Liveness Probe
| File | Lines | Key Symbols | What |
|---|---|---|---|
| `src/app.js` | 93-95 | `app.get('/health', ...)` | Returns `200 { ok: true, status: 'healthy' }` |

---

## 3. Database Access Layer (`src/db.js`)

### Connection Pool Configuration
| Lines | Key Symbols | What |
|---|---|---|
| 6-15 | `pool = new Pool({...})` | PostgreSQL connection pool with env config |
| 12 | `max` | Pool size from `DB_POOL_SIZE` env var |
| 17-19 | `pool.on('error', ...)` | Log unexpected pool errors |

### Database Readiness
| Lines | Key Symbols | What |
|---|---|---|
| 24-40 | `waitForDatabase(maxRetries, delayMs)` | Poll loop: `SELECT 1` every 1s, up to 30 attempts |

### CRUD Operations
| Lines | Key Symbols | What |
|---|---|---|
| 45-52 | `insertTelemetry(...)` | Parameterized INSERT with JSONB for services |
| 57-67 | `getLatestTelemetry(host)` | `SELECT ... WHERE host=$1 ORDER BY timestamp DESC LIMIT 1` |
| 72-93 | `getAllHostsSummary()` | CTE `DISTINCT ON (host)` + `bool_and(jsonb_array_elements(...))` |
| 98-105 | `insertEvent(...)` | Parameterized INSERT into events table |

### Connection Drain
| Lines | Key Symbols | What |
|---|---|---|
| 108-110 | `closePool()` | `pool.end()` for graceful shutdown |

---

## 4. Payload Validation (`src/validation.js`)

### Telemetry Validation
| Lines | Key Symbols | What |
|---|---|---|
| 7-59 | `validateTelemetryPayload(body)` | Main telemetry validation function |
| 10-12 | Guard | Reject non-object payloads |
| 15-17 | `host` | Must be non-empty string |
| 19-24 | `timestamp` | Must be valid ISO-8601 (checked via `Date.parse()`) |
| 26-29 | `cpu_load` | Must be number, not NaN |
| 31-34 | `mem_used_mb` | Must be integer (`Number.isInteger`) |
| 36-48 | `services` | Must be array; each element: `name` (string) + `healthy` (boolean) |
| 50-53 | `ip` | Must be non-empty string |
| 55-58 | Return | `{ valid: boolean, errors: string[] }` |

### Event Validation
| Lines | Key Symbols | What |
|---|---|---|
| 63-103 | `validateEventPayload(body)` | Event/incident validation function |
| 65-67 | Guard | Reject non-object payloads |
| 70-72 | `host` | Must be non-empty string |
| 75-79 | `timestamp` | Must be valid ISO-8601 |
| 82-89 | `type` | Must be non-empty string, must be one of: error, warning, incident |
| 92-94 | `message` | Optional, must be string if provided |
| 96-99 | Return | `{ valid: boolean, errors: string[] }` |

---

## 5. Logger (`src/logger.js`)

| Lines | Key Symbols | What |
|---|---|---|
| 1-17 | `logger` | pino instance with ISO timestamps and custom level formatting |
| 6 | `level: process.env.LOG_LEVEL || 'info'` | Configurable log level |

---

## 6. Database Schema (`init/init.sql`)

### telemetry table
| Lines | Key Symbols | What |
|---|---|---|
| 4-13 | `CREATE TABLE telemetry (...)` | Schema: id (BIGSERIAL PK), host, timestamp, cpu_load, mem_used_mb, services (JSONB), ip, created_at |
| 16-17 | `CREATE INDEX idx_telemetry_host_ts` | Composite index on `(host, timestamp DESC)` |

### events table
| Lines | Key Symbols | What |
|---|---|---|
| 22-31 | `CREATE TABLE events (...)` | Schema: id (BIGSERIAL PK), host, timestamp, type, message, created_at |
| 34-35 | `CREATE INDEX idx_events_host_ts` | Composite index on `(host, timestamp DESC)` |

---

## 7. Docker Infrastructure

### Dockerfile
| Lines | Key Symbols | What |
|---|---|---|
| 1-39 | Multi-stage build | Stage 1 (deps): `npm ci --only=production`. Stage 2 (runtime): minimal Alpine + node user |
| 11 | `npm ci --only=production` | Install only production deps |
| 19 | `USER node` | Run as unprivileged user |
| 36-37 | `HEALTHCHECK` | wget against `/health` every 15s |

### docker-compose.yml
| Lines | Key Symbols | What |
|---|---|---|
| 4-58 | Services: `database`, `app` | Full orchestration definition |
| 9-28 | `database` service | PostgreSQL 16 Alpine with health check + init volume |
| 22 | `./init/init.sql:/docker-entrypoint-initdb.d/init.sql:ro` | Auto-init schema on first DB startup |
| 24-27 | `healthcheck` | `pg_isready` every 5s |
| 33-52 | `app` service | Build from Dockerfile, depends_on database (healthy), env_file |

---

## 8. Operations Script (`ops.sh`)

| Lines | Function | What |
|---|---|---|
| 38-47 | `find_compose_cmd()` | Detect Docker Compose v1 vs v2 |
| 50-61 | `ensure_env()` | Auto-create `.env` from `.env.example` if missing |
| 64-70 | `load_env()` | Source `.env` with exported variables |
| 73-81 | `cmd_start()` | `docker compose up --build -d` |
| 84-91 | `cmd_stop()` | `docker compose down --remove-orphans` |
| 94-98 | `cmd_restart()` | Stop + start |
| 101-106 | `cmd_status()` | `docker compose ps` |
| 109-124 | `cmd_logs()` | Tail logs, optional `--filter <string>` for grep |
| 133-281 | `cmd_seed()` | Inject 6 telemetry payloads + 2 event signals via curl |
| 284-318 | `cmd_remote()` | SSH-based remote diagnostic (`docker ps`), dry-run without credentials |
| 321-351 | `cmd_snapshot()` | `pg_dump` custom format backup to `backups/` directory |
| 354-388 | `usage()` | Help text |

---

## 9. Configuration

| File | Lines | Key Values | What |
|---|---|---|---|
| `.env.example` | 1-14 | PORT, LOG_LEVEL, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_POOL_SIZE | Template for local config |
| `docker-compose.yml` | 41-47 | Overrides DB_HOST to `database`, sets DB_PORT | Container networking config |
| `ops.sh` | 288-291 | SSH_HOST, SSH_USER, SSH_KEY_PATH | Remote diagnostic config (optional) |

---

## 10. Test / Seed Data

| File | Lines | What |
|---|---|---|
| `ops.sh` | 144-281 | `cmd_seed()` — injected payload definitions for 5 hosts + 2 event signals |
| `ops.sh` | 155-168 | `api-01` — all services healthy, first heartbeat |
| `ops.sh` | 173-186 | `api-02` — one unhealthy (node-app), fleet health = false |
| `ops.sh` | 190-203 | `web-01` — all healthy, 2 services |
| `ops.sh` | 206-222 | `db-01` — all healthy, 3 services |
| `ops.sh` | 225-239 | `worker-01` — two unhealthy services |
| `ops.sh` | 243-257 | `api-01` — second heartbeat (tests latest-record logic) |
| `ops.sh` | 258-268 | `api-02` — error event ("upstream timeout contacting db") |
| `ops.sh` | 271-276 | `worker-01` — warning event ("memory usage above 90% threshold") |

---

## Quick Agent Workflows

### Finding what to change for a specific task

| If you need to... | Start here |
|---|---|
| Add a new API endpoint | `src/app.js` (routes) + `src/db.js` (query) + `src/validation.js` (if new payload) |
| Change validation rules | `src/validation.js` — telemetry `:7-59`, events `:63-103` |
| Modify database query | `src/db.js:45-108` |
| Change Docker build | `Dockerfile` (stages) or `docker-compose.yml` (orchestration) |
| Add a new ops subcommand | `ops.sh` — add a `cmd_*()` function + `case` entry |
| Modify DB schema | `init/init.sql` + restart containers to re-init |
| Change logging behavior | `src/logger.js:1-17` |
| Adjust graceful shutdown | `src/app.js:114-133` |
| Change startup retry logic | `src/db.js:24-40` |
| Add new seed test data | `ops.sh` `cmd_seed()` at lines 133-281 |
| Add remote diagnostic | `ops.sh` `cmd_remote()` at lines 284-318, config via `SSH_HOST`, `SSH_USER` in `.env` |
| Trace a bug from error log | Find error message in logs → map to route in `src/app.js` → validate in `src/validation.js` → query in `src/db.js` |