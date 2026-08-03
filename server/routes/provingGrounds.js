const express = require('express');
const { and, desc, eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { validateRun, normalizeLimit, MEDAL_RANK } = require('../lib/provingGroundsRuns');

const router = express.Router();
router.use(requireAuth);

// Rank a medal inside SQL, matching MEDAL_RANK in ../lib/provingGroundsRuns.
const medalRankSql = sql`CASE ${schema.provingGroundsRuns.medal} WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 ELSE 1 END`;

// A child's best medal per level, keyed `<mode>-<digit>` — the same shape the
// frontend keeps in localStorage, so it can be merged in directly.
async function bestMedalsFor(userId) {
  const res = await db.execute(sql`
    SELECT mode, digit, medal
    FROM (
      SELECT mode, digit, medal,
             ROW_NUMBER() OVER (
               PARTITION BY mode, digit
               ORDER BY CASE medal WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 ELSE 1 END DESC,
                        earned_at DESC
             ) AS rn
      FROM proving_grounds_runs
      WHERE user_id = ${userId}
    ) ranked
    WHERE rn = 1
  `);
  return Object.fromEntries(res.rows.map(r => [`${r.mode}-${r.digit}`, r.medal]));
}

// Most recent medals for one child, newest first. Shared by the child's own
// view and the parent drill-in so the two can't drift. Deliberately NOT windowed
// by the analytics `days` param: a medal is an event a grown-up wants the date
// of, not a rate to compare across a rolling window.
async function recentMedalsFor(userId, { limit } = {}) {
  return db
    .select({
      id: schema.provingGroundsRuns.id,
      mode: schema.provingGroundsRuns.mode,
      digit: schema.provingGroundsRuns.digit,
      medal: schema.provingGroundsRuns.medal,
      elapsed_ms: schema.provingGroundsRuns.elapsedMs,
      wrong_count: schema.provingGroundsRuns.wrongCount,
      earned_at: schema.provingGroundsRuns.earnedAt,
    })
    .from(schema.provingGroundsRuns)
    .where(eq(schema.provingGroundsRuns.userId, userId))
    .orderBy(desc(schema.provingGroundsRuns.earnedAt), desc(schema.provingGroundsRuns.id))
    .limit(normalizeLimit(limit));
}

// Was this the child's first medal at this level, or better than any before it?
// Read before the insert, so the new row can't count as its own predecessor.
async function isPersonalBest(userId, { mode, digit, medal }) {
  const [prior] = await db
    .select({ medal: schema.provingGroundsRuns.medal })
    .from(schema.provingGroundsRuns)
    .where(and(
      eq(schema.provingGroundsRuns.userId, userId),
      eq(schema.provingGroundsRuns.mode, mode),
      eq(schema.provingGroundsRuns.digit, digit),
    ))
    .orderBy(desc(medalRankSql))
    .limit(1);
  if (!prior) return true;
  return MEDAL_RANK[medal] > MEDAL_RANK[prior.medal];
}

// GET /api/proving-grounds/medals — the signed-in child's best medal per level.
// The page merges this into its localStorage map so a kid who switches devices
// still sees what they've earned.
router.get('/medals', async (req, res) => {
  const medals = await bestMedalsFor(req.user.id);
  res.json({ medals });
});

// GET /api/proving-grounds/runs — the signed-in child's own recent medals.
router.get('/runs', async (req, res) => {
  const medals = await recentMedalsFor(req.user.id, { limit: req.query.limit });
  res.json({ medals });
});

// POST /api/proving-grounds/runs — record one medal-winning run. Runs that earn
// no medal are never posted (see the schema comment); the drill's per-problem
// rows go to /api/attempts separately.
router.post('/runs', async (req, res) => {
  // A legitimate run takes at least ~45s, so this only ever catches a loop.
  const limit = await rateLimit({ key: `proving-run:${req.user.id}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return res.status(429).json({ error: 'Too many runs. Try again later.' });

  const validated = validateRun(req.body);
  if (typeof validated === 'string') return res.status(400).json({ error: validated });
  const { run } = validated;

  const isBest = await isPersonalBest(req.user.id, run);
  const [inserted] = await db
    .insert(schema.provingGroundsRuns)
    .values({
      userId: req.user.id,
      mode: run.mode,
      digit: run.digit,
      medal: run.medal,
      elapsedMs: run.elapsedMs,
      wrongCount: run.wrongCount,
    })
    .returning({
      id: schema.provingGroundsRuns.id,
      earned_at: schema.provingGroundsRuns.earnedAt,
    });

  res.status(201).json({ id: inserted.id, earned_at: inserted.earned_at, is_best: isBest });
});

module.exports = { router, bestMedalsFor, recentMedalsFor, isPersonalBest };
