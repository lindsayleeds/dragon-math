// Seeds dragon_catalog with rarity tiers across all dragon art in
// public/dragon_pngs/<id>.png. Tier sizes double back from the rarest:
//   mythic 4, legendary 8, very_rare 16, rare 32, uncommon 64, common = rest.
// `common` is the table default, so we only write the 124 non-common overrides.
// Ids are shuffled with a fixed seed so rare dragons are spread across the
// whole catalog (not clustered by id) and the result is reproducible.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../server/db.js';
import { sql } from 'drizzle-orm';

const here = dirname(fileURLToPath(import.meta.url));
const pngDir = join(here, '..', 'public', 'dragon_pngs');

const ids = readdirSync(pngDir)
  .map((f) => /^(\d+)\.png$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);

// mulberry32 — small deterministic PRNG so the shuffle is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x44524147); // "DRAG"
const shuffled = [...ids];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

// Rarest first; whatever's left over stays common (no row written).
const tiers = [
  ['mythic', 4],
  ['legendary', 8],
  ['very_rare', 16],
  ['rare', 32],
  ['uncommon', 64],
];

const assignments = [];
let cursor = 0;
for (const [rarity, n] of tiers) {
  for (let i = 0; i < n; i++) {
    assignments.push({ dragonId: shuffled[cursor++], rarity });
  }
}

console.log(`Total dragons: ${ids.length}`);
for (const [rarity, n] of tiers) console.log(`  ${rarity}: ${n}`);
console.log(`  common: ${ids.length - assignments.length} (default, no rows)`);

// Reset to a clean slate, then bulk-insert the overrides.
await db.execute(sql`DELETE FROM dragon_catalog`);

const values = sql.join(
  assignments.map((a) => sql`(${a.dragonId}, ${a.rarity})`),
  sql`, `,
);
await db.execute(sql`
  INSERT INTO dragon_catalog (dragon_id, rarity) VALUES ${values}
  ON CONFLICT (dragon_id) DO UPDATE SET rarity = EXCLUDED.rarity
`);

const check = await db.execute(
  sql`SELECT rarity, count(*)::int AS n FROM dragon_catalog GROUP BY rarity ORDER BY n`,
);
console.log('Catalog now:', check.rows || check);
process.exit(0);
