const express = require('express');
const { sql } = require('drizzle-orm');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isGameLocked, effectivePlanForUser } = require('../lib/entitlements');
const { LEADERBOARD_GAMES, GAME_SCORE_MAX, recordGameScore } = require('../lib/playRecords');

const router = express.Router();
router.use(requireAuth);

// Games allowed to write/read the leaderboard (the iOS app's `game_score` sync
// kind takes the same list).
const VALID_GAMES = new Set(LEADERBOARD_GAMES);

// GET /api/leaderboard/:game?limit=5 — the top scores of all time for one game.
// Returns each player's PERSONAL BEST (DISTINCT ON user) so a single hot streak
// can't fill every slot; highest score first, earliest achiever breaks ties.
// Flagged (implausible) scores are left off — see ../lib/plausibility.js.
router.get('/:game', async (req, res) => {
  const game = req.params.game;
  if (!VALID_GAMES.has(game)) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 50);

  try {
    const rows = await db.execute(sql`
      SELECT username, best_score AS score, achieved_at
      FROM (
        SELECT DISTINCT ON (gs.user_id)
               u.username,
               gs.score      AS best_score,
               gs.created_at AS achieved_at
        FROM game_scores gs
        JOIN users u ON u.id = gs.user_id
        WHERE gs.game = ${game} AND NOT gs.flagged
        ORDER BY gs.user_id, gs.score DESC, gs.created_at ASC
      ) ranked
      ORDER BY best_score DESC, achieved_at ASC
      LIMIT ${limit}
    `);
    res.json({ leaderboard: rows.rows });
  } catch (error) {
    console.error(`Error loading leaderboard for ${game}:`, error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// POST /api/leaderboard/:game — record a finished run's score. Body: { score }.
router.post('/:game', async (req, res) => {
  const game = req.params.game;
  if (!VALID_GAMES.has(game)) {
    return res.status(400).json({ error: 'Unknown game' });
  }
  const score = parseInt(req.body?.score, 10);
  if (!Number.isInteger(score) || score < 0 || score > GAME_SCORE_MAX) {
    return res.status(400).json({ error: 'score must be a non-negative integer' });
  }

  // Paid-game gate: a player on a free effective plan can't record scores for a
  // paywalled game (their guardian derives the plan for a child). The client also
  // locks the game UI; this is the authoritative backstop.
  const plan = await effectivePlanForUser(req.user);
  if (isGameLocked(game, plan)) {
    return res.status(402).json({ error: 'This game requires a Premium plan.', code: 'game_locked', game });
  }

  // A score no real game can reach is kept — it's the kid's — but flagged off
  // the leaderboard. The response doesn't say so.
  try {
    await db.transaction(tx => recordGameScore(tx, { userId: req.user.id, game, score }));
    res.json({ success: true });
  } catch (error) {
    console.error(`Error saving ${game} score for user ${req.user.id}:`, error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

module.exports = router;
