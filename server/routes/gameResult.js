const express = require('express');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_OPS = new Set(['add', 'sub', 'mul', 'div']);

// POST /api/game-result - Save results from practice games (egg hatchery, etc.)
// Body: { operation, base_number, problems: [...], time_ms }
//   operation: 'add' | 'sub' | 'mul' | 'div'
//   base_number: 1-12
//   problems: [{ multiplier, outcome }] where outcome is 'child' | 'ai'
//   time_ms: total game duration in milliseconds
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const operation = req.body?.operation;
  const baseNumber = parseInt(req.body?.base_number, 10);
  const problems = Array.isArray(req.body?.problems) ? req.body.problems : [];
  const timeMs = parseInt(req.body?.time_ms, 10);

  // Validate operation
  if (!VALID_OPS.has(operation)) {
    return res.status(400).json({ error: 'Invalid operation' });
  }

  // Validate base_number
  if (!Number.isInteger(baseNumber) || baseNumber < 1 || baseNumber > 12) {
    return res.status(400).json({ error: 'base_number must be 1-12' });
  }

  // Validate and transform problems
  const validProblems = problems.filter(p => {
    const multiplier = parseInt(p.multiplier, 10);
    return Number.isInteger(multiplier) && multiplier >= 1 && multiplier <= 12
      && (p.outcome === 'child' || p.outcome === 'ai');
  });

  if (validProblems.length === 0) {
    return res.status(400).json({ error: 'No valid problems provided' });
  }

  // Calculate answer based on operation
  const getAnswer = (base, mult, op) => {
    switch (op) {
      case 'add': return base + mult;
      case 'sub': return Math.max(0, base - mult);
      case 'mul': return base * mult;
      case 'div': return Math.floor(base / mult);
      default: return 0;
    }
  };

  // Build attempt rows
  const attemptRows = validProblems.map(p => {
    const multiplier = parseInt(p.multiplier, 10);
    const answer = getAnswer(baseNumber, multiplier, operation);
    return {
      userId,
      nodeId: 0, // 0 = practice/learning mode (no story node)
      operandA: baseNumber,
      operandB: multiplier,
      operator: operation,
      answer: answer,
      outcome: p.outcome,
      timeMs: Number.isFinite(timeMs) ? Math.round(timeMs / validProblems.length) : null,
    };
  });

  try {
    console.log(`Saving ${attemptRows.length} problem attempts for user ${userId}, operation ${operation}, baseNumber ${baseNumber}`);
    await db.insert(schema.problemAttempts).values(attemptRows);
    console.log(`Successfully saved ${attemptRows.length} problem attempts`);
    res.json({ success: true, saved: validProblems.length });
  } catch (error) {
    console.error(`Error saving game result for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to save game result' });
  }
});

module.exports = router;
