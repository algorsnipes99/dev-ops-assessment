'use strict';

/**
 * Continuous Heartbeat Feeder
 *
 * Simulates multiple fleet hosts sending telemetry payloads every N seconds.
 * Usage: node heartbeats/feeder.js [options]
 *
 * Options:
 *   --interval <s>    Seconds between heartbeat cycles (default: 5)
 *   --hosts <n>       Number of hosts to simulate (default: 5)
 *   --url <url>       Base URL of the Fleet Health Monitor (default: http://localhost:3000)
 *   --events          Also send random event signals
 */

const http = require('http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const INTERVAL = parseArg('--interval', 5);
const HOST_COUNT = parseArg('--hosts', 5);
const BASE_URL = parseArg('--url', 'http://localhost:3000');
const SEND_EVENTS = hasFlag('--events');

const parsedUrl = new URL(BASE_URL);
const API_HOST = parsedUrl.hostname || 'localhost';
const API_PORT = parseInt(parsedUrl.port, 10) || 3000;

// ---------------------------------------------------------------------------
// Host Definitions
// ---------------------------------------------------------------------------
const HOST_TEMPLATES = [
  {
    host: 'api-01',
    ip: '10.0.1.10',
    services: [
      { name: 'nginx', healthy: true },
      { name: 'node-app', healthy: true },
      { name: 'redis-cache', healthy: true }
    ]
  },
  {
    host: 'api-02',
    ip: '10.0.1.11',
    services: [
      { name: 'nginx', healthy: true },
      { name: 'node-app', healthy: true },
      { name: 'sidekiq-worker', healthy: true }
    ]
  },
  {
    host: 'web-01',
    ip: '10.0.2.20',
    services: [
      { name: 'apache2', healthy: true },
      { name: 'php-fpm', healthy: true }
    ]
  },
  {
    host: 'db-01',
    ip: '10.0.3.30',
    services: [
      { name: 'postgresql', healthy: true },
      { name: 'pgbouncer', healthy: true },
      { name: 'wal-g', healthy: true }
    ]
  },
  {
    host: 'worker-01',
    ip: '10.0.4.40',
    services: [
      { name: 'celery-worker', healthy: true },
      { name: 'rabbitmq', healthy: true },
      { name: 'redis', healthy: true }
    ]
  },
  {
    host: 'cache-01',
    ip: '10.0.5.50',
    services: [
      { name: 'memcached', healthy: true },
      { name: 'redis', healthy: true }
    ]
  },
  {
    host: 'monitor-01',
    ip: '10.0.6.60',
    services: [
      { name: 'prometheus', healthy: true },
      { name: 'grafana', healthy: true },
      { name: 'alertmanager', healthy: true }
    ]
  }
];

// Use only the requested number of hosts
const ACTIVE_HOSTS = HOST_TEMPLATES.slice(0, Math.min(HOST_COUNT, HOST_TEMPLATES.length));

// ---------------------------------------------------------------------------
// Random Helpers
// ---------------------------------------------------------------------------
function randomFloat(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// HTTP POST helper
// ---------------------------------------------------------------------------
function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: responseData });
      });
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Heartbeat Generation
// ---------------------------------------------------------------------------
function generateHeartbeat(template) {
  const now = new Date().toISOString();

  // Randomly flip one service's health with 8% probability (simulates real incidents)
  const services = template.services.map((svc) => {
    if (Math.random() < 0.08) {
      return { ...svc, healthy: !svc.healthy };
    }
    return { ...svc };
  });

  return {
    host: template.host,
    timestamp: now,
    cpu_load: randomFloat(0.05, 0.95),
    mem_used_mb: randomInt(256, 16384),
    services,
    ip: template.ip
  };
}

// ---------------------------------------------------------------------------
// Event Signal Generation (optional)
// ---------------------------------------------------------------------------
const EVENT_TYPES = ['error', 'warning', 'incident'];
const EVENT_MESSAGES = [
  'upstream timeout contacting service',
  'high memory pressure detected',
  'disk I/O latency spike',
  'connection pool exhaustion',
  'SSL certificate expiring soon',
  'response time degradation'
];

function generateEvent(host) {
  return {
    host,
    timestamp: new Date().toISOString(),
    type: pickRandom(EVENT_TYPES),
    message: pickRandom(EVENT_MESSAGES)
  };
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------
let cycleCount = 0;
let totalSent = 0;
let totalErrors = 0;

async function sendHeartbeatCycle() {
  cycleCount++;

  for (const hostTemplate of ACTIVE_HOSTS) {
    const payload = generateHeartbeat(hostTemplate);

    try {
      const result = await postJSON('/ingest', payload);
      if (result.status === 201) {
        totalSent++;
        const unhealthyServices = payload.services
          .filter((s) => !s.healthy)
          .map((s) => s.name);
        const status = unhealthyServices.length > 0
          ? `⚠ UNHEALTHY [${unhealthyServices.join(', ')}]`
          : '✓ OK';
        console.log(
          `[cycle ${cycleCount}] ${payload.host} | ` +
          `cpu=${payload.cpu_load} mem=${payload.mem_used_mb}MB | ${status}`
        );
      } else {
        totalErrors++;
        console.error(`[cycle ${cycleCount}] ${payload.host} | ERROR ${result.status}: ${result.body}`);
      }
    } catch (err) {
      totalErrors++;
      console.error(`[cycle ${cycleCount}] ${payload.host} | NETWORK ERROR: ${err.message}`);
    }
  }

  // Optionally send a random event signal
  if (SEND_EVENTS && Math.random() < 0.3) {
    const randomHost = pickRandom(ACTIVE_HOSTS).host;
    const event = generateEvent(randomHost);
    try {
      const result = await postJSON('/events', event);
      if (result.status === 201) {
        console.log(`[cycle ${cycleCount}] EVENT ${event.type} for ${randomHost}: ${event.message}`);
      }
    } catch (err) {
      console.error(`[cycle ${cycleCount}] EVENT ERROR: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI arg parsers
// ---------------------------------------------------------------------------
function parseArg(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const val = parseInt(process.argv[idx + 1], 10);
    return isNaN(val) ? defaultValue : val;
  }
  return defaultValue;
}

function hasFlag(name) {
  return process.argv.indexOf(name) !== -1;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
console.log('═══════════════════════════════════════════');
console.log('  Fleet Health Monitor — Heartbeat Feeder');
console.log('═══════════════════════════════════════════');
console.log(`  Target:    http://${API_HOST}:${API_PORT}`);
console.log(`  Interval:  ${INTERVAL}s`);
console.log(`  Hosts:     ${ACTIVE_HOSTS.length} (${ACTIVE_HOSTS.map(h => h.host).join(', ')})`);
console.log(`  Events:    ${SEND_EVENTS ? 'enabled' : 'disabled'}`);
console.log('───────────────────────────────────────────');
console.log('  Press Ctrl+C to stop');
console.log('═══════════════════════════════════════════\n');

// Send first cycle immediately, then repeat on interval
sendHeartbeatCycle();
const timer = setInterval(sendHeartbeatCycle, INTERVAL * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Stopped after ${cycleCount} cycles`);
  console.log(`  Heartbeats sent: ${totalSent}`);
  console.log(`  Errors:          ${totalErrors}`);
  console.log('═══════════════════════════════════════════');
  process.exit(0);
});