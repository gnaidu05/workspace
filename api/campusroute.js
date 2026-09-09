// CampusRoute on Vercel.
//
// One serverless function serves the whole planner:
//
//   GET  /campusroute                     the planner page
//   GET  /campusroute/api/health          { ok, db }
//   POST /campusroute/api/plans           { state }           -> { id, editKey, revision }
//   GET  /campusroute/api/plans/:id                           -> { state, revision, canEdit }
//   PUT  /campusroute/api/plans/:id       { state, revision }  -> { revision }   X-Edit-Key
//   DELETE /campusroute/api/plans/:id                                            X-Edit-Key
//
// vercel.json rewrites those paths here and passes the sub-path as ?path=, so
// the function never has to guess what the visitor asked for.
//
// Serverless functions have no disk, so plans live in a libSQL/Turso database:
// CAMPUSROUTE_DATABASE_URL / CAMPUSROUTE_AUTH_TOKEN when set, otherwise this
// project's existing TURSO_* pair. Either way the planner keeps to its own
// `campusroute_plans` table. With no database configured the planner still runs
// — it stays in local-draft mode, and says so, instead of pretending it can
// share.

'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const MAX_PLAN_BYTES = 2_000_000;
const MAX_PLANS = 5_000;
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes
const API_BASE = '/campusroute/api';

// The built single-file planner, which vercel.json includes in this function's
// bundle (`includeFiles`). Read on first use, never at import: work done while
// the module loads takes the whole function down if it fails, and then even the
// health check has nothing left to report.
const PAGE_CANDIDATES = [
  path.join(__dirname, '..', 'campusroute', 'docs', 'campusroute.html'),
  path.join(process.cwd(), 'campusroute', 'docs', 'campusroute.html'),
];

let plannerPage;
let pageError = null;

function plannerHtml() {
  if (plannerPage !== undefined) return plannerPage;
  for (const candidate of PAGE_CANDIDATES) {
    try {
      plannerPage = readFileSync(candidate, 'utf8').replace(
        '<body>',
        `<body>\n<script>window.CAMPUSROUTE_API_BASE=${JSON.stringify(API_BASE)};</script>`,
      );
      pageError = null;
      return plannerPage;
    } catch (error) {
      pageError = `${candidate}: ${error.code || error.message}`;
    }
  }
  plannerPage = null;
  return null;
}

// The planning engine is an ES module shared with the browser, so a CommonJS
// function reaches it through a dynamic import — on first use, so a resolution
// problem is something health can report instead of a dead function.
let enginePromise = null;
let engineError = null;

async function engine() {
  if (!enginePromise) {
    enginePromise = import('../campusroute/public/engine.js').then(
      (module) => {
        engineError = null;
        return module;
      },
      (error) => {
        engineError = error.message;
        enginePromise = null;
        throw error;
      },
    );
  }
  return enginePromise;
}

// --- database --------------------------------------------------------------

let client = null;
let schemaReady = null;

// CAMPUSROUTE_* wins, so the planner can be pointed at its own database without
// disturbing whatever else in this project uses TURSO_*.
function credentials() {
  if (process.env.CAMPUSROUTE_DATABASE_URL) {
    return {
      prefix: 'CAMPUSROUTE',
      url: process.env.CAMPUSROUTE_DATABASE_URL,
      authToken: process.env.CAMPUSROUTE_AUTH_TOKEN,
    };
  }
  if (process.env.TURSO_DATABASE_URL) {
    return { prefix: 'TURSO', url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  return null;
}

// The libSQL client is imported on first use too, so a bundling problem with it
// shows up as a reported error rather than a dead function.
async function database() {
  if (client) return client;
  const config = credentials();
  if (!config) return null;
  const { createClient } = require('@libsql/client');
  client = createClient({ url: config.url, authToken: config.authToken });
  return client;
}

// Additive, and safe to run on every cold start. A failure is retried on the
// next request rather than cached for the life of the instance.
async function ready() {
  const db = await database();
  if (!db) return null;
  if (!schemaReady) {
    schemaReady = db.execute(`CREATE TABLE IF NOT EXISTS campusroute_plans (
      id            TEXT PRIMARY KEY,
      edit_key_hash TEXT NOT NULL,
      revision      INTEGER NOT NULL DEFAULT 1,
      state         TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )`).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return db;
}

// --- helpers ---------------------------------------------------------------

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const isPlanId = (id) => typeof id === 'string' && /^[a-z2-9]{12}$/.test(id);

const newId = () => [...randomBytes(12)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
const newEditKey = () => randomBytes(24).toString('base64url');

function keyMatches(row, editKey) {
  if (!row || !editKey) return false;
  const a = Buffer.from(row.edit_key_hash);
  const b = Buffer.from(sha256(editKey));
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function fail(message, status, payload = {}) {
  return Object.assign(new Error(message), { status, payload });
}

// Vercel parses JSON bodies for us, but not when the content type is missing —
// and a raw body still needs its size checked before it is parsed.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PLAN_BYTES) throw fail('That plan is larger than this server accepts.', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail('The request body was not valid JSON.', 400);
  }
}

// The same engine the browser uses, so a malformed plan is never stored.
async function checkState(state) {
  const { validateState } = await engine();
  const errors = validateState(state);
  if (errors.length) throw fail(errors[0], 422, { errors });
}

const readPlan = async (db, id) =>
  (await db.execute({
    sql: 'SELECT id, edit_key_hash, revision, state, updated_at FROM campusroute_plans WHERE id = ?',
    args: [id],
  })).rows[0] || null;

// --- request handling ------------------------------------------------------

async function handleApi(req, res, segments) {
  const editKey = req.headers['x-edit-key'] || '';

  if (segments[0] === 'health') {
    // Names only, never values: enough to confirm which variables a deployment
    // picked up, and whether the database actually answers.
    const config = credentials();
    let db = false;
    let error;
    if (config) {
      try {
        await ready();
        db = true;
      } catch (dbError) {
        error = dbError.message;
      }
    }
    const page = Boolean(plannerHtml());
    let engineOk = false;
    try {
      await engine();
      engineOk = true;
    } catch {
      /* engineError carries the reason */
    }
    return send(res, 200, {
      ok: true,
      service: 'campusroute',
      db,
      page,
      engine: engineOk,
      ...(engineOk ? {} : { engineError }),
      credentials: config ? `${config.prefix}_DATABASE_URL` : null,
      ...(error ? { error } : {}),
      ...(page ? {} : { pageError }),
    });
  }

  const db = await ready();
  if (!db) {
    throw fail(
      'This deployment has no plan database configured, so plans cannot be shared from here. Set CAMPUSROUTE_DATABASE_URL and CAMPUSROUTE_AUTH_TOKEN.',
      503,
    );
  }

  if (segments[0] === 'plans' && segments.length === 1) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to create a plan.' });
    const body = await readBody(req);
    await checkState(body.state);

    const count = (await db.execute('SELECT COUNT(*) AS n FROM campusroute_plans')).rows[0];
    if (Number(count?.n || 0) >= MAX_PLANS) {
      return send(res, 507, { error: 'This server is holding as many plans as it is configured to keep.' });
    }

    const id = newId();
    const editKeyValue = newEditKey();
    const now = new Date().toISOString();
    await db.execute({
      sql: 'INSERT INTO campusroute_plans (id, edit_key_hash, revision, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      args: [id, sha256(editKeyValue), JSON.stringify(body.state), now, now],
    });
    return send(res, 201, { id, editKey: editKeyValue, revision: 1, updatedAt: now });
  }

  if (segments[0] === 'plans' && segments.length === 2) {
    const id = segments[1];
    if (!isPlanId(id)) return send(res, 404, { error: 'No plan with that id.' });

    if (req.method === 'GET') {
      const row = await readPlan(db, id);
      if (!row) return send(res, 404, { error: 'No plan with that id.' });
      return send(res, 200, {
        state: JSON.parse(row.state),
        revision: Number(row.revision),
        updatedAt: row.updated_at,
        canEdit: keyMatches(row, editKey),
      });
    }

    if (req.method === 'PUT') {
      // Authorise before reading the body: a viewer without the edit key should
      // be told that, not handed a critique of what they sent.
      const row = await readPlan(db, id);
      if (!row) return send(res, 404, { error: 'No plan with that id.' });
      if (!keyMatches(row, editKey)) {
        return send(res, 403, { error: 'This plan is read-only from here. Open it with its edit link to make changes.' });
      }
      const body = await readBody(req);
      await checkState(body.state);

      const now = new Date().toISOString();
      // The revision in the WHERE clause is the concurrency check: a save built
      // on a stale copy changes no rows and comes back as a conflict.
      const result = await db.execute({
        sql: 'UPDATE campusroute_plans SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        args: [JSON.stringify(body.state), now, id, Number(body.revision)],
      });
      if (!result.rowsAffected) {
        const current = await readPlan(db, id);
        return send(res, 409, {
          error: 'The shared plan changed since you loaded it. Reload it before saving.',
          revision: Number(current?.revision),
        });
      }
      return send(res, 200, { revision: Number(body.revision) + 1, updatedAt: now });
    }

    if (req.method === 'DELETE') {
      const row = await readPlan(db, id);
      if (!row) return send(res, 404, { error: 'No plan with that id.' });
      if (!keyMatches(row, editKey)) return send(res, 403, { error: 'Only the edit link can delete a plan.' });
      await db.execute({ sql: 'DELETE FROM campusroute_plans WHERE id = ?', args: [id] });
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed on a plan.' });
  }

  return send(res, 404, { error: 'No such endpoint.' });
}

async function handler(req, res) {
  // vercel.json passes the path under /campusroute as ?path=…; fall back to the
  // request URL so the function also works when called directly.
  const url = new URL(req.url, 'http://localhost');
  const raw = url.searchParams.get('path') ?? url.pathname.replace(/^\/campusroute\/?/, '');
  const segments = raw.split('/').filter(Boolean);

  try {
    if (segments[0] === 'api') return await handleApi(req, res, segments.slice(1));

    if (segments.length === 0) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        return res.end('Method not allowed');
      }
      const html = plannerHtml();
      if (!html) {
        // The build output is missing from the deployment bundle — say which
        // path was tried instead of failing blank.
        return send(res, 503, {
          error: 'The planner page is not in this deployment. Rebuild it with `npm run build:single` in campusroute/ and redeploy.',
          detail: pageError,
        });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      return res.end(html);
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('campusroute error', error);
    return send(res, status, {
      error: status >= 500 ? 'The server could not complete that request.' : error.message,
      ...(error.payload || {}),
    });
  }
}

module.exports = handler;
