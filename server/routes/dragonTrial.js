const express = require('express');
const { eq } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { TRIAL_BANDS, TRIAL_OPS, nodeExists, recordTrialCompletion } = require('../lib/playRecords');

const router = express.Router();
router.use(requireAuth);

const VALID_BANDS = new Set(TRIAL_BANDS);

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

// POST /api/dragon-trial/complete — finalize a one-time placement test.
router.post('/complete', async (req, res) => {
  const userId = req.user.id;
  const [user] = await db
    .select({
      id: schema.users.id,
      account_type: schema.users.accountType,
      dragon_trial_completed: schema.users.dragonTrialCompleted,
      current_node_id: schema.users.currentNodeId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user || user.account_type !== 'child') {
    return res.status(403).json({ error: "Only child accounts can take the Dragon's Trial." });
  }
  if (user.dragon_trial_completed) {
    return res.status(409).json({ error: "Dragon's Trial has already been taken." });
  }

  const targetNodeId = parseInt(req.body?.target_node_id, 10);
  if (!Number.isInteger(targetNodeId) || targetNodeId < 1) {
    return res.status(400).json({ error: 'target_node_id must be a positive integer' });
  }
  if (!(await nodeExists(db, targetNodeId))) return res.status(400).json({ error: `Unknown target_node_id ${targetNodeId}` });

  const validated = validatePerOp(req.body?.per_op);
  if (typeof validated === 'string') {
    return res.status(400).json({ error: validated });
  }
  const perOp = validated.perOp;

  // The same write as the iOS `trial_completed` sync kind (server/lib/playRecords.js).
  await db.transaction(tx => recordTrialCompletion(tx, { userId, targetNodeId, perOp }));

  const [updated] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      account_type: schema.users.accountType,
      current_node_id: schema.users.currentNodeId,
      avatar: schema.users.avatar,
      dragon_trial_completed: schema.users.dragonTrialCompleted,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

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
