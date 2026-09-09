// Plan storage: one JSON file per plan, written atomically.
//
// A plan needs no account. Creating one returns an edit key; the key's SHA-256
// hash is what gets stored, so a stolen backup of the data directory does not
// hand anyone the ability to edit the plans inside it.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const MAX_PLAN_BYTES = Number(process.env.MAX_PLAN_BYTES || 2_000_000);
export const PLAN_TTL_DAYS = Number(process.env.PLAN_TTL_DAYS || 0); // 0 = keep for ever
export const MAX_PLANS = Number(process.env.MAX_PLANS || 20_000);

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

export const isPlanId = (id) => typeof id === 'string' && /^[a-z2-9]{12}$/.test(id);

function newId() {
  const bytes = randomBytes(12);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

const fileFor = (id) => path.join(DATA_DIR, id + '.json');

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function writeAtomic(file, text) {
  const tmp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

async function readRecord(id) {
  try {
    return JSON.parse(await readFile(fileFor(id), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function keyMatches(record, editKey) {
  if (!record?.editKeyHash || !editKey) return false;
  const a = Buffer.from(hash(editKey));
  const b = Buffer.from(record.editKeyHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function countPlans() {
  await ensureDir();
  return (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).length;
}

export async function createPlan(state) {
  await ensureDir();
  if (MAX_PLANS && (await countPlans()) >= MAX_PLANS) {
    const error = new Error('This server is holding as many plans as it is configured to keep.');
    error.status = 507;
    throw error;
  }
  const editKey = randomBytes(24).toString('base64url');
  let id = newId();
  for (let attempt = 0; attempt < 5 && (await readRecord(id)); attempt++) id = newId();
  const now = new Date().toISOString();
  const record = { id, editKeyHash: hash(editKey), revision: 1, createdAt: now, updatedAt: now, state };
  await writeAtomic(fileFor(id), JSON.stringify(record));
  return { id, editKey, revision: 1, updatedAt: now };
}

export async function readPlan(id) {
  if (!isPlanId(id)) return null;
  return readRecord(id);
}

// Optimistic concurrency: a save carries the revision it was based on, so two
// people editing the same plan cannot silently overwrite each other.
export async function updatePlan(id, { state, revision, editKey }) {
  const record = await readPlan(id);
  if (!record) {
    const error = new Error('That plan no longer exists.');
    error.status = 404;
    throw error;
  }
  if (!keyMatches(record, editKey)) {
    const error = new Error('This plan is read-only from here. Open it with its edit link to make changes.');
    error.status = 403;
    throw error;
  }
  if (Number(revision) !== record.revision) {
    const error = new Error('The shared plan changed since you loaded it. Reload it before saving.');
    error.status = 409;
    error.payload = { revision: record.revision };
    throw error;
  }
  const next = { ...record, state, revision: record.revision + 1, updatedAt: new Date().toISOString() };
  await writeAtomic(fileFor(id), JSON.stringify(next));
  return { revision: next.revision, updatedAt: next.updatedAt };
}

export async function deletePlan(id, editKey) {
  const record = await readPlan(id);
  if (!record) return false;
  if (!keyMatches(record, editKey)) {
    const error = new Error('Only the edit link can delete a plan.');
    error.status = 403;
    throw error;
  }
  await unlink(fileFor(id));
  return true;
}

// Optional housekeeping for a public deployment: drop plans nobody has touched
// in PLAN_TTL_DAYS. Off by default.
export async function sweep(now = Date.now()) {
  if (!PLAN_TTL_DAYS) return 0;
  await ensureDir();
  let removed = 0;
  for (const file of await readdir(DATA_DIR)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(DATA_DIR, file);
    try {
      const info = await stat(full);
      if (now - info.mtimeMs > PLAN_TTL_DAYS * 86400000) {
        await unlink(full);
        removed++;
      }
    } catch {
      /* a file that vanished mid-sweep is already handled */
    }
  }
  return removed;
}
