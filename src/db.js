'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Use the remote (web/HTTP) client for Turso, and the local file client for
// dev/test. Both expose the same `execute` / `batch` API.
let createClient;
let clientOptions;
if (config.turso.url) {
  ({ createClient } = require('@libsql/client/web'));
  clientOptions = { url: config.turso.url, authToken: config.turso.authToken };
} else {
  ({ createClient } = require('@libsql/client'));
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  clientOptions = { url: 'file:' + config.dbPath };
}

const client = createClient(clientOptions);

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

// Initialise the schema once. `ready` is awaited by a middleware before any
// request is handled, which matters on serverless cold starts.
const ready = (async () => {
  await client.execute('PRAGMA foreign_keys = ON');
  for (const stmt of SCHEMA) {
    await client.execute(stmt);
  }
})();

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

module.exports = { client, ready, get, all, run };
