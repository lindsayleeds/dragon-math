// The module under test is CommonJS (server/**), while the test file itself is
// ESM — the same split every other server test uses (see rateLimit.test.js).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyElement,
  classifyAll,
  confusionPairs,
  RECENT_WINDOW,
} = require('./phonicsMastery');

// The rule is the product claim ("this child knows phonics"), so these tests are
// written against the PROPERTIES that claim rests on rather than against the
// current constants — tightening a threshold should not require rewriting them,
// but weakening the two-mode requirement or the recency window should fail here.

const NOW = new Date('2026-09-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);

// Newest-first, as classifyElement expects.
const run = (specs) => specs.map(([mode, correct, days = 0]) => ({
  mode, correct, createdAt: daysAgo(days),
}));

const allOf = (mode, correct, n, days = 0) =>
  Array.from({ length: n }, () => [mode, correct, days]);

describe('classifyElement', () => {
  it('reports a never-attempted element as new, with no accuracy', () => {
    const state = classifyElement([], NOW);
    expect(state.level).toBe('new');
    expect(state.accuracy).toBeNull();
    expect(state.attempts).toBe(0);
  });

  it('will not call an element solid on too few attempts, however perfect', () => {
    // Three for three is a good day, not evidence.
    const state = classifyElement(run(allOf('choose', true, 3)), NOW);
    expect(state.level).toBe('learning');
    expect(state.accuracy).toBe(1);
  });

  it('caps a one-mode streak at solid, no matter how long it is', () => {
    // The heart of the rule: recognition alone is not knowing. A child can pass
    // the multiple-choice game by elimination, so ten perfect taps in one mode
    // must not read as mastery.
    const state = classifyElement(run(allOf('choose', true, 10)), NOW);
    expect(state.level).toBe('solid');
    expect(state.modes).toEqual(['choose']);
  });

  it('reaches mastered once a second mode is right too', () => {
    const state = classifyElement(
      run([...allOf('choose', true, 5), ['type-it', true]]),
      NOW,
    );
    expect(state.level).toBe('mastered');
    expect(state.modes).toEqual(['choose', 'type-it']);
  });

  it('does not count a mode the child was only ever WRONG in', () => {
    // Being wrong in three games is not three kinds of evidence.
    const state = classifyElement(
      run([...allOf('choose', true, 6), ['type-it', false], ['find-in-word', false]]),
      NOW,
    );
    expect(state.modes).toEqual(['choose']);
    expect(state.level).not.toBe('mastered');
  });

  it('judges only the recent window, so an old bad patch stops counting', () => {
    const recent = allOf('choose', true, RECENT_WINDOW, 1);
    const ancient = allOf('choose', false, 20, 200);
    const state = classifyElement(run([...recent, ...ancient]), NOW);
    expect(state.attempts).toBe(RECENT_WINDOW);
    expect(state.accuracy).toBe(1);
    // …while the raw history is still reported, so a trend can be drawn.
    expect(state.total).toBe(RECENT_WINDOW + 20);
  });

  it('flags a long-unpractised strong element as stale without demoting it', () => {
    const state = classifyElement(
      run([['choose', true, 200], ['type-it', true, 200], ...allOf('choose', true, 4, 200)]),
      NOW,
    );
    expect(state.level).toBe('mastered');
    expect(state.stale).toBe(true);
  });

  it('never marks a struggling element stale — there is nothing to re-check', () => {
    const state = classifyElement(run(allOf('choose', false, 6, 200)), NOW);
    expect(state.level).toBe('learning');
    expect(state.stale).toBe(false);
  });

  it('tolerates a bad-but-recoverable day rather than dropping to learning', () => {
    const state = classifyElement(
      run([['choose', false], ['type-it', true], ...allOf('choose', true, 5)]),
      NOW,
    );
    expect(state.accuracy).toBeCloseTo(6 / 7);
    expect(state.level).toBe('solid');
  });
});

describe('classifyAll', () => {
  it('groups by element and sorts each group newest-first before judging', () => {
    // Rows arrive from the database in one stream, in no guaranteed per-element
    // order; if the sort were skipped the "recent" window would be arbitrary.
    const rows = [
      { elementKey: 'br', mode: 'choose', correct: false, createdAt: daysAgo(90) },
      { elementKey: 'sh', mode: 'choose', correct: true, createdAt: daysAgo(1) },
      { elementKey: 'br', mode: 'choose', correct: true, createdAt: daysAgo(1) },
    ];
    const out = classifyAll(rows, NOW);
    expect(Object.keys(out).sort()).toEqual(['br', 'sh']);
    expect(out.br.attempts).toBe(2);
    expect(out.br.lastSeenAt).toBe(daysAgo(1).toISOString());
  });

  it('omits elements with no attempts rather than inventing them', () => {
    // The server does not hold the curriculum, so it must not claim to know how
    // many sounds exist — the client fills the gaps.
    const out = classifyAll([{ elementKey: 'sh', mode: 'choose', correct: true, createdAt: NOW }], NOW);
    expect(out.ch).toBeUndefined();
  });

  it('survives empty and missing input', () => {
    expect(classifyAll([], NOW)).toEqual({});
    expect(classifyAll(null, NOW)).toEqual({});
  });
});

describe('confusionPairs', () => {
  const wrong = (element, chosen, n) =>
    Array.from({ length: n }, () => ({ elementKey: element, chosen, correct: false }));

  it('reports a repeated swap, strongest first', () => {
    const pairs = confusionPairs([...wrong('sh', 'ch', 3), ...wrong('ai', 'ee', 2)]);
    expect(pairs).toEqual([
      { element: 'sh', chose: 'ch', count: 3 },
      { element: 'ai', chose: 'ee', count: 2 },
    ]);
  });

  it('ignores a one-off slip', () => {
    // One mistake is noise; the report exists to name patterns.
    expect(confusionPairs(wrong('sh', 'ch', 1))).toEqual([]);
  });

  it('ignores correct answers and answers that named nothing', () => {
    const rows = [
      { elementKey: 'sh', chosen: 'ch', correct: true },
      { elementKey: 'sh', chosen: 'ch', correct: true },
      { elementKey: 'sh', chosen: null, correct: false },
      { elementKey: 'sh', chosen: null, correct: false },
    ];
    expect(confusionPairs(rows)).toEqual([]);
  });

  it('ignores an element recorded as confused with itself', () => {
    expect(confusionPairs(wrong('sh', 'sh', 4))).toEqual([]);
  });

  it('keeps the two directions of a swap apart', () => {
    // "reads /sh/ as /ch/" and "reads /ch/ as /sh/" are different findings.
    const pairs = confusionPairs([...wrong('sh', 'ch', 2), ...wrong('ch', 'sh', 3)]);
    expect(pairs).toEqual([
      { element: 'ch', chose: 'sh', count: 3 },
      { element: 'sh', chose: 'ch', count: 2 },
    ]);
  });
});
