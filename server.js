'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const config = require('./src/config');

const db = require('./src/db');
const authRoutes = require('./src/routes/auth');
const { router: folderRoutes } = require('./src/routes/folders');
const fileRoutes = require('./src/routes/files');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health first, and deliberately outside the database gate: when storage is
// misconfigured this is the endpoint that has to keep answering and say so.
app.get('/api/health', async (req, res) => {
  const state = await db.status();
  res.status(state.db === 'ready' ? 200 : 503).json({ ok: state.db === 'ready', ...state });
});

// Ensure the database schema is initialised before any request runs. On a
// serverless cold start this awaits the one-time init; afterwards it's a
// resolved promise and adds no latency. A database that is down or
// unconfigured answers 503 with the reason — it must never take the process
// with it, or every route fails with nothing to explain it.
app.use((req, res, next) => {
  db.ensureReady().then(
    () => next(),
    (error) => {
      console.error('database unavailable:', error.message);
      res.status(503).json({ error: 'The database is unavailable. ' + error.message });
    },
  );
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/files', fileRoutes);

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Multer / upload error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Drive clone running at http://localhost:${config.port}`);
  });
}

module.exports = app;
