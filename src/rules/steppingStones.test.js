// The Stepping Stones rules with their rng injected: a seed fixes every hop's
// pads. golden/stepping-stones.json pins the same outputs for the Swift port.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';
import { CHOICES_PER_HOP, NUM_STONES, buildPath, distractorPool, generateHops, shuffle } from './steppingStones';

const seeded = seed => createSeededRandom(seed).next;

function counting(rng) {
  const wrapped = () => { wrapped.calls++; return rng(); };
  wrapped.calls = 0;
  return wrapped;
}

describe('generateHops', () => {
  it.each([2, 3, 7, 12])('asks for each multiple of %i in turn, once among four pads', base => {
    const hops = generateHops(base, seeded(1));
    expect(hops).toHaveLength(NUM_STONES);
    hops.forEach((hop, k) => {
      const target = base * (k + 1);
      expect(hop.target).toBe(target);
      expect(hop.choices).toHaveLength(CHOICES_PER_HOP);
      expect(hop.choices.filter(c => c.isCorrect)).toEqual([{ value: target, isCorrect: true }]);
      const values = hop.choices.map(c => c.value);
      expect(new Set(values).size).toBe(values.length);
      values.forEach(v => expect(v).toBeGreaterThan(0));
    });
  });

  it('never offers a multiple already crossed', () => {
    for (const base of [1, 2, 3]) {
      generateHops(base, seeded(42)).forEach((hop, k) => {
        hop.choices.filter(c => !c.isCorrect).forEach(c => {
          const crossed = c.value % base === 0 && c.value / base <= k;
          expect(crossed).toBe(false);
        });
      });
    }
  });

  it('offers only three pads for the 1× count, whose slips back are all crossed', () => {
    expect(distractorPool(1, 5)).toEqual([6, 7]);
    generateHops(1, seeded(3)).forEach(hop => expect(hop.choices).toHaveLength(3));
  });

  it('builds the pool in candidate order', () => {
    // target 21: 22, 20, 23, 19, 28, 29 — none crossed.
    expect(distractorPool(7, 3)).toEqual([22, 20, 23, 19, 28, 29]);
    // target 4 (base 2, hop 2): 5, 3, 6, [2 crossed], 6 (dup), 7.
    expect(distractorPool(2, 2)).toEqual([5, 3, 6, 7]);
  });

  it('draws pool.length - 1 then 3 per hop', () => {
    const rng = counting(seeded(9));
    generateHops(7, rng);
    const expected = Array.from({ length: NUM_STONES }, (_, k) => distractorPool(7, k + 1).length - 1 + 3)
      .reduce((a, b) => a + b, 0);
    expect(rng.calls).toBe(expected);
  });

  it('is repeatable per seed', () => {
    expect(generateHops(5, seeded(42))).toEqual(generateHops(5, seeded(42)));
    expect(generateHops(5, seeded(42))).not.toEqual(generateHops(5, seeded(43)));
  });

  it('falls back to Math.random with no rng', () => {
    expect(generateHops(4)).toHaveLength(NUM_STONES);
  });
});

describe('shuffle', () => {
  it('is Fisher-Yates from the end', () => {
    // j = floor(0 * (i + 1)) = 0 each step: [a,b,c,d] → swap(3,0), swap(2,0), swap(1,0).
    expect(shuffle(['a', 'b', 'c', 'd'], () => 0)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('buildPath', () => {
  it('zig-zags down the stream inside the banks', () => {
    const path = buildPath();
    expect(path).toHaveLength(NUM_STONES);
    expect(path[0]).toEqual({ x: 16, y: 10 });
    expect(path.at(-1)).toEqual({ x: 84, y: 88 });
    path.forEach((p, i) => { if (i) expect(p.y).toBeGreaterThan(path[i - 1].y); });
  });
});
