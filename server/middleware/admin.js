// Gates the /admin tools with a static shared password. This is one of the two
// deliberately independent auth models in this app — see the auth-boundaries
// section of AGENTS.md before changing how it works.
//
// THERE IS NO DEFAULT PASSWORD, ON PURPOSE.
//
// This used to read `process.env.ADMIN_PASSWORD || 'dragon'`. A fallback is worse
// than no fallback here, because it applies exactly when someone forgot to set the
// real value — a fresh provision, a dropped line in shared/.env, a `pm2 reload`
// without --update-env — and the word is committed to the repo. Nothing detected
// that state: the box booted clean, logged nothing, and passed every deploy check
// with the whole admin surface behind a guessable word. deploy/verify.sh now
// asserts the variable is present; this file makes the app refuse rather than
// quietly accept.
//
// Missing config fails 503 rather than throwing at startup. Compare JWT_SECRET in
// ./auth.js, which DOES refuse to boot: a forgeable session token compromises
// every user in the system, while this compromises one surface, and taking the
// kid-facing app down over a missing admin password would trade a small risk for
// a total outage. Either way nothing can authenticate — there is no value to
// compare against.

const crypto = require('crypto');
const { rateLimit } = require('../lib/rateLimit');

// Read per request rather than captured at module load, so `pm2 reload
// --update-env` takes effect and so this is testable without cache surgery.
function adminPassword() {
  const raw = process.env.ADMIN_PASSWORD;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

// Constant-time comparison of two secrets. timingSafeEqual throws on a length
// mismatch — which would itself leak the length — so both sides are hashed to a
// fixed 32 bytes first and the digests are compared.
function secretsMatch(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function requireAdmin(req, res, next) {
  const expected = adminPassword();
  if (!expected) {
    console.error(
      'ADMIN_PASSWORD is not set — refusing every /admin request. '
      + 'Set it in the environment (see .env.example) and reload with --update-env.',
    );
    return res.status(503).json({ error: 'Admin tools are not configured on this server.' });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // Brute-force ceiling. Before this there was none at all: /api/admin/check
  // accepted unlimited guesses against the password below.
  //
  // EVERY admin request is counted, not only the failures, because rateLimit()
  // always increments and cannot be asked for a count without one — gating on
  // failures alone would let an attacker already over the limit straight through
  // the moment they guessed right. So the number is set high enough that real
  // admin use never reaches it (opening several tabs is a handful of requests)
  // and low enough that guessing is hopeless: 300/15min is ~29k/day against a
  // keyspace many orders of magnitude larger.
  //
  // On one line with literal values on purpose — that is the shape
  // server/lib/rateLimit.test.js parses, and it pins both numbers so a change to
  // a brute-force defence cannot pass as a tidy-up. It must also be awaited: an
  // unawaited call reads `allowed` off a Promise, which is always truthy, and the
  // limit silently does nothing. The same audit checks for that.
  const limit = await rateLimit({ key: `admin-auth:${ip}`, limit: 300, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  const provided = req.headers['x-admin-password'];
  if (typeof provided !== 'string' || !provided || !secretsMatch(provided, expected)) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
}

module.exports = { requireAdmin };
