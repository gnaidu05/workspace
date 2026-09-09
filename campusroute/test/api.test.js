import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated storage for the run, chosen before the store module is imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusroute-test-'));
process.env.DATA_DIR = dataDir;

const { server } = await import('../server.js');
const { demoPlan } = await import('../public/data/sample.js');

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const call = async (path, options = {}) => {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
};

test('health check answers', async () => {
  const { status, body } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('the app and its modules are served with security headers', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /CampusRoute/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

  const module = await call('/engine.js');
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
});

test('a directory traversal attempt is refused', async () => {
  const { status } = await call('/../server.js');
  assert.ok(status === 403 || status === 404, `expected a refusal, got ${status}`);
});

test('anyone can publish a plan, and only the edit key can change it', async () => {
  const created = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: demoPlan() }) });
  assert.equal(created.status, 201);
  const { id, editKey, revision } = created.body;
  assert.match(id, /^[a-z2-9]{12}$/);
  assert.ok(editKey.length >= 20);
  assert.equal(revision, 1);

  // A plain read is public, and read-only.
  const anonymous = await call('/api/plans/' + id);
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.canEdit, false);
  assert.equal(anonymous.body.state.base, 'Bangalore');

  // The same read with the key reports edit rights.
  const owner = await call('/api/plans/' + id, { headers: { 'X-Edit-Key': editKey } });
  assert.equal(owner.body.canEdit, true);

  // Writing without the key is refused, and refused for that reason rather
  // than after the plan has been inspected.
  const refused = await call('/api/plans/' + id, {
    method: 'PUT',
    body: JSON.stringify({ state: demoPlan(), revision: 1 })
  });
  assert.equal(refused.status, 403);
  const refusedJunk = await call('/api/plans/' + id, { method: 'PUT', body: JSON.stringify({ state: { schema: 1 }, revision: 1 }) });
  assert.equal(refusedJunk.status, 403, 'authorisation comes before validation');

  // Writing with the key succeeds and bumps the revision.
  const next = { ...demoPlan(), base: 'Pune' };
  const saved = await call('/api/plans/' + id, {
    method: 'PUT',
    headers: { 'X-Edit-Key': editKey },
    body: JSON.stringify({ state: next, revision: 1 })
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 2);

  const reread = await call('/api/plans/' + id);
  assert.equal(reread.body.state.base, 'Pune');
  assert.equal(reread.body.revision, 2);
});

test('a stale revision is a conflict, not a silent overwrite', async () => {
  const created = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: demoPlan() }) });
  const { id, editKey } = created.body;
  const headers = { 'X-Edit-Key': editKey };

  const first = await call('/api/plans/' + id, { method: 'PUT', headers, body: JSON.stringify({ state: { ...demoPlan(), base: 'Pune' }, revision: 1 }) });
  assert.equal(first.body.revision, 2);

  const stale = await call('/api/plans/' + id, { method: 'PUT', headers, body: JSON.stringify({ state: { ...demoPlan(), base: 'Mumbai' }, revision: 1 }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 2);

  const unchanged = await call('/api/plans/' + id);
  assert.equal(unchanged.body.state.base, 'Pune', 'the conflicting write must not land');
});

test('an invalid plan is rejected with the reason', async () => {
  const broken = { ...demoPlan(), base: 'Atlantis' };
  const { status, body } = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: broken }) });
  assert.equal(status, 422);
  assert.match(body.error, /base/);
  assert.ok(Array.isArray(body.errors));
});

test('malformed JSON and unknown ids give clean errors', async () => {
  const bad = await call('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);

  const missing = await call('/api/plans/aaaaaaaaaaaa');
  assert.equal(missing.status, 404);

  const badId = await call('/api/plans/NOT-AN-ID');
  assert.equal(badId.status, 404);

  const wrongMethod = await call('/api/plans', { method: 'GET' });
  assert.equal(wrongMethod.status, 405);
});

test('a plan can be deleted with its edit key and not without', async () => {
  const created = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: demoPlan() }) });
  const { id, editKey } = created.body;

  const refused = await call('/api/plans/' + id, { method: 'DELETE' });
  assert.equal(refused.status, 403);

  const removed = await call('/api/plans/' + id, { method: 'DELETE', headers: { 'X-Edit-Key': editKey } });
  assert.equal(removed.status, 200);
  assert.equal((await call('/api/plans/' + id)).status, 404);
});

test('an oversized body is refused before it is parsed', async () => {
  const huge = 'x'.repeat(2_100_000);
  const response = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: { note: huge } }) }).catch((error) => ({ status: 0, body: error.message }));
  assert.ok(response.status === 413 || response.status === 0, `expected a refusal, got ${response.status}`);
});

test('the stored file keeps only a hash of the edit key', async () => {
  const created = await call('/api/plans', { method: 'POST', body: JSON.stringify({ state: demoPlan() }) });
  const { id, editKey } = created.body;
  const record = JSON.parse(fs.readFileSync(path.join(dataDir, id + '.json'), 'utf8'));
  assert.equal(record.editKey, undefined);
  assert.match(record.editKeyHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(record).includes(editKey), 'the raw key must never be written to disk');
});
