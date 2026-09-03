import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DragonSpelling } from './DragonSpelling';

vi.mock('../data/spellingWords', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pickWords: () => ['cat'] };
});

vi.mock('../utils/speakWord', () => ({
  speakWord: vi.fn(),
  primeSpeech: vi.fn(),
}));

vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('DragonSpelling hints', () => {
  it.each(['easy', 'medium', 'hard'])('offers a hint in %s mode', async (difficulty) => {
    if (difficulty === 'medium') vi.useFakeTimers();
    render(<DragonSpelling grade={1} difficulty={difficulty} onComplete={vi.fn()} />);

    if (difficulty === 'medium') {
      await act(async () => { vi.advanceTimersByTime(2500); });
    }

    const button = screen.getByRole('button', { name: /show hint/i });
    await act(async () => { button.click(); });
    expect(screen.getByText(/starts with “c” · 3 letters/i)).toBeInTheDocument();
  });

  it('counts each hinted word once and reports the total in the results', async () => {
    render(<DragonSpelling grade={1} difficulty="hard" onComplete={vi.fn()} />);

    await act(async () => { screen.getByRole('button', { name: /show hint/i }).click(); });
    await act(async () => { screen.getByRole('button', { name: /hide hint/i }).click(); });
    await act(async () => { screen.getByRole('button', { name: /show hint/i }).click(); });

    for (const letter of ['c', 'a', 't']) {
      await act(async () => { screen.getByRole('button', { name: letter }).click(); });
    }
    await act(async () => { screen.getByText('Check it', { selector: 'button' }).click(); });
    await act(async () => { screen.getByRole('button', { name: /OK!/i }).click(); });

    expect(screen.getByText(/You used/)).toHaveTextContent('You used 1 hint.');
  });
});
