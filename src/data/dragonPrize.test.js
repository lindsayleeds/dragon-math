// Prize draws take an injected rng so they repeat from a seed (the golden file
// golden/prize-draws.json pins the exact values for iOS; see src/rules/golden.js).
// These tests cover the contract around that: repeatability, the Math.random
// default the web still uses, and the edge cases the fixture records.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from '../rules/seededRandom.js';
import { DRAGON_PNG_COUNT } from './dragonRarity.js';
import { COUNT_WEIGHTS, drawDragonPrize, rollPrizeCount } from './dragonPrize.js';
import { DEFAULT_PRIZE_SETTINGS } from './ruleSettings.js';

const CATALOG = [
  { dragon_id: 1, rarity: 'common' },
  { dragon_id: 2, rarity: 'common' },
  { dragon_id: 3, rarity: 'rare' },
  { dragon_id: 4, rarity: 'mythic' },
];

const seeded = seed => createSeededRandom(seed).next;
const ids = rows => rows.map(d => d.dragon_id);

afterEach(() => vi.restoreAllMocks());

describe('drawDragonPrize', () => {
  it('repeats exactly for the same seed', () => {
    const a = ids(drawDragonPrize(CATALOG, 50, seeded(42)));
    const b = ids(drawDragonPrize(CATALOG, 50, seeded(42)));
    expect(a).toEqual(b);
    expect(ids(drawDragonPrize(CATALOG, 50, seeded(43)))).not.toEqual(a);
  });

  it('uses Math.random when no rng is given, two draws per dragon', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(ids(drawDragonPrize(CATALOG, 3))).toEqual([1, 1, 1]);
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('never draws a tier with no dragons', () => {
    const catalog = [{ dragon_id: 9, rarity: 'legendary' }];
    expect(ids(drawDragonPrize(catalog, 20, seeded(1)))).toEqual(Array(20).fill(9));
  });

  it('falls back to the legacy art range when the catalog is empty or missing', () => {
    for (const catalog of [null, []]) {
      const drawn = drawDragonPrize(catalog, 30, seeded(7));
      for (const d of drawn) {
        expect(d.rarity).toBe('common');
        expect(d.dragon_id).toBeGreaterThanOrEqual(1);
        expect(d.dragon_id).toBeLessThanOrEqual(DRAGON_PNG_COUNT);
      }
    }
  });

  it('honours a custom rarity table', () => {
    const settings = { ...DEFAULT_PRIZE_SETTINGS, rarityWeights: { common: 0, rare: 0, mythic: 1 } };
    const drawn = drawDragonPrize(CATALOG, 40, seeded(5), settings);
    expect(new Set(ids(drawn))).toEqual(new Set([4]));
  });

  it('returns nothing for a zero count', () => {
    expect(drawDragonPrize(CATALOG, 0, seeded(0))).toEqual([]);
  });
});

describe('rollPrizeCount', () => {
  it('repeats for the same seed and stays within 1–3', () => {
    for (const performance of Object.keys(COUNT_WEIGHTS)) {
      const a = seeded(99), b = seeded(99);
      const run = rng => Array.from({ length: 40 }, () => rollPrizeCount(performance, rng));
      const counts = run(a);
      expect(run(b)).toEqual(counts);
      expect(counts.every(n => n >= 1 && n <= 3)).toBe(true);
    }
  });

  it('honours custom count weights', () => {
    const settings = { ...DEFAULT_PRIZE_SETTINGS, countWeights: { ...COUNT_WEIGHTS, high: [[3, 1]] } };
    const rng = seeded(8);
    expect(Array.from({ length: 10 }, () => rollPrizeCount('high', rng, settings))).toEqual(Array(10).fill(3));
  });

  it('treats an unknown tier as normal', () => {
    const run = p => { const rng = seeded(3); return Array.from({ length: 40 }, () => rollPrizeCount(p, rng)); };
    expect(run('mystery')).toEqual(run('normal'));
  });
});
