const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');
const { buildAnalytics } = require('../lib/analytics');

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
router.post('/reset-progress', requireAuth, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;

  const wipe = db.transaction(() => {
    const np = db.prepare('DELETE FROM node_progress WHERE user_id = ?').run(userId);
    const pa = db.prepare('DELETE FROM problem_attempts WHERE user_id = ?').run(userId);
    const wt = db.prepare('DELETE FROM wrong_taps WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET current_node_id = 1 WHERE id = ?').run(userId);
    return {
      node_progress: np.changes,
      problem_attempts: pa.changes,
      wrong_taps: wt.changes,
    };
  });

  const deleted = wipe();
  res.json({ ok: true, username, deleted });
});

// POST /api/admin/users — create a new child account. Avatar defaults to the
// users-table default; the child can change it later via the profile screen.
router.post('/users', (req, res) => {
  const raw = (req.body?.username || '').trim();
  if (!raw) return res.status(400).json({ error: 'Username is required' });
  if (!USERNAME_RE.test(raw)) {
    return res.status(400).json({ error: 'Username must be 2–24 letters, numbers, _ or -' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(raw);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(raw);
  const user = db.prepare(
    'SELECT id, username, avatar, current_node_id, created_at FROM users WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.status(201).json({ user });
});

// POST /api/admin/users/:userId/promote — set a child's current map node.
// Also marks every node before the target as completed (3 stars) so the map
// shows the path-so-far filled in. Existing node_progress rows are preserved
// (we MAX the star count rather than overwrite).
router.post('/users/:userId/promote', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const nodeId = parseInt(req.body?.node_id, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'node_id must be a positive integer' });
  }
  const exists = db.prepare('SELECT node_id FROM node_config WHERE node_id = ?').get(nodeId);
  if (!exists) return res.status(400).json({ error: `Unknown node_id ${nodeId}` });
  const user = db.prepare('SELECT id, username, current_node_id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const upsert = db.prepare(`
    INSERT INTO node_progress (user_id, node_id, completed, stars, completed_at)
    VALUES (?, ?, 1, 3, ?)
    ON CONFLICT(user_id, node_id) DO UPDATE SET
      completed = 1,
      stars = MAX(IFNULL(node_progress.stars, 0), excluded.stars),
      completed_at = COALESCE(node_progress.completed_at, excluded.completed_at)
  `);
  const promote = db.transaction(() => {
    db.prepare('UPDATE users SET current_node_id = ? WHERE id = ?').run(nodeId, userId);
    const now = new Date().toISOString();
    for (let n = 1; n < nodeId; n++) {
      upsert.run(userId, n, now);
    }
  });
  promote();

  res.json({ ok: true, user_id: userId, username: user.username, current_node_id: nodeId });
});

// POST /api/admin/users/:userId/reset-trial — clear a child's one-time
// Dragon's Trial flag so they can retake the placement test. Does NOT roll
// back the previous trial's promotion (kid keeps any progress they earned).
router.post('/users/:userId/reset-trial', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const result = db.prepare(
    "UPDATE users SET dragon_trial_completed = 0 WHERE id = ? AND account_type = 'child'"
  ).run(userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Child not found' });
  }
  res.json({ ok: true });
});

// GET /api/admin/users — list of users for analytics picker.
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           (SELECT COUNT(*) FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*) FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = date('now', 'localtime')) AS minutes_today,
           (SELECT COUNT(*) FROM play_minutes WHERE user_id = u.id) AS minutes_total
    FROM users u
    ORDER BY u.username COLLATE NOCASE
  `).all();
  res.json({ users });
});

// GET /api/admin/accounts — full roster of parents and children for the
// admin overview. Parents include linked-child count + email-verified status;
// children include attempt totals and the emails of any linked parents.
router.get('/accounts', (req, res) => {
  const parents = db.prepare(`
    SELECT u.id, u.email, u.username, u.email_verified, u.weekly_report_enabled,
           u.adult_role, u.created_at,
           (SELECT COUNT(*) FROM parent_child_links WHERE parent_id = u.id) AS kid_count
    FROM users u
    WHERE u.account_type = 'parent'
    ORDER BY u.created_at DESC
  `).all();

  const children = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           u.dragon_trial_completed,
           (SELECT COUNT(*) FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at,
           (SELECT COUNT(*) FROM play_minutes
              WHERE user_id = u.id
                AND substr(minute, 1, 10) = date('now', 'localtime')) AS minutes_today,
           (SELECT GROUP_CONCAT(COALESCE(p.email, p.username), ', ')
              FROM parent_child_links pcl
              JOIN users p ON p.id = pcl.parent_id
              WHERE pcl.child_id = u.id) AS parent_emails
    FROM users u
    WHERE u.account_type = 'child'
    ORDER BY u.username COLLATE NOCASE
  `).all();

  res.json({ parents, children });
});

// POST /api/admin/adults — hand-create a parent/guardian or teacher account.
// Body: { email, password, role }. Role must be 'parent' or 'teacher'. Mirrors
// the public parent-signup flow (account_type='parent', username=email) but is
// admin-gated, sets email_verified=1, and stores the adult_role sub-type.
router.post('/adults', (req, res) => {
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const result = db.prepare(`
    INSERT INTO users (username, account_type, email, password_hash, email_verified, adult_role)
    VALUES (?, 'parent', ?, ?, 1, ?)
  `).run(email, email, hash, role);

  const user = db.prepare(`
    SELECT id, email, username, email_verified, weekly_report_enabled, adult_role, created_at
    FROM users WHERE id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ user: { ...user, kid_count: 0 } });
});

// GET /api/admin/analytics/:userId — aggregated stats for one child.
// Query params:
//   days=N    — only include attempts from the last N days (default: all time)
router.get('/analytics/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const days = parseInt(req.query.days, 10);
  const result = buildAnalytics(userId, { days });
  if (!result) return res.status(404).json({ error: 'User not found' });
  res.json(result);
});

// PUT /api/admin/node-config/:nodeId — update one or more difficulty fields
// for a node. Body may include any subset of: grid_size, ops, range_min,
// range_max, ai_seconds. Validates each field independently.
router.put('/node-config/:nodeId', (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);
  if (!Number.isInteger(nodeId) || nodeId < 1) {
    return res.status(400).json({ error: 'Invalid nodeId' });
  }

  const updates = {};
  const body = req.body || {};

  if (body.grid_size !== undefined) {
    const v = parseInt(body.grid_size, 10);
    if (!Number.isInteger(v) || v < MIN_GRID || v > MAX_GRID) {
      return res.status(400).json({ error: `grid_size must be an integer in [${MIN_GRID}, ${MAX_GRID}]` });
    }
    updates.grid_size = v;
  }

  if (body.ops !== undefined) {
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      return res.status(400).json({ error: 'ops must be a non-empty array' });
    }
    if (!body.ops.every(op => VALID_OPS.includes(op))) {
      return res.status(400).json({ error: `ops must contain only: ${VALID_OPS.join(', ')}` });
    }
    updates.ops = JSON.stringify(Array.from(new Set(body.ops)));
  }

  if (body.range_min !== undefined) {
    const v = parseInt(body.range_min, 10);
    if (!Number.isInteger(v) || v < 0 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_min must be an integer in [0, ${MAX_RANGE}]` });
    }
    updates.range_min = v;
  }

  if (body.range_max !== undefined) {
    const v = parseInt(body.range_max, 10);
    if (!Number.isInteger(v) || v < 1 || v > MAX_RANGE) {
      return res.status(400).json({ error: `range_max must be an integer in [1, ${MAX_RANGE}]` });
    }
    updates.range_max = v;
  }

  if (body.ai_seconds !== undefined) {
    const v = Number(body.ai_seconds);
    if (!Number.isFinite(v) || v < MIN_AI_SECONDS || v > MAX_AI_SECONDS) {
      return res.status(400).json({ error: `ai_seconds must be a number in [${MIN_AI_SECONDS}, ${MAX_AI_SECONDS}]` });
    }
    updates.ai_seconds = v;
  }

  if (body.shape_id !== undefined) {
    if (typeof body.shape_id !== 'string' || !VALID_SHAPE_IDS.has(body.shape_id)) {
      return res.status(400).json({ error: 'shape_id must be a known battle-grid shape' });
    }
    updates.shape_id = body.shape_id;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  // Cross-field check: range_min must be <= range_max. Fetch current row to
  // validate against unchanged values when only one side is being updated.
  const current = db.prepare(
    'SELECT range_min, range_max FROM node_config WHERE node_id = ?'
  ).get(nodeId);
  const nextMin = updates.range_min ?? current?.range_min ?? 1;
  const nextMax = updates.range_max ?? current?.range_max ?? 10;
  if (nextMin > nextMax) {
    return res.status(400).json({ error: 'range_min must be <= range_max' });
  }

  // Update only — rows are seeded in db.js for every valid node id, so we
  // never need to insert here. (Upsert would trip grid_size's NOT NULL when
  // the patch omits grid_size for a non-existent row.)
  if (!current) {
    return res.status(404).json({ error: `Unknown nodeId ${nodeId}` });
  }
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(
    `UPDATE node_config SET ${setClause} WHERE node_id = ?`
  ).run(...keys.map(k => updates[k]), nodeId);

  const row = db.prepare(
    'SELECT node_id, grid_size, ops, range_min, range_max, ai_seconds, shape_id FROM node_config WHERE node_id = ?'
  ).get(nodeId);
  res.json({
    node_id: row.node_id,
    grid_size: row.grid_size,
    ops: JSON.parse(row.ops),
    range_min: row.range_min,
    range_max: row.range_max,
    ai_seconds: row.ai_seconds,
    shape_id: row.shape_id,
  });
});

module.exports = router;
