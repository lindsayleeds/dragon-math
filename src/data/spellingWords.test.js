import { describe, expect, it } from 'vitest';
import { audioUrlsFor, exampleSentenceFor, gradeSource, listSource } from './spellingWords';

describe('spelling prompt sources', () => {
  it('uses a complete-prompt recording for contextual built-in words', () => {
    const source = gradeSource(4);
    expect(exampleSentenceFor(source, 'ceiling')).toMatch(/ceiling/i);
    expect(audioUrlsFor(source, 'ceiling')).toEqual(['/audio/spelling/prompts/ceiling.mp3']);
  });

  it('carries custom-list sentences into playback', () => {
    const source = listSource({
      id: 7,
      name: 'Week 1',
      words: ['new'],
      example_sentences: { new: 'I have a new bike.' },
    });
    expect(exampleSentenceFor(source, 'new')).toBe('I have a new bike.');
    expect(audioUrlsFor(source, 'new')).toEqual(['/api/spelling/audio/new.mp3']);
  });
});
