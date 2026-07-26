const express = require('express');
const fs = require('fs');
const path = require('path');
const { sql } = require('drizzle-orm');
const { db } = require('../db');
const { DB_TIMEOUT_MS, probeDb, buildHealth } = require('../lib/health');

const router = express.Router();

// The build identifier the client already sees. `dist/version.json` is emitted
// by the version plugin in vite.config.js and served (no-cache) by nginx, so
// reporting the same values here is what lets a deploy confirm *which* release
// answered. GIT_SHA is the documented fallback when the app runs without a
// built dist/ (dev, or an API-only host).
//
// Cached after the first successful read: a released-artifact deploy swaps the
// symlink and reloads pm2, so a fresh process always re-reads the new file.
let cachedVersion = null;
function readVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const file = path.join(__dirname, '../../dist/version.json');
    const { commit, builtAt } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (commit && commit !== 'unknown') {
      cachedVersion = { version: commit, builtAt: builtAt || null };
      return cachedVersion;
    }
  } catch {
    /* no built dist/ — fall through to the env fallback */
  }
  return { version: process.env.GIT_SHA || 'unknown', builtAt: null };
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
router.get('/', async (_req, res) => {
  const dbCheck = await probeDb(() => db.execute(sql`select 1`), DB_TIMEOUT_MS);
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
