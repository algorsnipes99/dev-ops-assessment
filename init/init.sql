-- Fleet Health Database Schema
-- Initializes the telemetry table for persisting heartbeat payloads.

CREATE TABLE IF NOT EXISTS telemetry (
    id          BIGSERIAL PRIMARY KEY,
    host        VARCHAR(255) NOT NULL,
    timestamp   TIMESTAMPTZ  NOT NULL,
    cpu_load    DOUBLE PRECISION NOT NULL,
    mem_used_mb INTEGER      NOT NULL,
    services    JSONB        NOT NULL DEFAULT '[]',
    ip          VARCHAR(45)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by host ordered by timestamp
CREATE INDEX IF NOT EXISTS idx_telemetry_host_ts
    ON telemetry (host, timestamp DESC);

-- ============================================================================
-- Events Table — Optional error/incident signals
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    host        VARCHAR(255) NOT NULL,
    timestamp   TIMESTAMPTZ  NOT NULL,
    type        VARCHAR(50)  NOT NULL,
    message     TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by host ordered by timestamp
CREATE INDEX IF NOT EXISTS idx_events_host_ts
    ON events (host, timestamp DESC);
