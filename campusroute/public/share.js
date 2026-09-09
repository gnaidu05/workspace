// Persistence and public sharing.
//
// There are no accounts. A plan lives in one of three modes:
//
//   local        the plan exists only in this browser (localStorage)
//   shared-edit  the plan is on the server and this browser holds its edit key
//   shared-view  the plan is on the server and this browser can only read it
//
// The plan id and the edit key both live in the URL *fragment*, so the key is
// never sent to the server in a request line, a log or a Referer header. It is
// sent explicitly, as a header, only on the requests that need it.

import { validateState } from './engine.js';
import { safeStorage } from './geography.js';

export const DRAFT_KEY = 'campusroute.draft.v1';
export const LAST_PLAN_KEY = 'campusroute.last-plan.v1';
const KEYS_KEY = 'campusroute.edit-keys.v1';

const storage = safeStorage();

// --- URL fragment ----------------------------------------------------------

export function readLocation(hash = globalThis.location?.hash || '') {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const id = params.get('p') || '';
  return { id: /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : '', token: params.get('k') || '' };
}

export function planUrl(id, token) {
  const base = globalThis.location ? globalThis.location.origin + globalThis.location.pathname : '';
  return base + '#p=' + encodeURIComponent(id) + (token ? '&k=' + encodeURIComponent(token) : '');
}

function setFragment(id, token) {
  if (!globalThis.history || !globalThis.location) return;
  const next = id ? '#p=' + encodeURIComponent(id) + (token ? '&k=' + encodeURIComponent(token) : '') : '#';
  if (globalThis.location.hash !== next) globalThis.history.replaceState(null, '', next);
}

// Edit keys are also remembered per plan, so returning with a plain view link
// from the same browser still opens the plan for editing.
function rememberKey(id, token) {
  if (!storage || !id || !token) return;
  try {
    const keys = JSON.parse(storage.getItem(KEYS_KEY) || '{}');
    keys[id] = token;
    storage.setItem(KEYS_KEY, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

export function recallKey(id) {
  if (!storage || !id) return '';
  try {
    return JSON.parse(storage.getItem(KEYS_KEY) || '{}')[id] || '';
  } catch {
    return '';
  }
}

// --- local draft -----------------------------------------------------------

export function readDraft() {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateState(parsed).length ? null : parsed;
  } catch {
    return null;
  }
}

export function writeDraft(state) {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// --- server --------------------------------------------------------------

// Where the plan API lives. Defaults to /api; a host that serves the planner
// under a path prefix (the Vercel deployment mounts it at /campusroute) sets
// `window.CAMPUSROUTE_API_BASE` in the page before this module loads.
export const apiBase = () => String(globalThis.CAMPUSROUTE_API_BASE || '/api').replace(/\/$/, '');

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(apiBase() + path, {
    method,
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'X-Edit-Key': token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error page */
  }
  if (!response.ok) {
    const error = new Error(payload.error || `The server replied ${response.status}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export class Sharing {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.id = '';
    this.token = '';
    this.revision = 0;
    this.mode = 'local';
    this.serverAvailable = null; // null = not probed yet
    this.dirty = false;
    this.busy = false;
    this.conflict = false;
    this.status = 'Local draft in this browser';
    this.updatedAt = null;
    this.saveTimer = null;
  }

  get canEdit() {
    return this.mode !== 'shared-view';
  }

  setStatus(status) {
    this.status = status;
    this.onStatus(status);
  }

  async probeServer() {
    if (this.serverAvailable !== null) return this.serverAvailable;
    // Opened straight from disk (the single-file build): there is no API to ask.
    if (globalThis.location?.protocol === 'file:') {
      this.serverAvailable = false;
      return false;
    }
    try {
      const health = await api('/health');
      this.serverAvailable = health.ok === true;
    } catch {
      this.serverAvailable = false;
    }
    return this.serverAvailable;
  }

  // Called once at startup. Returns the state to show, or null to keep the
  // caller's own starting plan.
  async open() {
    const { id, token } = readLocation();
    await this.probeServer();
    if (!id) {
      this.mode = 'local';
      this.setStatus(this.serverAvailable ? 'Local draft · publish to share a link' : 'Local draft in this browser');
      return null;
    }
    if (!this.serverAvailable) {
      this.mode = 'local';
      this.setStatus('This build has no plan server, so shared links cannot be opened here.');
      return null;
    }
    this.id = id;
    this.token = token || recallKey(id);
    return this.load();
  }

  async load() {
    try {
      const result = await api('/plans/' + encodeURIComponent(this.id), { token: this.token });
      const errors = validateState(result.state);
      if (errors.length) throw new Error('The shared plan needs review: ' + errors[0]);
      this.revision = result.revision;
      this.updatedAt = result.updatedAt;
      this.mode = result.canEdit ? 'shared-edit' : 'shared-view';
      this.conflict = false;
      this.dirty = false;
      if (result.canEdit) rememberKey(this.id, this.token);
      setFragment(this.id, result.canEdit ? this.token : '');
      this.setStatus(this.describe());
      return result.state;
    } catch (error) {
      if (error.status === 404) {
        this.id = '';
        this.token = '';
        this.mode = 'local';
        setFragment('', '');
        this.setStatus('That shared plan no longer exists. Showing a local draft instead.');
        return null;
      }
      this.mode = 'local';
      this.setStatus(error.message + ' Working from the local draft.');
      return null;
    }
  }

  describe() {
    const when = this.updatedAt ? ' · updated ' + new Date(this.updatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
    if (this.mode === 'shared-edit') return 'Shared plan · anyone with the link can view' + when;
    if (this.mode === 'shared-view') return 'Read-only shared plan' + when;
    return 'Local draft in this browser';
  }

  // Publish the current local plan and become its editor.
  async publish(state) {
    if (!(await this.probeServer())) throw new Error('This build has no plan server, so it cannot publish a shared link.');
    const result = await api('/plans', { method: 'POST', body: { state } });
    this.id = result.id;
    this.token = result.editKey;
    this.revision = result.revision;
    this.updatedAt = result.updatedAt;
    this.mode = 'shared-edit';
    this.conflict = false;
    this.dirty = false;
    rememberKey(this.id, this.token);
    setFragment(this.id, this.token);
    this.setStatus(this.describe());
    return { viewUrl: planUrl(this.id, ''), editUrl: planUrl(this.id, this.token) };
  }

  // Copy a plan (usually one you can only view) into a new shared plan you own.
  async fork(state) {
    return this.publish(state);
  }

  // Queue a save. Local drafts are written immediately; shared plans are
  // debounced so typing does not become one request per keystroke.
  save(state, { immediate = false } = {}) {
    const wrote = writeDraft(state);
    if (this.mode !== 'shared-edit') {
      this.setStatus(wrote ? 'Local draft saved in this browser' : 'Browser storage is unavailable — export a backup');
      return;
    }
    this.dirty = true;
    if (this.conflict) {
      this.setStatus('Someone else changed the shared plan. Reload before saving; your draft is kept.');
      return;
    }
    this.setStatus('Saving shared plan…');
    clearTimeout(this.saveTimer);
    if (immediate) return this.flush(state);
    this.saveTimer = setTimeout(() => this.flush(state), 700);
  }

  async flush(state) {
    if (this.mode !== 'shared-edit' || this.busy || this.conflict || !this.dirty) return;
    this.busy = true;
    this.dirty = false;
    try {
      const result = await api('/plans/' + encodeURIComponent(this.id), {
        method: 'PUT',
        token: this.token,
        body: { state, revision: this.revision }
      });
      this.revision = result.revision;
      this.updatedAt = result.updatedAt;
      this.setStatus(this.describe());
    } catch (error) {
      this.dirty = true;
      if (error.status === 409) {
        this.conflict = true;
        this.setStatus('Someone else changed the shared plan. Reload to see it; your draft is kept.');
      } else {
        this.setStatus(error.message + ' Use Retry save.');
      }
    } finally {
      this.busy = false;
      if (this.dirty && !this.conflict) void this.flush(state);
    }
  }
}
