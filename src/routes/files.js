'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const { folderIsAccessible } = require('./folders');

const router = express.Router();
router.use(requireAuth);

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
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
router.get('/', (req, res) => {
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
    if (!folderIsAccessible(req.user.id, folderId)) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    clauses.push('folder_id IS ?');
    params.push(folderId);
  }

  const rows = db
    .prepare(`SELECT * FROM files WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params);
  res.json({ files: rows.map(serializeFile) });
});

// POST /api/files  (multipart form: file, folder_id?)
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
  if (!folderIsAccessible(req.user.id, folderId)) {
    fs.rm(path.join(config.uploadDir, req.file.filename), { force: true }, () => {});
    return res.status(404).json({ error: 'Folder not found' });
  }

  const info = db
    .prepare(
      `INSERT INTO files (user_id, folder_id, name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      folderId,
      decodeName(req.file.originalname),
      req.file.filename,
      req.file.mimetype || 'application/octet-stream',
      req.file.size
    );

  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ file: serializeFile(row) });
});

function getOwnedFile(userId, id) {
  return db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(id, userId);
}

// GET /api/files/:id/download
router.get('/:id/download', (req, res) => {
  const row = getOwnedFile(req.user.id, parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'File not found' });
  const diskPath = path.join(config.uploadDir, row.stored_name);
  if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'File data is missing' });
  res.download(diskPath, row.name);
});

// GET /api/files/:id/raw  (inline preview)
router.get('/:id/raw', (req, res) => {
  const row = getOwnedFile(req.user.id, parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'File not found' });
  const diskPath = path.join(config.uploadDir, row.stored_name);
  if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'File data is missing' });
  res.type(row.mime_type);
  res.sendFile(diskPath);
});

// PATCH /api/files/:id  { name?, folder_id?, starred? }
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = getOwnedFile(req.user.id, id);
  if (!row) return res.status(404).json({ error: 'File not found' });

  const updates = [];
  const params = [];

  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    updates.push('name = ?');
    params.push(req.body.name.trim());
  }
  if ('folder_id' in req.body) {
    const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
    if (!folderIsAccessible(req.user.id, folderId)) {
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
  db.prepare(`UPDATE files SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  res.json({ file: serializeFile(getOwnedFile(req.user.id, id)) });
});

// DELETE /api/files/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = getOwnedFile(req.user.id, id);
  if (!row) return res.status(404).json({ error: 'File not found' });
  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(id, req.user.id);
  fs.rm(path.join(config.uploadDir, row.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// GET /api/files/storage  -> total bytes used by the user
router.get('/storage', (req, res) => {
  const { total } = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE user_id = ?')
    .get(req.user.id);
  res.json({ used_bytes: total });
});

module.exports = router;
