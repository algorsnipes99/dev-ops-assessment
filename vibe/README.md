# Fleet Health Monitor — Vibe Guide

> **Purpose:** This directory is an agent-first documentation hub. Any new AI instance or human contributor can read these files to understand the system, its architecture, data flows, and operational procedures — without reading every line of source code.

## System at a Glance

**Fleet Health Monitor** is a lightweight, Dockerized telemetry ingestion and fleet-health visibility service. It receives heartbeat payloads from remote servers, persists them to PostgreSQL, and exposes REST endpoints for querying both individual host state and aggregate fleet health.

| Aspect | Summary |
|---|---|
| **Runtime** | Node.js 18 (Express) |
| **Database** | PostgreSQL 16 (Alpine) |
| **Logging** | pino (structured JSON) |
| **Orchestration** | Docker Compose |
| **Control Plane** | Bash script (`ops.sh`) |

## Documentation Index

| File | What It Covers |
|---|---|
| [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | High-level architecture, components, design decisions |
| [API_REFERENCE.md](API_REFERENCE.md) | All REST endpoints, request/response schemas, validation rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internal module relationships, patterns, code organization |
| [CONTEXT_MAP.md](CONTEXT_MAP.md) | **Start here for agent context** — maps concepts to exact code locations |
| [DATA_FLOW.md](DATA_FLOW.md) | End-to-end ingestion and query data flows |
| [OPERATIONS.md](OPERATIONS.md) | `ops.sh` subcommands, Docker lifecycle, backup/restore |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Dockerfile, compose, environment variables, networking |
| [LOGS.md](LOGS.md) | Development changelog |
| [PLAN.md](PLAN.md) | Roadmap and planned enhancements |

## Quick Navigation for Agents

1. **If you need to understand what this system does** → [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
2. **If you need to find where specific code lives** → [CONTEXT_MAP.md](CONTEXT_MAP.md)
3. **If you need to modify or debug an API endpoint** → [API_REFERENCE.md](API_REFERENCE.md) + [CONTEXT_MAP.md](CONTEXT_MAP.md)
4. **If you need to run or operate the system** → [OPERATIONS.md](OPERATIONS.md)
5. **If you need to deploy or reconfigure infrastructure** → [DEPLOYMENT.md](DEPLOYMENT.md)