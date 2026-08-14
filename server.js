'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const config = require('./src/config');

const authRoutes = require('./src/routes/auth');
const { router: folderRoutes } = require('./src/routes/folders');
const fileRoutes = require('./src/routes/files');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/files', fileRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

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
