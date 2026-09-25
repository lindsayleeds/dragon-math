// The `phonics` golden fixture (golden/phonics.json): what the phonics rules
// produce from fixed inputs and seeds, for the Swift port to reproduce exactly
// (ADR 0005). Registered in buildGoldenFiles() in ./golden.js.
//
// Three parts:
//   - rounds:  buildRound (src/data/phonicsRounds.js) for every mode × every
//              stage (and 'all') × every seed, plus mastery weighting, review
//              lists and stage arrays.
//   - words:   the Missing Sound game (src/data/phonicsWords.js) — the words a
//              round picks per level, and each word's choice tiles.
//   - missingSoundKeys: every Missing Sound word's curriculumKeyFor, and the
//              key each same-pool tile would be recorded as when tapped.
//   - mastery: the server's pure mastery rule (server/lib/phonicsMastery.js) —
//              one case per level transition and edge, a whole attempt stream
//              judged after every attempt, classifyAll and confusionPairs.
//
// The mastery module is CommonJS (server/package.json), so it is loaded with
// createRequire. That is a Node API, which is fine here: this module is only
// imported by the generator script and by the vitest drift test, never by the
// web bundle.

import { createRequire } from 'node:module';
import { createSeededRandom } from './seededRandom.js';
import { PHONICS_STAGES, ELEMENT_BY_KEY } from '../data/phonicsCurriculum.js';
import { ROUND_MODES, buildRound } from '../data/phonicsRounds.js';
import {
  PHONICS_LEVELS, WORDS_PER_ROUND, pickPhonicsWords, buildOptions, curriculumKeyFor, answerOf, poolFor,
} from '../data/phonicsWords.js';

const require = createRequire(import.meta.url);
const mastery = require('../../server/lib/phonicsMastery.js');

const SEEDS = ['1', '42'];

// --- Rounds -----------------------------------------------------------------

// A mastery map exercising every weight: each level, and the stale bonus on the
// two levels it applies to. Keys outside a round's pool are simply unused.
const WEIGHTED_MASTERY = {
  m: { level: 'mastered', stale: false },
  s: { level: 'mastered', stale: true },
  t: { level: 'solid', stale: false },
  p: { level: 'solid', stale: true },
  n: { level: 'learning', stale: false },
  'short-a': { level: 'learning', stale: false },
  sh: { level: 'solid', stale: false },
  ch: { level: 'mastered', stale: false },
};

function roundInputs() {
  const stageValues = [...PHONICS_STAGES.map(s => s.stage), 'all'];
  const inputs = [];
  for (const mode of ROUND_MODES) {
    for (const stages of stageValues) {
      for (const seed of SEEDS) inputs.push({ mode, stages, seed });
    }
  }
  for (const mode of ROUND_MODES) {
    inputs.push({ mode, stages: 'all', mastery: WEIGHTED_MASTERY, seed: '7' });
    inputs.push({ mode, stages: 1, mastery: WEIGHTED_MASTERY, seed: '7' });
    // A review list: asks only these, distractors still from the whole pool.
    inputs.push({ mode, stages: 'all', only: ['sh', 'ch', 'th'], seed: '7' });
    // A drifted review list (no key in the pool) falls back to the whole pool.
    inputs.push({ mode, stages: 3, only: ['no-such-element'], seed: '7' });
    inputs.push({ mode, stages: [2, 3], count: 5, seed: '7' });
  }
  return inputs;
}

function roundCase({ mode, stages, count, mastery: masteryMap = null, only = null, seed }) {
  const rng = createSeededRandom(BigInt(seed));
  const items = buildRound({ mode, stages, count, mastery: masteryMap, only, rng: rng.next });
  return {
    seed,
    mode,
    stages,
    count: count ?? null,
    mastery: masteryMap,
    only,
    items: items.map(item => ({
      element: item.element.key,
      word: item.word,
      options: item.options ? item.options.map(el => el.key) : null,
    })),
  };
}

// --- Missing Sound words ----------------------------------------------------

function wordsCase(levelKey, seed) {
  const rng = createSeededRandom(BigInt(seed));
  const words = pickPhonicsWords(levelKey, WORDS_PER_ROUND, rng.next);
  const level = PHONICS_LEVELS.find(l => l.key === levelKey) || PHONICS_LEVELS[0];
  return {
    seed,
    level: levelKey,
    optionCount: level.options,
    items: words.map(entry => ({
      graphemes: entry.g,
      blank: entry.b,
      options: buildOptions(entry, level.options, rng.next),
    })),
  };
}

// Every word of every level: the element its blank records against, and, for
// each tile its pool could show, the element a tap on it records as `chosen`
// (the word with that tile in the blank, keyed the same way). null = no
// curriculum element (the attempt is dropped / names no confusion).
function missingSoundKeyCases() {
  return PHONICS_LEVELS.flatMap(level => level.words.map(entry => {
    const chosen = {};
    for (const option of poolFor(answerOf(entry))) {
      chosen[option] = curriculumKeyFor(
        { g: entry.g.map((gr, i) => (i === entry.b ? option : gr)), b: entry.b },
        ELEMENT_BY_KEY,
      );
    }
    return {
      level: level.key,
      graphemes: entry.g,
      blank: entry.b,
      elementKey: curriculumKeyFor(entry, ELEMENT_BY_KEY),
      chosen,
    };
  }));
}

// --- Mastery ----------------------------------------------------------------

const NOW = '2026-06-01T12:00:00.000Z';
const DAY = 86400000;

// Attempts newest first, each `[mode, correct, daysAgo]`; a fractional day
// orders attempts on the same day.
function attempts(spec) {
  const now = Date.parse(NOW);
  return spec.map(([mode, correct, daysAgo]) => ({
    mode,
    correct,
    createdAt: new Date(now - daysAgo * DAY).toISOString(),
  }));
}

// `n` copies of an attempt, spaced a minute apart starting `fromDay` days ago.
function repeat(n, mode, correct, fromDay = 0) {
  return Array.from({ length: n }, (_, i) => [mode, correct, fromDay + i / 1440]);
}

const CLASSIFY_CASES = [
  ['new: no attempts', []],
  ['learning: too few attempts for solid', repeat(3, 'choose', true)],
  ['learning: accuracy below solid', [...repeat(7, 'choose', true), ...repeat(3, 'choose', false, 1)]],
  ['solid: exactly the attempt floor and accuracy', [...repeat(3, 'choose', true), ['choose', false, 1]]],
  ['solid: perfect but one mode only', repeat(10, 'choose', true)],
  ['solid: two modes but too few attempts for mastered', [...repeat(3, 'choose', true), ...repeat(2, 'type-it', true, 1)]],
  ['solid: two modes but accuracy below mastered', [
    ...repeat(4, 'choose', true), ...repeat(4, 'type-it', true, 1), ...repeat(2, 'choose', false, 2),
  ]],
  ['mastered: exactly the attempt floor, two modes', [...repeat(3, 'choose', true), ...repeat(3, 'type-it', true, 1)]],
  ['mastered: nine of ten across three modes', [
    ...repeat(3, 'choose', true), ...repeat(3, 'type-it', true, 1), ...repeat(3, 'find-in-word', true, 2),
    ['choose', false, 3],
  ]],
  ['solid: a mode only counts when answered right', [...repeat(9, 'choose', true), ['type-it', false, 1]]],
  ['mastered: old misses fall out of the window', [
    ...repeat(5, 'choose', true), ...repeat(5, 'type-it', true, 1), ...repeat(20, 'choose', false, 30),
  ]],
  ['learning: old successes fall out of the window', [
    ...repeat(3, 'choose', true), ...repeat(7, 'choose', false, 1), ...repeat(20, 'type-it', true, 30),
  ]],
  ['solid, stale: unpracticed past the limit', repeat(5, 'choose', true, 46)],
  ['mastered, stale: unpracticed past the limit', [...repeat(3, 'choose', true, 60), ...repeat(3, 'type-it', true, 61)]],
  ['solid, not stale: exactly at the limit', repeat(5, 'choose', true, mastery.STALE_AFTER_DAYS)],
  ['learning, never stale', repeat(2, 'choose', true, 100)],
];

function classifyCases() {
  const now = new Date(NOW);
  const cases = CLASSIFY_CASES.map(([name, spec]) => {
    const input = attempts(spec);
    return { name, attempts: input, result: mastery.classifyElement(input, now) };
  });
  // An unparseable timestamp on the newest attempt: no last-seen date, so never stale.
  const bad = [{ mode: 'choose', correct: true, createdAt: 'not a date' }, ...attempts(repeat(4, 'choose', true, 60))];
  cases.push({ name: 'solid: unparseable last-seen date is never stale', attempts: bad, result: mastery.classifyElement(bad, now) });
  return cases;
}

// One element's attempts arriving over time, oldest first; after each, the
// whole history so far is judged at that attempt's own time. Walks learning
// → solid → mastered, back down to learning on a run of misses, and up to
// mastered again; `later` judges the final history after a long gap, which is
// stale.
const PROGRESSION = [
  ['choose', true, 20], ['choose', false, 19], ['choose', true, 18], ['choose', true, 17],
  ['choose', true, 16], ['type-it', true, 15], ['type-it', true, 14], ['choose', true, 13],
  ['find-in-word', true, 12], ['type-it', true, 11], ['choose', true, 10], ['choose', false, 9],
  ['type-it', false, 8], ['choose', false, 7], ['choose', false, 6], ['type-it', true, 5],
  ['choose', true, 4], ['type-it', true, 3], ['choose', true, 2], ['find-in-word', true, 1],
  ['choose', true, 0.9], ['type-it', true, 0.8], ['choose', true, 0.7], ['find-in-word', true, 0.6],
];

function progressionCase() {
  const stream = attempts(PROGRESSION);
  const steps = stream.map((attempt, i) => {
    const history = stream.slice(0, i + 1).reverse(); // newest first
    return { attempt, result: mastery.classifyElement(history, new Date(attempt.createdAt)) };
  });
  const laterNow = new Date(Date.parse(NOW) + 60 * DAY);
  const history = [...stream].reverse();
  return {
    description:
      'Attempts in arrival order. Each step is classifyElement(historySoFar newest first, now = that ' +
      'attempt\'s createdAt). `later` judges the whole history at `later.now`.',
    steps,
    later: { now: laterNow.toISOString(), result: mastery.classifyElement(history, laterNow) },
  };
}

function classifyAllCase() {
  const rows = [
    { elementKey: 'sh', mode: 'choose', correct: true, createdAt: '2026-05-30T09:00:00.000Z' },
    { elementKey: 'ch', mode: 'choose', correct: false, createdAt: '2026-05-31T09:00:00.000Z' },
    { elementKey: 'sh', mode: 'type-it', correct: true, createdAt: '2026-05-31T09:00:00.000Z' },
    { elementKey: null, mode: 'choose', correct: true, createdAt: '2026-05-31T09:00:00.000Z' },
    { elementKey: 'sh', mode: 'choose', correct: true, createdAt: '2026-05-28T09:00:00.000Z' },
    { elementKey: 'ch', mode: 'type-it', correct: true, createdAt: '2026-05-29T09:00:00.000Z' },
    { elementKey: 'sh', mode: 'find-in-word', correct: true, createdAt: '2026-05-29T09:00:00.000Z' },
    { elementKey: 'sh', mode: 'choose', correct: true, createdAt: '2026-05-27T09:00:00.000Z' },
    { elementKey: 'sh', mode: 'type-it', correct: true, createdAt: '2026-05-26T09:00:00.000Z' },
  ];
  return { now: NOW, rows, result: mastery.classifyAll(rows, new Date(NOW)) };
}

function confusionCases() {
  const row = (elementKey, chosen, correct = false) => ({ elementKey, chosen, correct });
  const rows = [
    row('sh', 'ch'), row('sh', 'ch'), row('sh', 'ch'),
    row('ch', 'sh'), row('ch', 'sh'),
    row('b', 'd'), row('b', 'd'),
    row('a', 'e'), // a single slip is not a pattern
    row('th', 'th'), row('th', 'th'), // chosen itself: not a confusion
    row('m', 'n', true), row('m', 'n', true), // right answers never count
    row('f', null), row('f', null),
    row(null, 'x'), row(null, 'x'),
  ];
  return [
    { limit: 8, rows, result: mastery.confusionPairs(rows, 8) },
    { limit: 2, rows, result: mastery.confusionPairs(rows, 2) },
  ];
}

export function phonicsFixture() {
  return {
    fixture: 'phonics',
    version: 1,
    description:
      'Dragon Phonics rules from fixed inputs. `rounds`: buildRound (src/data/phonicsRounds.js) with ' +
      'rng = createSeededRandom(seed).next from a fresh generator per case, shared in draw order across the ' +
      'whole round (element picks first, then each item\'s word and options in turn); elements and options ' +
      'are element keys; `count` null means the default. `words`: pickPhonicsWords(level, 10, rng) then ' +
      'buildOptions(entry, optionCount, rng) per word, one fresh generator per case (src/data/phonicsWords.js). ' +
      '`missingSoundKeys`: curriculumKeyFor for each Missing Sound word, and `chosen` maps each tile of its ' +
      'pool to curriculumKeyFor of the word with that tile in the blank. ' +
      '`mastery`: server/lib/phonicsMastery.js; attempts are newest first, judged at `now`.',
    rounds: roundInputs().map(roundCase),
    words: [...PHONICS_LEVELS.map(l => l.key), 'no-such-level'].flatMap(level =>
      SEEDS.map(seed => wordsCase(level, seed))),
    missingSoundKeys: missingSoundKeyCases(),
    mastery: {
      constants: {
        recentWindow: mastery.RECENT_WINDOW,
        minAttemptsSolid: mastery.MIN_ATTEMPTS_SOLID,
        minAttemptsMastered: mastery.MIN_ATTEMPTS_MASTERED,
        solidAccuracy: mastery.SOLID_ACCURACY,
        masteredAccuracy: mastery.MASTERED_ACCURACY,
        modesForMastery: mastery.MODES_FOR_MASTERY,
        staleAfterDays: mastery.STALE_AFTER_DAYS,
        levels: mastery.LEVELS,
      },
      now: NOW,
      classifyElement: classifyCases(),
      progression: progressionCase(),
      classifyAll: classifyAllCase(),
      confusionPairs: confusionCases(),
    },
  };
}
