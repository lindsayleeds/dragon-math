const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { DB_TIMEOUT_MS, probeDb, buildHealth } = require('../lib/health');

const router = express.Router();

// The build identifier the client already sees. `dist/version.json` is emitted
// by the version plugin in vite.config.js and served (no-cache) by nginx, so
// reporting the same values here is what lets a deploy confirm *which* release
// answered. GIT_SHA is the documented fallback when the app runs without a
// built dist/ (dev, or an API-only host).
//
// Resolved once per process — including the fallback, so a missing dist/ can't
// make this public, continuously-polled route repeat a blocking readFileSync and
// an ENOENT throw on the event loop for every request. A released-artifact
// deploy swaps the symlink and reloads pm2, so a fresh process always re-reads
// the new file; a dev server needs a restart to notice a dist/ built after boot.
let cachedVersion = null;
function readVersion() {
  if (cachedVersion) return cachedVersion;
  let built = null;
  try {
    const file = path.join(__dirname, '../../dist/version.json');
    const { commit, builtAt } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (commit && commit !== 'unknown') built = { version: commit, builtAt: builtAt || null };
  } catch {
    /* no built dist/ — fall through to the env fallback */
  }
  cachedVersion = built || { version: process.env.GIT_SHA || 'unknown', builtAt: null };
  return cachedVersion;
}

// GET /api/health — readiness, not liveness.
//
// Unauthenticated and unthrottled by design: the deploy script polls it every
// second or two through a reload and rolls back on a non-200, and uptime
// monitoring hits it continuously. It is publicly reachable, so the body carries
// only the build id, process uptime, and a coarse per-check verdict — never a
// connection string, env value, error message, or stack.
//
// The database probe is hard-bounded (see server/lib/health.js). A health
// endpoint that hangs on a slow database is worse than none: the deploy script
// would block instead of rolling back, which is the outage this prevents.
//
// The probe takes a dedicated client out of the shared pool (never a second
// pool) so that abandoning it can destroy that one connection. Going through
// `db.execute` would leave the client checked out until a query we stopped
// waiting for settled, and a public endpoint polled every second or two would
// drain the pool the rest of the app shares.
router.get('/', async (_req, res) => {
  const dbCheck = await probeDb(() => pool.connect(), DB_TIMEOUT_MS);
  const { version, builtAt } = readVersion();

  const body = buildHealth({
    checks: { db: dbCheck },
    version,
    uptimeSeconds: Math.round(process.uptime()),
  });
  if (builtAt) body.builtAt = builtAt;

  res.set('Cache-Control', 'no-store');
  res.status(body.status === 'ok' ? 200 : 503).json(body);
});

module.exports = router;
