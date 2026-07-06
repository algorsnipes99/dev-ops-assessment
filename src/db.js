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
 * Retrieve the latest telemetry record for a given host within an optional time range.
 * When startTime/endTime are null, returns the absolute latest (same as getLatestTelemetry).
 */
async function getLatestTelemetryInRange(host, startTime, endTime) {
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
    SELECT
      host,
      timestamp,
      cpu_load,
      mem_used_mb,
      services,
      ip,
      (SELECT bool_and(CAST(svc->>'healthy' AS boolean))
       FROM jsonb_array_elements(services) AS svc) AS healthy
    FROM telemetry
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  const result = await pool.query(query, values);
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
 * Retrieve all event records for a host, with optional time range filtering
 * and pagination (limit/offset).  Uses the same pattern as getHostHistory.
 */
async function getHostEvents(host, startTime, endTime, limit = 100, offset = 0) {
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
    SELECT id, host, timestamp, type, message, created_at
    FROM events
    WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC
    ${limitClause}
    ${offsetClause}
  `;
  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Get the total count of events for a host, with optional time range.
 */
async function getHostEventsCount(host, startTime, endTime) {
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
    FROM events
    WHERE ${conditions.join(' AND ')}
  `;
  const result = await pool.query(query, values);
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

/**
 * Get a page of (id, source) pairs representing the combined chronological
 * timeline for a host within an optional time range.
 *
 * Lightweight — only fetches id and source (telemetry or event), no detail columns.
 * The FE uses these as a "map" to request full details in batches.
 */
async function getTimelinePage(host, startTime, endTime, limit = 20, offset = 0) {
  const tConditions = ['host = $1'];
  const eConditions = ['host = $1'];
  const values = [host];
  let paramIdx = 2;

  if (startTime) {
    tConditions.push(`timestamp >= $${paramIdx}`);
    eConditions.push(`timestamp >= $${paramIdx}`);
    values.push(startTime);
    paramIdx++;
  }
  if (endTime) {
    tConditions.push(`timestamp <= $${paramIdx}`);
    eConditions.push(`timestamp <= $${paramIdx}`);
    values.push(endTime);
    paramIdx++;
  }

  // Build LIMIT/OFFSET clauses (omit LIMIT when limit=0 meaning "all")
  const limitClause = limit === 0 ? '' : ` LIMIT $${paramIdx++}`;
  if (limit !== 0) values.push(limit);
  const offsetClause = offset > 0 ? ` OFFSET $${paramIdx++}` : '';
  if (offset > 0) values.push(offset);

  // Get combined page of (id, source) sorted by timestamp DESC
  const query = `
    SELECT id, source, timestamp
    FROM (
      SELECT id, 'telemetry' AS source, timestamp
      FROM telemetry
      WHERE ${tConditions.join(' AND ')}
      UNION ALL
      SELECT id, 'event' AS source, timestamp
      FROM events
      WHERE ${eConditions.join(' AND ')}
    ) combined
    ORDER BY timestamp DESC
    ${limitClause}
    ${offsetClause}
  `;

  const result = await pool.query(query, values);
  return result.rows;  // [{id: 1, source: 'telemetry'}, ...]
}

/**
 * Get the total number of combined records for a host, with optional time range.
 */
async function getTimelineTotal(host, startTime, endTime) {
  const tConditions = ['host = $1'];
  const eConditions = ['host = $1'];
  const values = [host];
  let idx = 2;

  if (startTime) {
    tConditions.push(`timestamp >= $${idx}`);
    eConditions.push(`timestamp >= $${idx}`);
    values.push(startTime);
    idx++;
  }
  if (endTime) {
    tConditions.push(`timestamp <= $${idx}`);
    eConditions.push(`timestamp <= $${idx}`);
    values.push(endTime);
    idx++;
  }

  const query = `
    SELECT COUNT(*) AS total
    FROM (
      SELECT id FROM telemetry WHERE ${tConditions.join(' AND ')}
      UNION ALL
      SELECT id FROM events WHERE ${eConditions.join(' AND ')}
    ) combined
  `;

  const result = await pool.query(query, values);
  return parseInt(result.rows[0].total, 10);
}

/**
 * Given an array of {id, source} items, fetch the full records and return them
 * in the same order, each annotated with a record_type field.
 */
async function getTimelineItems(items, host) {
  if (!items || items.length === 0) return [];

  const telemetryIds = items.filter(i => i.source === 'telemetry').map(i => i.id);
  const eventIds = items.filter(i => i.source === 'event').map(i => i.id);

  const results = [];

  // Fetch telemetry records
  if (telemetryIds.length > 0) {
    const tPlaceholders = telemetryIds.map((_, i) => `$${i + 2}`).join(',');
    const tQuery = `
      SELECT id, host, timestamp, cpu_load, mem_used_mb, services, ip
      FROM telemetry
      WHERE host = $1 AND id IN (${tPlaceholders})
    `;
    const tResult = await pool.query(tQuery, [host, ...telemetryIds]);
    const tMap = {};
    tResult.rows.forEach(r => { tMap[r.id] = r; });

    telemetryIds.forEach(id => {
      if (tMap[id]) {
        results.push({ ...tMap[id], record_type: 'heartbeat' });
      }
    });
  }

  // Fetch event records
  if (eventIds.length > 0) {
    const ePlaceholders = eventIds.map((_, i) => `$${i + 2}`).join(',');
    const eQuery = `
      SELECT id, host, timestamp, type, message, created_at
      FROM events
      WHERE host = $1 AND id IN (${ePlaceholders})
    `;
    const eResult = await pool.query(eQuery, [host, ...eventIds]);
    const eMap = {};
    eResult.rows.forEach(r => { eMap[r.id] = r; });

    eventIds.forEach(id => {
      if (eMap[id]) {
        results.push({
          id: eMap[id].id,
          host: eMap[id].host,
          timestamp: eMap[id].timestamp,
          record_type: 'event',
          event_type: eMap[id].type,
          message: eMap[id].message
        });
      }
    });
  }

  // Re-sort results to match the original items order
  const idOrder = {};
  items.forEach((item, index) => {
    idOrder[item.source + ':' + item.id] = index;
  });
  results.sort((a, b) => {
    const aKey = (a.record_type === 'event' ? 'event' : 'telemetry') + ':' + (a.record_type === 'event' ? a.id : a.id);
    const bKey = (b.record_type === 'event' ? 'event' : 'telemetry') + ':' + (b.record_type === 'event' ? b.id : b.id);
    return (idOrder[aKey] || 0) - (idOrder[bKey] || 0);
  });

  return results;
}

module.exports = {
  waitForDatabase,
  insertTelemetry,
  getLatestTelemetry,
  getLatestTelemetryInRange,
  getAllHostsSummary,
  getHostHistory,
  getHostHistoryCount,
  getHostEvents,
  getHostEventsCount,
  getTimelinePage,
  getTimelineTotal,
  getTimelineItems,
  insertEvent,
  closePool
};
