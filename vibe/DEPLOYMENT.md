# Deployment Guide

## Dockerfile — Multi-Stage Build

The application uses a two-stage Docker build for minimal runtime footprint.

### Stage 1: `deps` — Install Dependencies

```dockerfile
FROM node:18-alpine AS deps
WORKDIR /app
COPY src/package.json src/package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force
```

- Uses `npm ci` (not `npm install`) for deterministic, reproducible installs
- `--only=production` excludes devDependencies
- Cache is cleaned to reduce layer size

### Stage 2: `runtime` — Production Image

```dockerfile
FROM node:18-alpine AS runtime
USER node                              # Security: unprivileged user
WORKDIR /app
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node src/ .          # Only application source
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "app.js"]
```

**Key security practices:**
- Runs as `node` user — not root
- `COPY --chown=node:node` ensures correct file permissions
- Only production dependencies are included (no build tools, no dev deps)

### Building Manually

```bash
docker build -t fleet-health-monitor .
docker run -p 3000:3000 --env-file .env fleet-health-monitor
```

---

## Docker Compose — Service Orchestration

### Service: `database` (PostgreSQL 16 Alpine)

```yaml
database:
  image: postgres:16-alpine
  container_name: fleet-database
  restart: unless-stopped
  env_file: .env
  environment:
    POSTGRES_DB: ${DB_NAME:-fleet_health}
    POSTGRES_USER: ${DB_USER:-fleet_user}
    POSTGRES_PASSWORD: ${DB_PASSWORD:-fleet_pass}
  ports:
    - "${DB_PORT:-5432}:5432"
  volumes:
    - pgdata:/var/lib/postgresql/data          # Persistent storage
    - ./init/init.sql:/docker-entrypoint-initdb.d/init.sql:ro  # Auto-init schema
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-fleet_user} -d ${DB_NAME:-fleet_health}"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 10s
```

**Important notes:**
- The `init.sql` is mounted read-only and only executes on **first database initialization** (empty volume)
- The health check uses `pg_isready` which verifies PostgreSQL is accepting connections
- Persistent data is stored in the named `pgdata` volume

### Service: `app` (Node.js Application)

```yaml
app:
  build:
    context: .
    dockerfile: Dockerfile
  container_name: fleet-app
  restart: unless-stopped
  env_file: .env
  environment:
    DB_HOST: database                          # Override: use service name, not localhost
    DB_PORT: "5432"
    DB_NAME: ${DB_NAME:-fleet_health}
    DB_USER: ${DB_USER:-fleet_user}
    DB_PASSWORD: ${DB_PASSWORD:-fleet_pass}
    PORT: ${PORT:-3000}
    LOG_LEVEL: ${LOG_LEVEL:-info}
  ports:
    - "${PORT:-3000}:3000"
  depends_on:
    database:
      condition: service_healthy               # Wait for pg_isready to pass
```

**Key networking detail:** `DB_HOST` is set to `database` (the Docker Compose service name), not `localhost`. This is because each container runs in its own network namespace; within the compose network, services resolve each other by their service names.

### Network Topology

```
Host Machine (localhost)
    │
    ├── :3000 ──→ fleet-app (Express, port 3000)
    │                  │
    │                  │ (internal DNS: "database:5432")
    │                  ▼
    └── :5432 ──→ fleet-database (PostgreSQL, port 5432)
```

---

## Environment Variables

All configuration is managed through environment variables sourced from `.env`.

| Variable | Default | Purpose | Required by |
|---|---|---|---|
| `PORT` | `3000` | App HTTP listen port | App container |
| `LOG_LEVEL` | `info` | pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | App container |
| `DB_HOST` | `localhost` | PostgreSQL hostname | App container |
| `DB_PORT` | `5432` | PostgreSQL port | App container, DB container |
| `DB_NAME` | `fleet_health` | PostgreSQL database name | App container, DB container |
| `DB_USER` | `fleet_user` | PostgreSQL user | App container, DB container |
| `DB_PASSWORD` | `fleet_pass` | PostgreSQL password | App container, DB container |
| `DB_POOL_SIZE` | `10` | Maximum connections in pg pool | App container |

---

## Volumes

| Volume | Mount point | Purpose |
|---|---|---|
| `pgdata` | `/var/lib/postgresql/data` | Persistent PostgreSQL data, survives container restarts |

To inspect or manage:

```bash
# List volumes
docker volume ls

# Inspect volume location
docker volume inspect dev-ops-assessment_pgdata

# Remove volume (destroys all data)
docker volume rm dev-ops-assessment_pgdata
```

---

## Docker HEALTHCHECK Mechanism

The app container defines a Docker HEALTHCHECK that runs every 15 seconds:

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

- Uses `wget --spider` (no download, just checks response) against the `/health` endpoint
- Start period of 10s gives the app time to initialize
- After 3 consecutive failures, Docker marks the container as `unhealthy`
- This is **separate from** the application-level `waitForDatabase()` retry loop

### Health Check States

```
starting  →  healthy  (app is responding to /health)
starting  →  unhealthy  (app failed health check 3× in a row)
healthy   →  unhealthy  (app stopped responding)
```

---

## Port Mapping

Default port mappings (change via `.env`):

| Service | Host Port | Container Port |
|---|---|---|
| `app` | `3000` | `3000` |
| `database` | `5432` | `5432` |

**Accessing from host:**

```bash
# API endpoints
curl http://localhost:3000/health
curl http://localhost:3000/fleet

# Direct database access (for debugging)
psql -h localhost -p 5432 -U fleet_user -d fleet_health
```

---

## Deployment Checklist

- [ ] Update `.env` with secure `DB_PASSWORD`
- [ ] Verify `PORT` is not already in use on host
- [ ] Ensure Docker and Docker Compose are installed
- [ ] Run `./ops.sh start` to build and boot
- [ ] Verify `./ops.sh status` shows both containers as `healthy`
- [ ] Test API: `curl http://localhost:3000/health`
- [ ] Test ingestion: `./ops.sh seed`
- [ ] Take initial snapshot: `./ops.sh snapshot`