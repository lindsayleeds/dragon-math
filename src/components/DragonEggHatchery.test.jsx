// Characterisation tests for Dragon Egg Hatchery.
//
// This component carries 4 findings: two set-state-in-effect and two
// exhaustive-deps. The set-state effects are the ones that matter — one
// regenerates the whole problem set when `operation`/`baseNumber` change (and
// resets progress with it), the other rebuilds and reshuffles the answer buttons
// for each problem. The standard fix for "you might not need an effect" here is
// to derive the problems instead, or to key the component; both change WHEN a
// reset happens. Getting that wrong either wipes a child's progress mid-game or
// leaves them answering the previous number's questions.
//
// These tests therefore pin the reset contract and the answer contract through
// the DOM, so they survive a rewrite of the effects.
//
// Randomness (problem shuffle, distractor choice, dragon id) is left alone where
// it doesn't matter and pinned where it does; the correct answer is always found
// by reading the rendered problem text rather than by assuming button order.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DragonEggHatchery } from './DragonEggHatchery';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ dragons: [] })),
    post: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

const HATCH_MS = 800;      // egg crack animation before the next problem
const ACHIEVE_MS = 300;    // achievement screen delay after the 12th hatch
const OP_SYMBOL = { mul: '×', div: '÷', add: '+', sub: '−' };

beforeEach(() => {
  vi.useFakeTimers();
  api.get.mockResolvedValue({ dragons: [] });
  api.post.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderGame(props = {}) {
  return render(<DragonEggHatchery operation="mul" baseNumber={7} onComplete={vi.fn()} {...props} />);
}

// Read the problem on screen and work out the expected answer from the operator,
// so the test never has to guess which of the four buttons is right.
function currentProblem(operation = 'mul') {
  const text = document.querySelector('[class*="problemText"]').textContent;
  const symbol = OP_SYMBOL[operation];
  const [left, right] = text.split(symbol).map(s => parseInt(s.trim(), 10));
  const answer = operation === 'mul' ? left * right
    : operation === 'div' ? left / right
      : operation === 'add' ? left + right
        : left - right;
  return { left, right, answer };
}

function answerButtons() {
  return screen.getAllByRole('button').filter(b => /^-?\d+$/.test(b.textContent.trim()));
}

async function answerCorrectly(operation = 'mul') {
  const { answer } = currentProblem(operation);
  const button = answerButtons().find(b => Number(b.textContent) === answer);
  expect(button, `no button offered the correct answer ${answer}`).toBeTruthy();
  await act(async () => { button.click(); });
  await act(async () => { vi.advanceTimersByTime(HATCH_MS); });
}

async function answerWrongly(operation = 'mul') {
  const { answer } = currentProblem(operation);
  const button = answerButtons().find(b => Number(b.textContent) !== answer);
  await act(async () => { button.click(); });
}

const hatchedCount = () =>
  Number(document.querySelector('[class*="progressCount"]').textContent.split('/')[0]);

describe('DragonEggHatchery — the problem set', () => {
  it('offers four distinct answers, one of them correct', () => {
    renderGame();
    const buttons = answerButtons();
    expect(buttons).toHaveLength(4);
    const values = buttons.map(b => Number(b.textContent));
    expect(new Set(values).size).toBe(4);
    expect(values).toContain(currentProblem().answer);
  });

  it.each([
    ['mul', 7],
    ['add', 4],
    ['sub', 9],
    ['div', 3],
  ])('builds solvable %s problems for base %i', (operation, baseNumber) => {
    renderGame({ operation, baseNumber });
    const { answer } = currentProblem(operation);
    expect(Number.isInteger(answer)).toBe(true);
    expect(answer).toBeGreaterThanOrEqual(0); // never negative for a child
    expect(answerButtons().map(b => Number(b.textContent))).toContain(answer);
  });

  it('asks each of the twelve multipliers exactly once', async () => {
    renderGame({ operation: 'mul', baseNumber: 7 });
    const seen = [];
    for (let i = 0; i < 12; i++) {
      const { left, right } = currentProblem();
      seen.push(left === 7 ? right : left);
      if (i < 11) await answerCorrectly();
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('DragonEggHatchery — hatching', () => {
  it('hatches an egg and moves on after a correct answer', async () => {
    renderGame();
    const before = currentProblem();
    expect(hatchedCount()).toBe(0);
    await answerCorrectly();
    expect(hatchedCount()).toBe(1);
    expect(currentProblem()).not.toEqual(before);
  });

  it('collects one baby dragon per hatched egg', async () => {
    renderGame();
    await answerCorrectly();
    await answerCorrectly();
    expect(screen.getAllByAltText('Baby dragon')).toHaveLength(2);
  });

  it('keeps the child on the same problem after a wrong answer', async () => {
    renderGame();
    const before = currentProblem();
    await answerWrongly();
    expect(screen.getByText(/Try again/)).toBeInTheDocument();
    expect(hatchedCount()).toBe(0);
    expect(currentProblem()).toEqual(before);
  });

  it('lets the child retry after the wrong answer clears', async () => {
    renderGame();
    await answerWrongly();
    await act(async () => { vi.advanceTimersByTime(500); });
    await answerCorrectly();
    expect(hatchedCount()).toBe(1);
  });

  it('ignores extra taps during the hatch animation', async () => {
    renderGame();
    const { answer } = currentProblem();
    const correct = answerButtons().find(b => Number(b.textContent) === answer);
    await act(async () => { correct.click(); });
    // Buttons are disabled mid-animation; a frantic child taps anyway.
    await act(async () => { answerButtons().forEach(b => b.click()); });
    await act(async () => { vi.advanceTimersByTime(HATCH_MS); });
    expect(hatchedCount()).toBe(1);
  });
});

// The reset effect. A refactor that derives problems instead of syncing them in
// an effect must preserve BOTH of these: a changed number starts over, and an
// unchanged number does not.
describe('DragonEggHatchery — resetting on a new skill', () => {
  it('starts over when the base number changes', async () => {
    const { rerender } = renderGame({ operation: 'mul', baseNumber: 7 });
    await answerCorrectly();
    await answerCorrectly();
    expect(hatchedCount()).toBe(2);

    await act(async () => {
      rerender(<DragonEggHatchery operation="mul" baseNumber={8} onComplete={vi.fn()} />);
    });

    expect(hatchedCount()).toBe(0);
    expect(screen.queryAllByAltText('Baby dragon')).toHaveLength(0);
    const { left, right } = currentProblem();
    expect([left, right]).toContain(8);
  });

  it('starts over when the operation changes', async () => {
    const { rerender } = renderGame({ operation: 'mul', baseNumber: 7 });
    await answerCorrectly();
    await act(async () => {
      rerender(<DragonEggHatchery operation="add" baseNumber={7} onComplete={vi.fn()} />);
    });
    expect(hatchedCount()).toBe(0);
    expect(document.querySelector('[class*="problemText"]').textContent).toContain('+');
  });

  it('does NOT wipe progress on an unrelated re-render', async () => {
    const onComplete = vi.fn();
    const { rerender } = renderGame({ operation: 'mul', baseNumber: 7, onComplete });
    await answerCorrectly();
    await answerCorrectly();
    const problemBefore = currentProblem();

    // Same skill, new callback identity — exactly what a parent re-render does.
    await act(async () => {
      rerender(<DragonEggHatchery operation="mul" baseNumber={7} onComplete={vi.fn()} />);
    });

    expect(hatchedCount()).toBe(2);
    expect(currentProblem()).toEqual(problemBefore);
  });
});

describe('DragonEggHatchery — finishing the set', () => {
  async function playThrough() {
    for (let i = 0; i < 12; i++) await answerCorrectly();
    await act(async () => { vi.advanceTimersByTime(ACHIEVE_MS); });
  }

  it('celebrates with a full dozen and a mastery tier', async () => {
    renderGame();
    await playThrough();
    expect(screen.getByText('12/12')).toBeInTheDocument();
    // Fake timers mean no wall-clock elapsed, so this is the fastest tier.
    expect(screen.getByText('Mastered!')).toBeInTheDocument();
    expect(screen.getAllByAltText('Baby dragon')).toHaveLength(12);
  });

  it('reports the result to the server once, with all twelve problems', async () => {
    renderGame({ operation: 'mul', baseNumber: 7 });
    await playThrough();

    const results = api.post.mock.calls.filter(([p]) => p === '/api/game-result');
    expect(results).toHaveLength(1);
    const [, body] = results[0];
    expect(body).toMatchObject({ operation: 'mul', base_number: 7 });
    expect(body.problems).toHaveLength(12);
    expect(body.problems.every(p => p.outcome === 'child')).toBe(true);
    expect(body.problems.map(p => p.multiplier).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('saves the hatched dragons to the permanent collection', async () => {
    api.get.mockResolvedValue({ dragons: [{ dragon_id: 42 }] });
    renderGame();
    await playThrough();

    const collects = api.post.mock.calls.filter(([p]) => p === '/api/dragons/collect');
    expect(collects).toHaveLength(1);
    expect(collects[0][1].dragon_ids).toHaveLength(12);
    // With a one-dragon catalog, every hatch must come from it.
    expect(new Set(collects[0][1].dragon_ids)).toEqual(new Set([42]));
  });

  it('still celebrates when saving the result fails', async () => {
    api.post.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderGame();
    await playThrough();
    expect(screen.getByText('12/12')).toBeInTheDocument();
  });

  it('hands control back to the caller on continue', async () => {
    const onComplete = vi.fn();
    renderGame({ onComplete });
    await playThrough();
    const button = screen.getByRole('button', { name: /continue|keep going|done/i });
    await act(async () => { button.click(); });
    expect(onComplete).toHaveBeenCalled();
  });
});

describe('DragonEggHatchery — hints', () => {
  it('offers a hand only after the child has been stuck a while', async () => {
    renderGame();
    expect(screen.queryByRole('button', { name: /Get a hint/i })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(7000); });
    expect(screen.getByRole('button', { name: /Get a hint/i })).toBeInTheDocument();
  });

  it('shows and hides the hint text on demand', async () => {
    renderGame();
    await act(async () => { vi.advanceTimersByTime(7000); });
    const hintButton = screen.getByRole('button', { name: /Get a hint/i });
    await act(async () => { hintButton.click(); });
    expect(document.querySelector('[class*="hintText"]')).toBeTruthy();
    await act(async () => { screen.getByRole('button', { name: /Hide hint/i }).click(); });
    expect(document.querySelector('[class*="hintText"]')).toBeFalsy();
  });

  it('withdraws the hint offer once the child answers', async () => {
    renderGame();
    await act(async () => { vi.advanceTimersByTime(7000); });
    expect(screen.getByRole('button', { name: /Get a hint/i })).toBeInTheDocument();
    await answerCorrectly();
    expect(screen.queryByRole('button', { name: /Get a hint/i })).toBeNull();
  });
});

describe('DragonEggHatchery — quitting', () => {
  it('asks before throwing away a part-finished set', async () => {
    renderGame();
    await answerCorrectly();
    await act(async () => { screen.getByLabelText('Quit game').click(); });
    expect(screen.getByText('Are you sure you want to quit?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, quit' })).toBeInTheDocument();
  });

  it('leaves progress untouched if the child changes their mind', async () => {
    renderGame();
    await answerCorrectly();
    await answerCorrectly();
    const problemBefore = currentProblem();

    await act(async () => { screen.getByLabelText('Quit game').click(); });
    await act(async () => { screen.getByRole('button', { name: 'Keep playing' }).click(); });

    expect(screen.queryByText('Are you sure you want to quit?')).toBeNull();
    expect(hatchedCount()).toBe(2);
    expect(currentProblem()).toEqual(problemBefore);
  });

  it('hands back to the caller when the child confirms', async () => {
    const onComplete = vi.fn();
    renderGame({ onComplete });
    await act(async () => { screen.getByLabelText('Quit game').click(); });
    await act(async () => { screen.getByRole('button', { name: 'Yes, quit' }).click(); });
    expect(onComplete).toHaveBeenCalled();
  });
});
