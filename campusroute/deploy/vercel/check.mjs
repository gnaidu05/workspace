// Check a CampusRoute deployment from outside: health, then the whole
// publish / read / conflict / delete cycle against a throwaway plan.
//
//   node campusroute/deploy/vercel/check.mjs https://<host>/campusroute
//
// It creates one plan and deletes it again, so it is safe to run against a live
// deployment. Exits non-zero on the first failure.

import { demoPlan } from '../../public/data/sample.js';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node check.mjs https://<host>/campusroute');
  process.exit(2);
}

let failures = 0;

const call = async (path, { method = 'GET', body, key } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'X-Edit-Key': key } : {}),
      // Some hosts serve a challenge page to header-less clients.
      'User-Agent': 'campusroute-check',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text.slice(0, 200);
  }
  return { status: response.status, payload };
};

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  return ok;
}

const health = await call('/api/health');
check('health answers', health.status === 200 && health.payload?.ok === true, `status ${health.status}`);
const shares = health.payload?.db === true;
console.log(`      plan store: ${shares ? 'ready' : 'none'} (${health.payload?.credentials || 'no database variables set'})`);
if (health.payload?.error) console.log(`      database error: ${health.payload.error}`);

const page = await fetch(base, { headers: { 'User-Agent': 'campusroute-check' } });
const html = await page.text();
check('planner page serves', page.status === 200 && html.includes('CampusRoute'), `status ${page.status}`);
check('page knows where its API is', html.includes('CAMPUSROUTE_API_BASE'));

if (!shares) {
  console.log('\nNo plan store configured, so sharing is off. The planner still works; plans stay in the browser.');
  process.exit(failures ? 1 : 0);
}

const state = demoPlan();
const created = await call('/api/plans', { method: 'POST', body: { state } });
check('a plan can be published', created.status === 201 && /^[a-z2-9]{12}$/.test(created.payload?.id || ''), `status ${created.status}`);

const { id, editKey } = created.payload || {};
if (id) {
  const anonymous = await call('/api/plans/' + id);
  check('anyone can read it', anonymous.status === 200 && anonymous.payload?.canEdit === false);

  const owner = await call('/api/plans/' + id, { key: editKey });
  check('the edit key unlocks it', owner.payload?.canEdit === true);

  const refused = await call('/api/plans/' + id, { method: 'PUT', body: { state, revision: 1 } });
  check('a write without the key is refused', refused.status === 403, `status ${refused.status}`);

  const saved = await call('/api/plans/' + id, { method: 'PUT', key: editKey, body: { state: { ...state, base: 'Pune' }, revision: 1 } });
  check('the owner can save', saved.status === 200 && saved.payload?.revision === 2, `status ${saved.status}`);

  const stale = await call('/api/plans/' + id, { method: 'PUT', key: editKey, body: { state, revision: 1 } });
  check('a stale save is a conflict', stale.status === 409, `status ${stale.status}`);

  const invalid = await call('/api/plans', { method: 'POST', body: { state: { schema: 1 } } });
  check('an invalid plan is rejected', invalid.status === 422, `status ${invalid.status}`);

  const removed = await call('/api/plans/' + id, { method: 'DELETE', key: editKey });
  check('the test plan is cleaned up', removed.status === 200, `status ${removed.status}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed — shared links work on this deployment.');
process.exit(failures ? 1 : 0);
