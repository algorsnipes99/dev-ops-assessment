# Development Log

> Tracks the development history, changes, and decisions made during the lifecycle of this project.

---

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

## [1.0.0] — 2026-07-03

### Initial Release
- All core features implemented and operational
- Verified working end-to-end through Docker Compose
- Seed data demonstrates both healthy and unhealthy fleet states
- Documentation complete with `vibe/` agent-context directory