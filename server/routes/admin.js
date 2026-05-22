const express = require('express');
const bcrypt = require('bcryptjs');
const { and, asc, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');
const { buildAnalytics } = require('../lib/analytics');
const { localDayString } = require('./playtime');

const router = express.Router();
router.use(requireAdmin);

const MIN_GRID = 2;
const MAX_GRID = 10;
const MAX_RANGE = 999;
const MIN_AI_SECONDS = 0.5;
const MAX_AI_SECONDS = 60;
const VALID_OPS = ['add', 'sub', 'mul', 'div'];
// Allowed battle-grid shapes — must stay in sync with BATTLE_SHAPES in
// src/data/battleShapes.js. We keep the list server-side so admin PUTs can't
// inject an arbitrary shape_id that the client doesn't know how to render.
const VALID_SHAPE_IDS = new Set([
  'diamond', 'diamond-mini', 'hexagon', 'plus', 'plus-big', 'cross-x',
  'heart', 'flower', 'sun', 'moon-crescent', 'butterfly', 'bee-stripes',
  'tree', 'mushroom', 'leaf', 'cloud', 'mountain', 'wave', 'fish',
  'gem', 'crystal', 'honeycomb', 'star', 'crown', 'arrow-up', 'ring',
  'staircase', 'anchor-t', 'letter-h', 'zigzag-z',
  'triangle-up', 'triangle-down', 'letter-l', 'letter-t', 'bowtie',
  'chevron', 'kite-small', 'boat', 'acorn', 'berries',
]);
const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const BCRYPT_ROUNDS = 12;
const VALID_ADULT_ROLES = ['parent', 'teacher'];

// GET /api/admin/check — used by the admin UI to validate the password.
router.get('/check', (req, res) => {
  res.json({ ok: true });
});

// POST /api/admin/reset-progress — wipe the signed-in user's progress and
// practice history. Requires both admin password (router-level) and a valid
// user JWT (so we know whose data to clear).
router.post('/reset-progress', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;

  const deleted = await db.transaction(async (tx) => {
    const np = await tx
      .delete(schema.nodeProgress)
      .where(eq(schema.nodeProgress.userId, userId))
      .returning({ id: schema.nodeProgress.id });
    const pa = await tx
      .delete(schema.problemAttempts)
      .where(eq(schema.problemAttempts.userId, userId))
      .returning({ id: schema.problemAttempts.id });
    const wt = await tx
      .delete(schema.wrongTaps)
      .where(eq(schema.wrongTaps.userId, userId))
      .returning({ id: schema.wrongTaps.id });
    await tx
      .update(schema.users)
      .set({ currentNodeId: 1 })
      .where(eq(schema.users.id, userId));
    return {
      node_progress: np.length,
      problem_attempts: pa.length,
      wrong_taps: wt.length,
    };
  });

  res.json({ ok: true, username, deleted });
});

// POST /api/admin/users — create a new child account.
router.post('/users', async (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw)) {
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, raw))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

  const [inserted] = await db
    .insert(schema.users)
    .values({ username: raw })
    .returning({ id: schema.users.id });

  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      current_node_id: schema.users.currentNodeId,
      created_at: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, inserted.id))
    .limit(1);
  res.status(201).json({ user });
});

// POST /api/admin/users/:userId/promote — set a child's current map node.
// Also marks every node before the target as completed (3 stars) so the map
// shows the path-so-far filled in. Existing node_progress rows are preserved
// (we MAX the star count rather than overwrite).
router.post('/users/:userId/promote', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id must be a positive integer' });
  }
  const exists = await db
    .select({ node_id: schema.nodeConfig.nodeId })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  if (exists.length === 0) return res.status(400).json({ error: `Unknown node_id ${nodeId}` });

  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      current_node_id: schema.users.currentNodeId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ currentNodeId: nodeId })
      .where(eq(schema.users.id, userId));

    for (let n = 1; n < nodeId; n++) {
      await tx
        .insert(schema.nodeProgress)
        .values({ userId, nodeId: n, completed: true, stars: 3, completedAt: now })
        .onConflictDoUpdate({
          target: [schema.nodeProgress.userId, schema.nodeProgress.nodeId],
          set: {
            completed: true,
            stars: sql`GREATEST(COALESCE(${schema.nodeProgress.stars}, 0), excluded.stars)`,
            completedAt: sql`COALESCE(${schema.nodeProgress.completedAt}, excluded.completed_at)`,
          },
        });
    }
  });

  res.json({ ok: true, user_id: userId, username: user.username, current_node_id: nodeId });
});

// POST /api/admin/users/:userId/reset-trial — clear a child's one-time
// Dragon's Trial flag so they can retake the placement test. Does NOT roll
// back the previous trial's promotion (kid keeps any progress they earned).
router.post('/users/:userId/reset-trial', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const result = await db
    .update(schema.users)
    .set({ dragonTrialCompleted: false })
    .where(and(
      eq(schema.users.id, userId),
      eq(schema.users.accountType, 'child'),
    ))
    .returning({ id: schema.users.id });
  if (result.length === 0) {
    return res.status(404).json({ error: 'Child not found' });
  }
  res.json({ ok: true });
});

// GET /api/admin/users — list of users for analytics picker. The correlated
// subqueries match the prior SQLite shape; LEFT(minute, 10) replaces SQLite's
// substr(minute, 1, 10). Username is citext so ORDER BY username is
// case-insensitive by default.
router.get('/users', async (req, res) => {
  const todayStr = localDayString();
  const result = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           (SELECT COUNT(*)::int FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*)::int FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = ${todayStr}) AS minutes_today,
           (SELECT COUNT(*)::int FROM play_minutes WHERE user_id = u.id) AS minutes_total
    FROM users u
    ORDER BY u.username
  `);
  res.json({ users: result.rows });
});

// GET /api/admin/accounts — full roster of parents and children for the
// admin overview.
router.get('/accounts', async (req, res) => {
  const todayStr = localDayString();
  const parentsRes = await db.execute(sql`
    SELECT u.id, u.email, u.username, u.email_verified, u.weekly_report_enabled,
           u.adult_role, u.created_at,
           (SELECT COUNT(*)::int FROM parent_child_links WHERE parent_id = u.id) AS kid_count
    FROM users u
    WHERE u.account_type = 'parent'
    ORDER BY u.created_at DESC
  `);

  const childrenRes = await db.execute(sql`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           u.dragon_trial_completed,
           (SELECT COUNT(*)::int FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*)::int FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = ${todayStr}) AS minutes_today,
           (SELECT string_agg(COALESCE(p.email, p.username::text), ', ')
              FROM parent_child_links pcl
              JOIN users p ON p.id = pcl.parent_id
              WHERE pcl.child_id = u.id) AS parent_emails
    FROM users u
    WHERE u.account_type = 'child'
    ORDER BY u.username
  `);

  res.json({ parents: parentsRes.rows, children: childrenRes.rows });
});

// POST /api/admin/adults — hand-create a parent/guardian or teacher account.
router.post('/adults', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = typeof req.body?.role === 'string' ? req.body.role : '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  }
  if (!VALID_ADULT_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ADULT_ROLES.join(', ')}` });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const [inserted] = await db
    .insert(schema.users)
    .values({
      username: email,
      accountType: 'parent',
      email,
      passwordHash: hash,
      emailVerified: true,
      adultRole: role,
    })
    .returning({ id: schema.users.id });

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      email_verified: schema.users.emailVerified,
      weekly_report_enabled: schema.users.weeklyReportEnabled,
      adult_role: schema.users.adultRole,
      created_at: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, inserted.id))
    .limit(1);
  res.status(201).json({ user: { ...user, kid_count: 0 } });
});

// GET /api/admin/analytics/:userId — aggregated stats for one child.
router.get('/analytics/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const days = parseInt(req.query.days, 10);
  const result = await buildAnalytics(userId, { days });
  if (!result) return res.status(404).json({ error: 'User not found' });
  res.json(result);
});

// PUT /api/admin/node-config/:nodeId — update one or more difficulty fields
// for a node.
router.put('/node-config/:nodeId', async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'Invalid nodeId' });
  }

  // Build the Drizzle update map (camelCase keys) alongside the raw values for
  // the cross-field range check below.
  const updates = {};
  const raw = {};
  const body = req.body || {};

  if (body.grid_size !== undefined) {
    const v = parseInt(body.grid_size, 10);
    if (!Number.isInteger(v) || v < MIN_GRID || v > MAX_GRID) {
      return res.status(400).json({ error: `grid_size must be an integer in [${MIN_GRID}, ${MAX_GRID}]` });
    }
    updates.gridSize = v; raw.grid_size = v;
  }

  if (body.ops !== undefined) {
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      return res.status(400).json({ error: 'ops must be a non-empty array' });
    }
    if (!body.ops.every(op => VALID_OPS.includes(op))) {
      return res.status(400).json({ error: `ops must contain only: ${VALID_OPS.join(', ')}` });
    }
    updates.ops = JSON.stringify(Array.from(new Set(body.ops)));
    raw.ops = updates.ops;
  }

  if (body.range_min !== undefined) {
    const v = parseInt(body.range_min, 10);
    if (!Number.isInteger(v) || v < 0 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_min must be an integer in [0, ${MAX_RANGE}]` });
    }
    updates.rangeMin = v; raw.range_min = v;
  }

  if (body.range_max !== undefined) {
    const v = parseInt(body.range_max, 10);
    if (!Number.isInteger(v) || v < 1 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_max must be an integer in [1, ${MAX_RANGE}]` });
    }
    updates.rangeMax = v; raw.range_max = v;
  }

  if (body.ai_seconds !== undefined) {
    const v = Number(body.ai_seconds);
    if (!Number.isFinite(v) || v < MIN_AI_SECONDS || v > MAX_AI_SECONDS) {
      return res.status(400).json({ error: `ai_seconds must be a number in [${MIN_AI_SECONDS}, ${MAX_AI_SECONDS}]` });
    }
    updates.aiSeconds = v; raw.ai_seconds = v;
  }

  if (body.shape_id !== undefined) {
    if (typeof body.shape_id !== 'string' || !VALID_SHAPE_IDS.has(body.shape_id)) {
      return res.status(400).json({ error: 'shape_id must be a known battle-grid shape' });
    }
    updates.shapeId = body.shape_id; raw.shape_id = body.shape_id;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  // Cross-field check: range_min must be <= range_max. Fetch current row to
  // validate against unchanged values when only one side is being updated.
  const [current] = await db
    .select({
      range_min: schema.nodeConfig.rangeMin,
      range_max: schema.nodeConfig.rangeMax,
    })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);

  if (!current) {
    return res.status(404).json({ error: `Unknown nodeId ${nodeId}` });
  }
  const nextMin = raw.range_min ?? current.range_min ?? 1;
  const nextMax = raw.range_max ?? current.range_max ?? 10;
  if (nextMin > nextMax) {
    return res.status(400).json({ error: 'range_min must be <= range_max' });
  }

  await db
    .update(schema.nodeConfig)
    .set(updates)
    .where(eq(schema.nodeConfig.nodeId, nodeId));

  const [row] = await db
    .select({
      node_id: schema.nodeConfig.nodeId,
      grid_size: schema.nodeConfig.gridSize,
      ops: schema.nodeConfig.ops,
      range_min: schema.nodeConfig.rangeMin,
      range_max: schema.nodeConfig.rangeMax,
      ai_seconds: schema.nodeConfig.aiSeconds,
      shape_id: schema.nodeConfig.shapeId,
    })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, nodeId))
    .limit(1);
  res.json({ ...row, ops: JSON.parse(row.ops) });
});

module.exports = router;
