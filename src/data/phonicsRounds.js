// Building one round of Dragon Phonics, as pure functions.
//
// Everything here is deterministic given its inputs and its `rng` (any
// `() => number` in [0, 1), Math.random by default, a seeded generator from
// src/rules/seededRandom.js for the golden files and the iOS port),
// takes no React and touches no network, so the interesting decisions — which
// sounds a child is asked, and which wrong answers they are offered — are
// testable on their own (src/data/phonicsRounds.test.jsx). The hook in
// hooks/usePhonicsRound.js only sequences what these return.

import {
  PHONICS_ELEMENTS,
  ELEMENT_BY_KEY,
  elementsForStages,
  buildElementOptions,
  shufflePhonics as shuffle,
} from './phonicsCurriculum.js';

// The four ways the program asks about a sound. Each is a different cognitive
// task, which is exactly why mastery requires more than one of them — see the
// rule in server/lib/phonicsMastery.js.
export const PHONICS_MODES = [
  {
    key: 'choose',
    name: 'Sound Match',
    emoji: '👂',
    tagline: 'Hear a sound, tap the letters',
    blurb: 'You hear a sound. Tap the letters that make it. The choices are close together on purpose.',
    difficulty: 'easier',
    // Recognition: the answer is on the screen.
    skill: 'recognition',
  },
  {
    key: 'type-it',
    name: 'Sound Spell',
    emoji: '⌨️',
    tagline: 'Hear a sound, type the letters',
    blurb: 'You hear a sound and type the letters yourself. Nothing to pick from — you have to know it.',
    difficulty: 'harder',
    // Recall: nothing on screen to recognise.
    skill: 'recall',
  },
  {
    key: 'find-in-word',
    name: 'Sound Hunt',
    emoji: '🔍',
    tagline: 'Hear a word, find the sound inside',
    blurb: 'You hear a whole word. Which of these sounds is hiding inside it?',
    difficulty: 'medium',
    // Analysis: pulling one sound out of a stream of them.
    skill: 'analysis',
  },
  {
    key: 'missing-sound',
    name: 'Missing Sound',
    emoji: '🧩',
    tagline: 'Hear a word, fill the blank',
    blurb: 'A word with one sound missing. Listen, then tap the piece that fits.',
    difficulty: 'medium',
    skill: 'analysis',
  },
];

export const MODE_BY_KEY = Object.fromEntries(PHONICS_MODES.map((m) => [m.key, m]));

// The three modes this module builds rounds for. `missing-sound` is the older
// word-frame game and keeps its own data (data/phonicsWords.js); it reports
// attempts through the same progress API, it just isn't built here.
export const ROUND_MODES = ['choose', 'type-it', 'find-in-word'];

export const QUESTIONS_PER_ROUND = 10;

// How many tiles a multiple-choice item shows.
const OPTION_COUNT = { choose: 4, 'find-in-word': 4 };

// --- Which sounds to ask about ---------------------------------------------

// How much more likely a weak element is to be picked than a mastered one.
// Weights, not filters: a round that only ever showed a child what they are bad
// at would be demoralising and would also never re-check the rest, which is how
// mastery silently goes stale.
const LEVEL_WEIGHT = {
  learning: 6,
  new: 4,
  solid: 2,
  mastered: 1,
};
const STALE_BONUS = 4; // added to a solid/mastered element that needs re-checking

export function weightFor(element, mastery) {
  const state = mastery?.[element.key];
  const level = state?.level || 'new';
  const base = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.new;
  return base + (state?.stale ? STALE_BONUS : 0);
}

/**
 * Choose the elements one round will ask about.
 *
 * Distinct by design — asking the same sound twice in ten questions wastes half
 * the round. When the pool is smaller than `count` the round is simply shorter
 * rather than repeating (a stage with six sounds is a six-question round).
 *
 * @param {object[]} pool     candidate elements
 * @param {number} count      how many questions
 * @param {object} [mastery]  keyed by element key, from GET /api/phonics/mastery.
 *                            Absent (a guest, or a first visit) means every
 *                            element weighs the same, which is the right default.
 * @param {() => number} [rng]
 */
export function pickRoundElements(pool, count = QUESTIONS_PER_ROUND, mastery = null, rng = Math.random) {
  const remaining = [...pool];
  const picked = [];
  const want = Math.min(count, remaining.length);

  while (picked.length < want) {
    const weights = remaining.map((el) => weightFor(el, mastery));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let idx = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(remaining[idx]);
    remaining.splice(idx, 1); // distinct: never offered again this round
  }
  return picked;
}

// --- Find-in-word options ---------------------------------------------------

// Does this element's spelling appear anywhere in `word`?
// The magic-e frame (a_e) is checked as "vowel, one consonant, e" rather than
// literally, since `a_e` never appears in a word as written.
export function spellingAppearsIn(element, word) {
  const w = word.toLowerCase();
  return element.accepts.some((spelling) => {
    const s = spelling.toLowerCase();
    if (s.includes('_') || (s.length === 3 && s[1] === '-')) {
      const vowel = s[0];
      const tail = s[s.length - 1];
      return new RegExp(`${vowel}[bcdfghjklmnpqrstvwxyz]${tail}\\b`).test(w)
        || new RegExp(`${vowel}[bcdfghjklmnpqrstvwxyz]${tail}`).test(w);
    }
    return w.includes(s);
  });
}

/**
 * Options for a find-in-word item: the answer plus wrong sounds that are NOT in
 * the word.
 *
 * That exclusion is the whole correctness of this mode and it is easy to miss:
 * "brick" contains /br/, but it also contains /ck/ and /ĭ/, so offering `ck` as
 * a wrong answer makes a question with two right answers. Every candidate is
 * checked against the actual word, not against a category.
 */
export function buildWordOptions(element, word, count = 4, pool = PHONICS_ELEMENTS, rng = Math.random) {
  const eligible = pool.filter(
    (el) => el.key !== element.key && !spellingAppearsIn(el, word),
  );
  const byKey = Object.fromEntries(eligible.map((el) => [el.key, el]));

  const picked = [];
  const take = (candidates) => {
    for (const el of candidates) {
      if (picked.length >= count - 1) return;
      if (el && !picked.some((p) => p.key === el.key)) picked.push(el);
    }
  };

  // Confusable first (a wrong tap means something), then same type, then any.
  take(element.near.map((k) => byKey[k]));
  take(shuffle(eligible.filter((el) => el.type === element.type), rng));
  take(shuffle(eligible, rng));

  return shuffle([element, ...picked], rng);
}

// --- Whole rounds -----------------------------------------------------------

/**
 * Build one round.
 *
 * @param {object} opts
 * @param {string} opts.mode     one of ROUND_MODES
 * @param {number|number[]|'all'} opts.stages  which stage(s) to draw from
 * @param {number} [opts.count]
 * @param {object} [opts.mastery]
 * @param {string[]} [opts.only] restrict to these element keys (the review round)
 * @param {() => number} [opts.rng]
 * @returns {Array<{element: object, word: string|null, options: object[]|null}>}
 */
export function buildRound({
  mode, stages = 'all', count = QUESTIONS_PER_ROUND, mastery = null, only = null, rng = Math.random,
}) {
  // TWO pools, and conflating them breaks the game. `askPool` is what the child
  // is QUESTIONED on and may be narrowed to a handful of sounds by a review
  // list; `optionPool` is where WRONG ANSWERS come from and must not narrow with
  // it. Drawing distractors from a three-sound review list would hand the child
  // a three-tile question — and a one-sound review list a question with a single
  // tile, which is not a question at all.
  let optionPool = elementsForStages(stages);
  let askPool = optionPool;

  if (only?.length) {
    const wanted = new Set(only);
    const restricted = optionPool.filter((el) => wanted.has(el.key));
    // A review list that has drifted (an element renamed out of the curriculum)
    // must not produce an empty round — fall back to the whole pool.
    if (restricted.length) askPool = restricted;
  }

  // Find-in-word needs an example word to hide the sound in, so an element with
  // none cannot be asked in that mode. Every element in the curriculum has
  // words today; this keeps a future data edit from making an unanswerable item.
  if (mode === 'find-in-word') askPool = askPool.filter((el) => el.words.length > 0);

  // A single stage can be smaller than the tile count (stage 2 is five short
  // vowels), so distractors fall back to the whole curriculum rather than
  // rendering a short row.
  if (optionPool.length <= (OPTION_COUNT[mode] || 4)) optionPool = PHONICS_ELEMENTS;

  const elements = pickRoundElements(askPool, count, mastery, rng);
  const optionCount = OPTION_COUNT[mode] || 4;

  return elements.map((element) => {
    if (mode === 'choose') {
      return { element, word: null, options: buildElementOptions(element, optionCount, optionPool, rng) };
    }
    if (mode === 'find-in-word') {
      const word = element.words[Math.floor(rng() * element.words.length)];
      return { element, word, options: buildWordOptions(element, word, optionCount, PHONICS_ELEMENTS, rng) };
    }
    // type-it: nothing on screen but the sound.
    return { element, word: null, options: null };
  });
}

/**
 * The elements a "Needs Practice" round should drill: everything not yet solid,
 * plus anything that has gone stale, weakest first.
 *
 * Returns null when there is nothing to review — the caller shows the ordinary
 * stage picker rather than an empty review.
 */
export function reviewTargets(mastery, limit = 20) {
  if (!mastery) return null;
  const scored = PHONICS_ELEMENTS
    .map((el) => ({ el, state: mastery[el.key] }))
    .filter(({ state }) => state && (state.level === 'learning' || state.stale))
    .sort((a, b) => {
      // Lowest accuracy first; an element with no accuracy yet sorts as 0.
      const aa = a.state.accuracy ?? 0;
      const ba = b.state.accuracy ?? 0;
      return aa - ba;
    })
    .slice(0, limit)
    .map(({ el }) => el.key);
  return scored.length ? scored : null;
}

/**
 * Turn a child's answer into the attempt row the API stores.
 *
 * `chosen` is only ever another element's KEY. A typed answer is matched back
 * against the curriculum so that typing "ch" for /sh/ is recorded as the real
 * confusion it is rather than as unstructured text — which is what lets the
 * type-it game feed the same confusion report as the tap games.
 */
export function toAttempt({ element, mode, correct, chosenElement = null, typed = null, responseMs = null }) {
  // A right answer names no confusion. Recording the answer's own key as
  // `chosen` would be self-referential noise in the one column whose entire
  // purpose is "what did they mistake this for".
  let chosen = correct ? null : (chosenElement?.key ?? null);
  if (!chosen && typed && !correct) {
    const norm = typed.toLowerCase().replace(/[\s_-]/g, '');
    const match = PHONICS_ELEMENTS.find(
      (el) => el.key !== element.key
        && el.accepts.some((a) => a.toLowerCase().replace(/[\s_-]/g, '') === norm),
    );
    chosen = match?.key ?? null;
  }
  return {
    element_key: element.key,
    mode,
    correct,
    chosen,
    response_ms: responseMs,
  };
}

export { ELEMENT_BY_KEY };
