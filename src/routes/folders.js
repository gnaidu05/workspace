'use strict';

const express = require('express');
const db = require('../db');
const storage = require('../storage');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Confirm a folder belongs to the user (or is the null root).
async function folderIsAccessible(userId, folderId) {
  if (folderId === null || folderId === undefined) return true;
  const folder = await db.get('SELECT id FROM folders WHERE id = ? AND user_id = ?', [folderId, userId]);
  return Boolean(folder);
}

// GET /api/folders?parent_id=... -> list subfolders of a parent (root when omitted)
router.get(
  '/',
  wrap(async (req, res) => {
    const parentId = req.query.parent_id ? parseInt(req.query.parent_id, 10) : null;
    if (!(await folderIsAccessible(req.user.id, parentId))) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    const rows = await db.all(
      `SELECT id, name, parent_id, created_at
         FROM folders
        WHERE user_id = ? AND parent_id IS ?
        ORDER BY name COLLATE NOCASE`,
      [req.user.id, parentId]
    );
    res.json({ folders: rows });
  })
);

// GET /api/folders/:id/breadcrumb -> ancestor chain for navigation
router.get(
  '/:id/breadcrumb',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const chain = [];
    let current = await db.get('SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?', [
      id,
      req.user.id,
    ]);
    if (!current) return res.status(404).json({ error: 'Folder not found' });
    while (current) {
      chain.unshift({ id: current.id, name: current.name });
      current = current.parent_id
        ? await db.get('SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?', [
            current.parent_id,
            req.user.id,
          ])
        : null;
    }
    res.json({ breadcrumb: chain });
  })
);

// POST /api/folders  { name, parent_id? }
router.post(
  '/',
  wrap(async (req, res) => {
    const { name, parent_id } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const parentId = parent_id ? parseInt(parent_id, 10) : null;
    if (!(await folderIsAccessible(req.user.id, parentId))) {
      return res.status(404).json({ error: 'Parent folder not found' });
    }
    const info = await db.run('INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)', [
      req.user.id,
      parentId,
      String(name).trim(),
    ]);
    const folder = await db.get('SELECT id, name, parent_id, created_at FROM folders WHERE id = ?', [
      info.lastInsertRowid,
    ]);
    res.status(201).json({ folder });
  })
);

// PATCH /api/folders/:id  { name }  -> rename
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    const result = await db.run('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?', [
      String(name).trim(),
      id,
      req.user.id,
    ]);
    if (result.rowsAffected === 0) return res.status(404).json({ error: 'Folder not found' });
    res.json({ ok: true });
  })
);

// DELETE /api/folders/:id  -> removes the folder, its descendants, and their files
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const folder = await db.get('SELECT id FROM folders WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Collect this folder and all descendants (portable recursion, no CTE).
    const ids = [id];
    let frontier = [id];
    while (frontier.length) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = await db.all(
        `SELECT id FROM folders WHERE user_id = ? AND parent_id IN (${placeholders})`,
        [req.user.id, ...frontier]
      );
      const childIds = children.map((c) => c.id);
      ids.push(...childIds);
      frontier = childIds;
    }

    // Remove stored file objects, then rows (folder delete cascades in the DB).
    const placeholders = ids.map(() => '?').join(',');
    const files = await db.all(
      `SELECT storage_key, storage_url FROM files WHERE user_id = ? AND folder_id IN (${placeholders})`,
      [req.user.id, ...ids]
    );
    for (const f of files) {
      try {
        await storage.remove(f.storage_key, f.storage_url);
      } catch {
        /* best-effort cleanup */
      }
    }
    // Delete rows explicitly (don't depend on FK cascade being enforced on the
    // remote connection).
    await db.run(`DELETE FROM files WHERE user_id = ? AND folder_id IN (${placeholders})`, [
      req.user.id,
      ...ids,
    ]);
    await db.run(`DELETE FROM folders WHERE user_id = ? AND id IN (${placeholders})`, [
      req.user.id,
      ...ids,
    ]);
    res.json({ ok: true });
  })
);

module.exports = { router, folderIsAccessible };
