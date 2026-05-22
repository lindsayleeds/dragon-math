const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_BANDS = new Set(['fluent', 'capable', 'developing', 'not_ready']);
const TRIAL_OPS = ['add', 'sub', 'mul', 'div'];

// Returns a normalized per-op row, or a string error message.
function validatePerOp(perOp) {
  if (!perOp || typeof perOp !== 'object') return 'per_op is required';
  const out = {};
  for (const op of TRIAL_OPS) {
    const r = perOp[op];
    if (!r || typeof r !== 'object') return `per_op.${op} is required`;
    const score = Number(r.score);
    if (!Number.isFinite(score) || score < 0 || score > 1000) {
      return `per_op.${op}.score must be 0-1000`;
    }
    if (!VALID_BANDS.has(r.band)) return `per_op.${op}.band is invalid`;
    const asked = Number(r.problemsAsked);
    if (!Number.isInteger(asked) || asked < 0) {
      return `per_op.${op}.problemsAsked must be a non-negative integer`;
    }
    out[op] = { score: Math.round(score), band: r.band, asked };
  }
  return { perOp: out };
}

// Highest placement op (informational division, see TRIAL.md). Mirrors the
// frontend logic so the persisted highest_op stays consistent if the client
// is replayed or audited.
function deriveHighestOp(perOp) {
  const placementOrder = ['add', 'sub', 'mul'];
  const passing = new Set(['fluent', 'capable']);
  let highest = null;
  for (const op of placementOrder) {
    if (passing.has(perOp[op].band)) highest = op;
  }
  return highest;
}

// POST /api/dragon-trial/complete — finalize a one-time placement test.
// Body: {
//   target_node_id,
//   per_op: {
//     add: { score: 0-1000, band: 'fluent'|'capable'|'developing'|'not_ready', problemsAsked },
//     sub: {...}, mul: {...}, div: {...}
//   }
// }
// - Sets dragon_trial_completed = 1 (refuses if already 1 — parent reset clears it).
// - Promotes the player to target_node_id, marking nodes 1..(target-1) complete.
// - Upserts a `dragon_trial_results` row so retakes overwrite the prior summary.
router.post('/complete', (req, res) => {
  const userId = req.user.id;
  const user = db.prepare(
    "SELECT id, account_type, dragon_trial_completed, current_node_id FROM users WHERE id = ?"
  ).get(userId);
  if (!user || user.account_type !== 'child') {
    return res.status(403).json({ error: 'Only child accounts can take the Dragon\'s Trial.' });
  }
  if (user.dragon_trial_completed) {
    return res.status(409).json({ error: 'Dragon\'s Trial has already been taken.' });
  }

  const targetNodeId = parseInt(req.body?.target_node_id, 10);
  if (!Number.isInteger(targetNodeId) || targetNodeId < 1) {
    return res.status(400).json({ error: 'target_node_id must be a positive integer' });
  }
  const exists = db.prepare('SELECT node_id FROM node_config WHERE node_id = ?').get(targetNodeId);
  if (!exists) return res.status(400).json({ error: `Unknown target_node_id ${targetNodeId}` });

  const validated = validatePerOp(req.body?.per_op);
  if (typeof validated === 'string') {
    return res.status(400).json({ error: validated });
  }
  const perOp = validated.perOp;
  const highestOp = deriveHighestOp(perOp);

  const upsertProgress = db.prepare(`
    INSERT INTO node_progress (user_id, node_id, completed, stars, completed_at)
    VALUES (?, ?, 1, 3, ?)
    ON CONFLICT(user_id, node_id) DO UPDATE SET
      completed = 1,
      stars = MAX(IFNULL(node_progress.stars, 0), excluded.stars),
      completed_at = COALESCE(node_progress.completed_at, excluded.completed_at)
  `);
  const upsertResults = db.prepare(`
    INSERT INTO dragon_trial_results (
      user_id, taken_at, target_node_id, highest_op,
      add_score, add_band, add_asked,
      sub_score, sub_band, sub_asked,
      mul_score, mul_band, mul_asked,
      div_score, div_band, div_asked
    ) VALUES (
      @user_id, @taken_at, @target_node_id, @highest_op,
      @add_score, @add_band, @add_asked,
      @sub_score, @sub_band, @sub_asked,
      @mul_score, @mul_band, @mul_asked,
      @div_score, @div_band, @div_asked
    )
    ON CONFLICT(user_id) DO UPDATE SET
      taken_at       = excluded.taken_at,
      target_node_id = excluded.target_node_id,
      highest_op     = excluded.highest_op,
      add_score = excluded.add_score, add_band = excluded.add_band, add_asked = excluded.add_asked,
      sub_score = excluded.sub_score, sub_band = excluded.sub_band, sub_asked = excluded.sub_asked,
      mul_score = excluded.mul_score, mul_band = excluded.mul_band, mul_asked = excluded.mul_asked,
      div_score = excluded.div_score, div_band = excluded.div_band, div_asked = excluded.div_asked
  `);

  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET current_node_id = ?, dragon_trial_completed = 1 WHERE id = ?')
      .run(targetNodeId, userId);
    const now = new Date().toISOString();
    for (let n = 1; n < targetNodeId; n++) upsertProgress.run(userId, n, now);
    upsertResults.run({
      user_id: userId,
      taken_at: now,
      target_node_id: targetNodeId,
      highest_op: highestOp,
      add_score: perOp.add.score, add_band: perOp.add.band, add_asked: perOp.add.asked,
      sub_score: perOp.sub.score, sub_band: perOp.sub.band, sub_asked: perOp.sub.asked,
      mul_score: perOp.mul.score, mul_band: perOp.mul.band, mul_asked: perOp.mul.asked,
      div_score: perOp.div.score, div_band: perOp.div.band, div_asked: perOp.div.asked,
    });
  });
  apply();

  const updated = db.prepare(
    'SELECT id, username, account_type, current_node_id, avatar, dragon_trial_completed FROM users WHERE id = ?'
  ).get(userId);
  res.json({
    ok: true,
    user: {
      id: updated.id,
      username: updated.username,
      account_type: updated.account_type || 'child',
      current_node_id: updated.current_node_id,
      avatar: updated.avatar || '⚔️',
      dragon_trial_completed: !!updated.dragon_trial_completed,
    },
  });
});

module.exports = router;
