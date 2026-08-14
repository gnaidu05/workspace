'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const storage = require('../storage');
const { requireAuth } = require('../auth');
const { folderIsAccessible } = require('./folders');

const router = express.Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Buffer uploads in memory, then hand the bytes to the storage backend (local
// disk or Vercel Blob). This keeps the upload path identical on every host.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

// Fix mojibake in multer-decoded original filenames (latin1 -> utf8).
function decodeName(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function serializeFile(row) {
  return {
    id: row.id,
    name: row.name,
    folder_id: row.folder_id,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    starred: Boolean(row.starred),
    created_at: row.created_at,
  };
}

// GET /api/files?folder_id=...&starred=1&q=search
router.get(
  '/',
  wrap(async (req, res) => {
    const { starred, q } = req.query;
    const folderId = req.query.folder_id ? parseInt(req.query.folder_id, 10) : null;

    const clauses = ['user_id = ?'];
    const params = [req.user.id];

    if (q) {
      clauses.push('name LIKE ?');
      params.push(`%${q}%`);
    } else if (starred === '1') {
      clauses.push('starred = 1');
    } else {
      if (!(await folderIsAccessible(req.user.id, folderId))) {
        return res.status(404).json({ error: 'Folder not found' });
      }
      clauses.push('folder_id IS ?');
      params.push(folderId);
    }

    const rows = await db.all(
      `SELECT * FROM files WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json({ files: rows.map(serializeFile) });
  })
);

// GET /api/files/storage  -> total bytes used by the user
router.get(
  '/storage',
  wrap(async (req, res) => {
    const row = await db.get('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE user_id = ?', [
      req.user.id,
    ]);
    res.json({ used_bytes: Number(row.total) });
  })
);

// POST /api/files  (multipart form: file, folder_id?)
router.post(
  '/',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
    if (!(await folderIsAccessible(req.user.id, folderId))) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const mimeType = req.file.mimetype || 'application/octet-stream';
    const originalName = decodeName(req.file.originalname);
    const stored = await storage.save(req.file.buffer, { originalName, mimeType });

    const info = await db.run(
      `INSERT INTO files (user_id, folder_id, name, storage_key, storage_url, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, folderId, originalName, stored.key, stored.url, mimeType, req.file.size]
    );

    const row = await db.get('SELECT * FROM files WHERE id = ?', [info.lastInsertRowid]);
    res.status(201).json({ file: serializeFile(row) });
  })
);

async function getOwnedFile(userId, id) {
  return db.get('SELECT * FROM files WHERE id = ? AND user_id = ?', [id, userId]);
}

// GET /api/files/:id/download
router.get(
  '/:id/download',
  wrap(async (req, res) => {
    const row = await getOwnedFile(req.user.id, parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: 'File not found' });
    await storage.sendTo(res, {
      key: row.storage_key,
      url: row.storage_url,
      name: row.name,
      mimeType: row.mime_type,
      download: true,
    });
  })
);

// GET /api/files/:id/raw  (inline preview)
router.get(
  '/:id/raw',
  wrap(async (req, res) => {
    const row = await getOwnedFile(req.user.id, parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: 'File not found' });
    await storage.sendTo(res, {
      key: row.storage_key,
      url: row.storage_url,
      name: row.name,
      mimeType: row.mime_type,
      download: false,
    });
  })
);

// PATCH /api/files/:id  { name?, folder_id?, starred? }
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await getOwnedFile(req.user.id, id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const updates = [];
    const params = [];

    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      updates.push('name = ?');
      params.push(req.body.name.trim());
    }
    if ('folder_id' in req.body) {
      const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
      if (!(await folderIsAccessible(req.user.id, folderId))) {
        return res.status(404).json({ error: 'Target folder not found' });
      }
      updates.push('folder_id = ?');
      params.push(folderId);
    }
    if ('starred' in req.body) {
      updates.push('starred = ?');
      params.push(req.body.starred ? 1 : 0);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(id, req.user.id);
    await db.run(`UPDATE files SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);
    res.json({ file: serializeFile(await getOwnedFile(req.user.id, id)) });
  })
);

// DELETE /api/files/:id
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await getOwnedFile(req.user.id, id);
    if (!row) return res.status(404).json({ error: 'File not found' });
    await db.run('DELETE FROM files WHERE id = ? AND user_id = ?', [id, req.user.id]);
    try {
      await storage.remove(row.storage_key, row.storage_url);
    } catch {
      /* best-effort cleanup */
    }
    res.json({ ok: true });
  })
);

module.exports = router;
