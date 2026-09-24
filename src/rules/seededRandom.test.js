// The Swift port has to match this generator bit for bit, so the tests pin it
// to SplitMix64's published reference outputs rather than only to itself — a
// self-consistent but wrong generator would otherwise regenerate golden files
// that Swift could never agree with.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';

function take(fn, n) {
  return Array.from({ length: n }, fn);
}

describe('createSeededRandom', () => {
  it('matches the SplitMix64 reference sequence for seed 0', () => {
    const rng = createSeededRandom(0);
    expect(take(rng.nextUint64, 3)).toEqual([
      0xe220a8397b1dcdafn,
      0x6e789e6aa1b965f4n,
      0x06c45d188009454fn,
    ]);
  });

  it('produces the same sequence for the same seed', () => {
    const a = createSeededRandom(12345);
    const b = createSeededRandom(12345);
    expect(take(a.next, 50)).toEqual(take(b.next, 50));
  });

  it('produces different sequences for different seeds', () => {
    expect(take(createSeededRandom(1).next, 5)).not.toEqual(take(createSeededRandom(2).next, 5));
  });

  it('accepts a number, a BigInt, or a string for the same seed', () => {
    const expected = take(createSeededRandom(42).nextUint64, 4);
    expect(take(createSeededRandom(42n).nextUint64, 4)).toEqual(expected);
    expect(take(createSeededRandom('42').nextUint64, 4)).toEqual(expected);
  });

  it('wraps seeds to 64 bits', () => {
    expect(take(createSeededRandom(-1).nextUint64, 3))
      .toEqual(take(createSeededRandom(2n ** 64n - 1n).nextUint64, 3));
    expect(take(createSeededRandom(2n ** 64n).nextUint64, 3))
      .toEqual(take(createSeededRandom(0).nextUint64, 3));
  });

  it('rejects a seed a JS number cannot hold exactly', () => {
    expect(() => createSeededRandom(2 ** 53)).toThrow(RangeError);
    expect(() => createSeededRandom(0.5)).toThrow(RangeError);
  });

  it('keeps every output a 64-bit unsigned integer', () => {
    const rng = createSeededRandom(2n ** 64n - 1n);
    for (const x of take(rng.nextUint64, 200)) {
      expect(x >= 0n && x < 2n ** 64n).toBe(true);
    }
  });

  it('next() is the top 53 bits of the same draw, in [0, 1)', () => {
    const ints = createSeededRandom(7);
    const floats = createSeededRandom(7);
    for (let i = 0; i < 200; i++) {
      const f = floats.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect(f).toBe(Number(ints.nextUint64() >> 11n) / 2 ** 53);
    }
  });

  it('works unbound, as a drop-in for Math.random', () => {
    const { next } = createSeededRandom(99);
    const pick = Math.floor(next() * 10);
    expect(Number.isInteger(pick) && pick >= 0 && pick < 10).toBe(true);
  });
});
