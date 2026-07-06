# Fleet Health Monitor — Digital Twin Service

A lightweight Node.js service that ingests heartbeat/telemetry data from a fleet of servers, persists it to PostgreSQL, and exposes REST endpoints for fleet health reporting. Containerized with Docker Compose for local development.

## Prerequisites

- **Docker Engine** (with Compose v2 plugin `docker compose` or standalone `docker-compose` v1)
- **Bash** (Linux, macOS, or WSL on Windows)
- **curl** (for testing)
- **pg_dump** (optional, for database snapshots)

## Quick Start

```bash
# 1. Clone and enter the project directory
cd dev-ops-assessment

# 2. Copy environment config (edit as needed)
cp .env.example .env

# 3. Start the stack (builds images, boots PostgreSQL + App)
#    By default, only the database and app are started.
./ops.sh start

#    To also run the heartbeat feeder simulator (development only):
#    ./ops.sh start --feeder

# 4. Verify both containers are healthy
./ops.sh status

# 5. Seed synthetic test data (6 payloads across 5 hosts)
./ops.sh seed

# 6. Query the fleet
curl http://localhost:3000/fleet

# 7. Check a specific host
curl http://localhost:3000/host/api-02

# 8. View live logs
./ops.sh logs
```

## Project Structure

```
.
├── README.md             # This file — local run instructions
├── SOLUTION.md           # Design decisions and trade-offs
├── planlog.md            # Phase-by-phase progress tracker
├── ops.sh                # Bash control plane (Linux/macOS/WSL)
├── ops.ps1               # PowerShell control plane (Windows)
├── docker-compose.yml    # Container orchestration
├── Dockerfile            # Multi-stage app image build
├── .env.example          # Configuration template
├── .dockerignore
├── init/
│   └── init.sql          # DB schema (auto-executed on first PostgreSQL start)
├── backups/              # Database snapshots (created by `ops.sh snapshot`)
├── src/
│   ├── app.js            # Express application — routes, lifecycle, signal handling
│   ├── db.js             # PostgreSQL connection pool and query functions
│   ├── logger.js         # pino structured logger
│   ├── validation.js     # Payload schema validation
│   ├── package.json
│   └── package-lock.json
└── vibe/                 # Agent-friendly documentation hub
    ├── README.md
    ├── SYSTEM_OVERVIEW.md
    ├── API_REFERENCE.md
    ├── ARCHITECTURE.md
    ├── CONTEXT_MAP.md
    ├── DATA_FLOW.md
    ├── OPERATIONS.md
    ├── DEPLOYMENT.md
    ├── LOGS.md
    └── PLAN.md
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Ingest a telemetry heartbeat payload |
| `POST` | `/events` | Ingest an error/incident event (optional signal) |
| `GET` | `/host/:id` | Get latest telemetry for a specific host |
| `GET` | `/fleet` | Get latest telemetry for all hosts with computed health |
| `GET` | `/health` | Liveness probe (used by Docker HEALTHCHECK) |
| `GET` | `/dashboard` | HTML fleet health dashboard (human-readable view, live via SSE) |
| `GET` | `/events/fleet` | SSE stream for real-time fleet updates (consumed by dashboard) |
| `GET` | `/host/:id/history` | JSON telemetry history for a host, optional `?start=` & `?end=` time filter |
| `GET` | `/host/:id/logs` | HTML timeline view for a host with time range picker |

See [vibe/API_REFERENCE.md](vibe/API_REFERENCE.md) for full schema and examples.

## Operations

### Start Modes

By default, `./ops.sh start` boots only the **database** and **app** services. This is the production-ready mode — no simulator traffic is generated.

To include the heartbeat feeder simulator for development:

| OS | Command |
|---|---|
| Linux/macOS/WSL | `./ops.sh start --feeder` |
| Windows | `.\ops.ps1 start -Feeder` |

> **Windows double-click:** Use `start.bat` for an interactive menu — pick production mode (DB + app) or development mode (with heartbeat simulator). No PowerShell knowledge needed.

### Linux / macOS / WSL (`ops.sh`)
```bash
./ops.sh start             # Build and boot the stack (database + app only)
./ops.sh start --feeder    # Build and boot with heartbeat simulator
./ops.sh stop              # Gracefully shut down
./ops.sh restart           # Cycle the stack
./ops.sh status            # Container runtime health
./ops.sh logs              # Tail aggregated logs
./ops.sh logs --filter x   # Filter logs by host string
./ops.sh feeder start      # Start feeder on an already-running stack
./ops.sh feeder stop       # Stop the feeder
./ops.sh seed              # Inject synthetic telemetry data
./ops.sh snapshot          # Database backup via pg_dump
./ops.sh remote            # Remote diagnostic via SSH (dry-run without credentials)
```

### Windows PowerShell (`ops.ps1`)
```powershell
.\ops.ps1 start            # Build and boot the stack (database + app only)
.\ops.ps1 start -Feeder    # Build and boot with heartbeat simulator
.\ops.ps1 stop             # Gracefully shut down
.\ops.ps1 restart          # Cycle the stack
.\ops.ps1 status           # Container runtime health
.\ops.ps1 logs             # Tail aggregated logs
.\ops.ps1 logs -Filter x   # Filter logs by host string
.\ops.ps1 feeder start     # Start feeder on an already-running stack
.\ops.ps1 feeder stop      # Stop the feeder
.\ops.ps1 seed             # Inject synthetic telemetry data
.\ops.ps1 snapshot         # Database backup via pg_dump
.\ops.ps1 remote           # Remote diagnostic via SSH (dry-run without credentials)
```

## Environment Variables

All configuration via `.env` file (see [.env.example](.env.example)):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | App HTTP listen port |
| `LOG_LEVEL` | `info` | pino log level |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `fleet_health` | Database name |
| `DB_USER` | `fleet_user` | Database user |
| `DB_PASSWORD` | `fleet_pass` | Database password |
| `DB_POOL_SIZE` | `10` | Connection pool size |

## Agent Documentation

The [vibe/](vibe/) directory contains comprehensive, agent-friendly documentation:

- [CONTEXT_MAP.md](vibe/CONTEXT_MAP.md) — maps concepts to exact code locations (start here)
- [SYSTEM_OVERVIEW.md](vibe/SYSTEM_OVERVIEW.md) — high-level architecture
- [ARCHITECTURE.md](vibe/ARCHITECTURE.md) — design patterns and module relationships
- [DATA_FLOW.md](vibe/DATA_FLOW.md) — end-to-end data flow diagrams

## Design Decisions

See [SOLUTION.md](SOLUTION.md) for a full discussion of design decisions, trade-offs, and alternatives considered.