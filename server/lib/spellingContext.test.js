// describe/it/expect are Vitest globals; server tests remain CommonJS.
const { cleanDecision, cleanSentence, parseContextResponse } = require('./spellingContext');

describe('spelling context AI responses', () => {
  it('accepts one short use of the target and normalizes punctuation', () => {
    expect(cleanSentence('new', 'I have a new bike')).toBe('I have a new bike.');
  });

  it('rejects sentences that omit or repeat the target', () => {
    expect(cleanSentence('new', 'I have a bicycle.')).toBeNull();
    expect(cleanSentence('new', 'A new bike feels new.')).toBeNull();
  });

  it('requires evidence of a different confusable spelling', () => {
    expect(cleanDecision('new', {
      sentence: 'I have a new bike.',
      confused_with: 'knew',
    })).toBe('I have a new bike.');
    expect(() => cleanDecision('rabbit', {
      sentence: 'The rabbit hopped away.',
      confused_with: 'rabbit',
    })).toThrow('confusable spelling');
  });

  it('returns every requested word and ignores extra model keys', () => {
    const parsed = parseContextResponse(
      ['new', 'rabbit'],
      'Here is the JSON: {"new":{"sentence":"I have a new bike.","confused_with":"knew"},"rabbit":null,"extra":null}',
    );
    expect(Object.fromEntries(parsed)).toEqual({
      new: 'I have a new bike.',
      rabbit: null,
    });
  });

  it('rejects a response that silently omits a requested word', () => {
    expect(() => parseContextResponse(['new', 'rabbit'], '{"new":{"sentence":"I have a new bike.","confused_with":"knew"}}'))
      .toThrow('omitted "rabbit"');
  });
});
