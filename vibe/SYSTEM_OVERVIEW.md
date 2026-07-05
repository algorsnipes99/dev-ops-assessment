# System Overview

## Purpose

The Fleet Health Monitor is a production-ready telemetry ingestion service designed to:

1. **Ingest** structured heartbeat/metric payloads from a fleet of servers via a REST API
2. **Persist** telemetry data to PostgreSQL with time-series indexing
3. **Query** individual host state (latest snapshot)
4. **Aggregate** fleet-wide health status with computed health flags
5. **Operate** reliably in containerized environments with graceful lifecycle management

## High-Level Architecture

```
┌──────────────┐     POST /ingest     ┌──────────────────┐     INSERT     ┌────────────┐
│ Fleet Hosts  │ ──────────────────→  │  Node.js/Express │ ────────────→  │ PostgreSQL │
│ (curl/agents)│                      │   Fleet App      │                │  16 Alpine │
└──────────────┘     GET /host/:id     └──────────────────┘     SELECT    └────────────┘
                     GET /fleet                │                              │
                           │                   │ pino                        │
                           │                   ▼                              │
                           │            ┌──────────┐                        │
                           │            │  stdout  │                        │
                           │            │ (JSON    │                        │
                           │            │  logs)   │                        │
                           │            └──────────┘                        │
                           │                                                │
                           └────────────────────────────────────────────────┘
                               Docker Compose Orchestration
```

## Components

### 1. Express Application (`src/app.js`)
- Entry point for the Node.js service
- Defines all HTTP routes and middleware
- Manages server lifecycle and OS signal handling
- Blocks startup until database is reachable

### 2. Database Module (`src/db.js`)
- Manages a PostgreSQL connection pool (configurable pool size)
- Provides parameterized queries for all data operations
- Implements a retry-based `waitForDatabase()` for startup ordering
- Exposes: `insertTelemetry`, `getLatestTelemetry`, `getAllHostsSummary`

### 3. Validation Module (`src/validation.js`)
- Synchronous validation of incoming telemetry payloads
- Checks: `host` (non-empty string), `timestamp` (valid ISO-8601), `cpu_load` (float), `mem_used_mb` (integer), `services` (array of `{name, healthy}` objects), `ip` (non-empty string)
- Returns `{ valid: boolean, errors: string[] }`

### 4. Logger Module (`src/logger.js`)
- Wraps pino with ISO-8601 timestamps and structured formatting
- Log level configurable via `LOG_LEVEL` env var

### 5. Database Schema (`init/init.sql`)
- Creates the `telemetry` table with: `id`, `host`, `timestamp`, `cpu_load`, `mem_used_mb`, `services` (JSONB), `ip`, `created_at`
- Indexes on `(host, timestamp DESC)` for efficient latest-record lookups

### 6. Docker Infrastructure
- **Dockerfile**: Two-stage Node.js 18 Alpine build (deps + runtime). Runs as unprivileged `node` user. Includes `HEALTHCHECK` against `/health`
- **docker-compose.yml**: Orchestrates `database` (PostgreSQL 16 Alpine with health check) and `app` (depends on DB health)

### 7. Operations Script (`ops.sh`)
- POSIX-compliant Bash utility for local ecosystem management
- Subcommands: `start`, `stop`, `restart`, `status`, `logs`, `seed`, `snapshot`
- Handles Docker Compose v1/v2 detection
- Automatically copies `.env.example` if `.env` is missing

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Multi-stage Docker build** | Minimizes runtime image size; dev dependencies not in production |
| **Parameterized SQL queries** | Prevents SQL injection without ORM overhead |
| **Retry-based DB startup** | Avoids race conditions in container startup ordering |
| **Computed fleet health via SQL** | Single query uses `jsonb_array_elements` and `bool_and` to reduce application logic |
| **Structured JSON logging** | Machine-parseable log output for log aggregators (ELK, Datadog, etc.) |
| **ops.sh over Makefile** | Pure Bash — no Make dependency required on host |
| **Graceful shutdown** | HTTP server closes + DB pool drains before exit; 10s forced timeout as safety net |

## Non-Goals

- Authentication / authorization (not included — assumed behind a gateway)
- Historical time-series queries (only "latest per host" is exposed)
- Horizontal scaling (single-instance Node.js by design)
- Automated CI/CD pipeline (local development focus)