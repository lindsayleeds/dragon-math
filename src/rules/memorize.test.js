import { describe, expect, it, vi } from 'vitest';
import { createSeededRandom } from './seededRandom.js';
import { hiddenWordIndexes, passageWords, practiceTiles } from './memorize.js';

const rngFor = seed => createSeededRandom(BigInt(seed)).next;
const words = passageWords('The Lord is my shepherd; I shall not want.');
const hidden = hiddenWordIndexes(words, 0);

describe('memorize practice tiles', () => {
  it('easy shuffles only the hidden words, ids indexing the hidden list', () => {
    const rng = vi.fn(rngFor(3));
    const tiles = practiceTiles('easy', words, hidden, rng);
    expect(rng).toHaveBeenCalledTimes(hidden.length - 1);
    expect(tiles.map(t => t.id).sort()).toEqual(hidden.map((_, i) => i));
    expect(tiles.every(t => t.word === words[hidden[t.id]])).toBe(true);
  });

  it('medium shuffles every word', () => {
    const rng = vi.fn(rngFor(3));
    const tiles = practiceTiles('medium', words, hidden, rng);
    expect(rng).toHaveBeenCalledTimes(words.length - 1);
    expect(tiles.every(t => t.word === words[t.id])).toBe(true);
  });

  it('hard has no tiles and draws nothing', () => {
    const rng = vi.fn(rngFor(3));
    expect(practiceTiles('hard', words, hidden, rng)).toEqual([]);
    expect(rng).not.toHaveBeenCalled();
  });

  it('is repeatable from a seed', () => {
    expect(practiceTiles('medium', words, hidden, rngFor(11)))
      .toEqual(practiceTiles('medium', words, hidden, rngFor(11)));
  });
});
