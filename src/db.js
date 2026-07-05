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
 * Retrieve the full telemetry history for a host, optionally filtered by time range.
 * When start/end times are provided, returns only records within that window.
 */
async function getHostHistory(host, startTime, endTime) {
  let query;
  let values;

  if (startTime && endTime) {
    query = `
      SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      WHERE host = $1 AND timestamp >= $2 AND timestamp <= $3
      ORDER BY timestamp DESC
      LIMIT 500
    `;
    values = [host, startTime, endTime];
  } else if (startTime) {
    query = `
      SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      WHERE host = $1 AND timestamp >= $2
      ORDER BY timestamp DESC
      LIMIT 500
    `;
    values = [host, startTime];
  } else if (endTime) {
    query = `
      SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      WHERE host = $1 AND timestamp <= $2
      ORDER BY timestamp DESC
      LIMIT 500
    `;
    values = [host, endTime];
  } else {
    query = `
      SELECT host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      WHERE host = $1
      ORDER BY timestamp DESC
      LIMIT 500
    `;
    values = [host];
  }

  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Retrieve all event records for a host.
 */
async function getHostEvents(host) {
  const query = `
    SELECT id, host, timestamp, type, message, created_at
    FROM events
    WHERE host = $1
    ORDER BY timestamp DESC
    LIMIT 100
  `;
  const result = await pool.query(query, [host]);
  return result.rows;
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
  getHostEvents,
  insertEvent,
  closePool
};
