'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// A small storage abstraction so file contents can live either on the local
// filesystem (dev / self-hosted) or in Vercel Blob (serverless). Each backend
// implements the same three operations and returns a stable `key` used to
// reference the object later.

function randomKey(originalName) {
  const ext = path.extname(originalName || '');
  return `${crypto.randomBytes(16).toString('hex')}${ext}`;
}

// ---- Local filesystem backend ----
const localBackend = {
  async save(buffer, { originalName }) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const key = randomKey(originalName);
    await fs.promises.writeFile(path.join(config.uploadDir, key), buffer);
    return { key, url: null };
  },
  async remove(key) {
    await fs.promises.rm(path.join(config.uploadDir, key), { force: true });
  },
  async sendTo(res, { key, name, mimeType, download }) {
    const diskPath = path.join(config.uploadDir, key);
    if (!fs.existsSync(diskPath)) {
      res.status(410).json({ error: 'File data is missing' });
      return;
    }
    if (download) {
      res.download(diskPath, name);
    } else {
      res.type(mimeType);
      res.sendFile(diskPath);
    }
  },
};

// ---- Vercel Blob backend ----
const blobBackend = {
  async save(buffer, { originalName, mimeType }) {
    const { put } = require('@vercel/blob');
    const key = `uploads/${randomKey(originalName)}`;
    const result = await put(key, buffer, {
      access: 'public',
      contentType: mimeType,
      token: config.blob.token || undefined,
      addRandomSuffix: false,
    });
    return { key: result.pathname, url: result.url };
  },
  async remove(key, url) {
    const { del } = require('@vercel/blob');
    await del(url || key, { token: config.blob.token || undefined });
  },
  // Stream the blob back through this authenticated endpoint so access stays
  // scoped to the owner (the blob URL itself is never exposed to the client).
  async sendTo(res, { url, name, mimeType, download }) {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      res.status(410).json({ error: 'File data is missing' });
      return;
    }
    res.type(mimeType);
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    }
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  },
};

const backend = config.storageBackend === 'blob' ? blobBackend : localBackend;

module.exports = {
  backend: config.storageBackend,
  save: (buffer, meta) => backend.save(buffer, meta),
  remove: (key, url) => backend.remove(key, url),
  sendTo: (res, meta) => backend.sendTo(res, meta),
};
