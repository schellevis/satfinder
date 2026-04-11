# syntax=docker/dockerfile:1
FROM node:18-alpine AS deps

WORKDIR /app

# Install build deps for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ---- runtime image ----
FROM node:18-alpine

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY config.example.json ./

# Data directory for SQLite DB and optional config.json override
RUN mkdir -p /data

# Default: store DB in /data so it can be volume-mounted
ENV DB_PATH=/data/satfinder.db \
    PORT=3000 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/scheduler/status || exit 1

CMD ["node", "server.js"]
