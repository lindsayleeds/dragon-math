// Pure-rule tests for the Proving Grounds run payload. The query helpers in the
// same module need a database and are exercised by the routes; everything here
// runs with no db, no express, no mocks.

const {
  validateRun,
  normalizeLimit,
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
} = require('./provingGroundsRuns');

const VALID = { mode: 'mul', digit: 7, medal: 'gold', elapsed_ms: 41200, wrong_count: 0 };

describe('validateRun', () => {
  it('accepts a well-formed run and normalizes it', () => {
    const out = validateRun(VALID);
    expect(out).toEqual({
      run: { mode: 'mul', digit: 7, medal: 'gold', elapsedMs: 41200, wrongCount: 0 },
    });
  });

  it('accepts division runs', () => {
    expect(validateRun({ ...VALID, mode: 'div' }).run.mode).toBe('div');
  });

  it('defaults a missing wrong_count to zero', () => {
    const body = { ...VALID };
    delete body.wrong_count;
    expect(validateRun(body).run.wrongCount).toBe(0);
  });

  it('rounds a fractional elapsed_ms rather than rejecting it', () => {
    expect(validateRun({ ...VALID, elapsed_ms: 41200.7 }).run.elapsedMs).toBe(41201);
  });

  it('coerces a numeric-string digit', () => {
    expect(validateRun({ ...VALID, digit: '7' }).run.digit).toBe(7);
  });

  it.each([
    ['a missing body', undefined],
    ['an unknown mode', { ...VALID, mode: 'add' }],
    ['a missing mode', { ...VALID, mode: undefined }],
    ['a digit below the range', { ...VALID, digit: 1 }],
    ['a digit above the range', { ...VALID, digit: 10 }],
    ['a fractional digit', { ...VALID, digit: 7.5 }],
    ['a negative elapsed_ms', { ...VALID, elapsed_ms: -1 }],
    ['a zero elapsed_ms', { ...VALID, elapsed_ms: 0 }],
    ['an absurd elapsed_ms', { ...VALID, elapsed_ms: 60 * 60 * 1000 + 1 }],
    ['a non-numeric elapsed_ms', { ...VALID, elapsed_ms: 'fast' }],
    ['a negative wrong_count', { ...VALID, wrong_count: -1 }],
    ['a wrong_count past the problem count', { ...VALID, wrong_count: 25 }],
  ])('rejects %s', (_label, body) => {
    expect(typeof validateRun(body)).toBe('string');
  });

  // Only medal-winning runs get a row, so "no medal" is a client bug and must
  // not silently insert a null-medal record.
  it.each([null, undefined, 'none', '', 'platinum'])('rejects medal %p', (medal) => {
    expect(typeof validateRun({ ...VALID, medal })).toBe('string');
  });
});

describe('normalizeLimit', () => {
  it('falls back to the default for junk', () => {
    for (const raw of [undefined, null, '', 'abc', '0', '-5', {}]) {
      expect(normalizeLimit(raw)).toBe(DEFAULT_RECENT_LIMIT);
    }
  });

  it('honours a sane request', () => {
    expect(normalizeLimit('5')).toBe(5);
    expect(normalizeLimit(5)).toBe(5);
  });

  it('caps an oversized request', () => {
    expect(normalizeLimit('100000')).toBe(MAX_RECENT_LIMIT);
  });
});
