// The plan API. Four routes, no accounts.
//
//   GET    /api/health
//   POST   /api/plans            { state }            -> { id, editKey, revision }
//   GET    /api/plans/:id                             -> { state, revision, canEdit }
//   PUT    /api/plans/:id        { state, revision }   -> { revision }            (edit key required)
//   DELETE /api/plans/:id                                                          (edit key required)
//
// The edit key travels in an `X-Edit-Key` header, never in the URL, so it stays
// out of access logs and Referer headers.

import { validateState } from '../public/engine.js';
import { MAX_PLAN_BYTES, createPlan, deletePlan, isPlanId, keyMatches, readPlan, updatePlan } from './store.js';

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_PLAN_BYTES) {
        const error = new Error('That plan is larger than this server accepts.');
        error.status = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const error = new Error('The request body was not valid JSON.');
        error.status = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// The server validates every plan it stores with the same engine the browser
// uses, so a malformed or oversized plan never reaches another viewer.
function checkState(state) {
  const errors = validateState(state);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.status = 422;
    error.payload = { errors };
    throw error;
  }
}

export async function handleApi(req, res, url) {
  const editKey = req.headers['x-edit-key'] || '';
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  try {
    if (segments[0] === 'health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'campusroute' });
    }

    if (segments[0] === 'plans' && segments.length === 1) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST to create a plan.' });
      const body = await readBody(req);
      checkState(body.state);
      const created = await createPlan(body.state);
      return json(res, 201, created);
    }

    if (segments[0] === 'plans' && segments.length === 2) {
      const id = segments[1];
      if (!isPlanId(id)) return json(res, 404, { error: 'No plan with that id.' });

      if (req.method === 'GET') {
        const record = await readPlan(id);
        if (!record) return json(res, 404, { error: 'No plan with that id.' });
        return json(res, 200, {
          state: record.state,
          revision: record.revision,
          updatedAt: record.updatedAt,
          canEdit: keyMatches(record, editKey)
        });
      }

      if (req.method === 'PUT') {
        // Authorise before looking at the body: a viewer without the edit key
        // should be told that, not handed a critique of what they sent.
        const record = await readPlan(id);
        if (!record) return json(res, 404, { error: 'No plan with that id.' });
        if (!keyMatches(record, editKey)) {
          return json(res, 403, { error: 'This plan is read-only from here. Open it with its edit link to make changes.' });
        }
        const body = await readBody(req);
        checkState(body.state);
        const result = await updatePlan(id, { state: body.state, revision: body.revision, editKey });
        return json(res, 200, result);
      }

      if (req.method === 'DELETE') {
        const removed = await deletePlan(id, editKey);
        return json(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'No plan with that id.' });
      }

      return json(res, 405, { error: 'Method not allowed on a plan.' });
    }

    return json(res, 404, { error: 'No such endpoint.' });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('api error', error);
    return json(res, status, { error: status >= 500 ? 'The server could not complete that request.' : error.message, ...(error.payload || {}) });
  }
}
