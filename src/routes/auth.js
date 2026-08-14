'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');

const router = express.Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
  maxAge: config.tokenTtlSeconds * 1000,
};

// Wrap async handlers so rejected promises reach Express' error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/auth/register
router.post(
  '/register',
  wrap(async (req, res) => {
    const { email, name, password } = req.body || {};
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name and password are required' });
    }
    if (!auth.EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const info = await db.run('INSERT INTO users (email, name, password) VALUES (?, ?, ?)', [
      email.toLowerCase(),
      name.trim(),
      auth.hashPassword(password),
    ]);

    const user = await db.get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid]);
    const token = auth.signToken(user);
    res.cookie('token', token, cookieOptions);
    res.status(201).json({ user: auth.publicUser(user), token });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
    if (!user || !auth.verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = auth.signToken(user);
    res.cookie('token', token, cookieOptions);
    res.json({ user: auth.publicUser(user), token });
  })
);

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

module.exports = router;
