# Architecture

## Module Dependency Graph

```
src/app.js
  ├── src/logger.js        (require → logger instance)
  ├── src/db.js            (require → pool + query functions)
  └── src/validation.js    (require → validateTelemetryPayload)

heartbeats/feeder.js       (standalone Node.js — no module deps, uses built-in http only)
ops.sh                     (standalone Bash — no module deps)
ops.ps1                    (standalone PowerShell — no module deps)
init/init.sql              (standalone SQL — no module deps)
Dockerfile                 (build pipeline — no runtime deps)
Dockerfile.feeder          (build pipeline — copies heartbeats/feeder.js)
docker-compose.yml         (orchestration — depends on Dockerfile + Dockerfile.feeder + init.sql)
```

## Module Responsibilities

### `src/app.js` — Application Entry Point & HTTP Routes

- Initializes Express with `express.json()` middleware
- Defines routes:
  - `POST /ingest` — validates body via `validation.js`, persists via `db.js`, logs via `logger.js`
  - `POST /events` — validates event payload, persists incident/error events
  - `GET /host/:id` — queries `db.getLatestTelemetry()`, returns 404 if not found
  - `GET /host/:id/history` — returns full telemetry history with optional `?start=` & `?end=` time filtering
  - `GET /host/:id/logs` — renders an HTML timeline page with time range picker (From/To datetime-local)
  - `GET /fleet` — queries `db.getAllHostsSummary()`, returns computed health
  - `GET /dashboard` — renders live HTML dashboard with SSE auto-updates, clickable host links with ↗ arrows
  - `GET /events/fleet` — Server-Sent Events endpoint that pushes fleet data every 2s to connected browsers
  - `GET /health` — returns immediate 200 (no DB interaction)
- Implements `start()` function that:
  1. Calls `db.waitForDatabase()` — retries until PostgreSQL accepts connections
  2. Starts HTTP server on configurable `PORT`
  3. Registers `SIGTERM` / `SIGINT` handlers
- Implements `shutdown()` that:
  1. Closes HTTP server (stops accepting new requests)
  2. Drains the database connection pool via `db.closePool()`
  3. Exits with code 0 on clean, 1 on error
  4. Forces exit after 10 seconds via `setTimeout().unref()`

### `src/db.js` — Database Access Layer

- Creates a `pg.Pool` with configurable: `host`, `port`, `database`, `user`, `password`, `pool size`
- Pool error listener logs unexpected disconnections
- Exported functions:
  - `waitForDatabase(maxRetries, delayMs)` — polls `SELECT 1` in a loop, throws after exhaustion
  - `insertTelemetry({host, timestamp, cpu_load, mem_used_mb, services, ip})` — inserts a row with `services` stored as JSONB
  - `getLatestTelemetry(host)` — `SELECT ... WHERE host=$1 ORDER BY timestamp DESC LIMIT 1`
  - `getHostHistory(host, startTime, endTime)` — returns up to 500 telemetry records with optional ISO-8601 time range filtering
  - `getHostEvents(host)` — returns up to 100 event records for a host (errors, warnings, incidents)
  - `getAllHostsSummary()` — uses CTE `WITH latest AS (DISTINCT ON host ...)` to get latest per host, then computes `healthy` via `jsonb_array_elements` + `bool_and`
  - `insertEvent({host, timestamp, type, message})` — inserts an error/incident event
  - `closePool()` — `pool.end()` for graceful shutdown

### `src/validation.js` — Payload Schema Validation

- Pure function: no state, no I/O, no dependencies beyond JavaScript primitives
- Validates each field sequentially, accumulating error messages
- Returns `{ valid, errors }` — `valid` is `errors.length === 0`

### `src/logger.js` — Structured Logger

- Thin wrapper over pino
- Formatters customize the `level` key name
- Uses ISO-8601 timestamps for log aggregation compatibility

### `init/init.sql` — Database Schema Definition

- Creates `telemetry` table with `BIGSERIAL` primary key
- Creates composite index `idx_telemetry_host_ts` for efficient latest-per-host queries
- Mounted into PostgreSQL container's `/docker-entrypoint-initdb.d/` for auto-execution on first startup

## Design Patterns

### 1. Retry Circuit for Startup Ordering

```
app.start()
  └→ db.waitForDatabase()
       └→ loop: try SELECT 1 → catch → sleep 1s → retry (max 30)
            └→ success → proceed
            └→ failure → throw → app exits 1
```

This avoids docker-compose `depends_on` race conditions where the container is "running" but PostgreSQL isn't yet accepting connections.

### 2. Graceful Shutdown (Lifecycle Management)

```
SIGTERM/SIGINT
  └→ server.close() → stop accepting new connections
       └→ db.closePool() → drain idle clients, complete pending queries
            └→ process.exit(0)
  └→ setTimeout(10s) → force process.exit(1) as safety net
```

### 3. Health Computation in SQL

Rather than iterating services in application code, fleet health is computed entirely in the database:

```sql
SELECT bool_and(CAST(svc->>'healthy' AS boolean))
FROM jsonb_array_elements(services) AS svc
```

This is more efficient (single round-trip) and offloads processing to PostgreSQL.

### 4. Multi-Stage Docker Build

```
Stage 1 (deps):   node:18-alpine → npm ci --only=production
Stage 2 (runtime): node:18-alpine → COPY node_modules from stage 1
                                    → COPY src/ → CMD ["node", "app.js"]
```

Benefits:
- Runtime image contains only production dependencies
- No build tools, no dev dependencies, no source control artifacts
- Runs as unprivileged `node` user (security best practice)

## Configuration Model

All configuration flows through environment variables, with sensible defaults:

| Variable | Default | Source |
|---|---|---|
| `PORT` | `3000` | `.env` / `docker-compose.yml` |
| `LOG_LEVEL` | `info` | `.env` / `docker-compose.yml` |
| `DB_HOST` | `localhost` | `.env` / `docker-compose.yml` (overridden to `database` in compose) |
| `DB_PORT` | `5432` | `.env` / `docker-compose.yml` |
| `DB_NAME` | `fleet_health` | `.env` / `docker-compose.yml` / `init.sql` |
| `DB_USER` | `fleet_user` | `.env` / `docker-compose.yml` |
| `DB_PASSWORD` | `fleet_pass` | `.env` / `docker-compose.yml` |
| `DB_POOL_SIZE` | `10` | `.env` |
| `FEEDER_INTERVAL` | `5` | `.env` / `docker-compose.yml` |
| `FEEDER_HOSTS` | `7` | `.env` / `docker-compose.yml` |
| `FEEDER_EVENTS` | `true` | `.env` / `docker-compose.yml` |

## Error Handling Strategy

| Layer | Strategy |
|---|---|
| Validation | Synchronous, returns error array — no exceptions thrown |
| Database | Async/await — errors propagate to route handlers via `try/catch` |
| HTTP Routes | Global catch → log error → return `500 { ok: false }` |
| Unexpected pool errors | `pool.on('error')` listener → logged but does not crash process |
| Startup failure | `start()` catches → logs → `process.exit(1)` |
| Shutdown timeout | `setTimeout(10s).unref()` → logs → `process.exit(1)` |