// Post-game dragon prizes. Every finished game hands the player 1–3 dragons,
// drawn from the active catalog and weighted by rarity so commons are the
// everyday reward and mythics are a rare thrill. Wins draw more/better than
// losses (see the `performance` tiers below). Shared by every game's end
// screen through <DragonPrizeReveal>.
//
// The iOS app draws prizes on the device (ADR 0004), so the Swift GameRules
// port must reproduce these draws exactly. Both functions therefore take an
// optional injected rng (`() => number` in [0, 1), defaulting to Math.random)
// and golden/prize-draws.json records seeded draws for Swift to match (ADR
// 0005, built in src/rules/golden.js). Anything that changes which numbers are
// consumed, or in what order, is a rule change: regenerate the golden files.
import { DRAGON_PNG_COUNT } from './dragonRarity.js';

// Relative draw weights per rarity (weakest → strongest). Higher = more likely.
// Only rarities that actually have dragons in the catalog are ever picked.
export const RARITY_WEIGHTS = {
  common: 100,
  uncommon: 45,
  rare: 18,
  very_rare: 6,
  legendary: 2,
  mythic: 0.6,
};

// How many dragons a prize contains, weighted by how the game went. Everyone
// gets at least one; a strong finish skews toward the full three.
// Entries are [count, weight].
export const COUNT_WEIGHTS = {
  low: [[1, 70], [2, 25], [3, 5]],
  normal: [[1, 45], [2, 40], [3, 15]],
  high: [[1, 20], [2, 45], [3, 35]],
};

// Pick a value from [[value, weight], ...] proportional to weight. Consumes
// exactly one rng draw. Walks the entries in order, taking the first whose
// running weight reaches the draw (`<= 0`, so a draw of exactly 0 takes the
// first entry even if its weight is 0).
function weightedPick(entries, rng) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// Number of dragons in this prize for the given performance tier.
// Unknown tiers count as 'normal'. Consumes one rng draw.
export function rollPrizeCount(performance = 'normal', rng = Math.random) {
  return weightedPick(COUNT_WEIGHTS[performance] || COUNT_WEIGHTS.normal, rng);
}

// Draw `count` dragons from the catalog, rarity-weighted. The same dragon can
// come up more than once in a single prize (that just means "+2" to its count).
// Returns catalog rows: { dragon_id, name, rarity }.
//
// Each dragon costs two rng draws: one picks the rarity (among only the tiers
// present in the catalog, in the order each tier first appears there), the
// second picks a dragon within that tier in catalog order. A missing rarity
// counts as 'common'; a rarity absent from `rarityWeights` weighs 1.
// `rarityWeights` defaults to RARITY_WEIGHTS and exists so the golden fixture
// can exercise other tables.
export function drawDragonPrize(catalog, count, rng = Math.random, rarityWeights = RARITY_WEIGHTS) {
  const pool = Array.isArray(catalog) && catalog.length ? catalog : fallbackCatalog();
  const byRarity = {};
  for (const d of pool) {
    const r = d.rarity || 'common';
    (byRarity[r] ||= []).push(d);
  }
  const rarityEntries = Object.keys(byRarity).map((r) => [r, rarityWeights[r] ?? 1]);

  const out = [];
  for (let i = 0; i < count; i++) {
    const rarity = weightedPick(rarityEntries, rng);
    const group = byRarity[rarity];
    out.push(group[Math.floor(rng() * group.length)]);
  }
  return out;
}

// Before the live catalog loads (or if it fails), fall back to the legacy
// contiguous art range, all treated as common — mirrors the hatchery.
function fallbackCatalog() {
  return Array.from({ length: DRAGON_PNG_COUNT }, (_, i) => ({
    dragon_id: i + 1,
    name: null,
    rarity: 'common',
  }));
}
