const express = require('express');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// The four operations surfaced in the Learning Lair. Values match the
// `operator` column in problem_attempts.
const OPERATORS = ['add', 'sub', 'mul', 'div'];
const MIN_N = 1;
const MAX_N = 12;

// GET /api/mastery
// Per-operation, per-number (1-12) mastery for the logged-in kid. A problem
// "contains" number n when either operand equals n (3×3 counts toward 3 once).
// Accuracy is the share of attempts the child won (outcome 'child') vs. the AI.
router.get('/', async (req, res) => {
  const userId = req.user.id;

  // One row per distinct problem the kid has faced, with win/total counts.
  const rows = await db
    .select({
      operator: schema.problemAttempts.operator,
      operandA: schema.problemAttempts.operandA,
      operandB: schema.problemAttempts.operandB,
      total: sql`count(*)::int`,
      childWins: sql`sum(case when ${schema.problemAttempts.outcome} = 'child' then 1 else 0 end)::int`,
    })
    .from(schema.problemAttempts)
    .where(eq(schema.problemAttempts.userId, userId))
    .groupBy(
      schema.problemAttempts.operator,
      schema.problemAttempts.operandA,
      schema.problemAttempts.operandB,
    );

  // Seed a full 1-12 grid for every operation so the frontend always renders
  // all cells, even ones the kid hasn't practiced yet.
  const operations = {};
  for (const op of OPERATORS) {
    operations[op] = {};
    for (let n = MIN_N; n <= MAX_N; n++) {
      operations[op][n] = { total: 0, childWins: 0, accuracy: null };
    }
  }

  for (const r of rows) {
    const grid = operations[r.operator];
    if (!grid) continue; // ignore any operator outside the Lair's four
    // distinct in-range numbers this problem contains
    const nums = new Set(
      [r.operandA, r.operandB].filter(n => n >= MIN_N && n <= MAX_N)
    );
    for (const n of nums) {
      grid[n].total += r.total;
      grid[n].childWins += r.childWins;
    }
  }

  for (const op of OPERATORS) {
    for (let n = MIN_N; n <= MAX_N; n++) {
      const cell = operations[op][n];
      cell.accuracy = cell.total > 0 ? cell.childWins / cell.total : null;
    }
  }

  res.json({ operations });
});

module.exports = router;
