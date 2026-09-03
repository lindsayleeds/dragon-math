import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DragonSpelling } from './DragonSpelling';

vi.mock('../utils/speakWord', () => ({
  speakWord: vi.fn(),
  primeSpeech: vi.fn(),
}));

vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

const source = {
  kind: 'grade',
  key: 'grade:1',
  label: 'Grade 1',
  words: ['cat'],
  perRound: 1,
};

describe('DragonSpelling hints', () => {
  it.each(['easy', 'medium', 'hard'])('offers a hint in %s mode', async (difficulty) => {
    if (difficulty === 'medium') vi.useFakeTimers();
    render(<DragonSpelling source={source} difficulty={difficulty} onComplete={vi.fn()} />);

    if (difficulty === 'medium') {
      await act(async () => { vi.advanceTimersByTime(2500); });
    }

    const button = screen.getByRole('button', {
      name: difficulty === 'easy' ? /hint — show the word/i : /show hint/i,
    });
    await act(async () => { button.click(); });
    if (difficulty === 'easy') {
      expect(screen.getByRole('status')).toHaveTextContent('cat');
      expect(screen.queryByRole('button', { name: /show hint/i })).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(/starts with “c” · 3 letters/i)).toBeInTheDocument();
    }
  });

  it('counts each hinted word once and reports the total in the results', async () => {
    render(<DragonSpelling source={source} difficulty="hard" onComplete={vi.fn()} />);

    await act(async () => { screen.getByRole('button', { name: /show hint/i }).click(); });
    await act(async () => { screen.getByRole('button', { name: /hide hint/i }).click(); });
    await act(async () => { screen.getByRole('button', { name: /show hint/i }).click(); });

    for (const letter of ['c', 'a', 't']) {
      await act(async () => { screen.getByRole('button', { name: letter }).click(); });
    }
    await act(async () => { screen.getByText('Check it', { selector: 'button' }).click(); });
    await act(async () => { screen.getByRole('button', { name: /OK!/i }).click(); });

    expect(screen.getByText(/You used/)).toHaveTextContent('You used 1 hint.');

    await act(async () => { screen.getByRole('button', { name: /play again/i }).click(); });
    for (const letter of ['c', 'a', 't']) {
      await act(async () => { screen.getByRole('button', { name: letter }).click(); });
    }
    await act(async () => { screen.getByText('Check it', { selector: 'button' }).click(); });
    await act(async () => { screen.getByRole('button', { name: /OK!/i }).click(); });

    expect(screen.getByText(/You used/)).toHaveTextContent('You used 0 hints.');
  });

  it('counts Easy word peeks once', async () => {
    render(<DragonSpelling source={source} difficulty="easy" onComplete={vi.fn()} />);

    await act(async () => { screen.getByRole('button', { name: /hint — show the word/i }).click(); });
    await act(async () => { screen.getByRole('status').click(); });
    await act(async () => { screen.getByRole('button', { name: /hint — show the word/i }).click(); });
    await act(async () => { screen.getByRole('status').click(); });

    for (const letter of ['c', 'a', 't']) {
      await act(async () => { screen.getByRole('button', { name: letter }).click(); });
    }
    await act(async () => { screen.getByText('Check it', { selector: 'button' }).click(); });
    await act(async () => { screen.getByRole('button', { name: /OK!/i }).click(); });

    expect(screen.getByText(/You used/)).toHaveTextContent('You used 1 hint.');
  });
});
