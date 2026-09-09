'use strict';

// Temporary diagnostic: the planner function fails at module load in production
// with nothing but FUNCTION_INVOCATION_FAILED to go on, and this deployment's
// logs are not reachable from here. Each step is attempted separately so the
// response says which one breaks. Delete once the cause is known.

module.exports = async (req, res) => {
  const steps = {};

  try {
    const bundle = require('./_campusroute-bundle.js');
    steps.bundle = {
      loaded: true,
      pageBytes: bundle.PLANNER_PAGE ? bundle.PLANNER_PAGE.length : 0,
      validateState: typeof bundle.validateState,
    };
  } catch (error) {
    steps.bundle = { loaded: false, error: error.message, code: error.code };
  }

  try {
    require('@libsql/client');
    steps.libsql = { loaded: true };
  } catch (error) {
    steps.libsql = { loaded: false, error: error.message, code: error.code };
  }

  try {
    steps.handler = { loaded: true, type: typeof require('./campusroute.js') };
  } catch (error) {
    steps.handler = { loaded: false, error: error.message, code: error.code, stack: (error.stack || '').split('\n').slice(0, 4) };
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    dirname: __dirname,
    env: {
      hasTurso: Boolean(process.env.TURSO_DATABASE_URL),
      hasCampusroute: Boolean(process.env.CAMPUSROUTE_DATABASE_URL),
      vercel: Boolean(process.env.VERCEL),
    },
    steps,
  }, null, 2));
};
