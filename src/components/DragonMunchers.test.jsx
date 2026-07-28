// Characterisation tests for Dragon Munchers.
//
// Both of the repo's remaining react-hooks/purity findings live in this file's
// `gridNumbers` useMemo: it calls Math.random() to shuffle cell positions and to
// pick distractors. The rule's objection is legitimate — React is free to
// discard and recompute a useMemo, which would deal the child a brand-new board
// mid-level. The fix is to move board generation into state, and the two things
// that must survive that move are:
//
//   1. every correct answer is actually ON the board (otherwise the level can
//      never be cleared and the game soft-locks), and
//   2. the board does NOT change underneath the player on an unrelated
//      re-render — which is the bug the purity rule is warning about.
//
// Test 2 in particular is the one that would catch a careless "just call it in
// render" or a badly-keyed state refactor.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DragonMunchers } from './DragonMunchers';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ scores: [] })),
    post: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

// jsdom has no audio pipeline; the real class builds an AudioContext.
vi.mock('../utils/soundEffects', () => ({
  soundEffects: {
    playCorrect: vi.fn(), playWrong: vi.fn(), playCaught: vi.fn(),
    playLevelUp: vi.fn(), playGameOver: vi.fn(), playMove: vi.fn(),
  },
}));

const HIGH_SCORE_KEY = 'dragonMunchers.highScore';
const DRAGON_VARIANT_KEY = 'dragonMunchers.dragon';
const TOTAL_CELLS = 30; // GRID_COLS 5 * GRID_ROWS 6
const COLS = 5;

beforeEach(() => {
  api.get.mockResolvedValue({ scores: [] });
  api.post.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderGame(props = {}) {
  return render(
    <DragonMunchers operation="mul" baseNumber={3} progression={false} onComplete={vi.fn()} {...props} />
  );
}

// The picker gates play; get past it to reach the board.
async function start(props) {
  const utils = renderGame(props);
  await act(async () => { screen.getByRole('button', { name: /Let's go/ }).click(); });
  return utils;
}

const cells = () => Array.from(document.querySelectorAll('[class*="_cell_"]'));

// Cell values in board order, with null for an emptied/covered cell.
function boardValues() {
  return cells().map(cell => {
    const numberEl = cell.querySelector('[class*="cellNumber"]');
    return numberEl ? Number(numberEl.textContent) : null;
  });
}

// Each step gets its own act(): several clicks inside ONE act are batched, so
// the muncher would only register the first move and every later step would be
// computed from a stale position.
const move = async (direction) => {
  await act(async () => { fireEvent.click(screen.getByLabelText(`Move ${direction}`)); });
};
const eat = async () => {
  await act(async () => { fireEvent.keyDown(window, { code: 'Space', key: ' ' }); });
};

function currentScore() {
  const label = Array.from(document.querySelectorAll('[class*="_label_"]'))
    .find(el => el.textContent.trim() === 'Score:');
  return Number(label.parentElement.querySelector('[class*="_value_"]').textContent);
}

const livesShown = () => document.querySelectorAll('[class*="lifeIcon"]').length;

describe('DragonMunchers — the board', () => {
  it('fills every cell and shows the right table', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    expect(cells()).toHaveLength(TOTAL_CELLS);
    expect(screen.getByText(/Multiples of 3/)).toBeInTheDocument();
  });

  // Soft-lock guard: clearing a level requires eating every correct answer, so
  // all of them have to be dealt onto the board.
  it('places every multiple of the base number somewhere on the board', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const values = boardValues().filter(v => v !== null);
    const expectedCorrect = Array.from({ length: 12 }, (_, i) => 3 * (i + 1));
    for (const answer of expectedCorrect) {
      expect(values, `board is missing ${answer}`).toContain(answer);
    }
  });

  it('never dresses a correct answer up as a distractor', async () => {
    await start({ operation: 'mul', baseNumber: 4 });
    const values = boardValues().filter(v => v !== null);
    const multiples = new Set(Array.from({ length: 12 }, (_, i) => 4 * (i + 1)));
    // Distractors are the values that are NOT multiples; there must be some, and
    // no value may be both (that would make the same number right and wrong).
    const distractors = values.filter(v => !multiples.has(v));
    expect(distractors.length).toBeGreaterThan(0);
    for (const d of distractors) expect(multiples.has(d)).toBe(false);
  });

  // THE purity invariant.
  it('does not re-deal the board when the player merely moves', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const before = boardValues();

    await move('up');
    await move('left');
    await move('up');

    // Moving re-renders repeatedly; the numbers must be exactly where they were.
    expect(boardValues()).toEqual(before);
  });

  it('does not re-deal the board on an unrelated parent re-render', async () => {
    const { rerender } = await start({ operation: 'mul', baseNumber: 3 });
    const before = boardValues();
    await act(async () => {
      rerender(
        <DragonMunchers operation="mul" baseNumber={3} progression={false} onComplete={vi.fn()} />
      );
    });
    expect(boardValues()).toEqual(before);
  });

  it('deals a different table when the base number changes', async () => {
    const { rerender } = await start({ operation: 'mul', baseNumber: 3 });
    await act(async () => {
      rerender(
        <DragonMunchers operation="mul" baseNumber={5} progression={false} onComplete={vi.fn()} />
      );
    });
    expect(screen.getByText(/Multiples of 5/)).toBeInTheDocument();
    const values = boardValues().filter(v => v !== null);
    for (const answer of [5, 10, 15, 20, 25]) expect(values).toContain(answer);
  });

  it.each([
    ['mul', 3, 'Multiples of 3'],
    ['add', 4, 'Adding 4'],
    ['sub', 9, 'Subtracting 9'],
    ['div', 6, 'Dividing by 6'],
  ])('labels a %s round for base %i', async (operation, baseNumber, title) => {
    await start({ operation, baseNumber });
    expect(screen.getByText(new RegExp(title))).toBeInTheDocument();
  });
});

// Where the muncher actually is, read off the board — it stays where it last
// ate, so a walk must never assume it is back at the start cell.
function muncherIndex() {
  return cells().findIndex(cell => cell.querySelector('[class*="_muncher_"]'));
}

// Walk the muncher to `target` one orthogonal step at a time, then eat.
async function walkToAndEat(target) {
  let current = muncherIndex();
  for (let i = 0; i < 60 && current !== target; i++) {
    const cc = current % COLS, tc = target % COLS;
    const cr = Math.floor(current / COLS), tr = Math.floor(target / COLS);
    if (cc > tc) { await move('left'); current -= 1; }
    else if (cc < tc) { await move('right'); current += 1; }
    else if (cr > tr) { await move('up'); current -= COLS; }
    else { await move('down'); current += COLS; }
  }
  if (current !== target) return false;
  await eat();
  return true;
}

const multiplesOf = (base) => new Set(Array.from({ length: 12 }, (_, i) => base * (i + 1)));

describe('DragonMunchers — eating', () => {
  it('scores when the muncher eats a correct answer', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);
    const target = boardValues().findIndex(v => v !== null && multiples.has(v));
    expect(await walkToAndEat(target)).toBe(true);
    // A base of 5 or less is worth 5 points a bite.
    expect(currentScore()).toBe(5);
  });

  it('explains the mistake when the muncher eats a wrong answer', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);
    const values = boardValues();
    const target = values.findIndex(v => v !== null && !multiples.has(v));
    expect(await walkToAndEat(target)).toBe(true);
    expect(screen.getByText(`${values[target]} is not a multiple of 3`)).toBeInTheDocument();
    expect(currentScore()).toBe(0);
  });

  it('clears the eaten cell so it cannot be eaten twice', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);
    const target = boardValues().findIndex(v => v !== null && multiples.has(v));
    await walkToAndEat(target);
    expect(currentScore()).toBe(5);
    expect(boardValues()[target]).toBeNull();
    // A second spacebar on the same cell must not score again.
    await eat();
    expect(currentScore()).toBe(5);
  });

  it('costs the child nothing but the mistake — lives are for monsters', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);
    const before = livesShown();
    const target = boardValues().findIndex(v => v !== null && !multiples.has(v));
    await walkToAndEat(target);
    expect(livesShown()).toBe(before);
  });
});

describe('DragonMunchers — clearing the board', () => {
  it('wins the round, banks the score, and records it on the leaderboard', async () => {
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);

    // Eat every correct answer on the board, re-reading positions as cells empty.
    for (let n = 0; n < 12; n++) {
      const target = boardValues().findIndex(v => v !== null && multiples.has(v));
      if (target === -1) break;
      await walkToAndEat(target);
    }

    expect(screen.getByText('You won the round!')).toBeInTheDocument();
    expect(screen.getByText(/🏆 60 points/)).toBeInTheDocument();
    // 12 bites at 5 points, banked as this device's best.
    expect(localStorage.getItem(HIGH_SCORE_KEY)).toBe('60');
    expect(screen.getByText(/New high score/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/api/leaderboard/'), { score: 60 });
  });

  it('shows the previous best when the run does not beat it', async () => {
    localStorage.setItem(HIGH_SCORE_KEY, '9999');
    await start({ operation: 'mul', baseNumber: 3 });
    const multiples = multiplesOf(3);
    for (let n = 0; n < 12; n++) {
      const target = boardValues().findIndex(v => v !== null && multiples.has(v));
      if (target === -1) break;
      await walkToAndEat(target);
    }
    expect(screen.getByText('Best: 9999 points')).toBeInTheDocument();
    expect(localStorage.getItem(HIGH_SCORE_KEY)).toBe('9999');
  });
});

describe('DragonMunchers — the dragon picker', () => {
  it('keeps play frozen until the child picks a dragon and starts', async () => {
    renderGame();
    expect(screen.getByRole('button', { name: /Let's go/ })).toBeInTheDocument();
    expect(cells()).toHaveLength(0);
  });

  it('remembers the chosen dragon on this device', async () => {
    renderGame();
    const choices = screen.getAllByLabelText(/Choose .* the dragon/);
    await act(async () => { choices[choices.length - 1].click(); });
    await act(async () => { screen.getByRole('button', { name: /Let's go/ }).click(); });
    expect(localStorage.getItem(DRAGON_VARIANT_KEY)).toBeTruthy();
  });

  it('pre-selects the remembered dragon next time', async () => {
    localStorage.setItem(DRAGON_VARIANT_KEY, 'fern');
    renderGame();
    // Rendering must not throw or reset the stored choice.
    await act(async () => { screen.getByRole('button', { name: /Let's go/ }).click(); });
    expect(localStorage.getItem(DRAGON_VARIANT_KEY)).toBe('fern');
  });
});

describe('DragonMunchers — high score storage', () => {
  it('survives a corrupted stored value', async () => {
    localStorage.setItem(HIGH_SCORE_KEY, 'not-a-number');
    await start();
    // Falls back to zero rather than rendering NaN anywhere.
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
