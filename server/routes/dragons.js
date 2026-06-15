const express = require('express');
const { eq, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Number of dragon images available in public/dragon_pngs (1.png … N.png).
// Mirrors DRAGON_PNG_COUNT in src/data/dragonRarity.js — kept here so the
// server can reject out-of-range ids without trusting the client.
const DRAGON_PNG_COUNT = 253;

function validDragonId(n) {
  return Number.isInteger(n) && n >= 1 && n <= DRAGON_PNG_COUNT;
}

// GET /api/dragons — the signed-in child's collection. Each owned dragon comes
// back with its current rarity (LEFT JOIN to dragon_catalog; unclassified
// dragons default to 'common'). Also returns total_dragons so the UI can show
// "X / total collected".
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const result = await db.execute(sql`
    SELECT ud.dragon_id,
           ud.count,
           ud.first_acquired_at,
           COALESCE(dc.rarity, 'common') AS rarity
    FROM user_dragons ud
    LEFT JOIN dragon_catalog dc ON dc.dragon_id = ud.dragon_id
    WHERE ud.user_id = ${userId}
    ORDER BY ud.dragon_id
  `);
  res.json({ owned: result.rows, total_dragons: DRAGON_PNG_COUNT });
});

// POST /api/dragons/collect { dragon_ids: [n, ...] }
// Records dragons earned in a game (hatchery, etc.). Each id increments that
// dragon's `count` for the user, inserting the row on first catch. Returns the
// set of dragon ids that were newly added to the collection (first-ever catch),
// so the caller can celebrate "new!" dragons.
router.post('/collect', async (req, res) => {
  const userId = req.user.id;
  const ids = Array.isArray(req.body?.dragon_ids) ? req.body.dragon_ids : [];
  const valid = ids.map(Number).filter(validDragonId);
  if (valid.length === 0) {
    return res.status(400).json({ error: 'dragon_ids must be a non-empty array of valid dragon ids' });
  }

  // Collapse duplicates within the batch into per-id counts so a single upsert
  // covers "caught the same dragon twice in one game".
  const counts = new Map();
  for (const id of valid) counts.set(id, (counts.get(id) || 0) + 1);

  const newlyAdded = [];
  await db.transaction(async (tx) => {
    for (const [dragonId, n] of counts) {
      const inserted = await tx
        .insert(schema.userDragons)
        .values({ userId, dragonId, count: n })
        .onConflictDoUpdate({
          target: [schema.userDragons.userId, schema.userDragons.dragonId],
          set: { count: sql`${schema.userDragons.count} + ${n}` },
        })
        .returning({ count: schema.userDragons.count });
      // First-ever catch ⇒ the row's count now equals this batch's n.
      if (inserted[0]?.count === n) newlyAdded.push(dragonId);
    }
  });

  res.json({ ok: true, collected: valid.length, newly_added: newlyAdded });
});

module.exports = router;
