# API Reference

## Base URL

When running locally via Docker Compose: `http://localhost:3000` (or `$PORT`).

---

## POST /ingest

Ingest a telemetry/heartbeat payload from a monitored host.

### Request Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |

### Request Body Schema

```json
{
  "host": "string (required, non-empty)",
  "timestamp": "string (required, ISO-8601 datetime)",
  "cpu_load": "number (required, float)",
  "mem_used_mb": "integer (required)",
  "services": [
    {
      "name": "string (required, non-empty)",
      "healthy": "boolean (required)"
    }
  ],
  "ip": "string (required, non-empty)"
}
```

### Example Request

```bash
curl -s -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "host": "api-01",
    "timestamp": "2026-07-03T13:00:00Z",
    "cpu_load": 0.42,
    "mem_used_mb": 2048,
    "services": [
      {"name": "nginx", "healthy": true},
      {"name": "node-app", "healthy": true}
    ],
    "ip": "10.0.1.10"
  }'
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `201` | Successfully ingested | `{"ok": true}` |
| `400` | Validation failed | `{"ok": false, "errors": ["host: must be a non-empty string", ...]}` |
| `500` | Internal server error | `{"ok": false, "error": "Internal server error"}` |

### Validation Rules

| Field | Rule | Error message |
|---|---|---|
| `host` | Must be non-empty string | `host: must be a non-empty string` |
| `timestamp` | Must be non-empty ISO-8601 string, must be parseable by `Date.parse()` | `timestamp: must be a non-empty ISO-8601 string` / `timestamp: must be a valid ISO-8601 date string` |
| `cpu_load` | Must be a number (float), not NaN | `cpu_load: must be a number (float)` |
| `mem_used_mb` | Must be an integer | `mem_used_mb: must be an integer` |
| `services` | Must be an array, each element must have `name` (non-empty string) and `healthy` (boolean) | `services: must be an array` / `services[0].name: must be a non-empty string` / `services[0].healthy: must be a boolean` |
| `ip` | Must be non-empty string | `ip: must be a non-empty string` |
| Payload structure | Must be a JSON object | `Payload must be a JSON object` |

---

## POST /events

Ingest an error/incident event signal from a monitored host (optional).

### Request Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |

### Request Body Schema

```json
{
  "host": "string (required, non-empty)",
  "timestamp": "string (required, ISO-8601 datetime)",
  "type": "string (required, one of: error, warning, incident)",
  "message": "string (optional, defaults to empty string)"
}
```

### Example Request

```bash
curl -s -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "host": "api-02",
    "timestamp": "2026-07-03T13:05:00Z",
    "type": "error",
    "message": "upstream timeout contacting db"
  }'
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `201` | Successfully ingested | `{"ok": true}` |
| `400` | Validation failed | `{"ok": false, "errors": ["type: must be one of: error, warning, incident", ...]}` |
| `500` | Internal server error | `{"ok": false, "error": "Internal server error"}` |

### Validation Rules

| Field | Rule | Error message |
|---|---|---|
| `host` | Must be non-empty string | `host: must be a non-empty string` |
| `timestamp` | Must be non-empty ISO-8601 string, must be parseable by `Date.parse()` | `timestamp: must be a non-empty ISO-8601 string` / `timestamp: must be a valid ISO-8601 date string` |
| `type` | Must be non-empty string, must be one of `error`, `warning`, `incident` | `type: must be a non-empty string` / `type: must be one of: error, warning, incident` |
| `message` | If provided, must be a string | `message: must be a string` |
| Payload structure | Must be a JSON object | `Payload must be a JSON object` |

---

## GET /host/:id

Retrieve the latest telemetry record for a specific host.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Host identifier (e.g., `api-01`, `db-01`) |

### Example Request

```bash
curl http://localhost:3000/host/api-02
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `200` | Host found | `{"ok": true, "data": { ... latest telemetry record ... }}` |
| `404` | Host not found | `{"ok": false, "error": "Host 'api-02' not found"}` |
| `500` | Internal server error | `{"ok": false, "error": "Internal server error"}` |

### Example Response (200)

```json
{
  "ok": true,
  "data": {
    "host": "api-02",
    "timestamp": "2026-07-03T13:00:05.000Z",
    "cpu_load": 0.87,
    "mem_used_mb": 4096,
    "services": [
      {"name": "nginx", "healthy": true},
      {"name": "node-app", "healthy": false},
      {"name": "sidekiq-worker", "healthy": true}
    ],
    "ip": "10.0.1.11"
  }
}
```

---

## GET /fleet

Retrieve the latest telemetry for every host, with computed aggregate health.

### Example Request

```bash
curl http://localhost:3000/fleet
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `200` | Always succeeds (may return empty array) | `{"ok": true, "data": [ ... host records with health ... ]}` |
| `500` | Internal server error | `{"ok": false, "error": "Internal server error"}` |

### Example Response (200)

```json
{
  "ok": true,
  "data": [
    {
      "host": "api-01",
      "timestamp": "2026-07-03T13:00:10.000Z",
      "cpu_load": 0.55,
      "mem_used_mb": 2304,
      "services": [
        {"name": "nginx", "healthy": true},
        {"name": "node-app", "healthy": true},
        {"name": "redis-cache", "healthy": true}
      ],
      "ip": "10.0.1.10",
      "healthy": true
    },
    {
      "host": "api-02",
      "timestamp": "2026-07-03T13:00:05.000Z",
      "cpu_load": 0.87,
      "mem_used_mb": 4096,
      "services": [
        {"name": "nginx", "healthy": true},
        {"name": "node-app", "healthy": false},
        {"name": "sidekiq-worker", "healthy": true}
      ],
      "ip": "10.0.1.11",
      "healthy": false
    }
  ]
}
```

### Health Computation

The `healthy` field is computed in SQL using:

```sql
SELECT bool_and(CAST(svc->>'healthy' AS boolean))
FROM jsonb_array_elements(services) AS svc
```

Returns `true` only when **all** services in the payload report `healthy: true`. Returns `false` if **any** service reports `healthy: false`.

---

## GET /dashboard

Returns an HTML dashboard page displaying the fleet health status visually.

### Example Request

```bash
curl http://localhost:3000/dashboard
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `200` | Always succeeds (may show empty table) | HTML page with styled fleet health table |
| `500` | Internal server error | HTML error page |

The dashboard renders the same data as `GET /fleet` but in a human-readable HTML table with:
- Color-coded health badges (green ● Healthy / red ● Unhealthy)
- Per-service health indicators
- CPU load and memory usage metrics
- Responsive layout with dark theme
- Refresh button to reload live data

---

## GET /host/:id/history

Retrieve the full telemetry history for a specific host, optionally filtered by time range.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Host identifier (e.g., `api-01`, `db-01`) |

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `start` | string (ISO-8601) | Optional. Return records after this timestamp |
| `end` | string (ISO-8601) | Optional. Return records before this timestamp |
| `limit` | integer | Optional. Max records to return (default: 500, use `0` or `all=true` for no limit) |
| `offset` | integer | Optional. Number of records to skip (default: 0) |
| `all` | boolean | Optional. Set to `true` to fetch all records (ignores limit) |

### Example Requests

```bash
# Get all history for a host
curl http://localhost:3000/host/api-01/history

# Get history within a specific time window
curl "http://localhost:3000/host/api-01/history?start=2026-07-03T00:00:00Z&end=2026-07-04T00:00:00Z"

# Get first 20 records (pagination)
curl "http://localhost:3000/host/api-01/history?limit=20&offset=0"

# Get next 20 records
curl "http://localhost:3000/host/api-01/history?limit=20&offset=20"

# Get all records
curl "http://localhost:3000/host/api-01/history?all=true"
```

### Responses

| Status | Condition | Body |
|---|---|---|
| `200` | Host found | `{"ok": true, "data": { "host": "...", "latest": {...}, "history": [...], "events": [...], "pagination": {...} } }` |
| `404` | Host not found | `{"ok": false, "error": "Host '...' not found"}` |
| `500` | Internal server error | `{"ok": false, "error": "Internal server error"}` |

The response now includes a `pagination` object:

```json
{
  "limit": 20,
  "offset": 0,
  "telemetryTotal": 150,
  "eventsTotal": 12,
  "total": 162,
  "hasMore": true
}
```


## GET /host/:id/logs

Returns an HTML timeline view of all telemetry records and events for a specific host, with a time range filter.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | Host identifier (e.g., `api-01`, `db-01`) |

### Features

- **Pagination**: Shows 20 records initially with "Show 20 more" and "Show all" buttons
- **Time range picker**: `From` and `To` datetime-local inputs to filter records within a range
- **Timeline cards**: Each heartbeat shows timestamp, CPU gauge, memory gauge, service health indicators
- **Event interleaving**: Error/warning/incident events appear mixed in the timeline with colored borders
- **Live indicator**: Pulsing green dot confirms live data stream

---

## GET /health

Lightweight liveness probe for Docker HEALTHCHECK and orchestration.

### Example Request

```bash
curl http://localhost:3000/health
```

### Response (always 200)

```json
{
  "ok": true,
  "status": "healthy"
}
```

No database query is performed — this is a pure HTTP 200 response indicating the Node.js process is alive and accepting requests.

---

## Error Response Format

All error responses follow this structure:

```json
{
  "ok": false,
  "error": "Human-readable error message"
}
```

Validation errors (400) include an `errors` array:

```json
{
  "ok": false,
  "errors": ["host: must be a non-empty string", "cpu_load: must be a number (float)"]
}