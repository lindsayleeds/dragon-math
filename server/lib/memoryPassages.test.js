const {
  MAX_WORDS,
  passageWords,
  validatePassage,
} = require('./memoryPassages');

describe('memory passage validation', () => {
  it('accepts several sentences and preserves their exact wording', () => {
    const body = "The Lord is my shepherd. I shall not want.";
    expect(validatePassage({ title: 'Psalm 23:1', category: 'verse', body })).toEqual({
      ok: true,
      passage: { title: 'Psalm 23:1', category: 'verse', body, wordCount: 9 },
    });
  });

  it('counts contractions as one word', () => {
    expect(passageWords("Don't be afraid.")).toEqual(["Don't", 'be', 'afraid']);
  });

  it('rejects an empty or oversized passage', () => {
    expect(validatePassage({ title: 'Empty', body: '' }).ok).toBe(false);
    expect(validatePassage({ title: 'Long', body: Array(MAX_WORDS + 1).fill('word').join(' ') }).ok).toBe(false);
  });

  it('rejects words that cannot be entered with the hard-mode keyboard', () => {
    expect(validatePassage({ title: 'Unsupported', body: 'Élan meets Łódź and Æsop.' })).toEqual({
      ok: false,
      error: 'Each word must begin with A–Z or 0–9 so Hard mode can be played. Change: Łódź, Æsop.',
    });
  });
});
