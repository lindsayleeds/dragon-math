const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { and, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth, requireParent, JWT_SECRET } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { checkHandle } = require('../lib/moderation');
const { effectivePlanForChild, lockedGames, compPlanForRole } = require('../lib/entitlements');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../lib/authEmails');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const BCRYPT_ROUNDS = 12;

// Single-use auth token lifetimes (password reset / email verification).
const RESET_TTL_MS = 60 * 60 * 1000;          // 1 hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;    // 24 hours

// Hash a raw token the way it's stored in auth_tokens.token_hash. Only the hash
// ever hits the database; the raw token lives solely in the email link.
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Mint a fresh single-use token of `kind` for a user, store its hash, and return
// the RAW token to hand to the caller (who emails it). Old unused tokens of the
// same kind are pre-expired so only the newest link works.
async function issueAuthToken(userId, kind, ttlMs) {
  await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(schema.authTokens.userId, userId),
      eq(schema.authTokens.kind, kind),
      sql`${schema.authTokens.usedAt} IS NULL`,
    ));
  const raw = crypto.randomBytes(32).toString('base64url');
  await db.insert(schema.authTokens).values({
    userId,
    kind,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

// Atomically redeem a raw token of `kind`: marks the matching unused, unexpired
// row used and returns its userId, or null if the token is unknown/expired/used.
// The guarded UPDATE...RETURNING makes redemption single-use even under a race.
async function consumeAuthToken(raw, kind) {
  if (typeof raw !== 'string' || !raw) return null;
  const [row] = await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(schema.authTokens.tokenHash, hashToken(raw)),
      eq(schema.authTokens.kind, kind),
      sql`${schema.authTokens.usedAt} IS NULL`,
      sql`${schema.authTokens.expiresAt} > now()`,
    ))
    .returning({ userId: schema.authTokens.userId });
  return row ? row.userId : null;
}

// Curated set of avatars the player may choose from. Centralized here so the
// server can reject anything outside the list — prevents arbitrary strings
// (or hostile payloads) from being stored as a user's avatar.
const ALLOWED_AVATARS = [
  '⚔️', '🗡️', '🏹', '/avatars/cleaned_up_dragon.png',
  '/avatars/avie_rain.png', '🧝‍♀️', '🧚', '👸',
  '🦄', '🐉', '🐲', '🐱',
  '🐰', '🦊', '🐺', '🦁',
  '🐯', '🐼', '🐨', '🦉',
];

// Font combos selectable from the Settings page; mirrors src/data/fontThemes.js.
const ALLOWED_FONTS = ['handwritten', 'bubbly', 'storybook', 'clean'];

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      account_type: user.account_type || 'child',
      adult_role: user.adult_role || 'parent',
    },
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
    return {
      ...base,
      email: user.email,
      email_verified: !!user.email_verified,
      adult_role: user.adult_role || 'parent',
      plan: user.plan || 'free',
    };
  }
  return {
    ...base,
    current_node_id: user.current_node_id,
    avatar: user.avatar || '⚔️',
    font: user.font || 'handwritten',
    dragon_trial_completed: !!user.dragon_trial_completed,
    needs_handle: !!user.needs_handle,
  };
}

// safeUser + monetization fields. Adults carry their own `plan` (already in
// safeUser). A child gets `effective_plan` (highest plan across their guardians)
// and an `entitlements` object the client uses to lock paid games. Async because
// a child's plan requires a guardian lookup.
async function shapeUser(user) {
  const shaped = safeUser(user);
  if (shaped.account_type === 'child') {
    const effectivePlan = await effectivePlanForChild(user.id);
    shaped.effective_plan = effectivePlan;
    shaped.entitlements = { games_locked: lockedGames(effectivePlan) };
  }
  return shaped;
}

// Project a full user row into the snake_case shape consumed by safeUser /
// signToken. Centralized so all selects use the same alias map.
function userColumns() {
  return {
    id: schema.users.id,
    username: schema.users.username,
    current_node_id: schema.users.currentNodeId,
    avatar: schema.users.avatar,
    font: schema.users.font,
    account_type: schema.users.accountType,
    email: schema.users.email,
    password_hash: schema.users.passwordHash,
    google_sub: schema.users.googleSub,
    email_verified: schema.users.emailVerified,
    weekly_report_enabled: schema.users.weeklyReportEnabled,
    adult_role: schema.users.adultRole,
    plan: schema.users.plan,
    active_companion_id: schema.users.activeCompanionId,
    dragon_trial_completed: schema.users.dragonTrialCompleted,
    needs_handle: schema.users.needsHandle,
  };
}

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: await shapeUser(user) });
});

// GET /api/auth/avatars — list of avatars the client may offer to the user.
router.get('/avatars', requireAuth, (req, res) => {
  res.json({ avatars: ALLOWED_AVATARS });
});

// ---- Passwordless "login by URL" ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/auth/child-login — { token } → exchange a permanent login token
// (the GUID in a /k/<token> URL) for a JWT. No password. Originally kid-only;
// now accepts any account type so parents/teachers can get a link too (used for
// testing — admins mint these). safeUser/signToken already shape the response
// by account_type, so a parent token yields a parent session.
router.post('/child-login', async (req, res) => {
  const ip = req.ip || 'unknown';
  // Loose limit on guessing: a UUIDv4 is unguessable, but cap brute force.
  const limit = await rateLimit({ key: `child-login:${ip}`, limit: 30, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!UUID_RE.test(token)) return res.status(400).json({ error: 'That link looks broken.' });

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.loginToken, token))
    .limit(1);
  if (!user) return res.status(404).json({ error: "We couldn't find that link. Ask for a fresh one." });

  res.json({ token: signToken(user), user: await shapeUser(user) });
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
  // Screen the kid-chosen handle for lewd/nasty content (no-op until an API key
  // is configured — see server/lib/moderation.js).
  const verdict = await checkHandle(raw);
  if (!verdict.allowed) {
    console.warn(`[moderation] blocked handle "${raw}": ${verdict.reason}`);
    return res.status(400).json({ error: 'Please choose a different handle.' });
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
  res.json({ token: signToken(user), user: await shapeUser(user) });
});

// ---- Parent accounts ----

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// Look up a "lifetime free" comp invite by its token. Returns the row only if it
// is still redeemable (never redeemed, never revoked); otherwise null.
async function findRedeemableCompInvite(token) {
  if (typeof token !== 'string' || !token) return null;
  const [row] = await db
    .select()
    .from(schema.compInvites)
    .where(and(
      eq(schema.compInvites.token, token),
      sql`${schema.compInvites.redeemedByUserId} IS NULL`,
      sql`${schema.compInvites.revokedAt} IS NULL`,
    ))
    .limit(1);
  return row || null;
}

// The plan a comp invite grants: its explicit override, else auto by role.
function compInvitePlan(invite) {
  return invite.plan || compPlanForRole(invite.role);
}

// GET /api/auth/comp-invite/:token — public: describe an invite so the signup
// page can show "you've been invited to a free account" without redeeming it.
// Returns 404 (as { valid:false }) for unknown/used/revoked tokens.
router.get('/comp-invite/:token', async (req, res) => {
  const invite = await findRedeemableCompInvite(req.params.token);
  if (!invite) return res.status(404).json({ valid: false });
  res.json({ valid: true, role: invite.role, plan: compInvitePlan(invite) });
});

// POST /api/auth/parent/signup — { email, password } → parent account.
router.post('/parent/signup', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  // Adults sign up as a parent/guardian (default) or a teacher. Both share the
  // 'parent' account_type; adult_role distinguishes them.
  let adultRole = req.body?.role === 'teacher' ? 'teacher' : 'parent';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const ip = req.ip || 'unknown';
  const limit = await rateLimit({ key: `signup:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many signup attempts. Try again later.' });

  // Optional "lifetime free" comp invite. When present, it dictates the role and
  // grants a permanent paid plan. Validate up-front; the atomic claim below
  // guards against a token being used twice.
  const compToken = typeof req.body?.compToken === 'string' ? req.body.compToken : '';
  let invite = null;
  if (compToken) {
    invite = await findRedeemableCompInvite(compToken);
    if (!invite) return res.status(400).json({ error: 'This invitation link is no longer valid.' });
    adultRole = invite.role; // the invite decides parent vs teacher
  }

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
  const comped = !!invite;
  const values = {
    username: email,
    accountType: 'parent',
    adultRole,
    email,
    passwordHash: hash,
    emailVerified: false,
  };
  if (comped) {
    values.comped = true;
    values.plan = compInvitePlan(invite);
    values.planStatus = 'comped';
  }

  let userId;
  try {
    userId = await db.transaction(async (tx) => {
      const [ins] = await tx
        .insert(schema.users)
        .values(values)
        .returning({ id: schema.users.id });
      if (invite) {
        // Atomically claim the invite; if another signup already took it the
        // guarded WHERE matches no rows and we abort the whole transaction.
        const claimed = await tx
          .update(schema.compInvites)
          .set({ redeemedByUserId: ins.id, redeemedAt: new Date() })
          .where(and(
            eq(schema.compInvites.id, invite.id),
            sql`${schema.compInvites.redeemedByUserId} IS NULL`,
            sql`${schema.compInvites.revokedAt} IS NULL`,
          ))
          .returning({ id: schema.compInvites.id });
        if (claimed.length === 0) throw new Error('COMP_INVITE_TAKEN');
      }
      return ins.id;
    });
  } catch (err) {
    if (err.message === 'COMP_INVITE_TAKEN') {
      return res.status(409).json({ error: 'This invitation link has already been used.' });
    }
    throw err;
  }

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  // Fire off an email-verification link. A mail failure must never fail signup —
  // the account is already created; the parent can resend from their dashboard.
  try {
    const verifyToken = await issueAuthToken(user.id, 'email_verify', VERIFY_TTL_MS);
    await sendVerificationEmail(user.email, verifyToken);
  } catch (err) {
    console.error('[auth] verification email failed for', user.email, err.message);
  }

  res.status(201).json({ token: signToken(user), user: await shapeUser(user) });
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

  res.json({ token: signToken(user), user: await shapeUser(user) });
});

// POST /api/auth/parent/login — { email, password } → JWT.
router.post('/parent/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const ip = req.ip || 'unknown';
  // Separate rows, so the two counters go out in one round trip instead of two
  // serial ones. Both are still counted whichever verdict ends up denying.
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit({ key: `login-ip:${ip}`, limit: 20, windowMs: 15 * 60 * 1000 }),
    rateLimit({ key: `login-email:${email}`, limit: 8, windowMs: 15 * 60 * 1000 }),
  ]);
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

  res.json({ token: signToken(user), user: await shapeUser(user) });
});

// PUT /api/auth/profile — update the signed-in user's profile (currently
// just avatar, but shaped to accept additional fields later).
router.put('/profile', requireAuth, async (req, res) => {
  const { avatar, font } = req.body || {};
  const updates = {};
  if (avatar !== undefined) {
    if (typeof avatar !== 'string' || !ALLOWED_AVATARS.includes(avatar)) {
      return res.status(400).json({ error: 'Invalid avatar' });
    }
    updates.avatar = avatar;
  }
  if (font !== undefined) {
    if (typeof font !== 'string' || !ALLOWED_FONTS.includes(font)) {
      return res.status(400).json({ error: 'Invalid font' });
    }
    updates.font = font;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, req.user.id));
  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  res.json({ user: await shapeUser(user) });
});

// ---- Password reset ----

// POST /api/auth/password/forgot — { email } → always 200 (never reveals whether
// an account exists). If a password account is found, email a reset link.
router.post('/password/forgot', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  const ip = req.ip || 'unknown';
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit({ key: `forgot-ip:${ip}`, limit: 20, windowMs: 15 * 60 * 1000 }),
    rateLimit({ key: `forgot-email:${email}`, limit: 5, windowMs: 15 * 60 * 1000 }),
  ]);

  // Uniform response so the endpoint can't be used to enumerate accounts or to
  // probe the rate limiter for a hit/miss signal.
  const GENERIC = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (!EMAIL_RE.test(email)) return res.json(GENERIC);
  if (!ipLimit.allowed || !emailLimit.allowed) return res.json(GENERIC);

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(and(eq(schema.users.email, email), eq(schema.users.accountType, 'parent')))
    .limit(1);

  // Only password accounts can reset. Google-only rows (no password_hash) have
  // nothing to reset; we still return the generic message.
  if (user && user.password_hash) {
    try {
      const token = await issueAuthToken(user.id, 'password_reset', RESET_TTL_MS);
      await sendPasswordResetEmail(user.email, token);
    } catch (err) {
      console.error('[auth] password-reset email failed for', email, err.message);
    }
  }
  res.json(GENERIC);
});

// POST /api/auth/password/reset — { token, password } → set a new password and
// sign the user in with a fresh JWT.
router.post('/password/reset', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const userId = await consumeAuthToken(token, 'password_reset');
  if (!userId) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  await db
    .update(schema.users)
    .set({ passwordHash: hash })
    .where(eq(schema.users.id, userId));

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  res.json({ token: signToken(user), user: await shapeUser(user) });
});

// ---- Email verification ----

// POST /api/auth/email/verify — { token } → mark the email verified. Public: the
// token is the proof. Idempotent-friendly for an already-used link.
router.post('/email/verify', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const userId = await consumeAuthToken(token, 'email_verify');
  if (!userId) {
    return res.status(400).json({ error: 'This confirmation link is invalid or has expired.' });
  }
  await db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, userId));
  res.json({ ok: true });
});

// POST /api/auth/email/resend — re-send the verification email to the signed-in
// parent's own address. No-op-200 if already verified.
router.post('/email/resend', requireAuth, requireParent, async (req, res) => {
  const ip = req.ip || 'unknown';
  const limit = await rateLimit({ key: `verify-resend:${req.user.id}:${ip}`, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many requests. Try again in a little while.' });

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user || !user.email) return res.status(404).json({ error: 'Account not found.' });
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  try {
    const token = await issueAuthToken(user.id, 'email_verify', VERIFY_TTL_MS);
    await sendVerificationEmail(user.email, token);
  } catch (err) {
    console.error('[auth] resend verification failed for', user.email, err.message);
    return res.status(502).json({ error: "We couldn't send the email right now. Please try again shortly." });
  }
  res.json({ ok: true });
});

// ---- Account management (signed-in parent) ----

// POST /api/auth/password/change — { currentPassword, newPassword }.
router.post('/password/change', requireAuth, requireParent, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.password_hash) {
    return res.status(400).json({ error: 'This account signs in with Google, so it has no password to change.' });
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }

  const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  await db
    .update(schema.users)
    .set({ passwordHash: hash })
    .where(eq(schema.users.id, user.id));
  res.json({ ok: true });
});

// POST /api/auth/email/change — { newEmail, currentPassword }. Updates the email,
// resets verification, and sends a fresh confirmation link to the new address.
router.post('/email/change', requireAuth, requireParent, async (req, res) => {
  const newEmail = normalizeEmail(req.body?.newEmail);
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.password_hash) {
    return res.status(400).json({ error: 'This account signs in with Google — change your email through your Google account.' });
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }
  if (newEmail === (user.email || '').toLowerCase()) {
    return res.status(400).json({ error: "That's already your email." });
  }

  // Email is also the parent's username (see signup) — both are unique columns.
  const taken = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.email, newEmail), sql`${schema.users.id} <> ${user.id}`))
    .limit(1);
  if (taken.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' });

  try {
    await db
      .update(schema.users)
      .set({ email: newEmail, username: newEmail, emailVerified: false })
      .where(eq(schema.users.id, user.id));
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    throw err;
  }

  try {
    const token = await issueAuthToken(user.id, 'email_verify', VERIFY_TTL_MS);
    await sendVerificationEmail(newEmail, token);
  } catch (err) {
    console.error('[auth] verification email failed for new address', newEmail, err.message);
  }

  const [updated] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  // Re-sign: the JWT embeds the username, which just changed to the new email.
  res.json({ token: signToken(updated), user: await shapeUser(updated) });
});

// DELETE /api/auth/account — { currentPassword }. Deletes the parent account.
// Children left with NO remaining guardian are stamped orphanedAt = now() and
// enter a 30-day grace period before a cron sweep (see server/lib/orphanCleanup.js).
router.delete('/account', requireAuth, requireParent, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';

  const [user] = await db
    .select(userColumns())
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  // Password accounts must confirm with their password. Google-only accounts
  // have no password to check — the JWT is sufficient proof of identity.
  if (user.password_hash && !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }

  const parentId = user.id;
  await db.transaction(async (tx) => {
    // Children this parent guards. Deleting the parent will cascade the link
    // rows, so capture the child ids first.
    const links = await tx
      .select({ childId: schema.parentChildLinks.childId })
      .from(schema.parentChildLinks)
      .where(eq(schema.parentChildLinks.parentId, parentId));
    const childIds = links.map(l => l.childId);

    // Delete the parent (cascades parent_child_links, classrooms/tribes they own,
    // their auth_tokens, etc. via FK onDelete).
    await tx.delete(schema.users).where(eq(schema.users.id, parentId));

    // Any of those children now left with zero guardians is orphaned. Stamp
    // orphanedAt so the grace-period sweep can pick them up; kids who still have
    // another guardian keep orphanedAt NULL.
    for (const childId of childIds) {
      const [stillLinked] = await tx
        .select({ parentId: schema.parentChildLinks.parentId })
        .from(schema.parentChildLinks)
        .where(eq(schema.parentChildLinks.childId, childId))
        .limit(1);
      if (!stillLinked) {
        await tx
          .update(schema.users)
          .set({ orphanedAt: new Date() })
          .where(eq(schema.users.id, childId));
      }
    }
  });

  res.json({ ok: true });
});

module.exports = router;
