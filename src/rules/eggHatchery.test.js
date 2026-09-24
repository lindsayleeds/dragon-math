// The Egg Hatchery rules with their rng injected: a seed fixes the problem
// order, the buttons and the dragons, so every case here is exact.
// golden/egg-hatchery.json pins the same outputs for the Swift port.

import { describe, it, expect } from 'vitest';
import { createSeededRandom } from './seededRandom';
import {
  buildAnswerChoices,
  buildProblem,
  calculateMasteryTier,
  formatTime,
  generateAnswerButtons,
  generateProblems,
  getHintText,
  getOperationSymbol,
  hintOfferDelayMs,
  pickDragonId,
} from './eggHatchery';
import { DRAGON_PNG_COUNT } from '../data/dragonRarity';

const seeded = seed => createSeededRandom(seed).next;

// An rng that replays fixed draws and counts them.
function scripted(values) {
  const rng = () => {
    if (rng.calls >= values.length) throw new Error('rng drawn too many times');
    return values[rng.calls++];
  };
  rng.calls = 0;
  return rng;
}

describe('buildProblem', () => {
  it.each([
    ['mul', 7, 3, { operand1: 7, operand2: 3, answer: 21 }],
    ['div', 4, 6, { operand1: 24, operand2: 4, answer: 6 }],
    ['add', 5, 12, { operand1: 5, operand2: 12, answer: 17 }],
    ['sub', 9, 4, { operand1: 9, operand2: 4, answer: 5 }],
    ['sub', 3, 8, { operand1: 8, operand2: 3, answer: 5 }],
    ['sub', 6, 6, { operand1: 6, operand2: 6, answer: 0 }],
  ])('%s base %i × %i', (op, base, i, expected) => {
    expect(buildProblem(base, i, op)).toEqual(expected);
  });
});

describe('generateProblems', () => {
  it('asks every multiplier once', () => {
    const problems = generateProblems('mul', 7, seeded(1));
    expect(problems.map(p => p.multiplier).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    problems.forEach(p => expect(p.correctAnswer).toBe(7 * p.multiplier));
  });

  it('is repeatable per seed', () => {
    expect(generateProblems('add', 4, seeded(42))).toEqual(generateProblems('add', 4, seeded(42)));
    expect(generateProblems('add', 4, seeded(42))).not.toEqual(generateProblems('add', 4, seeded(43)));
  });

  it('draws 11 times, Fisher-Yates from the end', () => {
    // Every draw 0.999… picks j = i: the identity order.
    const rng = scripted(Array(11).fill(0.9999));
    expect(generateProblems('mul', 2, rng).map(p => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rng.calls).toBe(11);
  });
});

describe('answer buttons', () => {
  it('puts the correct answer first, with three distinct positive distractors', () => {
    for (const seed of [0, 1, 2, 3, 42]) {
      for (const correct of [0, 1, 2, 7, 56, 144]) {
        const buttons = generateAnswerButtons(correct, seeded(seed));
        expect(buttons[0]).toBe(correct);
        expect(buttons).toHaveLength(4);
        expect(new Set(buttons).size).toBe(4);
        buttons.slice(1).forEach(d => expect(d).toBeGreaterThan(0));
      }
    }
  });

  it('draws 4 plausible values, then one per picked distractor', () => {
    const rng = scripted([0, 0, 0, 0, 0, 0, 0]);
    // Distractors 9, 11, 8, 12, then four 5s (min = 10 - 5). Unique: 9, 11, 8, 12, 5.
    expect(generateAnswerButtons(10, rng)).toEqual([10, 9, 11, 8]);
    expect(rng.calls).toBe(7);
  });

  it('shuffles the buttons with three more draws', () => {
    const rng = scripted([0, 0, 0, 0, 0, 0, 0, 0.9999, 0.9999, 0.9999]);
    expect(buildAnswerChoices(10, rng)).toEqual([10, 9, 11, 8]);
    expect(rng.calls).toBe(10);
  });
});

describe('hint delay, dragon pick and hint text', () => {
  it('offers the hint 5-7s in', () => {
    expect(hintOfferDelayMs(() => 0)).toBe(5000);
    expect(hintOfferDelayMs(() => 0.5)).toBe(6000);
  });

  it('picks from the pool, or the legacy range without one', () => {
    expect(pickDragonId([5, 17, 42], () => 0.5)).toBe(17);
    expect(pickDragonId(null, () => 0)).toBe(1);
    expect(pickDragonId([], () => 0.9999)).toBe(DRAGON_PNG_COUNT);
  });

  it('skip-counts past the answer by 2-4, never past 15×', () => {
    expect(getHintText('mul', 7, 3, 1, () => 0)).toBe('Skip-count: 7, 14, 21, 28, 35');
    expect(getHintText('mul', 7, 3, 1, () => 0.9999)).toBe('Skip-count: 7, 14, 21, 28, 35, 42, 49');
    expect(getHintText('mul', 1, 14, 1, () => 0.9999)).toBe(
      'Skip-count: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15',
    );
  });

  it('gives no hint, and draws nothing, off multiplication or when hidden', () => {
    const rng = scripted([]);
    expect(getHintText('add', 7, 3, 1, rng)).toBeNull();
    expect(getHintText('mul', 7, 3, 0, rng)).toBeNull();
  });

  it('knows each operation symbol, defaulting to ×', () => {
    expect(['mul', 'div', 'add', 'sub', 'nope'].map(getOperationSymbol)).toEqual(['×', '÷', '+', '−', '×']);
  });
});

describe('mastery tiers', () => {
  it.each([
    [0, 'legendary', '0s'],
    [14.999, 'legendary', '14s'],
    [15, 'gold', '15s'],
    [25, 'silver', '25s'],
    [40, 'bronze', '40s'],
    [75.2, 'bronze', '1:15'],
  ])('%fs → %s', (seconds, tier, timeDisplay) => {
    expect(calculateMasteryTier(seconds)).toMatchObject({ tier, timeDisplay });
  });

  it('formats minutes with padded seconds', () => {
    expect(formatTime(605)).toBe('10:05');
  });
});

describe('defaults', () => {
  it('falls back to Math.random with no rng', () => {
    expect(generateProblems('mul', 3)).toHaveLength(12);
    expect(buildAnswerChoices(9)).toHaveLength(4);
  });
});
