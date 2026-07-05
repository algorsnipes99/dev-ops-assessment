# Development Log

> Tracks the development history, changes, and decisions made during the lifecycle of this project.

---

## [1.2.0] — 2026-07-05

### Added
- **Containerized Heartbeat Feeder** (`Dockerfile.feeder`) — Feeder script now runs as its own Docker service (`fleet-feeder`) inside the compose network
- **Feeder control in ops.sh/ops.ps1** — New `feeder` subcommand with `start`, `stop`, `restart`, `logs`, `status`
- **Feeder environment variables** — `FEEDER_INTERVAL`, `FEEDER_HOSTS`, `FEEDER_EVENTS` in `.env.example`
- **YAML anchor** — `x-feeder-defaults` for clean environment variable injection in docker-compose.yml

### Changed
- **docker-compose.yml** — Added `feeder` service with `depends_on: app: service_healthy`
- **ops.sh** — Added `cmd_feeder()` function and `feeder` case in main dispatch
- **ops.ps1** — Added `Invoke-Feeder` function and `feeder` case in switch statement
- **vibe/ documentation** — Updated SYSTEM_OVERVIEW.md (diagram), DEPLOYMENT.md (network topology), OPERATIONS.md (feeder subcommand docs), CONTEXT_MAP.md (new files and lines)

## [Unreleased] — 2026-07-03

### Added
- Initial project scaffolding (Dockerfile, docker-compose.yml, ops.sh, init.sql)
- Express application with telemetry ingestion endpoint (`POST /ingest`)
- Host query endpoint (`GET /host/:id`) and fleet summary endpoint (`GET /fleet`)
- Health check endpoint (`GET /health`) for Docker liveness probes
- PostgreSQL connection pool with retry-based startup ordering
- Payload validation module with comprehensive schema checks
- Structured JSON logging via pino with ISO-8601 timestamps
- Graceful shutdown handling for SIGTERM and SIGINT signals
- Multi-stage Docker build for minimal production image size
- Docker Compose orchestration with PostgreSQL health check dependency
- `ops.sh` control plane script with subcommands: start, stop, restart, status, logs, seed, snapshot
- Synthetic seed data generator covering 5 hosts with various health states
- Database snapshot/backup capability via pg_dump
- `vibe/` documentation directory with agent-friendly system documentation

### Architecture Decisions
- **Parameterized SQL queries** chosen over ORM for simplicity and security
- **JSONB for services column** enables flexible schema-less service definitions per payload
- **SQL-level health computation** using `bool_and` + `jsonb_array_elements` for efficiency
- **Two-stage Docker build** minimizes runtime image to ~140MB
- **ops.sh over Makefile** to avoid Make dependency on host systems
- **pino** chosen for structured logging over Winston for better performance and smaller bundle
- **`npm ci`** over `npm install` for deterministic, reproducible dependency installs

---

## [1.1.0] — 2026-07-05

### Added
- **Live Fleet Dashboard** (`GET /dashboard`) — HTML dashboard with dark theme, color-coded health badges, responsive layout
- **SSE Real-Time Updates** (`GET /events/fleet`) — Server-Sent Events endpoint pushing fleet data every 2 seconds to connected browsers
- **Host Logs Timeline** (`GET /host/:id/logs`) — Per-host heartbeat timeline with CPU/memory gauges, service health indicators, and event interleaving
- **Host History API** (`GET /host/:id/history`) — JSON endpoint returning full telemetry history with optional `?start=` and `?end=` time range filtering
- **Clickable Host Links** — Dashboard host names link to per-host logs page with arrow indicator (↗) on hover
- **Time Range Picker** — Replaced service filter with From/To datetime-local inputs on the logs page
- **Continuous Heartbeat Feeder** (`heartbeats/feeder.js`) — Node.js script simulating multiple fleet hosts with random CPU/memory variance and 8% service flip probability
- **Windows PowerShell Control Plane** (`ops.ps1`) — Full PowerShell equivalent of ops.sh with all subcommands
- **Windows Double-Click Launcher** (`start.bat`) — One-click rebuild and boot without terminal
- **`.gitignore`** — Ignores node_modules, .env, backups, and editor files

### Changed
- **Docker builds** — `ops.ps1 start` now runs `docker compose build --no-cache` to force clean builds
- **`getHostHistory()`** — Updated to accept `startTime` and `endTime` parameters for time-range filtering (replaced service filter)

## [1.0.0] — 2026-07-03

### Initial Release
- All core features implemented and operational
- Verified working end-to-end through Docker Compose
- Seed data demonstrates both healthy and unhealthy fleet states
