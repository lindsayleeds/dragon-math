const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { and, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
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
    needs_handle: !!user.needs_handle,
  };
}

// Project a full user row into the snake_case shape consumed by safeUser /
// signToken. Centralized so all selects use the same alias map.
function userColumns() {
  return {
    id: schema.users.id,
    username: schema.users.username,
    current_node_id: schema.users.currentNodeId,
    avatar: schema.users.avatar,
    account_type: schema.users.accountType,
    email: schema.users.email,
    password_hash: schema.users.passwordHash,
    google_sub: schema.users.googleSub,
    email_verified: schema.users.emailVerified,
    weekly_report_enabled: schema.users.weeklyReportEnabled,
    adult_role: schema.users.adultRole,
    active_companion_id: schema.users.activeCompanionId,
    dragon_trial_completed: schema.users.dragonTrialCompleted,
    needs_handle: schema.users.needsHandle,
  };
}

// POST /api/auth/signin — finds the user by username, creating one if needed.
router.post('/signin', async (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw))
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });

  // username is citext, so this lookup is already case-insensitive.
  let [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(and(eq(schema.users.username, raw), eq(schema.users.accountType, 'child')))
    .limit(1);

  if (!user) {
    const [inserted] = await db
      .insert(schema.users)
      .values({ username: raw, accountType: 'child' })
      .returning({ id: schema.users.id });
    [user] = await db
      .select(userColumns())
      .from(schema.users)
      .where(eq(schema.users.id, inserted.id))
      .limit(1);
  }

  res.json({ token: signToken(user), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: safeUser(user) });
});

// GET /api/auth/avatars — list of avatars the client may offer to the user.
router.get('/avatars', requireAuth, (req, res) => {
  res.json({ avatars: ALLOWED_AVATARS });
});

// ---- Passwordless "login by URL" for kids ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/auth/child-login — { token } → exchange a child's permanent login
// token (the GUID in their /k/<token> URL) for a JWT. No password.
router.post('/child-login', async (req, res) => {
  const ip = req.ip || 'unknown';
  // Loose limit on guessing: a UUIDv4 is unguessable, but cap brute force.
  const limit = rateLimit({ key: `child-login:${ip}`, limit: 30, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!UUID_RE.test(token)) return res.status(400).json({ error: 'That link looks broken.' });

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(and(eq(schema.users.loginToken, token), eq(schema.users.accountType, 'child')))
    .limit(1);
  if (!user) return res.status(404).json({ error: "We couldn't find that adventurer. Ask your grown-up for a fresh link." });

  res.json({ token: signToken(user), user: safeUser(user) });
});

// POST /api/auth/child/handle — { username, avatar? } → the signed-in kid picks
// their own handle. Only allowed while needs_handle is true (first-time setup).
router.post('/child/handle', requireAuth, async (req, res) => {
  if (req.user.account_type !== 'child') {
    return res.status(403).json({ error: 'Only adventurers can set a handle.' });
  }

  const [current] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!current) return res.status(404).json({ error: 'User not found' });
  if (!current.needs_handle) {
    return res.status(409).json({ error: 'You already have a handle.' });
  }

  const raw = (req.body?.username || '').trim();
  if (!USERNAME_RE.test(raw)) {
    return res.status(400).json({ error: 'Handle must be 2–24 letters, numbers, _ or -' });
  }
  const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar : null;
  if (avatar !== null && !ALLOWED_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }

  // username is citext-unique; check first for a friendly message, then rely on
  // the constraint to settle any race.
  const taken = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.username, raw), sql`${schema.users.id} <> ${req.user.id}`))
    .limit(1);
  if (taken.length > 0) {
    return res.status(409).json({ error: 'That handle is already taken. Try another!' });
  }

  try {
    await db
      .update(schema.users)
      .set({ username: raw, needsHandle: false, ...(avatar ? { avatar } : {}) })
      .where(eq(schema.users.id, req.user.id));
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'That handle is already taken. Try another!' });
    }
    throw err;
  }

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  // Re-sign: the token embeds the username, which just changed.
  res.json({ token: signToken(user), user: safeUser(user) });
});

// ---- Parent accounts ----

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// POST /api/auth/parent/signup — { email, password } → parent account.
router.post('/parent/signup', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const ip = req.ip || 'unknown';
  const limit = rateLimit({ key: `signup:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many signup attempts. Try again later.' });

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  // Parents share the users table; username is set to email to satisfy the
  // NOT NULL UNIQUE constraint without changing the kid signin path (kids
  // can't type an '@' under USERNAME_RE so the namespaces don't collide).
  const [inserted] = await db
    .insert(schema.users)
    .values({
      username: email,
      accountType: 'parent',
      email,
      passwordHash: hash,
      emailVerified: false,
    })
    .returning({ id: schema.users.id });

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, inserted.id))
    .limit(1);
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
  const emailVerifiedClaim = !!payload?.email_verified;
  if (!sub || !email) return res.status(401).json({ error: 'Google profile is missing email.' });

  // Lookup priority: google_sub > email. Merge by attaching google_sub to an
  // existing email-only row when the user previously signed up with password.
  let [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.googleSub, sub))
    .limit(1);

  if (!user) {
    const [byEmail] = await db
      .select(userColumns())
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (byEmail) {
      await db
        .update(schema.users)
        .set({
          googleSub: sub,
          emailVerified: emailVerifiedClaim || byEmail.email_verified || false,
        })
        .where(eq(schema.users.id, byEmail.id));
      [user] = await db
        .select(userColumns())
        .from(schema.users)
        .where(eq(schema.users.id, byEmail.id))
        .limit(1);
    } else {
      const [inserted] = await db
        .insert(schema.users)
        .values({
          username: email,
          accountType: 'parent',
          email,
          googleSub: sub,
          emailVerified: emailVerifiedClaim,
        })
        .returning({ id: schema.users.id });
      [user] = await db
        .select(userColumns())
        .from(schema.users)
        .where(eq(schema.users.id, inserted.id))
        .limit(1);
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
router.post('/parent/login', async (req, res) => {
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

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(and(eq(schema.users.email, email), eq(schema.users.accountType, 'parent')))
    .limit(1);
  if (!user || !user.password_hash) return res.status(401).json(GENERIC);
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json(GENERIC);

  res.json({ token: signToken(user), user: safeUser(user) });
});

// PUT /api/auth/profile — update the signed-in user's profile (currently
// just avatar, but shaped to accept additional fields later).
router.put('/profile', requireAuth, async (req, res) => {
  const { avatar } = req.body || {};
  if (typeof avatar !== 'string' || !ALLOWED_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }
  await db
    .update(schema.users)
    .set({ avatar })
    .where(eq(schema.users.id, req.user.id));
  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  res.json({ user: safeUser(user) });
});

module.exports = router;
