import { describe, it, expect } from 'vitest';
import {
  buildRound,
  buildWordOptions,
  spellingAppearsIn,
  pickRoundElements,
  reviewTargets,
  toAttempt,
  weightFor,
  PHONICS_MODES,
  ROUND_MODES,
} from './phonicsRounds';
import { PHONICS_ELEMENTS, ELEMENT_BY_KEY, elementsForStages } from './phonicsCurriculum';

// Round building is where a phonics item can quietly become unanswerable, so
// these tests are mostly about the ways an item can have zero or two right
// answers rather than about the happy path.

const state = (level, extra = {}) => ({
  level, attempts: 6, correct: 6, accuracy: 1, modes: ['choose'], lastSeenAt: null, stale: false, total: 6, ...extra,
});

describe('spellingAppearsIn', () => {
  it('finds a spelling inside a word', () => {
    expect(spellingAppearsIn(ELEMENT_BY_KEY.br, 'brick')).toBe(true);
    expect(spellingAppearsIn(ELEMENT_BY_KEY.ck, 'brick')).toBe(true);
    expect(spellingAppearsIn(ELEMENT_BY_KEY.sh, 'brick')).toBe(false);
  });

  it('matches a magic-e frame structurally, not literally', () => {
    // `a_e` never appears in a word as written; "cake" is the match.
    expect(spellingAppearsIn(ELEMENT_BY_KEY['long-a'], 'cake')).toBe(true);
    expect(spellingAppearsIn(ELEMENT_BY_KEY['long-a'], 'grass')).toBe(false);
  });

  it('counts any accepted spelling, not just the primary one', () => {
    // /ā/ is spelled `ay` in "hay" — a hunt item must not offer it as a wrong
    // answer for a word that contains it.
    expect(spellingAppearsIn(ELEMENT_BY_KEY['team-ai'], 'hay')).toBe(true);
  });
});

describe('buildWordOptions', () => {
  it('never offers a sound that is actually in the word', () => {
    // The whole correctness of the hunt mode. "brick" contains /br/, /ĭ/ AND
    // /ck/ — offering `ck` as a wrong answer makes two right answers.
    for (const el of PHONICS_ELEMENTS) {
      for (const word of el.words) {
        const options = buildWordOptions(el, word, 4);
        const alsoPresent = options
          .filter((o) => o.key !== el.key && spellingAppearsIn(o, word))
          .map((o) => o.key);
        expect(alsoPresent, `${el.key} in "${word}"`).toEqual([]);
      }
    }
  });

  it('always includes the answer and returns distinct tiles', () => {
    const el = ELEMENT_BY_KEY.br;
    const options = buildWordOptions(el, 'brick', 4);
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.key)).toContain('br');
    expect(new Set(options.map((o) => o.key)).size).toBe(4);
  });
});

describe('pickRoundElements', () => {
  const pool = elementsForStages(4);

  it('never repeats a sound inside one round', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickRoundElements(pool, 10);
      expect(new Set(picked.map((el) => el.key)).size).toBe(picked.length);
    }
  });

  it('shortens the round rather than repeating when the pool is small', () => {
    const tiny = elementsForStages(2); // five short vowels
    expect(pickRoundElements(tiny, 10)).toHaveLength(tiny.length);
  });

  it('weights a struggling sound above a mastered one', () => {
    const el = ELEMENT_BY_KEY.br;
    const learning = { br: state('learning') };
    const mastered = { br: state('mastered') };
    expect(weightFor(el, learning)).toBeGreaterThan(weightFor(el, mastered));
  });

  it('adds weight to a stale sound so it gets re-checked', () => {
    const el = ELEMENT_BY_KEY.br;
    const fresh = { br: state('mastered') };
    const gone = { br: state('mastered', { stale: true }) };
    expect(weightFor(el, gone)).toBeGreaterThan(weightFor(el, fresh));
  });

  it('treats every sound equally when there is no mastery yet', () => {
    // A guest, or a first visit — an unweighted round is the right default.
    const weights = pool.map((el) => weightFor(el, null));
    expect(new Set(weights).size).toBe(1);
  });

  it('still offers mastered sounds, so mastery can go stale honestly', () => {
    // Weights, not filters. A round that only drilled weaknesses would never
    // re-check anything else.
    const allMastered = Object.fromEntries(pool.map((el) => [el.key, state('mastered')]));
    expect(pickRoundElements(pool, 10, allMastered)).toHaveLength(10);
  });
});

describe('buildRound', () => {
  it('builds a full, answerable round in every mode', () => {
    for (const mode of ROUND_MODES) {
      const round = buildRound({ mode, stages: 'all', count: 10 });
      expect(round, mode).toHaveLength(10);
      for (const item of round) {
        expect(item.element, mode).toBeTruthy();
        if (mode === 'type-it') {
          expect(item.options).toBeNull();
        } else {
          expect(item.options.map((o) => o.key), mode).toContain(item.element.key);
        }
        if (mode === 'find-in-word') {
          expect(spellingAppearsIn(item.element, item.word), item.element.key).toBe(true);
        }
      }
    }
  });

  it('restricts to a stage when asked', () => {
    const round = buildRound({ mode: 'choose', stages: 3, count: 7 });
    expect(round.every((i) => i.element.stage === 3)).toBe(true);
  });

  it('restricts to a review list when given one', () => {
    const only = ['br', 'sh', 'ch'];
    const round = buildRound({ mode: 'choose', stages: 'all', count: 3, only });
    expect(round.map((i) => i.element.key).sort()).toEqual([...only].sort());
  });

  it('draws distractors from the whole curriculum, not from the review list', () => {
    // Regression: `only` used to narrow the distractor pool as well as the
    // question pool, so a one-sound review round rendered a question with a
    // single tile — a 100%-correct item that would wrongly count as evidence.
    const round = buildRound({ mode: 'choose', stages: 2, count: 1, only: ['short-a'] });
    expect(round).toHaveLength(1);
    expect(round[0].options).toHaveLength(4);
    expect(round[0].options.map((o) => o.key)).toContain('short-a');
  });

  it('pads the options of a stage smaller than the tile count', () => {
    // Stage 2 has five short vowels; a 4-tile item drawing only from it would
    // be down to a coin flip.
    const round = buildRound({ mode: 'choose', stages: 2, count: 5 });
    for (const item of round) expect(item.options, item.element.key).toHaveLength(4);
  });

  it('falls back to the whole pool rather than dealing nothing for a stale review list', () => {
    // A review list can name an element that has since been renamed out of the
    // curriculum; an empty round would strand the child on a blank screen.
    const round = buildRound({ mode: 'choose', stages: 'all', count: 5, only: ['no-such-sound'] });
    expect(round).toHaveLength(5);
  });
});

describe('reviewTargets', () => {
  it('returns nothing when there is nothing to review', () => {
    expect(reviewTargets(null)).toBeNull();
    expect(reviewTargets({ br: state('mastered') })).toBeNull();
  });

  it('collects struggling and stale sounds, weakest first', () => {
    const mastery = {
      br: state('learning', { accuracy: 0.2 }),
      sh: state('learning', { accuracy: 0.6 }),
      ch: state('mastered', { stale: true, accuracy: 1 }),
      th: state('mastered'),
    };
    const targets = reviewTargets(mastery);
    expect(targets).toContain('br');
    expect(targets).toContain('ch');
    expect(targets).not.toContain('th');
    expect(targets.indexOf('br')).toBeLessThan(targets.indexOf('sh'));
  });
});

describe('toAttempt', () => {
  it('records a tapped wrong answer as that element\'s key', () => {
    const attempt = toAttempt({
      element: ELEMENT_BY_KEY.sh,
      mode: 'choose',
      correct: false,
      chosenElement: ELEMENT_BY_KEY.ch,
    });
    expect(attempt).toMatchObject({ element_key: 'sh', mode: 'choose', correct: false, chosen: 'ch' });
  });

  it('matches a TYPED wrong answer back to an element, so typing feeds the confusion report', () => {
    const attempt = toAttempt({
      element: ELEMENT_BY_KEY.sh,
      mode: 'type-it',
      correct: false,
      typed: 'ch',
    });
    expect(attempt.chosen).toBe('ch');
  });

  it('records no `chosen` for a typed answer that names nothing', () => {
    // Free text in the confusion report would be noise, so it is dropped —
    // the attempt is still stored as wrong.
    const attempt = toAttempt({
      element: ELEMENT_BY_KEY.sh,
      mode: 'type-it',
      correct: false,
      typed: 'zzz',
    });
    expect(attempt.chosen).toBeNull();
    expect(attempt.correct).toBe(false);
  });

  it('records no `chosen` for a correct answer, typed or tapped', () => {
    // Regression: a correct TAP used to store the answer's own key as the
    // confusion, which is self-referential noise in the one column whose job is
    // "what did they mistake this for".
    expect(toAttempt({
      element: ELEMENT_BY_KEY.sh, mode: 'type-it', correct: true, typed: 'sh',
    }).chosen).toBeNull();
    expect(toAttempt({
      element: ELEMENT_BY_KEY.sh, mode: 'choose', correct: true, chosenElement: ELEMENT_BY_KEY.sh,
    }).chosen).toBeNull();
  });
});

describe('modes', () => {
  it('covers more than one kind of skill, which is what mastery requires', () => {
    // server/lib/phonicsMastery.js only grants `mastered` across two modes. If
    // the modes all tested the same thing that rule would be theatre.
    const skills = new Set(PHONICS_MODES.map((m) => m.skill));
    expect(skills.size).toBeGreaterThan(1);
  });

  it('keeps every round mode declared as a mode', () => {
    const keys = new Set(PHONICS_MODES.map((m) => m.key));
    for (const mode of ROUND_MODES) expect(keys.has(mode), mode).toBe(true);
  });
});
