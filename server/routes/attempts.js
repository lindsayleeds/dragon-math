const express = require('express');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_OPS = new Set(['add', 'sub', 'mul']);
const VALID_OUTCOMES = new Set(['child', 'ai']);

// POST /api/attempts — batched logging of problem outcomes + wrong taps.
// Body: { attempts?: [...], wrongTaps?: [...] }
//   attempt:  { node_id, operand_a, operand_b, operator, answer, outcome, time_ms }
//   wrongTap: { node_id, operand_a, operand_b, operator, correct_answer, tapped_value, time_ms }
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const attempts  = Array.isArray(req.body?.attempts)  ? req.body.attempts  : [];
  const wrongTaps = Array.isArray(req.body?.wrongTaps) ? req.body.wrongTaps : [];

  const attemptRows = attempts.filter(isValidAttempt).map(a => ({
    userId,
    nodeId: a.node_id,
    operandA: a.operand_a,
    operandB: a.operand_b,
    operator: a.operator,
    answer: a.answer,
    outcome: a.outcome,
    timeMs: intOrNull(a.time_ms),
  }));
  const wrongRows = wrongTaps.filter(isValidWrongTap).map(w => ({
    userId,
    nodeId: w.node_id,
    operandA: w.operand_a,
    operandB: w.operand_b,
    operator: w.operator,
    correctAnswer: w.correct_answer,
    tappedValue: w.tapped_value,
    timeMs: intOrNull(w.time_ms),
  }));

  await db.transaction(async (tx) => {
    if (attemptRows.length) await tx.insert(schema.problemAttempts).values(attemptRows);
    if (wrongRows.length)   await tx.insert(schema.wrongTaps).values(wrongRows);
  });

  res.json({ success: true, attempts: attempts.length, wrongTaps: wrongTaps.length });
});

function isInt(x) { return Number.isInteger(x); }
function intOrNull(x) { return Number.isFinite(x) ? Math.round(x) : null; }

function isValidAttempt(a) {
  return a && isInt(a.node_id) && isInt(a.operand_a) && isInt(a.operand_b)
    && VALID_OPS.has(a.operator) && isInt(a.answer)
    && VALID_OUTCOMES.has(a.outcome);
}

function isValidWrongTap(w) {
  return w && isInt(w.node_id) && isInt(w.operand_a) && isInt(w.operand_b)
    && VALID_OPS.has(w.operator) && isInt(w.correct_answer) && isInt(w.tapped_value);
}

module.exports = router;
