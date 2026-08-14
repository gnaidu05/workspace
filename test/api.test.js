'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Use isolated, temporary storage for the test run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-secret';

const app = require('../server');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const creds = { name: 'Ada', email: 'ada@example.com', password: 'password123' };
let cookie;

async function jsonReq(method, urlPath, body, extraHeaders = {}) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

test('registers a new user and returns a session cookie', async () => {
  const res = await jsonReq('POST', '/api/auth/register', creds);
  assert.strictEqual(res.status, 201);
  cookie = res.headers.get('set-cookie').split(';')[0];
  const data = await res.json();
  assert.strictEqual(data.user.email, creds.email);
});

test('rejects duplicate registration', async () => {
  const res = await jsonReq('POST', '/api/auth/register', creds);
  assert.strictEqual(res.status, 409);
});

test('rejects login with a wrong password', async () => {
  const res = await jsonReq('POST', '/api/auth/login', {
    email: creds.email,
    password: 'wrongpass1',
  });
  assert.strictEqual(res.status, 401);
});

test('blocks access to files without authentication', async () => {
  const res = await fetch(baseUrl + '/api/files');
  assert.strictEqual(res.status, 401);
});

test('creates a folder and lists it', async () => {
  const create = await jsonReq('POST', '/api/folders', { name: 'Docs' }, { cookie });
  assert.strictEqual(create.status, 201);
  const { folder } = await create.json();
  assert.strictEqual(folder.name, 'Docs');

  const list = await fetch(baseUrl + '/api/folders', { headers: { cookie } });
  const { folders } = await list.json();
  assert.strictEqual(folders.length, 1);
  assert.strictEqual(folders[0].id, folder.id);
});

test('uploads, lists, downloads and deletes a file', async () => {
  const form = new FormData();
  form.append('file', new Blob(['hello drive'], { type: 'text/plain' }), 'note.txt');

  const up = await fetch(baseUrl + '/api/files', { method: 'POST', headers: { cookie }, body: form });
  assert.strictEqual(up.status, 201);
  const { file } = await up.json();
  assert.strictEqual(file.name, 'note.txt');

  const dl = await fetch(baseUrl + `/api/files/${file.id}/download`, { headers: { cookie } });
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(await dl.text(), 'hello drive');

  const del = await fetch(baseUrl + `/api/files/${file.id}`, { method: 'DELETE', headers: { cookie } });
  assert.strictEqual(del.status, 200);

  const list = await fetch(baseUrl + '/api/files', { headers: { cookie } });
  const { files } = await list.json();
  assert.strictEqual(files.length, 0);
});

test('does not leak another user\'s files', async () => {
  // Second user
  const other = await jsonReq('POST', '/api/auth/register', {
    name: 'Grace',
    email: 'grace@example.com',
    password: 'password123',
  });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];

  // First user uploads a file
  const form = new FormData();
  form.append('file', new Blob(['secret'], { type: 'text/plain' }), 'secret.txt');
  const up = await fetch(baseUrl + '/api/files', { method: 'POST', headers: { cookie }, body: form });
  const { file } = await up.json();

  // Second user must not see or download it
  const dl = await fetch(baseUrl + `/api/files/${file.id}/download`, { headers: { cookie: otherCookie } });
  assert.strictEqual(dl.status, 404);

  const list = await fetch(baseUrl + '/api/files', { headers: { cookie: otherCookie } });
  const { files } = await list.json();
  assert.strictEqual(files.length, 0);
});
