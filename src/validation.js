'use strict';

/**
 * Validates an ingested telemetry payload against the required schema.
 * Returns { valid: boolean, errors: string[] }
 */
function validateTelemetryPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  // host: string, required
  if (typeof body.host !== 'string' || body.host.trim().length === 0) {
    errors.push('host: must be a non-empty string');
  }

  // timestamp: string (ISO-8601), required
  if (typeof body.timestamp !== 'string' || body.timestamp.trim().length === 0) {
    errors.push('timestamp: must be a non-empty ISO-8601 string');
  } else if (isNaN(Date.parse(body.timestamp))) {
    errors.push('timestamp: must be a valid ISO-8601 date string');
  }

  // cpu_load: number (float), required
  if (typeof body.cpu_load !== 'number' || isNaN(body.cpu_load)) {
    errors.push('cpu_load: must be a number (float)');
  }

  // mem_used_mb: integer, required
  if (!Number.isInteger(body.mem_used_mb)) {
    errors.push('mem_used_mb: must be an integer');
  }

  // services: array, required
  if (!Array.isArray(body.services)) {
    errors.push('services: must be an array');
  } else {
    body.services.forEach((svc, idx) => {
      if (typeof svc.name !== 'string' || svc.name.trim().length === 0) {
        errors.push(`services[${idx}].name: must be a non-empty string`);
      }
      if (typeof svc.healthy !== 'boolean') {
        errors.push(`services[${idx}].healthy: must be a boolean`);
      }
    });
  }

  // ip: string, required
  if (typeof body.ip !== 'string' || body.ip.trim().length === 0) {
    errors.push('ip: must be a non-empty string');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates an error/incident event payload.
 * Returns { valid: boolean, errors: string[] }
 */
function validateEventPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  // host: string, required
  if (typeof body.host !== 'string' || body.host.trim().length === 0) {
    errors.push('host: must be a non-empty string');
  }

  // timestamp: string (ISO-8601), required
  if (typeof body.timestamp !== 'string' || body.timestamp.trim().length === 0) {
    errors.push('timestamp: must be a non-empty ISO-8601 string');
  } else if (isNaN(Date.parse(body.timestamp))) {
    errors.push('timestamp: must be a valid ISO-8601 date string');
  }

  // type: string, required
  if (typeof body.type !== 'string' || body.type.trim().length === 0) {
    errors.push('type: must be a non-empty string');
  } else {
    const validTypes = ['error', 'warning', 'incident'];
    if (!validTypes.includes(body.type)) {
      errors.push(`type: must be one of: ${validTypes.join(', ')}`);
    }
  }

  // message: string, optional (defaults to empty)
  if (body.message !== undefined && typeof body.message !== 'string') {
    errors.push('message: must be a string');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = { validateTelemetryPayload, validateEventPayload };
