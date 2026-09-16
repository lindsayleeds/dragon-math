import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(screen.getByRole('status')).toHaveTextContent('Word rescued. The word is apple. 0 misses.');
    expect(soundEffects.playCorrect).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button', { name: /next rescue/i }).click();
    });
    expect(screen.getByText(/You rescued/)).toHaveTextContent('You rescued 1 of 1 words.');
    expect(screen.getByText('Dragon prize')).toBeInTheDocument();
  });

  it('reveals the word after six different misses', async () => {
    vi.useFakeTimers();
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    for (const letter of ['b', 'c', 'd', 'f', 'g', 'h']) await guess(letter);

    expect(MAX_MISSES).toBe(6);
    expect(screen.getByRole('status')).toHaveTextContent('Six misses. Splash!');
    expect(screen.queryByLabelText('The word is apple')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText('Splash! The word is ready to learn.')).toBeInTheDocument();
    expect(screen.getByLabelText('The word is apple')).toHaveTextContent('apple');
    expect(screen.getByRole('status')).toHaveTextContent('Rescue missed. The word is apple. Wrong letters: b, c, d, f, g, h.');
    expect(soundEffects.playWrong).toHaveBeenCalledTimes(6);
  });

  it('announces wrong letters and misses remaining', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    expect(screen.getByText('Choose the letters you hear in the word.')).toBeVisible();
    await guess('b');

    expect(screen.getByRole('status')).toHaveTextContent('B is not in the word. 5 misses remaining. Wrong letters: b.');
  });

  it('accepts letter guesses from a physical keyboard', async () => {
    render(<DragonWordRescue source={source} onComplete={vi.fn()} />);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    });

    expect(screen.getByLabelText('Word to rescue')).toHaveTextContent('a');
  });

  it('isolates best scores by player and custom-list revision', async () => {
    vi.useFakeTimers();
    const listV1 = { ...source, kind: 'list', key: 'list:7', revision: 'v1' };
    const listV2 = { ...listV1, revision: 'v2' };
    const first = render(
      <DragonWordRescue source={listV1} playerScope="player:1" persistentScores onComplete={vi.fn()} />,
    );

    for (const letter of ['a', 'p', 'l', 'e']) await guess(letter);
    await act(async () => screen.getByRole('button', { name: /next rescue/i }).click());
    expect(screen.getByText('Best: 1 / 1')).toBeInTheDocument();
    first.unmount();

    const second = render(
      <DragonWordRescue source={listV1} playerScope="player:2" persistentScores onComplete={vi.fn()} />,
    );
    for (const letter of ['b', 'c', 'd', 'f', 'g', 'h']) await guess(letter);
    await act(async () => vi.advanceTimersByTime(1100));
    await act(async () => screen.getByRole('button', { name: /try the next word/i }).click());
    expect(screen.getByText('Best: 0 / 1')).toBeInTheDocument();
    second.unmount();

    render(
      <DragonWordRescue source={listV2} playerScope="player:1" persistentScores onComplete={vi.fn()} />,
    );
    for (const letter of ['b', 'c', 'd', 'f', 'g', 'h']) await guess(letter);
    await act(async () => vi.advanceTimersByTime(1100));
    await act(async () => screen.getByRole('button', { name: /try the next word/i }).click());
    expect(screen.getByText('Best: 0 / 1')).toBeInTheDocument();
  });
});
