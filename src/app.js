'use strict';

const express = require('express');
const logger = require('./logger');
const db = require('./db');
const { validateTelemetryPayload, validateEventPayload } = require('./validation');

// ---------------------------------------------------------------------------
// Express App Setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// 1.1 Ingestion Pipeline — POST /ingest
// ---------------------------------------------------------------------------
app.post('/ingest', async (req, res) => {
  try {
    const { valid, errors } = validateTelemetryPayload(req.body);

    if (!valid) {
      logger.warn({ errors, body: req.body }, 'Ingestion validation failed');
      return res.status(400).json({ ok: false, errors });
    }

    const { host, timestamp, cpu_load, mem_used_mb, services, ip } = req.body;

    await db.insertTelemetry({ host, timestamp, cpu_load, mem_used_mb, services, ip });

    logger.info({ host, timestamp }, 'Telemetry ingested successfully');
    return res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Ingestion error');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Host History — GET /host/:id/history (JSON)
// ---------------------------------------------------------------------------
// Query params:
//   ?start=2026-07-04T00:00:00Z&end=2026-07-05T23:59:59Z  — filter by time range
//   &limit=20&offset=0  — pagination (default: limit=500, offset=0)
//   &all=true            — override: fetch with no limit (limit=0)
// ---------------------------------------------------------------------------
app.get('/host/:id/history', async (req, res) => {
  try {
    const hostId = req.params.id;
    const startTime = req.query.start || null;
    const endTime = req.query.end || null;
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 0) limit = 500;
    let offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;
    // Allow ?all=true to fetch everything
    if (req.query.all === 'true') limit = 0;

    // Check host exists (within date range if filtered)
    const latest = await db.getLatestTelemetryInRange(hostId, startTime, endTime);
    if (!latest) {
      return res.status(404).json({ ok: false, error: `Host '${hostId}' not found` });
    }

    // Fetch timeline page items (lightweight) + total count in parallel
    const [pageItems, timelineTotal] = await Promise.all([
      db.getTimelinePage(hostId, startTime, endTime, limit, offset),
      db.getTimelineTotal(hostId, startTime, endTime)
    ]);

    // Then fetch full detail records using the page items
    const timeline = await db.getTimelineItems(pageItems, hostId);

    // hasMore: when limit=0 ("all"), we got everything so no more
    const hasMore = limit > 0 ? (offset + limit) < timelineTotal : false;

    return res.status(200).json({
      ok: true,
      data: {
        host: hostId,
        latest,
        timeline,
        start: startTime,
        end: endTime,
        pagination: {
          limit,
          offset,
          total: timelineTotal,
          hasMore
        }
      }
    });
  } catch (err) {
    logger.error({ err }, 'Host history error');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// 1.2 Query & Visibility — GET /fleet
// ---------------------------------------------------------------------------
app.get('/fleet', async (req, res) => {
  try {
    const rows = await db.getAllHostsSummary();
    return res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'Fleet query error');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Host Logs — GET /host/:id/logs (HTML timeline view with pagination)
// ---------------------------------------------------------------------------
app.get('/host/:id/logs', async (req, res) => {
  try {
    const hostId = req.params.id;
    const startTime = req.query.start || '';
    const endTime = req.query.end || '';
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    let offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;

    const st = startTime || null;
    const et = endTime || null;

    const latest = await db.getLatestTelemetryInRange(hostId, st, et);
    if (!latest) {
      return res.status(404).send(`<h1>404</h1><p>Host '${hostId}' not found</p>`);
    }

    // Fetch timeline page items (lightweight) + total count in parallel
    const [pageItems, total] = await Promise.all([
      db.getTimelinePage(hostId, st, et, limit, offset),
      db.getTimelineTotal(hostId, st, et)
    ]);

    // Then fetch full detail records using the page items
    const timelineRows = await db.getTimelineItems(pageItems, hostId);

    const shown = timelineRows.length;
    const hasMore = (offset + shown) < total;
    const nextOffset = offset + shown;

    const hostHealthy = latest.healthy;
    const healthBadge = hostHealthy
      ? '<span class="badge badge-ok">● Healthy</span>'
      : '<span class="badge badge-fail">● Unhealthy</span>';

    // Build timeline HTML from the already-sorted UNION ALL result
    const timeline = [];

    timelineRows.forEach(r => {
      if (r.record_type === 'heartbeat') {
        const servicesHtml = (r.services || []).map(s => {
          const cls = s.healthy ? 'svc-ok' : 'svc-fail';
          return `<span class="service ${cls}">${s.name}</span>`;
        }).join('');

        const cpuPct = r.cpu_load != null ? Math.round(r.cpu_load * 100) : 0;
        const memMb = r.mem_used_mb || 0;
        const memPct = Math.min(Math.round((memMb / 16384) * 100), 100);

        timeline.push({
          ts: new Date(r.timestamp).getTime(),
          html: `<div class="tl-entry tl-telemetry">
            <div class="tl-header">
              <span class="tl-time">${new Date(r.timestamp).toLocaleString()}</span>
              <span class="tl-type">Heartbeat</span>
            </div>
            <div class="tl-metrics">
              <span class="metric">CPU <span class="gauge"><span class="gauge-fill gauge-cpu" style="width:${cpuPct}%"></span></span> ${r.cpu_load != null ? r.cpu_load.toFixed(2) : '—'}</span>
              <span class="metric">MEM <span class="gauge"><span class="gauge-fill gauge-mem" style="width:${memPct}%"></span></span> ${memMb.toLocaleString()} MB</span>
            </div>
            <div class="tl-services">${servicesHtml}</div>
          </div>`
        });
      } else if (r.record_type === 'event') {
        const eventType = r.event_type || 'incident';
        const typeIcon = eventType === 'error' ? '🟥' : eventType === 'warning' ? '🟨' : '🟦';
        timeline.push({
          ts: new Date(r.timestamp).getTime(),
          html: `<div class="tl-entry tl-event tl-event-${eventType}">
            <div class="tl-header">
              <span class="tl-time">${new Date(r.timestamp).toLocaleString()}</span>
              <span class="tl-type tl-type-${eventType}">${typeIcon} ${eventType.toUpperCase()}</span>
            </div>
            <div class="tl-message">${r.message || ''}</div>
          </div>`
        });
      }
    });

    const timelineHtml = shown > 0
      ? timeline.map(t => t.html).join('\n')
      : '<div class="empty">No telemetry or event data for this host yet.</div>';

    const moreBtn = hasMore
      ? `<button class="btn" id="loadMoreBtn">Show 20 more</button>
         <button class="btn" id="showAllBtn">Show all</button>`
      : '';

    const reqStart = req.query.start || '';
    const reqEnd = req.query.end || '';
    const fpParts = [];
    if (reqStart) fpParts.push('start=' + encodeURIComponent(reqStart));
    if (reqEnd) fpParts.push('end=' + encodeURIComponent(reqEnd));
    const fetchParams = fpParts.length > 0 ? '?' + fpParts.join('&') : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logs — ${hostId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      background: #0f172a; color: #e2e8f0;
      padding: 2rem 1rem; min-height: 100vh;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem;
    }
    header h1 { font-size: 1.5rem; font-weight: 700; color: #e2e8f0; }
    header .sub { font-size: 0.85rem; color: #94a3b8; }
    .back-link {
      color: #38bdf8; text-decoration: none; font-size: 0.9rem;
    }
    .back-link:hover { text-decoration: underline; }
    .host-info {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .badge {
      display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px;
      font-size: 0.8rem; font-weight: 600;
    }
    .badge-ok { color: #22c55e; background: rgba(34, 197, 94, 0.12); }
    .badge-fail { color: #ef4444; background: rgba(239, 68, 68, 0.15); }
    .controls {
      display: flex; align-items: center; gap: 0.5rem;
      margin-bottom: 1.5rem; flex-wrap: wrap;
    }
    .controls label { font-size: 0.85rem; color: #94a3b8; }
    .controls input[type="datetime-local"] {
      background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
      padding: 0.4rem 0.5rem; border-radius: 6px; font-size: 0.85rem;
    }
    .controls .btn {
      background: #1e293b; color: #38bdf8; border: 1px solid #334155;
      padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer;
      font-size: 0.85rem; transition: background 0.2s;
    }
    .controls .btn:hover { background: #334155; }
    .controls .btn-primary {
      background: #0ea5e9; color: #fff; border: 1px solid #0ea5e9;
    }
    .controls .btn-primary:hover { background: #0284c7; }
    .controls .count { font-size: 0.85rem; color: #64748b; margin-left: auto; }
    .pagination-bar {
      display: flex; justify-content: center; gap: 0.75rem;
      margin-top: 1.5rem; flex-wrap: wrap;
    }
    .tl-entry {
      background: #1e293b; border-radius: 8px; padding: 0.75rem 1rem;
      border-left: 3px solid #334155; margin-bottom: 0.5rem;
    }
    .tl-telemetry { border-left-color: #38bdf8; }
    .tl-event-error { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.06); }
    .tl-event-warning { border-left-color: #eab308; background: rgba(234, 179, 8, 0.06); }
    .tl-event-incident { border-left-color: #3b82f6; background: rgba(59, 130, 246, 0.06); }
    .tl-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 0.5rem;
    }
    .tl-time { font-size: 0.8rem; color: #64748b; font-family: monospace; }
    .tl-type { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .tl-type-error { color: #ef4444; }
    .tl-type-warning { color: #eab308; }
    .tl-type-incident { color: #3b82f6; }
    .tl-metrics {
      display: flex; gap: 1.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;
    }
    .metric {
      font-size: 0.85rem; color: #cbd5e1; display: flex; align-items: center; gap: 0.5rem;
    }
    .gauge {
      display: inline-block; width: 80px; height: 6px; background: #334155;
      border-radius: 3px; overflow: hidden; vertical-align: middle;
    }
    .gauge-fill {
      display: block; height: 100%; border-radius: 3px; transition: width 0.3s;
    }
    .gauge-cpu { background: #38bdf8; }
    .gauge-mem { background: #818cf8; }
    .tl-services { display: flex; flex-wrap: wrap; gap: 4px; }
    .service {
      display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px;
      font-size: 0.8rem; font-weight: 500;
    }
    .svc-ok { color: #22c55e; background: rgba(34, 197, 94, 0.10); }
    .svc-fail { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
    .tl-message { font-size: 0.85rem; color: #e2e8f0; }
    .empty { text-align: center; padding: 3rem; color: #64748b; }
    .live-indicator {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.8rem; color: #22c55e;
    }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #22c55e; animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    @media (max-width: 768px) {
      body { padding: 1rem 0.5rem; }
      header h1 { font-size: 1.2rem; }
      .metric { font-size: 0.8rem; }
      .gauge { width: 60px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <a href="/dashboard" class="back-link">← Fleet Dashboard</a>
        <h1>📋 ${hostId}</h1>
        <div class="sub">
          ${latest.ip || '—'} · <span class="live-indicator"><span class="live-dot"></span> Live</span>
        </div>
      </div>
      <div class="host-info">${healthBadge}</div>
    </header>

    <div class="controls">
      <label for="startTime">From:</label>
      <input type="datetime-local" id="startTime" value="${startTime ? startTime.substring(0,16) : ''}">
      <label for="endTime">To:</label>
      <input type="datetime-local" id="endTime" value="${endTime ? endTime.substring(0,16) : ''}">
      <button class="btn btn-primary" id="applyBtn">Apply</button>
      <button class="btn" id="clearBtn">Clear</button>
      <span class="count" id="recordCount">Showing ${shown} of ${total} record${total !== 1 ? 's' : ''}</span>
    </div>

    <div class="timeline" id="timeline">
      ${timelineHtml}
    </div>

    ${moreBtn ? `<div class="pagination-bar" id="paginationBar">${moreBtn}</div>` : ''}
  </div>

  <script>
    window.__LOGS_CONFIG__ = ${JSON.stringify({
      hostId,
      fetchParams,
      nextOffset,
      allLoaded: !hasMore
    })};
  </script>
  <script src="/js/logs.js"></script>
</body>
</html>`;

    return res.status(200).type('text/html').send(html);
  } catch (err) {
    logger.error({ err }, 'Host logs error');
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>Failed to load host logs.</p>');
  }
});

// ---------------------------------------------------------------------------
// SSE Fleet Stream — GET /events/fleet (Server-Sent Events)
// ---------------------------------------------------------------------------
// Keeps a pool of connected SSE clients. Every 2 seconds, queries fleet data
// and pushes updates to all connected browsers in real-time.
// ---------------------------------------------------------------------------
const sseClients = new Set();

// Periodic broadcast: query fleet data and push to all SSE clients
let sseInterval = null;

function broadcastFleetUpdate() {
  db.getAllHostsSummary()
    .then((rows) => {
      const data = JSON.stringify({ ok: true, data: rows, timestamp: new Date().toISOString() });
      for (const client of sseClients) {
        client.res.write(`event: fleet\n`);
        client.res.write(`data: ${data}\n\n`);
      }
    })
    .catch((err) => {
      logger.error({ err }, 'SSE broadcast error');
      const errorData = JSON.stringify({ ok: false, error: 'Internal server error' });
      for (const client of sseClients) {
        client.res.write(`event: error\n`);
        client.res.write(`data: ${errorData}\n\n`);
      }
    });
}

function startSSEBroadcast() {
  if (sseInterval) return;
  logger.info('Starting SSE fleet broadcast (every 2s)');
  // Push immediately, then every 2s
  broadcastFleetUpdate();
  sseInterval = setInterval(broadcastFleetUpdate, 2000);
  sseInterval.unref();
}

function stopSSEBroadcast() {
  if (sseInterval) {
    clearInterval(sseInterval);
    sseInterval = null;
  }
}

app.get('/events/fleet', (req, res) => {
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'  // Disable nginx buffering if behind proxy
  });

  // Send initial comment to confirm connection
  res.write(':ok\n\n');

  const clientId = Date.now() + Math.random().toString(36).slice(2);
  const client = { id: clientId, res };
  sseClients.add(client);

  logger.info({ clientId, totalClients: sseClients.size }, 'SSE client connected');

  // Start broadcast if not running
  startSSEBroadcast();

  // Clean up on disconnect
  req.on('close', () => {
    sseClients.delete(client);
    logger.info({ clientId, totalClients: sseClients.size }, 'SSE client disconnected');
    if (sseClients.size === 0) {
      stopSSEBroadcast();
    }
  });
});

// ---------------------------------------------------------------------------
// Fleet Dashboard — GET /dashboard (HTML view + live SSE)
// ---------------------------------------------------------------------------
app.get('/dashboard', async (_req, res) => {
  try {
    const rows = await db.getAllHostsSummary();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fleet Health Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem 1rem;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem;
    }
    header h1 {
      font-size: 1.75rem; font-weight: 700;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    header .meta { font-size: 0.875rem; color: #94a3b8; }
    .live-indicator {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.8rem; color: #22c55e;
    }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #22c55e; animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    table {
      width: 100%; border-collapse: collapse;
      background: #1e293b; border-radius: 12px; overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
    }
    th {
      background: #0f172a; padding: 0.875rem 1rem; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;
      text-align: left; border-bottom: 1px solid #334155;
    }
    td { padding: 0.875rem 1rem; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    .row-ok td { background: rgba(34, 197, 94, 0.04); }
    .row-fail td { background: rgba(239, 68, 68, 0.06); }
    .row-ok:hover td { background: rgba(34, 197, 94, 0.10); }
    .row-fail:hover td { background: rgba(239, 68, 68, 0.12); }
    .badge {
      display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px;
      font-size: 0.8rem; font-weight: 600;
    }
    .badge-ok { color: #22c55e; background: rgba(34, 197, 94, 0.12); }
    .badge-fail { color: #ef4444; background: rgba(239, 68, 68, 0.15); }
        .cell-host { font-weight: 600; color: #e2e8f0; }
        .cell-host a:hover { color: #38bdf8 !important; text-decoration: underline !important; }
        .host-arrow { color: #38bdf8; margin-left: 4px; font-size: 0.75rem; opacity: 0; transition: opacity 0.2s; }
        .cell-host:hover .host-arrow { opacity: 1; }
    .cell-num { font-variant-numeric: tabular-nums; color: #cbd5e1; }
    .cell-ip { font-family: 'JetBrains Mono', 'Cascadia Code', monospace; color: #94a3b8; font-size: 0.85rem; }
    .cell-ts { color: #64748b; font-size: 0.85rem; }
    .services { display: flex; flex-wrap: wrap; gap: 4px; }
    .service {
      display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px;
      font-size: 0.8rem; font-weight: 500;
    }
    .svc-ok { color: #22c55e; background: rgba(34, 197, 94, 0.10); }
    .svc-fail { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
    .empty { text-align: center; padding: 3rem; color: #64748b; }
    .info-bar {
      display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    }
    @media (max-width: 768px) {
      body { padding: 1rem 0.5rem; }
      th, td { padding: 0.625rem 0.5rem; font-size: 0.8rem; }
      header h1 { font-size: 1.25rem; }
      .cell-ts, .cell-ip { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>⚡ Fleet Health Dashboard</h1>
        <div class="info-bar">
          <span class="meta" id="hostCount">${rows.length} host${rows.length !== 1 ? 's' : ''} tracked</span>
          <span class="live-indicator" id="liveIndicator"><span class="live-dot"></span> Live</span>
          <span class="meta" id="lastUpdated">Updated: just now</span>
        </div>
      </div>
    </header>
    <div id="tableContainer">
      ${rows.length === 0
        ? '<div class="empty">No telemetry data received yet. Run <code>./ops.sh seed</code> to inject test data.</div>'
        : `<table id="fleetTable">
            <thead>
              <tr>
                <th>Host</th>
                <th>Status</th>
                <th>CPU Load</th>
                <th>Memory</th>
                <th>IP</th>
                <th>Services</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody id="fleetBody">${renderRows(rows)}</tbody>
          </table>`
      }
    </div>
  </div>

  <script src="/js/dashboard.js"></script>
</body>
</html>`;

    return res.status(200).type('text/html').send(html);
  } catch (err) {
    logger.error({ err }, 'Dashboard error');
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>Failed to load dashboard.</p>');
  }
});

// Helper: render fleet rows as HTML (used by both server and client)
function renderRows(rows) {
  return rows.map((r) => {
    const healthy = r.healthy;
    const statusBadge = healthy
      ? '<span class="badge badge-ok">● Healthy</span>'
      : '<span class="badge badge-fail">● Unhealthy</span>';
    const rowClass = healthy ? 'row-ok' : 'row-fail';

    const servicesHtml = (r.services || [])
      .map((s) => {
        const svcClass = s.healthy ? 'svc-ok' : 'svc-fail';
        return `<span class="service ${svcClass}">${s.name}</span>`;
      })
      .join('');

    const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '—';

    const hostLink = `<a href="/host/${encodeURIComponent(r.host)}/logs" style="color:inherit;text-decoration:none;">${r.host} <span class="host-arrow">↗</span></a>`;

    return `<tr class="${rowClass}">
        <td class="cell-host">${hostLink}</td>
        <td class="cell-status">${statusBadge}</td>
        <td class="cell-num">${r.cpu_load != null ? r.cpu_load.toFixed(2) : '—'}</td>
        <td class="cell-num">${r.mem_used_mb != null ? r.mem_used_mb.toLocaleString() + ' MB' : '—'}</td>
        <td class="cell-ip">${r.ip || '—'}</td>
        <td class="cell-svc">${servicesHtml}</td>
        <td class="cell-ts">${ts}</td>
      </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// 1.3 Incident Ingestion — POST /events
// ---------------------------------------------------------------------------
app.post('/events', async (req, res) => {
  try {
    const { valid, errors } = validateEventPayload(req.body);

    if (!valid) {
      logger.warn({ errors, body: req.body }, 'Event validation failed');
      return res.status(400).json({ ok: false, errors });
    }

    const { host, timestamp, type, message } = req.body;

    await db.insertEvent({ host, timestamp, type, message });

    logger.info({ host, timestamp, type }, 'Event ingested successfully');
    return res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Event ingestion error');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Health check endpoint (for Docker liveness)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, status: 'healthy' });
});

// ---------------------------------------------------------------------------
// Server startup with database dependency check
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;

async function start() {
  try {
    // Block until PostgreSQL is ready (Startup Ordering & Liveness Check)
    await db.waitForDatabase();

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Fleet Health Monitor listening');
    });

    // -----------------------------------------------------------------------
    // Process Lifecycle Signals — SIGTERM & SIGINT
    // -----------------------------------------------------------------------
    function shutdown(signal) {
      logger.info({ signal }, 'Shutdown signal received — draining connections');

      server.close(async () => {
        logger.info('HTTP server closed, draining DB pool');
        try {
          await db.closePool();
          logger.info('Database pool drained — exiting');
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during pool drain');
          process.exit(1);
        }
      });

      // Force exit after 10s timeout
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000).unref();
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error({ err }, 'Failed to start application');
    process.exit(1);
  }
}

start();
