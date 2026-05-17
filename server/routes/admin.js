const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/admin');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

const MIN_GRID = 2;
const MAX_GRID = 10;
const MAX_RANGE = 999;
const MIN_AI_SECONDS = 0.5;
const MAX_AI_SECONDS = 60;
const VALID_OPS = ['add', 'sub', 'mul'];

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

// GET /api/admin/users — list of users for analytics picker.
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.current_node_id, u.created_at,
           (SELECT COUNT(*) FROM problem_attempts WHERE user_id = u.id) AS attempt_count,
           (SELECT MAX(created_at) FROM problem_attempts WHERE user_id = u.id) AS last_attempt_at
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
