// describe/it/expect come from vitest globals — these files are CommonJS, so
// they can't `import` from vitest (see vitest.config.js).
const {
  MAX_WORDS_PER_LIST,
  MAX_NAME_LEN,
  parseWords,
  validateName,
  validateWords,
} = require('./spellingLists');

describe('parseWords', () => {
  it('splits on newlines, commas and spaces', () => {
    expect(parseWords('cat\ndog, bird  fish').words).toEqual(['cat', 'dog', 'bird', 'fish']);
  });

  it('lowercases and de-duplicates, keeping first-seen order', () => {
    expect(parseWords('Dragon\ndragon\nCastle').words).toEqual(['dragon', 'castle']);
  });

  it('strips the numbering a school email brings along', () => {
    const { words, rejected } = parseWords('1. amazing\n2. because\n3) careful\n- decide');
    expect(words).toEqual(['amazing', 'because', 'careful', 'decide']);
    expect(rejected).toEqual([]);
  });

  it('strips surrounding punctuation and curly quotes', () => {
    expect(parseWords('“breeze”, (bridge). brought!').words).toEqual(['breeze', 'bridge', 'brought']);
  });

  it('rejects anything that is not a single run of letters', () => {
    // A word the child would have to guess the punctuation of is unfair to grade,
    // so hyphens, apostrophes and digits are dropped rather than silently mangled.
    const { words, rejected } = parseWords("can't\nice-cream\nb4\nvalid");
    expect(words).toEqual(['valid']);
    expect(rejected).toEqual(["can't", 'ice-cream', 'b4']);
  });

  it('reports the rejected token as typed, not as mangled', () => {
    expect(parseWords('Mother-in-law').rejected).toEqual(['Mother-in-law']);
  });

  it('rejects a word longer than the cap', () => {
    const long = 'a'.repeat(25);
    expect(parseWords(long).words).toEqual([]);
    expect(parseWords(long).rejected).toEqual([long]);
  });

  it('handles empty and non-string input', () => {
    expect(parseWords('')).toEqual({ words: [], rejected: [] });
    expect(parseWords(null)).toEqual({ words: [], rejected: [] });
    expect(parseWords('   \n\n  ')).toEqual({ words: [], rejected: [] });
  });
});

describe('validateName', () => {
  it('trims and collapses whitespace', () => {
    expect(validateName('  Week   1 ')).toEqual({ ok: true, name: 'Week 1' });
  });

  it('rejects an empty name', () => {
    expect(validateName('   ').ok).toBe(false);
    expect(validateName(undefined).ok).toBe(false);
  });

  it('rejects an over-long name', () => {
    expect(validateName('x'.repeat(MAX_NAME_LEN)).ok).toBe(true);
    expect(validateName('x'.repeat(MAX_NAME_LEN + 1)).ok).toBe(false);
  });
});

describe('validateWords', () => {
  it('accepts an array of words', () => {
    const result = validateWords(['cat', 'Dog']);
    expect(result).toMatchObject({ ok: true, words: ['cat', 'dog'] });
  });

  it('accepts one pasted blob', () => {
    expect(validateWords('cat\ndog').words).toEqual(['cat', 'dog']);
  });

  it('surfaces rejected tokens alongside the good ones', () => {
    const result = validateWords(['cat', "can't"]);
    expect(result.ok).toBe(true);
    expect(result.words).toEqual(['cat']);
    expect(result.rejected).toEqual(["can't"]);
  });

  it('rejects a list with no usable words', () => {
    expect(validateWords(["can't", 'ice-cream']).ok).toBe(false);
    expect(validateWords([]).ok).toBe(false);
    expect(validateWords(42).ok).toBe(false);
  });

  it('rejects a list over the per-list cap', () => {
    // Distinct words, since duplicates collapse before the cap is checked.
    const many = Array.from({ length: MAX_WORDS_PER_LIST + 1 }, (_, i) => `w${i}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]));
    expect(new Set(many).size).toBe(MAX_WORDS_PER_LIST + 1);
    expect(validateWords(many).ok).toBe(false);
    expect(validateWords(many.slice(0, MAX_WORDS_PER_LIST)).ok).toBe(true);
  });
});
