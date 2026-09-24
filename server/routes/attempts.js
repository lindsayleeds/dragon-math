const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  isValidAttempt,
  isValidWrongTap,
  attemptRow,
  wrongTapRow,
  insertAttempts,
} = require('../lib/playRecords');

const router = express.Router();
router.use(requireAuth);

// POST /api/attempts — batched logging of problem outcomes + wrong taps.
// Body: { attempts?: [...], wrongTaps?: [...] }
//   attempt:  { node_id, operand_a, operand_b, operator, answer, outcome, time_ms }
//   wrongTap: { node_id, operand_a, operand_b, operator, correct_answer, tapped_value, time_ms }
// The row shapes and the insert are shared with the iOS sync upload
// (server/lib/playRecords.js).
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const attempts  = Array.isArray(req.body?.attempts)  ? req.body.attempts  : [];
  const wrongTaps = Array.isArray(req.body?.wrongTaps) ? req.body.wrongTaps : [];

  const attemptRows = attempts.filter(isValidAttempt).map(a => attemptRow(userId, a));
  const wrongRows = wrongTaps.filter(isValidWrongTap).map(w => wrongTapRow(userId, w));

  await db.transaction(tx => insertAttempts(tx, attemptRows, wrongRows));

  res.json({ success: true, attempts: attempts.length, wrongTaps: wrongTaps.length });
});

module.exports = router;
