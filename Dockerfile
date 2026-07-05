# ============================================================================
# Fleet Health Monitor — Multi-stage Docker Build
# ============================================================================
# Stage 1: Install production dependencies
FROM node:18-alpine AS deps

WORKDIR /app

COPY src/package.json src/package-lock.json* ./

RUN npm ci --only=production && \
    npm cache clean --force

# ----------------------------------------------------------------------------
# Stage 2: Runtime image (minimal footprint)
FROM node:18-alpine AS runtime

# Security: run as unprivileged user
USER node

WORKDIR /app

# Copy only production node_modules from deps stage
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# Copy application source code
COPY --chown=node:node src/ .

# Environment defaults
ENV PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

# Health check (lightweight)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "app.js"]
