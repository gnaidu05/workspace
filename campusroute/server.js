// CampusRoute server: static files plus the plan API. No dependencies.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './src/api.js';
import { DATA_DIR, PLAN_TTL_DAYS, sweep } from './src/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// Writes per IP per window, so one client cannot fill the disk on a public host.
const WRITE_LIMIT = Number(process.env.WRITE_LIMIT || 120);
const WINDOW_MS = 60_000;
const writes = new Map();

function overWriteLimit(ip) {
  const now = Date.now();
  const entry = writes.get(ip);
  if (!entry || now - entry.since > WINDOW_MS) {
    writes.set(ip, { since: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > WRITE_LIMIT;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

// The app loads no third-party scripts, so the policy can stay tight. Inline
// *style attributes* are used for route colours and timeline bars, hence
// 'unsafe-inline' on style-src only.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://photon.komoot.io https://router.project-osrm.org https://overpass-api.de",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = path.join(PUBLIC_DIR, path.normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      // The app is a handful of small modules; keep them fresh but revalidated.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300, must-revalidate'
    });
    createReadStream(target).pipe(res);
  } catch {
    // Unknown paths fall back to the app itself, so a shared link opens even
    // when a host rewrites the fragment into a path.
    if (!path.extname(target)) return serveStatic(req, res, '/index.html');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

export const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname.startsWith('/api')) {
    const writing = req.method !== 'GET' && req.method !== 'HEAD';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    if (writing && overWriteLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'Too many changes from this address. Wait a minute and try again.' }));
      return;
    }
    return handleApi(req, res, url);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  return serveStatic(req, res, url.pathname);
});

if (process.argv[1] && import.meta.url === 'file://' + process.argv[1]) {
  server.listen(PORT, HOST, () => {
    console.log(`CampusRoute listening on http://localhost:${PORT}`);
    console.log(`Plans are stored in ${DATA_DIR}${PLAN_TTL_DAYS ? ` (removed after ${PLAN_TTL_DAYS} days idle)` : ''}`);
  });
  if (PLAN_TTL_DAYS) {
    sweep().then((n) => n && console.log(`Swept ${n} idle plan(s)`));
    setInterval(() => sweep().catch((e) => console.error('sweep failed', e)), 6 * 3600 * 1000).unref();
  }
}
