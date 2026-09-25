const express = require('express');
const { sql } = require('drizzle-orm');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const playRecords = require('../lib/playRecords');
const { parseInput } = require('../lib/parseInput');
const { artFile, withArt } = require('../lib/dragonArt');
const { DragonArtParams } = require('../contracts/dragons');

const router = express.Router();

// GET /api/dragons/art/<id>.png — a dragon's PNG, public like the web's
// /dragon_pngs/ files (which nginx serves outside the API). The iOS app
// downloads it for a dragon it has no bundled art for (#143) and checks it
// against the catalog's art_sha256. Registered before requireAuth.
router.get('/art/:dragon_id', (req, res) => {
  const params = parseInput(DragonArtParams, req.params);
  if (!params.ok) return res.status(400).json({ error: params.error });
  const file = artFile(Number(params.data.dragon_id.replace(/\.png$/, '')));
  if (!file) return res.status(404).json({ error: 'No art for that dragon' });
  // A day: a keeper can replace a dragon's art, and the catalog hash moves then.
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('image/png');
  res.sendFile(file);
});

router.use(requireAuth);

// The awardable roster (dragon_catalog minus retired dragons) and the collect
// upsert live in ../lib/playRecords, shared with the iOS sync upload. The
// catalog routes list each dragon's art hash and size (../lib/dragonArt).
const activeCatalog = () => playRecords.activeCatalog(db);
const catalogWithArt = async () => withArt(await activeCatalog());

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
  const catalog = await catalogWithArt();
  res.json({ owned: result.rows, catalog, total_dragons: catalog.length });
});

// GET /api/dragons/catalog — the active dragon roster (id, name, rarity) that
// games draw from when awarding a dragon. Lets the client hand out only
// existing, non-retired dragons (including ones a keeper uploaded), and the app
// download the art of ones it doesn't bundle.
router.get('/catalog', async (req, res) => {
  const dragons = await catalogWithArt();
  res.json({ dragons, total: dragons.length });
});

// POST /api/dragons/collect { dragon_ids: [n, ...] }
// Records dragons earned in a game (battles, hatchery, spelling, …). Each id
// increments that dragon's `count` for the user, inserting the row on first
// catch. Returns:
//   - newly_added: dragon ids caught for the first time (celebrate "new!")
//   - results: per-dragon detail { dragon_id, added, total, is_new } so the
//     prize screen can show "NEW!" vs. "now ×N" without a second round-trip.
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

  // Duplicates within the batch collapse into one upsert per dragon ("caught
  // the same dragon twice in one game").
  const results = await db.transaction(tx => playRecords.addDragons(tx, userId, valid));
  const newlyAdded = results.filter(r => r.is_new).map(r => r.dragon_id);

  res.json({ ok: true, collected: valid.length, newly_added: newlyAdded, results });
});

module.exports = router;
