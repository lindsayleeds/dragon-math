const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read the app manifest once and reuse it as the template. Prefer the built
// copy (what production actually serves), fall back to source, then a minimal
// stub so the route can never hard-fail.
let baseManifest = null;
function readBaseManifest() {
  if (baseManifest) return baseManifest;
  const candidates = [
    path.join(__dirname, '../../dist/manifest.webmanifest'),
    path.join(__dirname, '../../public/manifest.webmanifest'),
  ];
  for (const file of candidates) {
    try {
      baseManifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      return baseManifest;
    } catch {
      /* try next candidate */
    }
  }
  baseManifest = { name: 'My Dragon Math', short_name: 'Dragon Math', display: 'standalone', scope: '/' };
  return baseManifest;
}

// GET /api/manifest/k/:token — a per-kid PWA manifest whose start_url is the
// child's own /k/<token> login link. "Add to Home Screen" shortcuts launch at
// the manifest's start_url (not the page you were on), and the standalone app
// has its own storage that never sees the browser's saved login — so with the
// default start_url ("/") a kid's icon always lands on /auth. Pointing it at
// /k/<token> makes every launch re-exchange the token for a fresh session.
//
// Unauthenticated by design (a manifest must be fetchable before login); it
// only echoes the token into start_url and never touches the database.
router.get('/k/:token', (req, res) => {
  const { token } = req.params;
  if (!UUID_RE.test(token)) return res.status(400).json({ error: 'Invalid token' });

  const manifest = { ...readBaseManifest(), start_url: `/k/${token}`, scope: '/' };
  res.set('Content-Type', 'application/manifest+json');
  res.set('Cache-Control', 'no-cache');
  res.send(JSON.stringify(manifest));
});

module.exports = router;
