import { describe, expect, it, vi } from 'vitest';
import {
  firstMemoryLetter,
  hiddenWordIndexes,
  normalizeMemoryWord,
  passageSegments,
  passageWords,
  splitPassage,
  unsupportedMemoryWords,
} from './memoryPassage';

describe('memory passage helpers', () => {
  it('splits a multi-sentence passage without losing ending punctuation', () => {
    expect(splitPassage('Be still. Know that I am here!')).toEqual([
      'Be still. ',
      'Know that I am here!',
    ]);
  });

  it('preserves leading ellipses, smart quotes, and spacing while splitting', () => {
    const passage = '...and then we began.”  “Keep going!’ Next.';
    const sentences = splitPassage(passage);
    expect(sentences).toEqual(['...and then we began.”  ', '“Keep going!’ ', 'Next.']);
    expect(sentences.join('')).toBe(passage);
  });

  it('attaches punctuation-only chunks to a word-bearing sentence', () => {
    const passage = '... Hello. ... World.';
    const sentences = splitPassage(passage);
    expect(sentences).toEqual(['... Hello. ... ', 'World.']);
    expect(sentences.every(sentence => passageWords(sentence).length > 0)).toBe(true);
    expect(sentences.join('')).toBe(passage);
  });

  it('treats apostrophes as part of a word', () => {
    expect(passageWords("Don't be afraid.")).toEqual(["Don't", 'be', 'afraid']);
  });

  it('keeps the exact separators around passage words', () => {
    expect(passageSegments('To be, or not—to be.')).toEqual([
      { type: 'word', value: 'To', wordIndex: 0 },
      { type: 'separator', value: ' ' },
      { type: 'word', value: 'be', wordIndex: 1 },
      { type: 'separator', value: ', ' },
      { type: 'word', value: 'or', wordIndex: 2 },
      { type: 'separator', value: ' ' },
      { type: 'word', value: 'not', wordIndex: 3 },
      { type: 'separator', value: '—' },
      { type: 'word', value: 'to', wordIndex: 4 },
      { type: 'separator', value: ' ' },
      { type: 'word', value: 'be', wordIndex: 5 },
      { type: 'separator', value: '.' },
    ]);
  });

  it('compares recall without case differences', () => {
    expect(normalizeMemoryWord('Shepherd')).toBe('shepherd');
    expect(firstMemoryLetter('Lord')).toBe('l');
  });

  it('normalizes hard-mode input independently of the browser locale', () => {
    const localeLower = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockReturnValue('ı');
    expect(normalizeMemoryWord('I')).toBe('i');
    localeLower.mockRestore();
  });

  it('always hides at least one word in easy mode', () => {
    expect(hiddenWordIndexes(['Remember'])).toEqual([0]);
    expect(hiddenWordIndexes(['one', 'two', 'three', 'four'])).toEqual([1]);
  });

  it('finds words whose first character cannot be entered in hard mode', () => {
    expect(unsupportedMemoryWords('Élan and Łódź meet Æsop.')).toEqual(['Łódź', 'Æsop']);
  });
});
