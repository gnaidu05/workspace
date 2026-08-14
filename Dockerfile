# ---- Build stage: install deps (compiles the native better-sqlite3) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build toolchain for node-gyp / better-sqlite3 (falls back to prebuilt binary
# when available, but these guarantee a working native build).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: slim image with just the app + compiled modules ----
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/data.db \
    UPLOAD_DIR=/data/uploads

# Copy installed dependencies and application source.
COPY --from=build /app/node_modules ./node_modules
COPY . .

# Data directory for the SQLite database and uploaded files. Mount a volume
# here (e.g. -v nimbus-data:/data) to persist across restarts and redeploys.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000

# Basic container healthcheck against the app's health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
