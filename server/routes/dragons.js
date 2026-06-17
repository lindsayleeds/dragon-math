const express = require('express');
const { sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// The set of dragon ids a kid can currently be awarded — every dragon in the
// catalog that hasn't been retired. dragon_catalog is the source of truth for
// which dragons exist (seeded for the original art, extended on upload), so we
// read it rather than trusting a hardcoded count. Kept tiny and uncached: the
// catalog is a few hundred rows and these reads are infrequent.
async function activeCatalog() {
  const { rows } = await db.execute(sql`
    SELECT dragon_id, name, rarity
    FROM dragon_catalog
    WHERE NOT retired
    ORDER BY dragon_id
  `);
  return rows;
}

// GET /api/dragons — the signed-in child's collection. Each owned dragon comes
// back with its name and current rarity (LEFT JOIN to dragon_catalog;
// unclassified dragons default to 'common'). Also returns the active `catalog`
// (every non-retired dragon's id/name/rarity) so the Den can render the right
// slots — including uploaded dragons, and skipping retired ones — plus
// total_dragons for the "X / total collected" headline.
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const result = await db.execute(sql`
    SELECT ud.dragon_id,
           ud.count,
           ud.first_acquired_at,
           dc.name AS name,
           COALESCE(dc.rarity, 'common') AS rarity
    FROM user_dragons ud
    LEFT JOIN dragon_catalog dc ON dc.dragon_id = ud.dragon_id
    WHERE ud.user_id = ${userId}
    ORDER BY ud.dragon_id
  `);
  const catalog = await activeCatalog();
  res.json({ owned: result.rows, catalog, total_dragons: catalog.length });
});

// GET /api/dragons/catalog — the active dragon roster (id, name, rarity) that
// games draw from when awarding a dragon. Lets the client hand out only
// existing, non-retired dragons (including ones a keeper uploaded).
router.get('/catalog', async (req, res) => {
  const dragons = await activeCatalog();
  res.json({ dragons, total: dragons.length });
});

// POST /api/dragons/collect { dragon_ids: [n, ...] }
// Records dragons earned in a game (hatchery, etc.). Each id increments that
// dragon's `count` for the user, inserting the row on first catch. Returns the
// set of dragon ids that were newly added to the collection (first-ever catch),
// so the caller can celebrate "new!" dragons.
router.post('/collect', async (req, res) => {
  const userId = req.user.id;
  const ids = Array.isArray(req.body?.dragon_ids) ? req.body.dragon_ids : [];
  // Only award dragons that actually exist and aren't retired — guards against a
  // stale client handing out an id that's since been removed or hidden.
  const allowed = new Set((await activeCatalog()).map((d) => d.dragon_id));
  const valid = ids.map(Number).filter((n) => Number.isInteger(n) && allowed.has(n));
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
