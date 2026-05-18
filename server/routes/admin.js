const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');
const { buildDaySeries, toLocalIsoDay } = require('./playtime');

const router = express.Router();
router.use(requireAdmin);

const MIN_GRID = 2;
const MAX_GRID = 10;
const MAX_RANGE = 999;
const MIN_AI_SECONDS = 0.5;
const MAX_AI_SECONDS = 60;
const VALID_OPS = ['add', 'sub', 'mul'];
const USERNAME_RE = /^[A-Za-z0-9_-]{2,24}$/;

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

// GET /api/admin/analytics/:userId — aggregated stats for one child.
// Query params:
//   days=N    — only include attempts from the last N days (default: all time)
router.get('/analytics/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Optional time-window filter. Datetime() comparison is ISO-lexicographic safe.
  const days = parseInt(req.query.days, 10);
  const sinceClause = Number.isInteger(days) && days > 0
    ? `AND created_at >= datetime('now', '-${days} days')`
    : '';

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
      SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
      AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms,
      AVG(CASE WHEN outcome = 'ai'    THEN time_ms END)  AS avg_ai_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
  `).get(userId);

  const byOperator = db.prepare(`
    SELECT operator,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator
    ORDER BY operator
  `).all(userId);

  const byNode = db.prepare(`
    SELECT node_id,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY node_id
    ORDER BY node_id
  `).all(userId);

  // Hard problems: same (a, op, b) grouped, sorted by AI wins desc then avg child time desc.
  const hardProblems = db.prepare(`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*) AS total,
           SUM(CASE WHEN outcome = 'child' THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'    THEN 1 ELSE 0 END) AS ai_wins,
           AVG(CASE WHEN outcome = 'child' THEN time_ms END)  AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING total >= 2
    ORDER BY ai_wins DESC, avg_child_ms DESC NULLS LAST, total DESC
    LIMIT 25
  `).all(userId);

  // Fastest-recall problems (child won, lowest avg time, at least a few samples).
  const fastestProblems = db.prepare(`
    SELECT operator, operand_a, operand_b, answer,
           COUNT(*) AS child_wins,
           AVG(time_ms) AS avg_child_ms
    FROM problem_attempts
    WHERE user_id = ? AND outcome = 'child' ${sinceClause}
    GROUP BY operator, operand_a, operand_b, answer
    HAVING child_wins >= 2
    ORDER BY avg_child_ms ASC
    LIMIT 15
  `).all(userId);

  // Top wrong-tap confusions.
  const confusions = db.prepare(`
    SELECT operator, operand_a, operand_b, correct_answer, tapped_value,
           COUNT(*) AS n
    FROM wrong_taps
    WHERE user_id = ? ${sinceClause}
    GROUP BY operator, operand_a, operand_b, correct_answer, tapped_value
    ORDER BY n DESC
    LIMIT 20
  `).all(userId);

  const recentAttempts = db.prepare(`
    SELECT node_id, operand_a, operand_b, operator, answer, outcome, time_ms, created_at
    FROM problem_attempts
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all(userId);

  // Match-level summary: counts each *battle* (not each individual problem).
  // `matches` rows are filtered by `started_at` so a match that began inside
  // the window but ended after still counts — and matches with no end (e.g.
  // a crashed tab) show up as ended_at IS NULL alongside the explicit
  // 'incomplete' outcome.
  const matchSinceClause = Number.isInteger(days) && days > 0
    ? `AND started_at >= datetime('now', '-${days} days')`
    : '';

  const matchSummary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END) AS child_wins,
      SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END) AS ai_wins,
      SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END) AS incomplete
    FROM matches
    WHERE user_id = ? ${matchSinceClause}
  `).get(userId);

  const byNodeMatches = db.prepare(`
    SELECT node_id,
           COUNT(*) AS matches,
           SUM(CASE WHEN outcome = 'child'      THEN 1 ELSE 0 END) AS child_wins,
           SUM(CASE WHEN outcome = 'ai'         THEN 1 ELSE 0 END) AS ai_wins,
           SUM(CASE WHEN outcome = 'incomplete' OR outcome IS NULL THEN 1 ELSE 0 END) AS incomplete,
           AVG(player_score) AS avg_player_score,
           AVG(ai_score)     AS avg_ai_score
    FROM matches
    WHERE user_id = ? ${matchSinceClause}
    GROUP BY node_id
    ORDER BY node_id
  `).all(userId);

  // Daily playtime series. For "all time" we still cap at 30 days so the
  // chart stays readable. Days are local-time calendar days.
  const playDays = Number.isInteger(days) && days > 0 ? Math.min(days, 90) : 30;
  const playRows = db.prepare(`
    SELECT substr(minute, 1, 10) AS day, COUNT(*) AS minutes
    FROM play_minutes
    WHERE user_id = ?
      AND minute >= datetime('now', 'localtime', ?)
    GROUP BY day
    ORDER BY day DESC
  `).all(userId, `-${playDays - 1} days`);
  const playByDay = Object.fromEntries(playRows.map(r => [r.day, r.minutes]));
  const playMinutesByDay = buildDaySeries(playDays, playByDay);
  const todayKey = toLocalIsoDay(new Date());
  const minutesToday = playByDay[todayKey] || 0;
  const minutesWindow = playMinutesByDay.reduce((s, r) => s + r.minutes, 0);

  res.json({
    user,
    days: Number.isInteger(days) && days > 0 ? days : null,
    summary,
    byOperator,
    byNode,
    hardProblems,
    fastestProblems,
    confusions,
    recentAttempts,
    matches: matchSummary,
    byNodeMatches,
    playtime: {
      window_days: playDays,
      minutes_today: minutesToday,
      minutes_in_window: minutesWindow,
      by_day: playMinutesByDay,
    },
  });
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
    'SELECT node_id, grid_size, ops, range_min, range_max, ai_seconds FROM node_config WHERE node_id = ?'
  ).get(nodeId);
  res.json({
    node_id: row.node_id,
    grid_size: row.grid_size,
    ops: JSON.parse(row.ops),
    range_min: row.range_min,
    range_max: row.range_max,
    ai_seconds: row.ai_seconds,
  });
});

module.exports = router;
