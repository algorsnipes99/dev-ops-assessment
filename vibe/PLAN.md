# Development Plan & Roadmap

> Outlines the current state, planned enhancements, and strategic direction for the Fleet Health Monitor.

---

## Current State (v1.0.0) — Core Features Implemented

- [x] Telemetry ingestion API (`POST /ingest`)
- [x] Single host query (`GET /host/:id`)
- [x] Fleet health summary (`GET /fleet`) with computed health
- [x] Liveness probe (`GET /health`)
- [x] Payload validation with comprehensive error reporting
- [x] PostgreSQL persistence with JSONB services storage
- [x] Docker Compose orchestration with health check dependencies
- [x] Multi-stage Docker build (minimal production image, unprivileged user)
- [x] Graceful shutdown (SIGTERM/SIGINT handling)
- [x] Structured JSON logging via pino
- [x] Operations control plane (`ops.sh` with start, stop, restart, status, logs, seed, snapshot)
- [x] Database backup/snapshot capability
- [x] Synthetic seed data for testing
- [x] Agent-friendly documentation (`vibe/` directory)
- [x] Root `README.md` with run instructions
- [x] `SOLUTION.md` with design decisions and trade-offs
- [x] `planlog.md` master progress tracker

---

## Development Phases

Development is organized into **phases** tracked in [planlog.md](../planlog.md). Below is the summary of each phase.

### Phase 0: Retrospective & Documentation (Complete)

- [x] Root `README.md` with run instructions
- [x] Root `SOLUTION.md` with full design rationale
- [x] `planlog.md` master progress tracker
- [x] `vibe/` agent documentation directory (10 files)

### Phase 1: Error/Incident Endpoint (Current)

**Goal:** Add optional `POST /events` endpoint for error/incident signals as described in the assignment.

| Task | Status |
|---|---|
| `init/init.sql` — add `events` table | ⬜ |
| `src/validation.js` — add `validateEventPayload()` | ⬜ |
| `src/db.js` — add `insertEvent()` | ⬜ |
| `src/app.js` — add `POST /events` route | ⬜ |
| `ops.sh` — update seed with error signals | ⬜ |
| vibe/ docs — update API_REFERENCE, CONTEXT_MAP, DATA_FLOW | ⬜ |

### Phase 2: Remote Diagnostic

**Goal:** Add `./ops.sh remote` subcommand for SSH-based diagnostic (docker ps).

| Task | Status |
|---|---|
| `ops.sh` — add `cmd_remote()` | ⬜ |
| vibe/ docs — update OPERATIONS.md | ⬜ |

### Phase 3: Final Verification & Polish

- [ ] End-to-end testing of all endpoints
- [ ] Verify all ops.sh subcommands function correctly
- [ ] Sync all documentation with final code state
- [ ] Final review of root docs (README, SOLUTION, planlog)

---

## Future Enhancements (Beyond Current Phases)

### Historical Time-Series Queries
**Priority:** Medium | **Effort:** Small

- `GET /host/:id/history?from=ISO&to=ISO`
- `GET /fleet/history?from=ISO&to=ISO`
- Add index on `timestamp` for efficient range scans

### Pagination for Fleet Endpoint
**Priority:** Low | **Effort:** Small

- `GET /fleet?limit=50&offset=0`
- Add `total` metadata to response

### Enhanced Health Metrics
**Priority:** Low | **Effort:** Small

- `health_score` (percentage of healthy services)
- Fleet-wide `cpu_load_avg`, `mem_used_mb_avg`
- `total_hosts`, `unhealthy_hosts` counts

### Authentication & Authorization
**Priority:** Medium | **Effort:** Medium

- API key validation middleware (`Authorization: Bearer <token>`)
- Configurable via `API_KEY` env var

### Alerting / Webhook Notifications
**Priority:** Medium | **Effort:** Medium

- POST to webhook URL when unhealthy host detected
- Configurable cooldown period

### Prometheus Metrics Endpoint
**Priority:** Low | **Effort:** Medium

- `GET /metrics` endpoint with request counters, error rates, duration histograms

### CI/CD Pipeline
**Priority:** Low | **Effort:** Medium

- GitHub Actions: automated build, test, push to registry

### Grafana Dashboard
**Priority:** Low | **Effort:** Medium

- Optional Grafana + Prometheus in docker-compose
- Fleet health and per-host CPU/memory dashboards

---

## How to Contribute / Add a Feature

1. Check the [planlog.md](../planlog.md) for current phase and task status
2. Reference [CONTEXT_MAP.md](CONTEXT_MAP.md) to identify which files need modification
3. Update source files (`src/*.js`, `init/init.sql`, etc.)
4. Run `./ops.sh start` to build and test
5. Use `./ops.sh seed` to populate test data
6. Verify with `curl` against the relevant endpoints
7. Update planlog.md and this file to track progress
8. Update [LOGS.md](LOGS.md) with a summary of changes
