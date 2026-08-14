'use strict';

// Vercel serverless entry point. The Express app is itself a (req, res)
// handler, so exporting it makes every route run inside one function.
module.exports = require('../server');
