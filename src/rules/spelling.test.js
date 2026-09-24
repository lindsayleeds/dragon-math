import { describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from './seededRandom.js';
import { drawRound, letterTiles, shuffle } from './spelling.js';
import { gradeSource, listSource } from '../data/spellingWords.js';

const rngFor = seed => createSeededRandom(BigInt(seed)).next;

describe('spelling rules', () => {
  it('draws the same round from the same seed', () => {
    expect(drawRound(gradeSource(3), rngFor(7))).toEqual(drawRound(gradeSource(3), rngFor(7)));
  });

  it('shuffles the whole pool before cutting a grade round (n - 1 draws)', () => {
    const rng = vi.fn(rngFor(1));
    const words = drawRound(gradeSource(1), rng);
    expect(words).toHaveLength(10);
    expect(new Set(words).size).toBe(10);
    expect(rng).toHaveBeenCalledTimes(99);
  });

  it('plays a custom list in full', () => {
    const list = { id: 9, name: 'Mine', words: ['otter', 'maple', 'comet', 'river'] };
    expect([...drawRound(listSource(list), rngFor(2))].sort()).toEqual([...list.words].sort());
  });

  it('scrambles letters as tiles keyed by letter position', () => {
    const rng = vi.fn(rngFor(5));
    const tiles = letterTiles('dragon', rng);
    expect(rng).toHaveBeenCalledTimes(5);
    expect(tiles.map(t => t.id).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tiles.every(t => 'dragon'[t.id] === t.letter)).toBe(true);
  });

  it('defaults to Math.random, looked up per call', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    // j = 0 every step moves each tail element to the front in turn.
    expect(shuffle(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
