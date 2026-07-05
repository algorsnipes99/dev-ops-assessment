'use strict';

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'message',
  errorKey: 'error'
});

module.exports = logger;
