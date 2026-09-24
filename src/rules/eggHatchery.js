// Dragon Egg Hatchery rules — twelve problems on one base number and operation
// (base op 1 … base op 12), each hatching an egg into a baby dragon when solved.
//
// Pure: every random choice takes an injected rng (`() => number` in [0, 1),
// default Math.random), so a round from a fixed seed is repeatable and
// golden/egg-hatchery.json can pin it for the Swift port (ADR 0005).
// src/components/DragonEggHatchery.jsx owns the UI: timers, animation, the
// catalog fetch and saving results.
//
// Draw order (the Swift port must consume draws in exactly this order):
//   - generateProblems: one Fisher-Yates shuffle of the 12 problems, from the
//     end — 11 draws, j = floor(rng() * (i + 1)) for i = 11 down to 1.
//   - generateAnswerButtons: 4 draws for the "plausible" distractors
//     (floor(rng() * (max - min + 1)) + min each), then one draw per button
//     picked from the de-duplicated distractor list
//     (idx = floor(rng() * remaining)), until there are 4 buttons or the list
//     runs out. Returns [correct, ...picked] — unshuffled.
//   - shuffleAnswerButtons: a Fisher-Yates shuffle of those buttons, from the
//     end (buttons.length - 1 draws; 3 for a full set).
//   - buildAnswerChoices = generateAnswerButtons then shuffleAnswerButtons.
//   - hintOfferDelayMs: one draw, 5000 + rng() * 2000.
//   - pickDragonId: one draw — floor(rng() * pool.length) into the pool, or
//     floor(rng() * DRAGON_PNG_COUNT) + 1 with no pool.
//   - getHintText: one draw (the 2-4 extra skip-count numbers), and only for a
//     shown multiplication hint; otherwise none.
// The component draws, per problem: buildAnswerChoices, then hintOfferDelayMs;
// then pickDragonId when that problem hatches.
//
// Mastery tiers take the elapsed seconds as input, so there's no clock here.

import { DRAGON_PNG_COUNT } from '../data/dragonRarity.js';

export const HATCHERY_SIZE = 12;
export const ANSWER_BUTTON_COUNT = 4;

// Seconds under which each tier is earned; slower than the last is bronze.
export const TIER_THRESHOLDS = { legendary: 15, gold: 25, silver: 40 };

export const OPERATION_SYMBOLS = { mul: '×', div: '÷', add: '+', sub: '−' };

// Fisher-Yates from the end, one rng draw per step.
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the two displayed operands and the answer for one problem.
 *
 * Division is derived from the multiplication table so it always resolves to a
 * whole number: the dividend is `baseNumber * i` and the divisor is
 * `baseNumber`, giving the quotient `i` (e.g. base 2 → 2÷2, 4÷2, … 24÷2). This
 * avoids problems like `2 ÷ 6` that don't divide cleanly.
 */
export function buildProblem(baseNumber, i, operation) {
  switch (operation) {
    case 'mul':
      return { operand1: baseNumber, operand2: i, answer: baseNumber * i };
    case 'div':
      return { operand1: baseNumber * i, operand2: baseNumber, answer: i };
    case 'add':
      return { operand1: baseNumber, operand2: i, answer: baseNumber + i };
    case 'sub':
      // Avoid negatives for kids: subtract the smaller from the larger.
      return {
        operand1: Math.max(baseNumber, i),
        operand2: Math.min(baseNumber, i),
        answer: Math.abs(baseNumber - i),
      };
    default:
      return { operand1: baseNumber, operand2: i, answer: 0 };
  }
}

/**
 * The 12 problems baseNumber op 1 … baseNumber op 12, in shuffled order.
 */
export function generateProblems(operation, baseNumber, rng = Math.random) {
  const problems = [];
  for (let i = 1; i <= HATCHERY_SIZE; i++) {
    const { operand1, operand2, answer } = buildProblem(baseNumber, i, operation);
    problems.push({
      id: i,
      multiplier: i,
      operand1,
      operand2,
      correctAnswer: answer,
      isHatched: false,
    });
  }
  return shuffle(problems, rng);
}

/**
 * Up to 4 answer buttons: the correct answer first, then distractors drawn
 * from off-by-one/two slips and random values within ±5 (all positive).
 */
export function generateAnswerButtons(correctAnswer, rng = Math.random) {
  const buttons = [correctAnswer];

  // Off-by-one: ±1, ±2
  const distractors = [correctAnswer - 1, correctAnswer + 1, correctAnswer - 2, correctAnswer + 2];

  // Random plausible values (within a reasonable range)
  const min = Math.max(1, correctAnswer - 5);
  const max = correctAnswer + 5;
  for (let i = 0; i < 4; i++) {
    distractors.push(Math.floor(rng() * (max - min + 1)) + min);
  }

  // Pick 3 unique distractors
  const uniqueDistractors = [...new Set(distractors)].filter(d => d !== correctAnswer && d > 0);

  while (buttons.length < ANSWER_BUTTON_COUNT && uniqueDistractors.length > 0) {
    const idx = Math.floor(rng() * uniqueDistractors.length);
    buttons.push(uniqueDistractors[idx]);
    uniqueDistractors.splice(idx, 1);
  }

  return buttons;
}

export function shuffleAnswerButtons(buttons, rng = Math.random) {
  return shuffle(buttons, rng);
}

/** The shuffled answer buttons for one problem, as the component shows them. */
export function buildAnswerChoices(correctAnswer, rng = Math.random) {
  return shuffleAnswerButtons(generateAnswerButtons(correctAnswer, rng), rng);
}

/** How long (ms) a child sits on a problem before a hint is offered: 5-7s. */
export function hintOfferDelayMs(rng = Math.random) {
  return 5000 + rng() * 2000;
}

/**
 * A random baby dragon id. Prefers the live active-catalog `pool` (so uploaded
 * dragons can hatch and retired ones can't); falls back to the legacy
 * contiguous range (1 … DRAGON_PNG_COUNT) before the catalog loads.
 */
export function pickDragonId(pool, rng = Math.random) {
  if (Array.isArray(pool) && pool.length) {
    return pool[Math.floor(rng() * pool.length)];
  }
  return Math.floor(rng() * DRAGON_PNG_COUNT) + 1;
}

/**
 * Hint text for a problem. Multiplication only: a skip-count from 1× up to the
 * answer, plus 2-4 extra numbers beyond it, never past 15×. Null otherwise.
 */
export function getHintText(operation, baseNumber, multiplier, hintLevel, rng = Math.random) {
  if (operation !== 'mul' || hintLevel === 0) {
    return null;
  }

  const counts = [];
  for (let i = 1; i <= multiplier; i++) {
    counts.push(baseNumber * i);
  }

  const extraCount = Math.floor(rng() * 3) + 2; // 2-4 extra
  const maxMultiplier = Math.min(15, multiplier + extraCount);

  for (let i = multiplier + 1; i <= maxMultiplier; i++) {
    counts.push(baseNumber * i);
  }

  return `Skip-count: ${counts.join(', ')}`;
}

export function getOperationSymbol(operation) {
  return OPERATION_SYMBOLS[operation] || '×';
}

/** Seconds as `m:ss` from a minute up, `Ns` below. */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}

/** The mastery tier earned by finishing all 12 in `elapsedSeconds`. */
export function calculateMasteryTier(elapsedSeconds) {
  const timeDisplay = formatTime(elapsedSeconds);
  if (elapsedSeconds < TIER_THRESHOLDS.legendary) {
    return {
      tier: 'legendary',
      icon: '💎',
      label: 'Mastered!',
      message: 'Incredible! You completely mastered this!',
      timeDisplay,
    };
  }
  if (elapsedSeconds < TIER_THRESHOLDS.gold) {
    return {
      tier: 'gold',
      icon: '⭐',
      label: 'Almost Mastered!',
      message: 'Excellent work! You\'re almost there!',
      timeDisplay,
    };
  }
  if (elapsedSeconds < TIER_THRESHOLDS.silver) {
    return {
      tier: 'silver',
      icon: '✨',
      label: 'Getting There!',
      message: 'Great job! Keep practicing!',
      timeDisplay,
    };
  }
  return {
    tier: 'bronze',
    icon: '🌱',
    label: 'Keep Practicing!',
    message: 'Good effort! Practice makes perfect!',
    timeDisplay,
  };
}
