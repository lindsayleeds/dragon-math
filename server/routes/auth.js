const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const BCRYPT_ROUNDS = 12;

// Curated set of avatars the player may choose from. Centralized here so the
// server can reject anything outside the list — prevents arbitrary strings
// (or hostile payloads) from being stored as a user's avatar.
const ALLOWED_AVATARS = [
  '⚔️', '🗡️', '🏹', '🛡️',
  '🧜‍♀️', '🧝‍♀️', '🧚', '👸',
  '🦄', '🐉', '🐲', '🐱',
  '🐰', '🦊', '🐺', '🦁',
  '🐯', '🐼', '🐨', '🦉',
];

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, account_type: user.account_type || 'child' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function safeUser(user) {
  const base = {
    id: user.id,
    username: user.username,
    account_type: user.account_type || 'child',
  };
  if (base.account_type === 'parent') {
    return { ...base, email: user.email, email_verified: !!user.email_verified };
  }
  return {
    ...base,
    current_node_id: user.current_node_id,
    avatar: user.avatar || '⚔️',
    dragon_trial_completed: !!user.dragon_trial_completed,
  };
}

// POST /api/auth/signin — finds the user by username, creating one if needed.
router.post('/signin', (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw))
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });

  let user = db
    .prepare("SELECT * FROM users WHERE username = ? AND account_type = 'child'")
    .get(raw);
  if (!user) {
    const result = db
      .prepare("INSERT INTO users (username, account_type) VALUES (?, 'child')")
      .run(raw);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }

  res.json({ token: signToken(user), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safeUser(user) });
});

// GET /api/auth/avatars — list of avatars the client may offer to the user.
router.get('/avatars', requireAuth, (req, res) => {
  res.json({ avatars: ALLOWED_AVATARS });
});

// ---- Parent accounts ----

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// POST /api/auth/parent/signup — { email, password } → parent account.
router.post('/parent/signup', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `signup:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many signup attempts. Try again later.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  // Parents share the users table; username is set to email to satisfy the
  // NOT NULL UNIQUE constraint without changing the kid signin path (kids
  // can't type an '@' under USERNAME_RE so the namespaces don't collide).
  const result = db.prepare(`
    INSERT INTO users (username, account_type, email, password_hash, email_verified)
    VALUES (?, 'parent', ?, ?, 0)
  `).run(email, email, hash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

// POST /api/auth/google — verify a Google ID token and sign in / sign up.
// If an account already exists with the same email, attaches google_sub to
// that row (account merge). All Google-auth accounts are 'parent'.
const { OAuth2Client } = require('google-auth-library');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

router.post('/google', async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }
  const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Could not verify Google sign-in.' });
  }

  const sub = payload?.sub;
  const email = (payload?.email || '').toLowerCase();
  const emailVerified = payload?.email_verified ? 1 : 0;
  if (!sub || !email) return res.status(401).json({ error: 'Google profile is missing email.' });

  // Lookup priority: google_sub > email. Merge by attaching google_sub to an
  // existing email-only row when the user previously signed up with password.
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (!user) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail) {
      db.prepare('UPDATE users SET google_sub = ?, email_verified = ? WHERE id = ?')
        .run(sub, emailVerified || byEmail.email_verified || 0, byEmail.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
    } else {
      const result = db.prepare(`
        INSERT INTO users (username, account_type, email, google_sub, email_verified)
        VALUES (?, 'parent', ?, ?, ?)
      `).run(email, email, sub, emailVerified);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }
  }

  if (user.account_type !== 'parent') {
    // Defensive: a future migration might let kids attach Google; today we
    // never auto-promote a kid to parent on a Google match.
    return res.status(409).json({ error: 'This account is not a grown-up account.' });
  }

  res.json({ token: signToken(user), user: safeUser(user) });
});

// POST /api/auth/parent/login — { email, password } → JWT.
router.post('/parent/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const ip = req.ip || 'unknown';
  const ipLimit = rateLimit({ key: `login-ip:${ip}`, limit: 20, windowMs: 15 * 60 * 1000 });
  const emailLimit = rateLimit({ key: `login-email:${email}`, limit: 8, windowMs: 15 * 60 * 1000 });
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }

  // Generic error for both "no such email" and "wrong password" so the
  // endpoint can't be used to enumerate accounts.
  const GENERIC = { error: 'Email or password is incorrect.' };
  if (!EMAIL_RE.test(email) || !password) return res.status(401).json(GENERIC);

  const user = db.prepare("SELECT * FROM users WHERE email = ? AND account_type = 'parent'").get(email);
  if (!user || !user.password_hash) return res.status(401).json(GENERIC);
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json(GENERIC);

  res.json({ token: signToken(user), user: safeUser(user) });
});

// PUT /api/auth/profile — update the signed-in user's profile (currently
// just avatar, but shaped to accept additional fields later).
router.put('/profile', requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  if (typeof avatar !== 'string' || !ALLOWED_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: safeUser(user) });
});

module.exports = router;
