'use strict';

const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'fleet_health',
  user: process.env.DB_USER || 'fleet_user',
  password: process.env.DB_PASSWORD || 'fleet_pass',
  max: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

/**
 * Wait for PostgreSQL to accept connections, polling until healthy.
 */
async function waitForDatabase(maxRetries = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      logger.info('Database connection established');
      return;
    } catch (err) {
      logger.warn({ attempt, maxRetries }, `Database not ready: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error(`Failed to connect to database after ${maxRetries} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Insert a telemetry record using parameterized query.
 */
async function insertTelemetry({ host, timestamp, cpu_load, mem_used_mb, services, ip }) {
  const query = `
    INSERT INTO telemetry (host, timestamp, cpu_load, mem_used_mb, services, ip)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  `;
  const values = [host, timestamp, cpu_load, mem_used_mb, JSON.stringify(services), ip];
  await pool.query(query, values);
}

/**
 * Retrieve the latest telemetry record for a given host.
 */
async function getLatestTelemetry(host) {
  const query = `
    SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
    FROM telemetry
    WHERE host = $1
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  const result = await pool.query(query, [host]);
  return result.rows[0] || null;
}

/**
 * Retrieve telemetry history for a host, with optional time range filtering,
 * pagination (limit/offset), and a mode to return all records (limit=0).
 */
async function getHostHistory(host, startTime, endTime, limit = 500, offset = 0) {
  const conditions = ['host = $1'];
  const values = [host];
  let paramIdx = 2;

  if (startTime) {
    conditions.push(`timestamp >= $${paramIdx++}`);
    values.push(startTime);
  }
  if (endTime) {
    conditions.push(`timestamp <= $${paramIdx++}`);
    values.push(endTime);
  }

  const limitClause = limit === 0 ? '' : ` LIMIT $${paramIdx++}`;
  if (limit !== 0) values.push(limit);

  const offsetClause = offset > 0 ? ` OFFSET $${paramIdx++}` : '';
  if (offset > 0) values.push(offset);

  const query = `
    SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
    FROM telemetry
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    ${limitClause}
    ${offsetClause}
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Get the total count of telemetry records for a host, with optional time range.
 */
async function getHostHistoryCount(host, startTime, endTime) {
  const conditions = ['host = $1'];
  const values = [host];
  let paramIdx = 2;

  if (startTime) {
    conditions.push(`timestamp >= $${paramIdx++}`);
    values.push(startTime);
  }
  if (endTime) {
    conditions.push(`timestamp <= $${paramIdx++}`);
    values.push(endTime);
  }

  const query = `
    SELECT COUNT(*) AS total
    FROM telemetry
    WHERE ${conditions.join(' AND ')}
  `;

  const result = await pool.query(query, values);
  return parseInt(result.rows[0].total, 10);
}

/**
 * Retrieve all event records for a host, with optional pagination.
 */
async function getHostEvents(host, limit = 100, offset = 0) {
  const limitClause = limit === 0 ? '' : ` LIMIT $2`;
  const offsetClause = offset > 0 ? ` OFFSET $3` : '';
  const values = [host];
  if (limit !== 0) values.push(limit);
  if (offset > 0) values.push(offset);

  const query = `
    SELECT id, host, timestamp, type, message, created_at
    FROM events
    WHERE host = $1
    ORDER BY timestamp DESC
    ${limitClause}
    ${offsetClause}
  `;
  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Get the total count of events for a host.
 */
async function getHostEventsCount(host) {
  const query = `
    SELECT COUNT(*) AS total
    FROM events
    WHERE host = $1
  `;
  const result = await pool.query(query, [host]);
  return parseInt(result.rows[0].total, 10);
}

/**
 * Retrieve all unique host identifiers with their latest telemetry and computed health.
 */
async function getAllHostsSummary() {
  const query = `
    WITH latest AS (
      SELECT DISTINCT ON (host) host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      ORDER BY host, timestamp DESC
    )
    SELECT
      host,
      timestamp,
      cpu_load,
      mem_used_mb,
      services,
      ip,
      (SELECT bool_and(CAST(svc->>'healthy' AS boolean))
       FROM jsonb_array_elements(latest.services) AS svc) AS healthy
    FROM latest
    ORDER BY host
  `;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Insert an error/incident event using a parameterized query.
 */
async function insertEvent({ host, timestamp, type, message }) {
  const query = `
    INSERT INTO events (host, timestamp, type, message)
    VALUES ($1, $2, $3, $4)
  `;
  const values = [host, timestamp, type, message || ''];
  await pool.query(query, values);
}

/**
 * Gracefully close the database pool.
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  waitForDatabase,
  insertTelemetry,
  getLatestTelemetry,
  getAllHostsSummary,
  getHostHistory,
  getHostHistoryCount,
  getHostEvents,
  getHostEventsCount,
  insertEvent,
  closePool
};
