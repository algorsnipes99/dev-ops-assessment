# Solution Design & Trade-offs

## Overview

This document explains the key design decisions, trade-offs, and alternatives considered while building the Fleet Health Monitor "digital twin" service.

---

## Architecture Decisions

### 1. Express.js over Raw HTTP or Fastify

**Chosen:** Express.js

**Rationale:**
- Industry-standard Node.js framework with minimal overhead
- Excellent middleware ecosystem (json parsing, error handling)
- Team familiarity assumed; no learning curve
- Sufficient for a service with 4–5 endpoints

**Alternatives considered:**
- **Raw `http` module:** More control but significantly more boilerplate for route parsing, middleware, and error handling
- **Fastify:** Faster, with schema validation built-in, but adds complexity for a small service and deviates from common conventions

### 2. pino over Winston for Logging

**Chosen:** pino

**Rationale:**
- ~5x faster than Winston (important when every request produces a log line)
- Automatic JSON output with ISO timestamps out of the box
- Lower memory footprint, smaller dependency tree
- Production-ready with log level control via environment variable

**Trade-off:** pino's child logger API is less ergonomic than Winston's for some use cases, but for this service's flat logging pattern it's a non-issue.

### 3. `pg` (node-postgres) Pool over an ORM

**Chosen:** Direct `pg.Pool` with parameterized queries

**Rationale:**
- Full control over SQL — queries are optimized for the specific data model
- No ORM overhead, magic, or hidden N+1 queries
- Parameterized queries prevent SQL injection without additional layers
- Connection pooling is built-in and configurable

**Trade-off:** More verbose than using Sequelize/Prisma for schema management and migrations. However, with a single table and two queries, an ORM would add unnecessary complexity.

### 4. SQL-Level Health Computation vs Application-Level

**Chosen:** SQL-level using `jsonb_array_elements` + `bool_and`

```sql
SELECT bool_and(CAST(svc->>'healthy' AS boolean))
FROM jsonb_array_elements(services) AS svc
```

**Rationale:**
- Single round-trip to the database — application code does zero iteration
- PostgreSQL's JSONB functions are mature and performant
- Keeps application logic in the database layer where it belongs for data-level computations

**Trade-off:** Harder to test in isolation compared to a pure JavaScript function. However, the fleet query itself is integration-tested via `ops.sh seed` + curl verification.

### 5. JSONB for Services vs Separate Services Table

**Chosen:** JSONB column within the telemetry table

**Rationale:**
- Services are always ingested and queried together with the rest of the telemetry payload
- No need to independently query or join on services (no "find all hosts running unhealthy NGINX" requirement)
- Avoids a JOIN on every fleet query
- Simpler schema, fewer tables

**Trade-off:** If future requirements demand querying across services independently (e.g., "show me all hosts where NGINX is unhealthy"), a normalized `services` table with host/timestamp foreign keys would be necessary. The current JSONB approach makes that kind of query harder (requires JSON path operations across rows).

### 6. `DISTINCT ON` for "Latest Per Host" Queries

**Chosen:** PostgreSQL `DISTINCT ON (host)` with `ORDER BY host, timestamp DESC`

**Rationale:**
- Standard PostgreSQL idiom for "latest row per group"
- More efficient than a subquery with `MAX(timestamp)` + JOIN (single table scan with sort)
- Backed by the composite index `(host, timestamp DESC)`

**Trade-off:** `DISTINCT ON` is PostgreSQL-specific and not portable to other databases. This is acceptable since PostgreSQL is a hard requirement.

### 7. Multi-Stage Docker Build

**Chosen:** Two-stage `node:18-alpine` build

**Rationale:**
- Stage 1 (deps) installs production dependencies with `npm ci --only=production`
- Stage 2 (runtime) copies only `node_modules` and source — no build tools, no dev dependencies
- Runtime image is ~140MB vs ~300MB+ for a single-stage build
- Runs as unprivileged `node` user (security best practice)

**Trade-off:** Slightly more complex Dockerfile, but the reduction in attack surface and image size is worth it.

### 8. Bash (ops.sh) over Make or Python

**Chosen:** POSIX-compliant Bash script

**Rationale:**
- Zero dependencies — Bash is available on any Linux/Ubuntu host
- No Make, no Python, no additional runtime required
- Direct access to Docker, curl, pg_dump without wrappers
- POSIX-compliant where practical (avoids bashisms)

**Trade-off:** Bash is less ergonomic than Python for complex logic. The `cmd_seed()` function at ~100 lines is the most complex part and approaches the limit of what's comfortable in Bash. For significantly more complex operations, a Python or Go tool would be warranted.

### 9. Retry-Based Database Startup vs External Wait

**Chosen:** Application-level retry loop (`waitForDatabase()`)

**Rationale:**
- `depends_on` with `condition: service_healthy` in docker-compose only ensures the container is "healthy" per PostgreSQL's `pg_isready`, but the app's `pg.Pool` connection might still fail briefly
- The retry loop in application code handles both container startup and any transient network issues
- Configurable retry count and delay

**Trade-off:** Adds ~30 seconds of startup delay in worst case. However, this is a one-time cost on boot and prevents cascading restarts.

### 10. Graceful Shutdown Pattern

**Chosen:** Close HTTP server → Drain DB pool → Exit

**Rationale:**
- `server.close()` stops accepting new connections but waits for in-flight requests to complete
- `pool.end()` drains idle connections and waits for active queries to finish
- 10-second `setTimeout().unref()` as a safety net prevents hung processes

**Trade-off:** In-flight requests during shutdown may fail if the DB pool drains before they complete. The 10-second timeout window is typically sufficient for a service processing sub-second requests.

---

## Data Model

### telemetry table

```
Column         | Type              | Purpose
id             | BIGSERIAL         | Auto-incrementing primary key
host           | VARCHAR(255)      | Host identifier (api-01, db-01, etc.)
timestamp      | TIMESTAMPTZ       | When the heartbeat was recorded
cpu_load       | DOUBLE PRECISION  | CPU load average
mem_used_mb    | INTEGER           | Memory usage in MB
services       | JSONB             | Array of {name, healthy} objects
ip             | VARCHAR(45)       | Host IP address (supports IPv6)
created_at     | TIMESTAMPTZ       | When the record was inserted
```

**Index:** `(host, timestamp DESC)` — Composite index optimized for "latest per host" lookups. The descending timestamp order avoids an additional sort step.

### events table

```
Column         | Type              | Purpose
id             | BIGSERIAL         | Auto-incrementing primary key
host           | VARCHAR(255)      | Host identifier
timestamp      | TIMESTAMPTZ       | When the event occurred
type           | VARCHAR(50)       | Event type (e.g., "error")
message        | TEXT              | Event description/message
created_at     | TIMESTAMPTZ       | When the record was inserted
```

**Index:** `(host, timestamp DESC)` — Consistent with the telemetry table for uniform query patterns.

---

## API Design

### Response Format

All responses follow a consistent envelope:

```json
{
  "ok": true,
  "data": { ... }        // or "data": [ ... ]
  // "errors": [...]     // present on validation failures
  // "error": "..."      // present on 4xx/5xx
}
```

### Status Code Conventions

| Code | Usage |
|---|---|
| `200` | Successful GET (host found, fleet query) |
| `201` | Successful POST (resource created) |
| `400` | Validation failure (malformed payload) |
| `404` | Resource not found (host not in database) |
| `500` | Internal server error (catch-all for unexpected failures) |

### Health Computation

A host is considered **healthy** if all services in its most recent heartbeat report `healthy: true`. If any service reports `healthy: false`, the host is unhealthy. This is computed in SQL per request, not stored as a pre-computed column.

---

## Operations Design

### ops.sh Philosophy

- **Single entry point** for all common operations — new team members only need to know `./ops.sh <cmd>`
- **Auto-discovery** of Docker Compose v1 vs v2
- **Fail-safe** on missing `.env` (auto-copies from `.env.example`)
- **Colored output** when connected to a TTY, plain text when piped
- **Safe defaults** for the `remote` subcommand — runs in dry-run mode without credentials

### Why pg_dump Custom Format

`--format=custom` produces a compressed, multi-schema, parallel-restoreable dump. It's faster than plain SQL, smaller on disk, and can be selectively restored.

---

## Agent Documentation (vibe/) Approach

The `vibe/` directory was designed with AI agents as the primary audience. Key principles:

1. **CONTEXT_MAP.md** is the most critical file — it provides a "CTRL+F for code locations" table. Any agent can find exactly which line of code implements a feature.
2. **Cross-linking** between files allows an agent to start anywhere and navigate to relevant context.
3. **Line-number precision** in the context map eliminates guesswork.
4. **Quick-agent-workflows** at the bottom of the context map answer "if I need to change X, where do I start?".