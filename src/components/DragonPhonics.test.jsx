import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DragonPhonics } from './DragonPhonics';

vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

vi.mock('../utils/speakWord', () => ({
  speakWord: vi.fn(),
  primeSpeech: vi.fn(),
}));

vi.mock('../data/phonicsWords', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    pickPhonicsWords: () => [{ g: ['c', 'a', 't'], b: 1 }],
  };
});

describe('DragonPhonics', () => {
  it('records one mastery attempt when an answer is double-tapped', async () => {
    const onSave = vi.fn();
    render(<DragonPhonics level="vowels" onSave={onSave} onComplete={vi.fn()} />);
    const answer = screen.getByRole('button', { name: 'Choose a, as in apple' });

    await act(async () => {
      fireEvent.click(answer);
      fireEvent.click(answer);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /OK!/ }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toHaveLength(1);
  });
});
