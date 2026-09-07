import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DragonWordRescue, MAX_MISSES } from './DragonWordRescue';
import { soundEffects } from '../utils/soundEffects';

vi.mock('../utils/speakWord', () => ({
  speakWord: vi.fn(),
  primeSpeech: vi.fn(),
}));

vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

vi.mock('./DragonPrizeReveal', () => ({
  DragonPrizeReveal: () => <div>Dragon prize</div>,
}));

const source = {
  kind: 'grade',
  key: 'grade:test',
  label: 'Test words',
  words: ['apple'],
  perRound: 1,
};

async function guess(letter) {
  await act(async () => {
    screen.getByRole('button', { name: letter }).click();
  });
}

describe('DragonWordRescue', () => {
  it('reveals every copy of a correctly guessed letter', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    await guess('p');

    expect(screen.getByLabelText('Word to rescue')).toHaveTextContent('pp');
    expect(screen.getByRole('button', { name: 'p, already guessed' })).toBeDisabled();
    expect(soundEffects.playWrong).not.toHaveBeenCalled();
  });

  it('solves a word and records a rescue', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    for (const letter of ['a', 'p', 'l', 'e']) await guess(letter);

    expect(screen.getByText('Dry scales! You found the word.')).toBeInTheDocument();
    expect(screen.getByLabelText('The word is apple')).toHaveTextContent('apple');
    expect(soundEffects.playCorrect).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button', { name: /next rescue/i }).click();
    });
    expect(screen.getByText(/You rescued/)).toHaveTextContent('You rescued 1 of 1 words.');
    expect(screen.getByText('Dragon prize')).toBeInTheDocument();
  });

  it('reveals the word after six different misses', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    for (const letter of ['b', 'c', 'd', 'f', 'g', 'h']) await guess(letter);

    expect(MAX_MISSES).toBe(6);
    expect(screen.getByText('Splash! The word is ready to learn.')).toBeInTheDocument();
    expect(screen.getByLabelText('The word is apple')).toHaveTextContent('apple');
    expect(soundEffects.playWrong).toHaveBeenCalledTimes(6);
  });

  it('accepts letter guesses from a physical keyboard', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    });

    expect(screen.getByLabelText('Word to rescue')).toHaveTextContent('a');
  });
});
