// Seeds dragon_catalog with a fun, wholesome name for every dragon that has art
// in public/dragon_pngs/<id>.png. Names are an adjective + nature-noun pairing
// (e.g. "Sunny Pebblescale") drawn from a deterministic shuffle of the full
// adjective × noun product, so every dragon gets a UNIQUE name and re-running
// the script is reproducible. Only rows missing a name are written, so a
// keeper's hand-picked renames are never clobbered — pass --force to overwrite.
//
//   node scripts/seed-dragon-names.mjs          # fill in blanks only
//   node scripts/seed-dragon-names.mjs --force  # regenerate all names
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../server/db.js';
import { sql } from 'drizzle-orm';

const here = dirname(fileURLToPath(import.meta.url));
const pngDir = join(here, '..', 'public', 'dragon_pngs');
const force = process.argv.includes('--force');

const ids = readdirSync(pngDir)
  .map((f) => /^(\d+)\.png$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);

// Wholesome, nature-forward word pools (see CLAUDE.md theme rules — nothing
// dark/occult). 30 × 26 = 780 combos, comfortably more than the catalog needs.
const ADJECTIVES = [
  'Sunny', 'Ember', 'Misty', 'Clover', 'Maple', 'Pebble', 'Breezy', 'Sparkle',
  'Bramble', 'Honey', 'Frost', 'Coral', 'Dewy', 'Cinder', 'Ivy', 'Marigold',
  'Pippin', 'Tumble', 'Hazel', 'Glimmer', 'Bubbles', 'Cozy', 'Meadow', 'Pumpkin',
  'Twinkle', 'Willow', 'Nimbus', 'Saffron', 'Mossy', 'Snuggle',
];

const NOUNS = [
  'wingsworth', 'pebblescale', 'cloudtail', 'brightspark', 'thornberry',
  'meadowhop', 'sunpetal', 'riverstone', 'gleamheart', 'puddlejump',
  'fernwhisk', 'snugglewing', 'berryfluff', 'starnose', 'mossfoot',
  'glimmerscale', 'breezewhisk', 'honeydrop', 'acorntail', 'sundapple',
  'frostnibble', 'cloverpaw', 'wobblehorn', 'gigglefin', 'twigglewing', 'mooncuddle',
];

// mulberry32 — small deterministic PRNG (matches seed-dragon-rarity.mjs).
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build every adjective+noun combination, then shuffle with a fixed seed so the
// id → name mapping is stable across runs.
const combos = [];
for (const a of ADJECTIVES) for (const n of NOUNS) combos.push(`${a} ${n[0].toUpperCase()}${n.slice(1)}`);

const rand = mulberry32(0x4e414d45); // "NAME"
for (let i = combos.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [combos[i], combos[j]] = [combos[j], combos[i]];
}

if (ids.length > combos.length) {
  console.error(`Not enough unique names (${combos.length}) for ${ids.length} dragons — add more words.`);
  process.exit(1);
}

const named = ids.map((dragonId, i) => ({ dragonId, name: combos[i] }));

console.log(`Naming ${named.length} dragons${force ? ' (force: overwriting existing names)' : ' (only blanks)'}…`);

// Upsert one row per dragon. Without --force we only set the name when the row
// is new or its name is still NULL, so keeper edits survive.
for (const { dragonId, name } of named) {
  await db.execute(sql`
    INSERT INTO dragon_catalog (dragon_id, name)
    VALUES (${dragonId}, ${name})
    ON CONFLICT (dragon_id) DO UPDATE
      SET name = ${force ? sql`EXCLUDED.name` : sql`COALESCE(dragon_catalog.name, EXCLUDED.name)`}
  `);
}

console.log('Done. Sample:');
for (const { dragonId, name } of named.slice(0, 8)) console.log(`  #${dragonId} → ${name}`);

process.exit(0);
