'use strict';

// The production outage this guards against: the schema init used to run at
// import with no rejection handler, so an unreachable or unconfigured database
// killed the whole serverless function and every route — health included —
// answered FUNCTION_INVOCATION_FAILED with nothing to explain it.
//
// Each case boots the real server in a child process with a different
// environment, so the module-level singletons (config, db client) are genuinely
// re-evaluated.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function boot(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const app = require(${JSON.stringify(path.join(ROOT, 'server.js'))});
         const server = app.listen(0, '127.0.0.1', () => {
           process.stdout.write('PORT=' + server.address().port + '\\n');
         });`,
      ],
      { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('server did not start within 20s: ' + err));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/PORT=(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({
        child,
        base: `http://127.0.0.1:${match[1]}`,
        stderr: () => err,
        stop: () => new Promise((done) => {
          child.on('exit', done);
          child.kill('SIGKILL');
        }),
      });
    });
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!out.includes('PORT=')) reject(new Error(`server exited with ${code}: ${err}`));
    });
  });
}

const call = async (base, path) => {
  const response = await fetch(base + path);
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

test('an unconfigured database on a serverless host does not take the app down', async () => {
  // VERCEL=1 with no Turso URL: the old code fell back to a local SQLite file,
  // which a read-only serverless filesystem cannot open.
  const app = await boot({ VERCEL: '1', NODE_ENV: 'production', TURSO_DATABASE_URL: '', JWT_SECRET: 'test-secret' });
  try {
    const health = await call(app.base, '/api/health');
    assert.strictEqual(health.status, 503);
    assert.strictEqual(health.body.ok, false);
    assert.strictEqual(health.body.db, 'unconfigured');
    assert.match(health.body.error, /TURSO_DATABASE_URL/);

    // Data routes refuse cleanly rather than crashing the process.
    const me = await call(app.base, '/api/auth/me');
    assert.strictEqual(me.status, 503);
    assert.match(me.body.error, /database is unavailable/i);

    // Still alive: a dead process is the bug being tested for.
    const again = await call(app.base, '/api/health');
    assert.strictEqual(again.status, 503);
  } finally {
    await app.stop();
  }
});

test('a database that cannot be reached is reported, not fatal', async () => {
  const app = await boot({
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret',
    TURSO_DATABASE_URL: 'https://nonexistent-db-abc123.turso.io',
    TURSO_AUTH_TOKEN: 'bogus',
  });
  try {
    const health = await call(app.base, '/api/health');
    assert.strictEqual(health.status, 503);
    assert.strictEqual(health.body.db, 'error');
    assert.ok(health.body.error, 'the health check should carry the database error');

    const me = await call(app.base, '/api/auth/me');
    assert.strictEqual(me.status, 503);

    // The process survived both the failed init and the failed request.
    const again = await call(app.base, '/api/health');
    assert.strictEqual(again.status, 503);
    assert.ok(!app.stderr().includes('UnhandledPromiseRejection'), 'init must not reject unhandled');
  } finally {
    await app.stop();
  }
});

test('a working database reports ready and serves requests', async () => {
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-resilience-'));
  const app = await boot({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
    TURSO_DATABASE_URL: '',
    DB_PATH: path.join(tmp, 'data.db'),
    UPLOAD_DIR: path.join(tmp, 'uploads'),
  });
  try {
    const health = await call(app.base, '/api/health');
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(health.body, { ok: true, db: 'ready' });

    // The gate lets ordinary requests through: unauthenticated, not unavailable.
    const me = await call(app.base, '/api/auth/me');
    assert.strictEqual(me.status, 401);
  } finally {
    await app.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
