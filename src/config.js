'use strict';

const path = require('path');

// Load a .env file if present, without adding a dependency.
function loadDotEnv() {
  const fs = require('fs');
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

// Turso (libSQL) connection. When TURSO_DATABASE_URL is set, the app talks to a
// remote serverless database; otherwise it uses a local SQLite file (dev/test).
const tursoUrl = process.env.TURSO_DATABASE_URL || '';

// Vercel Blob token. When present (or when running on Vercel) uploaded files are
// stored in Vercel Blob instead of on the local disk.
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || '';
const onVercel = Boolean(process.env.VERCEL);

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  dbPath: path.resolve(process.env.DB_PATH || './data.db'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '52428800', 10),
  tokenTtlSeconds: 60 * 60 * 24 * 7, // 7 days

  turso: {
    url: tursoUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  },
  blob: {
    token: blobToken,
  },
  // Choose the file-storage backend: 'blob' on Vercel / when a Blob token is
  // configured, otherwise the local filesystem.
  storageBackend: blobToken || onVercel ? 'blob' : 'local',
  isProduction: process.env.NODE_ENV === 'production',
};

module.exports = config;
