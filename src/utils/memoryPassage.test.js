import { describe, expect, it } from 'vitest';
import {
  firstMemoryLetter,
  hiddenWordIndexes,
  normalizeMemoryWord,
  passageWords,
  splitPassage,
} from './memoryPassage';

describe('memory passage helpers', () => {
  it('splits a multi-sentence passage without losing ending punctuation', () => {
    expect(splitPassage('Be still. Know that I am here!')).toEqual([
      'Be still.',
      'Know that I am here!',
    ]);
  });

  it('treats apostrophes as part of a word', () => {
    expect(passageWords("Don't be afraid.")).toEqual(["Don't", 'be', 'afraid']);
  });

  it('compares recall without case differences', () => {
    expect(normalizeMemoryWord('Shepherd')).toBe('shepherd');
    expect(firstMemoryLetter('Lord')).toBe('l');
  });

  it('always hides at least one word in easy mode', () => {
    expect(hiddenWordIndexes(['Remember'])).toEqual([0]);
    expect(hiddenWordIndexes(['one', 'two', 'three', 'four'])).toEqual([1]);
  });
});
