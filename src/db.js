'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Use the remote (web/HTTP) client for Turso, and the local file client for
// dev/test. Both expose the same `execute` / `batch` API.
//
// A serverless deployment has a read-only filesystem, so the local file client
// cannot work there: opening the database hangs or fails at import and takes the
// whole function down. Say so plainly instead, and let the readiness check
// report it.
let createClient;
let clientOptions;
let configError = null;

if (config.turso.url) {
  ({ createClient } = require('@libsql/client/web'));
  clientOptions = { url: config.turso.url, authToken: config.turso.authToken };
} else if (process.env.VERCEL) {
  configError =
    'No database is configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN — a serverless deployment has no writable disk for a local SQLite file.';
} else {
  ({ createClient } = require('@libsql/client'));
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  clientOptions = { url: 'file:' + config.dbPath };
}

const client = configError ? null : createClient(clientOptions);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     email      TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL,
     password   TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS folders (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL,
     parent_id  INTEGER,
     name       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
     FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS files (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id      INTEGER NOT NULL,
     folder_id    INTEGER,
     name         TEXT NOT NULL,
     storage_key  TEXT NOT NULL,
     storage_url  TEXT,
     mime_type    TEXT NOT NULL,
     size_bytes   INTEGER NOT NULL,
     starred      INTEGER NOT NULL DEFAULT 0,
     created_at   TEXT NOT NULL DEFAULT (datetime('now')),
     FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
     FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_files_user   ON files(user_id, folder_id)`,
  `CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, parent_id)`,
];

// Initialise the schema once. `ensureReady()` is awaited by a middleware before
// any request is handled, which matters on serverless cold starts.
//
// This must never reject on its own: an unhandled rejection at import time kills
// the whole serverless function, so every route — even /api/health — answers
// FUNCTION_INVOCATION_FAILED and there is nothing left to say why. Instead the
// failure is captured, reported, and retried on the next request, so a database
// that comes back needs no redeploy.
let initPromise = null;
let lastError = configError ? new Error(configError) : null;

function ensureReady() {
  if (configError) return Promise.reject(new Error(configError));
  if (!initPromise) {
    initPromise = (async () => {
      await client.execute('PRAGMA foreign_keys = ON');
      for (const stmt of SCHEMA) {
        await client.execute(stmt);
      }
      lastError = null;
    })().catch((error) => {
      lastError = error;
      initPromise = null; // let the next request try again
      throw error;
    });
  }
  return initPromise;
}

// Never leaves a rejection unhandled, and never throws: for a health check.
async function status() {
  if (configError) return { db: 'unconfigured', error: configError };
  try {
    await ensureReady();
    return { db: 'ready' };
  } catch (error) {
    return { db: 'error', error: error.message };
  }
}

// Kept for callers that awaited the old eagerly-started promise.
const ready = { then: (...args) => ensureReady().then(...args), catch: (...args) => ensureReady().catch(...args) };

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

// Query helpers. SQL uses positional `?` placeholders bound from `args`.
async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0];
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return {
    lastInsertRowid: toNumber(res.lastInsertRowid),
    rowsAffected: res.rowsAffected,
  };
}

module.exports = { client, ready, ensureReady, status, get, all, run };
