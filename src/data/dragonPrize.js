// Post-game dragon prizes. Every finished game hands the player 1–3 dragons,
// drawn from the active catalog and weighted by rarity so commons are the
// everyday reward and mythics are a rare thrill. Wins draw more/better than
// losses (see the `performance` tiers below). Shared by every game's end
// screen through <DragonPrizeReveal>.
import { DRAGON_PNG_COUNT } from './dragonRarity';

// Relative draw weights per rarity (weakest → strongest). Higher = more likely.
// Only rarities that actually have dragons in the catalog are ever picked.
const RARITY_WEIGHTS = {
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
const COUNT_WEIGHTS = {
  low: [[1, 70], [2, 25], [3, 5]],
  normal: [[1, 45], [2, 40], [3, 15]],
  high: [[1, 20], [2, 45], [3, 35]],
};

// Pick a value from [[value, weight], ...] proportional to weight.
function weightedPick(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// Number of dragons in this prize for the given performance tier.
export function rollPrizeCount(performance = 'normal') {
  return weightedPick(COUNT_WEIGHTS[performance] || COUNT_WEIGHTS.normal);
}

// Draw `count` dragons from the catalog, rarity-weighted. The same dragon can
// come up more than once in a single prize (that just means "+2" to its count).
// Returns catalog rows: { dragon_id, name, rarity }.
export function drawDragonPrize(catalog, count) {
  const pool = Array.isArray(catalog) && catalog.length ? catalog : fallbackCatalog();
  const byRarity = {};
  for (const d of pool) {
    const r = d.rarity || 'common';
    (byRarity[r] ||= []).push(d);
  }
  const rarityEntries = Object.keys(byRarity).map((r) => [r, RARITY_WEIGHTS[r] ?? 1]);

  const out = [];
  for (let i = 0; i < count; i++) {
    const rarity = weightedPick(rarityEntries);
    const group = byRarity[rarity];
    out.push(group[Math.floor(Math.random() * group.length)]);
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
