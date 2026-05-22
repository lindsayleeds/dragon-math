const express = require('express');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_BANDS = new Set(['fluent', 'capable', 'developing', 'emerging', 'not_ready']);
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

// Highest mastered op (informational; persisted for parent stats). Mastery is
// "fluent" — matches the frontend placement rule, which drops the kid at the
// start of the first un-mastered op in [add, sub, mul]. Division has no
// dedicated world yet, so it doesn't factor into placement.
function deriveHighestOp(perOp) {
  const placementOrder = ['add', 'sub', 'mul'];
  let highest = null;
  for (const op of placementOrder) {
    if (perOp[op].band === 'fluent') highest = op;
  }
  return highest;
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
  const exists = await db
    .select({ node_id: schema.nodeConfig.nodeId })
    .from(schema.nodeConfig)
    .where(eq(schema.nodeConfig.nodeId, targetNodeId))
    .limit(1);
  if (exists.length === 0) return res.status(400).json({ error: `Unknown target_node_id ${targetNodeId}` });

  const validated = validatePerOp(req.body?.per_op);
  if (typeof validated === 'string') {
    return res.status(400).json({ error: validated });
  }
  const perOp = validated.perOp;
  const highestOp = deriveHighestOp(perOp);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ currentNodeId: targetNodeId, dragonTrialCompleted: true })
      .where(eq(schema.users.id, userId));

    for (let n = 1; n < targetNodeId; n++) {
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

    await tx
      .insert(schema.dragonTrialResults)
      .values({
        userId,
        takenAt: now,
        targetNodeId,
        highestOp,
        addScore: perOp.add.score, addBand: perOp.add.band, addAsked: perOp.add.asked,
        subScore: perOp.sub.score, subBand: perOp.sub.band, subAsked: perOp.sub.asked,
        mulScore: perOp.mul.score, mulBand: perOp.mul.band, mulAsked: perOp.mul.asked,
        divScore: perOp.div.score, divBand: perOp.div.band, divAsked: perOp.div.asked,
      })
      .onConflictDoUpdate({
        target: schema.dragonTrialResults.userId,
        set: {
          takenAt: sql`excluded.taken_at`,
          targetNodeId: sql`excluded.target_node_id`,
          highestOp: sql`excluded.highest_op`,
          addScore: sql`excluded.add_score`, addBand: sql`excluded.add_band`, addAsked: sql`excluded.add_asked`,
          subScore: sql`excluded.sub_score`, subBand: sql`excluded.sub_band`, subAsked: sql`excluded.sub_asked`,
          mulScore: sql`excluded.mul_score`, mulBand: sql`excluded.mul_band`, mulAsked: sql`excluded.mul_asked`,
          divScore: sql`excluded.div_score`, divBand: sql`excluded.div_band`, divAsked: sql`excluded.div_asked`,
        },
      });
  });

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
