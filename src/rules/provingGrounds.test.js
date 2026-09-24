// The Proving Grounds rules with their rng and clock injected: a seed fixes the
// problem order, a fake clock fixes the time, so every case here is exact.
// golden/proving-grounds.json pins the same outputs for the Swift port.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';
import { buildProblemSet, awardMedal, createDrillTimer, elapsedSeconds } from './provingGrounds';

const seeded = seed => createSeededRandom(seed).next;

describe('buildProblemSet', () => {
  it('gives the same order for the same seed', () => {
    expect(buildProblemSet('mul', 7, seeded(42))).toEqual(buildProblemSet('mul', 7, seeded(42)));
    expect(buildProblemSet('mul', 7, seeded(42))).not.toEqual(buildProblemSet('mul', 7, seeded(43)));
  });

  it.each([0, 1, 27, 34, 42])('asks every fact twice, never back-to-back (seed %i)', seed => {
    for (const mode of ['mul', 'div']) {
      const set = buildProblemSet(mode, 6, seeded(seed));
      expect(set).toHaveLength(24);
      const counts = {};
      set.forEach((p, i) => {
        counts[p.prompt] = (counts[p.prompt] || 0) + 1;
        if (i > 0) expect(p.prompt).not.toBe(set[i - 1].prompt);
      });
      expect(Object.values(counts)).toEqual(Array(12).fill(2));
    }
  });

  it('builds division facts that divide exactly', () => {
    for (const p of buildProblemSet('div', 8, seeded(1))) {
      expect(p.a).toBe(p.answer * 8);
      expect(p.prompt).toBe(`${p.a} ÷ 8`);
    }
  });

  it('falls back to Math.random with no rng', () => {
    expect(buildProblemSet('mul', 3)).toHaveLength(24);
  });
});

describe('awardMedal boundaries', () => {
  it('treats each threshold as inclusive', () => {
    expect(awardMedal(45, 0)).toBe('gold');
    expect(awardMedal(45.001, 0)).toBe('silver');
    expect(awardMedal(60, 0)).toBe('silver');
    expect(awardMedal(60.001, 0)).toBe('bronze');
    expect(awardMedal(90, 1)).toBe('bronze');
    expect(awardMedal(90.001, 1)).toBeNull();
  });
});

describe('createDrillTimer', () => {
  it('reads elapsed seconds from the injected clock', () => {
    let ms = 5000;
    const timer = createDrillTimer(() => ms);
    expect(timer.start()).toBe(5000);
    ms = 50000;
    expect(timer.elapsedSec()).toBe(45);
    expect(awardMedal(timer.elapsedSec(), 0)).toBe('gold');
  });

  it('never reports negative time', () => {
    expect(elapsedSeconds(500, 400)).toBe(0);
  });
});
