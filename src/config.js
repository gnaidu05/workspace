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

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  dbPath: path.resolve(process.env.DB_PATH || './data.db'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '52428800', 10),
  tokenTtlSeconds: 60 * 60 * 24 * 7, // 7 days
};

module.exports = config;
