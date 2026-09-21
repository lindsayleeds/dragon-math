import { describe, expect, it } from 'vitest';
import {
  BLENDS,
  CONSONANTS,
  PHONICS_LEVELS,
  VOWELS,
  answerOf,
  cueWordFor,
  phonicsAudioAuditItems,
} from './phonicsWords';

describe('phonics cue words', () => {
  it('gives every possible choice a curated example', () => {
    const choices = [...VOWELS, ...CONSONANTS, ...BLENDS];

    for (const choice of choices) {
      expect(cueWordFor(choice), `missing cue for ${choice}`).not.toBe('');
    }
  });

  it('gives every catalog answer a curated example', () => {
    for (const level of PHONICS_LEVELS) {
      for (const entry of level.words) {
        const answer = answerOf(entry);
        expect(cueWordFor(answer), `missing cue for ${answer}`).not.toBe('');
      }
    }
  });

  it('uses strong examples for representative sounds', () => {
    expect(cueWordFor('gr')).toBe('grass');
    expect(cueWordFor('sh')).toBe('ship');
    expect(cueWordFor('i')).toBe('pig');
    expect(cueWordFor('g')).toBe('gum');
  });
});

describe('phonics audio audit catalog', () => {
  it('deduplicates recordings while retaining every use', () => {
    const items = phonicsAudioAuditItems();
    const pig = items.find(item => item.word === 'pig');

    expect(new Set(items.map(item => item.word)).size).toBe(items.length);
    expect(pig.targets.length).toBeGreaterThan(0);
    expect(pig.cues).toEqual(expect.arrayContaining(['i', 'p']));
  });

  it('describes the missing grapheme for target words', () => {
    const cat = phonicsAudioAuditItems().find(item => item.word === 'cat');

    expect(cat.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'Vowel Sounds', answer: 'a', pattern: 'c?t' }),
      expect.objectContaining({ level: 'First & Last', answer: 'c', pattern: '?at' }),
    ]));
  });
});
