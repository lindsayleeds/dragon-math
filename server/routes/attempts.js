const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_OPS = new Set(['add', 'sub', 'mul']);
const VALID_OUTCOMES = new Set(['child', 'ai']);

// POST /api/attempts — batched logging of problem outcomes + wrong taps.
// Body: { attempts?: [...], wrongTaps?: [...] }
//   attempt:  { node_id, operand_a, operand_b, operator, answer, outcome, time_ms }
//   wrongTap: { node_id, operand_a, operand_b, operator, correct_answer, tapped_value, time_ms }
router.post('/', (req, res) => {
  const userId = req.user.id;
  const attempts  = Array.isArray(req.body?.attempts)  ? req.body.attempts  : [];
  const wrongTaps = Array.isArray(req.body?.wrongTaps) ? req.body.wrongTaps : [];

  const insertAttempt = db.prepare(`
    INSERT INTO problem_attempts
      (user_id, node_id, operand_a, operand_b, operator, answer, outcome, time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWrong = db.prepare(`
    INSERT INTO wrong_taps
      (user_id, node_id, operand_a, operand_b, operator, correct_answer, tapped_value, time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const a of attempts) {
      if (!isValidAttempt(a)) continue;
      insertAttempt.run(
        userId, a.node_id, a.operand_a, a.operand_b, a.operator,
        a.answer, a.outcome, intOrNull(a.time_ms),
      );
    }
    for (const w of wrongTaps) {
      if (!isValidWrongTap(w)) continue;
      insertWrong.run(
        userId, w.node_id, w.operand_a, w.operand_b, w.operator,
        w.correct_answer, w.tapped_value, intOrNull(w.time_ms),
      );
    }
  });
  tx();

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
