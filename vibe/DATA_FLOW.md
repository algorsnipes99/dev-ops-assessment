# Data Flow

## 1. Telemetry Ingestion Flow

```
Fleet Host (curl/agent)
        │
        │  POST /ingest
        │  Content-Type: application/json
        ▼
┌───────────────────┐
│  Express App       │
│  src/app.js:17-36  │
│                    │
│  express.json()    │
│  middleware parses  │
│  JSON body         │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Validation        │
│  src/validation.js │
│  :7-59             │
│                    │
│  Fields validated: │
│  • host (string)   │
│  • timestamp (ISO) │
│  • cpu_load (float)│
│  • mem_used_mb (int)│
│  • services (arr)  │
│  • ip (string)     │
└────────┬──────────┘
         │
    ┌────┴────┐
    │         │
  Valid     Invalid
    │         │
    │         ▼
    │    ┌───────────────────┐
    │    │  Response 400      │
    │    │  { ok: false,      │
    │    │    errors: [...] } │
    │    └───────────────────┘
    │
    ▼
┌───────────────────────────┐
│  Database Insert          │
│  src/db.js:45-52          │
│                           │
│  INSERT INTO telemetry    │
│  (host, timestamp,        │
│   cpu_load, mem_used_mb,  │
│   services, ip)           │
│  VALUES ($1, $2, $3, $4,  │
│          $5::jsonb, $6)   │
└───────────┬───────────────┘
            │
            ▼
┌───────────────────┐
│  PostgreSQL 16     │
│  init/init.sql     │
│                    │
│  Table: telemetry  │
│  Index:            │
│  (host, timestamp  │
│   DESC)            │
└───────────────────┘
            │
            ▼
┌───────────────────┐
│  Response 201      │
│  { ok: true }      │
│                    │
│  logger.info()     │
│  "Telemetry        │
│   ingested"        │
└───────────────────┘
```

### Sequence of Events (Ingestion)

1. Fleet host sends HTTP POST with JSON body to `/ingest`
2. Express `json()` middleware parses the request body into a JavaScript object
3. `validateTelemetryPayload()` runs synchronously:
   - Returns `{ valid: false, errors: [...] }` → route sends 400 response, logs warning
   - Returns `{ valid: true }` → proceeds to step 4
4. `db.insertTelemetry()` executes parameterized INSERT query against PostgreSQL
5. If INSERT succeeds → route sends 201 response, logs info
6. If INSERT throws → catch block logs error, sends 500 response

---

## 2. Single Host Query Flow

```
Client
  │
  │  GET /host/api-02
  ▼
┌───────────────────┐
│  Express App       │
│  src/app.js:41-55  │
│                    │
│  Extract host ID   │
│  from req.params   │
└────────┬──────────┘
         │
         ▼
┌───────────────────────────┐
│  Database Query            │
│  src/db.js:57-67          │
│                            │
│  SELECT host, timestamp,   │
│    cpu_load, mem_used_mb,  │
│    services, ip            │
│  FROM telemetry            │
│  WHERE host = $1           │
│  ORDER BY timestamp DESC   │
│  LIMIT 1                   │
└───────────┬───────────────┘
            │
      ┌─────┴─────┐
      │           │
   Found        Not Found
      │           │
      ▼           ▼
┌──────────┐ ┌──────────┐
│ 200      │ │ 404      │
│ {ok:true,│ │ {ok:false│
│  data:...│ │ "Host '..│
│ }        │ │ .' not   │
└──────────┘ │ found"}  │
             └──────────┘
```

---

## 3. Fleet Summary Flow

```
Client
  │
  │  GET /fleet
  ▼
┌───────────────────┐
│  Express App       │
│  src/app.js:60-68  │
│                    │
│  No params needed  │
└────────┬──────────┘
         │
         ▼
┌───────────────────────────────────────┐
│  Database Query                       │
│  src/db.js:72-93                     │
│                                       │
│  WITH latest AS (                     │
│    SELECT DISTINCT ON (host) ...      │
│    FROM telemetry                     │
│    ORDER BY host, timestamp DESC      │
│  )                                    │
│  SELECT                               │
│    host, timestamp, cpu_load,         │
│    mem_used_mb, services, ip,         │
│    (SELECT bool_and(                  │
│      CAST(svc->>'healthy' AS boolean) │
│     FROM jsonb_array_elements(        │
│       latest.services) AS svc)        │
│    ) AS healthy                       │
│  FROM latest                          │
│  ORDER BY host                        │
└───────────┬───────────────────────────┘
            │
            ▼
┌───────────────────────────────────────┐
│  Result Set                           │
│                                       │
│  host     │ healthy                   │
│  ─────────┼─────────────────          │
│  api-01   │ true   (all services OK)  │
│  api-02   │ false  (node-app down)    │
│  db-01    │ true   (all services OK)  │
│  web-01   │ true   (all services OK)  │
│  worker-01│ false  (celery & redis    │
│           │         down)             │
└───────────────────────────────────────┘
            │
            ▼
┌───────────────────┐
│  Response 200      │
│  { ok: true,       │
│    data: [rows] }  │
└───────────────────┘
```

---

## 4. Liveness Probe Flow

```
Orchestrator/Docker
  │
  │  GET /health
  ▼
┌───────────────────┐
│  Express App       │
│  src/app.js:73-75  │
│                    │
│  No DB query       │
│  Immediate 200     │
│  response          │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Response          │
│  200               │
│  { ok: true,       │
│    status:         │
│    "healthy" }     │
└───────────────────┘
```

---

## 5. Event Ingestion Flow

```
Fleet Host (curl/agent)
        │
        │  POST /events
        │  Content-Type: application/json
        ▼
┌───────────────────┐
│  Express App       │
│  src/app.js:73-88  │
│                    │
│  express.json()    │
│  middleware parses  │
│  JSON body         │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Validation        │
│  src/validation.js│
│  :63-103           │
│                    │
│  Fields validated: │
│  • host (string)   │
│  • timestamp (ISO) │
│  • type (one of:   │
│    error, warning, │
│    incident)       │
│  • message (string)│
└────────┬──────────┘
         │
    ┌────┴────┐
    │         │
  Valid     Invalid
    │         │
    │         ▼
    │    ┌───────────────────┐
    │    │  Response 400      │
    │    │  { ok: false,      │
    │    │    errors: [...] } │
    │    └───────────────────┘
    │
    ▼
┌───────────────────────────┐
│  Database Insert          │
│  src/db.js:98-105         │
│                           │
│  INSERT INTO events       │
│  (host, timestamp,        │
│   type, message)          │
│  VALUES ($1, $2, $3, $4)  │
└───────────┬───────────────┘
            │
            ▼
┌───────────────────┐
│  PostgreSQL 16     │
│  init/init.sql     │
│                    │
│  Table: events     │
│  Index:            │
│  (host, timestamp  │
│   DESC)            │
└───────────────────┘
            │
            ▼
┌───────────────────┐
│  Response 201      │
│  { ok: true }      │
│                    │
│  logger.info()     │
│  "Event ingested"  │
└───────────────────┘
```

---

## 6. Startup & Shutdown Flow

### Startup
```
ops.sh start
  │
  ▼
docker compose up --build -d
  │
  ├── database container starts
  │     └── init.sql executes (creates table + index)
  │     └── health check: pg_isready
  │
  └── app container starts (after database is healthy)
        └── db.waitForDatabase()
              └── Loop (up to 30×):
                    ├── SELECT 1 → success → proceed
                    └── catch → sleep 1s → retry
        └── app.listen(PORT)
        └── Register SIGTERM/SIGINT handlers
```

### Shutdown
```
SIGTERM or SIGINT received
  │
  ▼
shutdown(signal)
  │
  ├── server.close()  → stop accepting HTTP requests
  │     └── Wait for in-flight requests to complete
  │
  ├── db.closePool()  → drain all idle connections
  │     └── pool.end()
  │
  ├── process.exit(0) → clean exit
  │
  └── setTimeout(10s).unref() → safety net
        └── process.exit(1) → forced exit if hung
```

---

## 7. Data Schema

```
telemetry table
┌──────────────┬──────────────────┬──────────┐
│ Column       │ Type             │ Notes    │
├──────────────┼──────────────────┼──────────┤
│ id           │ BIGSERIAL        │ PK       │
│ host         │ VARCHAR(255)     │ NOT NULL │
│ timestamp    │ TIMESTAMPTZ      │ NOT NULL │
│ cpu_load     │ DOUBLE PRECISION │ NOT NULL │
│ mem_used_mb  │ INTEGER          │ NOT NULL │
│ services     │ JSONB            │ NOT NULL,│
│              │                  │ DEFAULT  │
│              │                  │ '[]'     │
│ ip           │ VARCHAR(45)      │ NOT NULL │
│ created_at   │ TIMESTAMPTZ      │ NOT NULL,│
│              │                  │ DEFAULT  │
│              │                  │ NOW()    │
└──────────────┴──────────────────┴──────────┘

Index: idx_telemetry_host_ts ON (host, timestamp DESC)

### events table

```
┌──────────────┬──────────────────┬──────────┐
│ Column       │ Type             │ Notes    │
├──────────────┼──────────────────┼──────────┤
│ id           │ BIGSERIAL        │ PK       │
│ host         │ VARCHAR(255)     │ NOT NULL │
│ timestamp    │ TIMESTAMPTZ      │ NOT NULL │
│ type         │ VARCHAR(50)      │ NOT NULL │
│ message      │ TEXT             │ NOT NULL │
│              │                  │ DEFAULT  │
│              │                  │ ''       │
│ created_at   │ TIMESTAMPTZ      │ NOT NULL,│
│              │                  │ DEFAULT  │
│              │                  │ NOW()    │
└──────────────┴──────────────────┴──────────┘

Index: idx_events_host_ts ON (host, timestamp DESC)
```
