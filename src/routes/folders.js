'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Confirm a folder belongs to the user (or is the null root). Returns true/false.
function folderIsAccessible(userId, folderId) {
  if (folderId === null || folderId === undefined) return true;
  const folder = db
    .prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
    .get(folderId, userId);
  return Boolean(folder);
}

// GET /api/folders?parent_id=... -> list subfolders of a parent (root when omitted)
router.get('/', (req, res) => {
  const parentId = req.query.parent_id ? parseInt(req.query.parent_id, 10) : null;
  if (!folderIsAccessible(req.user.id, parentId)) {
    return res.status(404).json({ error: 'Folder not found' });
  }
  const rows = db
    .prepare(
      `SELECT id, name, parent_id, created_at
         FROM folders
        WHERE user_id = ? AND parent_id IS ?
        ORDER BY name COLLATE NOCASE`
    )
    .all(req.user.id, parentId);
  res.json({ folders: rows });
});

// GET /api/folders/:id/breadcrumb -> ancestor chain for navigation
router.get('/:id/breadcrumb', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chain = [];
  let current = db
    .prepare('SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?')
    .get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'Folder not found' });
  while (current) {
    chain.unshift({ id: current.id, name: current.name });
    current = current.parent_id
      ? db
          .prepare('SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?')
          .get(current.parent_id, req.user.id)
      : null;
  }
  res.json({ breadcrumb: chain });
});

// POST /api/folders  { name, parent_id? }
router.post('/', (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const parentId = parent_id ? parseInt(parent_id, 10) : null;
  if (!folderIsAccessible(req.user.id, parentId)) {
    return res.status(404).json({ error: 'Parent folder not found' });
  }
  const info = db
    .prepare('INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)')
    .run(req.user.id, parentId, String(name).trim());
  const folder = db.prepare('SELECT id, name, parent_id, created_at FROM folders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ folder });
});

// PATCH /api/folders/:id  { name }  -> rename
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const result = db
    .prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?')
    .run(String(name).trim(), id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Folder not found' });
  res.json({ ok: true });
});

// DELETE /api/folders/:id  -> cascades to subfolders and files
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  // Collect stored files in this folder and all descendants so we can remove
  // them from disk (the DB rows are removed by ON DELETE CASCADE).
  const doomedFiles = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ?
         UNION ALL
         SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
       )
       SELECT stored_name FROM files WHERE folder_id IN (SELECT id FROM tree) AND user_id = ?`
    )
    .all(id, req.user.id);

  db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, req.user.id);

  for (const { stored_name } of doomedFiles) {
    fs.rm(path.join(config.uploadDir, stored_name), { force: true }, () => {});
  }
  res.json({ ok: true });
});

module.exports = { router, folderIsAccessible };
