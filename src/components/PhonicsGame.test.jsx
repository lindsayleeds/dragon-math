// Characterisation tests for the three Dragon Phonics sound games.
//
// These assert the LATE-FIRING consequences of the component's guards rather
// than the guards themselves, so a correct refactor keeps them green:
//
//   1. A second tap while feedback is showing must not score against the next
//      sound. The round hook keeps the current item in a render-phase ref for
//      exactly this reason; with a stale closure the child would silently get a
//      wrong answer recorded for a sound they never heard.
//   2. A finished round saves EXACTLY once. A re-render in the done phase — a
//      mastery refresh landing, a parent's state change — would otherwise post
//      the same attempts again and double-count the round in the child's
//      history, which is invisible until a parent reads an inflated number.
//   3. The attempts posted must describe what actually happened: the right
//      element, the right mode, and a wrong answer identified as the element
//      the child confused it with.
//
// Audio is stubbed throughout: jsdom has no playback, and the real speakSound
// would try to fetch an mp3.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PhonicsGame } from './PhonicsGame';
import { ELEMENT_BY_KEY } from '../data/phonicsCurriculum';

vi.mock('../utils/speakSound', () => ({
  speakSound: vi.fn(() => Promise.resolve()),
  speakSoundInWord: vi.fn(() => Promise.resolve()),
  primeSounds: vi.fn(),
  soundAudioReady: vi.fn(() => true),
  phonicsAudioUrl: (k) => `/audio/phonics/${k}.mp3`,
}));

vi.mock('../utils/speakWord', () => ({
  speakWord: vi.fn(() => Promise.resolve()),
  primeSpeech: vi.fn(),
}));

vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

// The prize reveal animates and is irrelevant to scoring.
vi.mock('./DragonPrizeReveal', () => ({
  DragonPrizeReveal: () => <div data-testid="prize" />,
}));

afterEach(() => {
  vi.clearAllMocks();
});

// Stage 2 is the five short vowels, so a round is exactly five questions —
// short enough to play to the end in a test without fighting randomness.
const STAGE = 2;
const ROUND_LENGTH = 5;

function renderGame(props = {}) {
  const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
  const onExit = vi.fn();
  const utils = render(
    <PhonicsGame mode="choose" stages={STAGE} onSave={onSave} onExit={onExit} {...props} />,
  );
  return { onSave, onExit, ...utils };
}

// The option tiles, in render order. They are shuffled per item, and each tile
// shows its OWN letters and sound — so which one is correct cannot be read off
// the screen, which is the point of the game. Tests that need a known outcome
// pin the round to a single element with `only` and then match on its letters.
function optionTiles() {
  const group = screen.getByRole('group', { name: /sound choices/i });
  return [...group.querySelectorAll('button')];
}

const lettersOf = (tile) => tile.querySelector('span').textContent;

// Answer every question by taking the first tile, then dismissing feedback.
// Which answers land right is left to the shuffle; the assertions below are
// about the SHAPE of what gets posted, not about the score.
async function playRound(length = ROUND_LENGTH) {
  for (let i = 0; i < length; i++) {
    await act(async () => { fireEvent.click(optionTiles()[0]); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /OK!|Got it/ }));
    });
  }
}

describe('PhonicsGame — scoring integrity', () => {
  it('ignores a second tap while feedback is showing', async () => {
    // The stale-closure bug this guards: the extra tap would be scored against
    // whichever sound came next, adding a 6th attempt to a 5-question round.
    const { onSave } = renderGame();

    for (let i = 0; i < ROUND_LENGTH; i++) {
      const tiles = optionTiles();
      await act(async () => { fireEvent.click(tiles[0]); });
      // Tapping the (now detached) option again must do nothing: the feedback
      // card has replaced the tiles, so re-clicking the same node is the closest
      // a test can get to a double-tap that lands after the phase moved on.
      await act(async () => { fireEvent.click(tiles[0]); });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /OK!|Got it/ }));
      });
    }

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toHaveLength(ROUND_LENGTH);
  });

  it('saves a finished round exactly once, even across re-renders', async () => {
    const { onSave, rerender } = renderGame();
    await playRound();

    expect(onSave).toHaveBeenCalledTimes(1);

    // A parent re-render in the done phase — a mastery refresh landing, say.
    await act(async () => {
      rerender(
        <PhonicsGame
          mode="choose"
          stages={STAGE}
          onSave={onSave}
          onExit={vi.fn()}
          mastery={{ 'short-a': { level: 'solid' } }}
        />,
      );
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('posts one attempt per question, tagged with the mode it was asked in', async () => {
    const { onSave } = renderGame({ mode: 'choose' });
    await playRound();

    const attempts = onSave.mock.calls[0][0];
    expect(attempts).toHaveLength(ROUND_LENGTH);
    for (const a of attempts) {
      expect(a.mode).toBe('choose');
      expect(ELEMENT_BY_KEY[a.element_key], a.element_key).toBeTruthy();
      expect(typeof a.correct).toBe('boolean');
    }
    // Distinct sounds: a round must not ask the same one twice.
    expect(new Set(attempts.map((a) => a.element_key)).size).toBe(ROUND_LENGTH);
  });

  it('names the element a wrong answer was confused with', async () => {
    // Pinned to one sound so the wrong tile can be chosen deliberately rather
    // than hoped for — this is the assertion the confusion report rests on.
    const { onSave } = renderGame({ only: ['short-a'] });

    const wrongTile = optionTiles().find((t) => lettersOf(t) !== 'a');
    const chosenLetters = lettersOf(wrongTile);
    await act(async () => { fireEvent.click(wrongTile); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Got it/ }));
    });

    const [attempt] = onSave.mock.calls[0][0];
    expect(attempt.correct).toBe(false);
    expect(attempt.element_key).toBe('short-a');
    expect(ELEMENT_BY_KEY[attempt.chosen], `chosen ${attempt.chosen}`).toBeTruthy();
    expect(ELEMENT_BY_KEY[attempt.chosen].g).toBe(chosenLetters);
  });

  it('records no confusion for a correct answer', async () => {
    const { onSave } = renderGame({ only: ['short-a'] });

    await act(async () => {
      fireEvent.click(optionTiles().find((t) => lettersOf(t) === 'a'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /OK!/ }));
    });

    const [attempt] = onSave.mock.calls[0][0];
    expect(attempt.correct).toBe(true);
    expect(attempt.chosen).toBeNull();
  });
});

describe('PhonicsGame — type-it mode', () => {
  it('accepts any legitimate spelling of an ambiguous sound', async () => {
    // Stage 7's /ā/ is genuinely `ai` or `ay` by ear. Marking `ay` wrong would
    // be testing spelling knowledge under a phonics label.
    const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
    render(<PhonicsGame mode="type-it" stages={7} only={['team-ai']} onSave={onSave} onExit={vi.fn()} />);

    const input = screen.getByLabelText(/type the letters/i);
    await act(async () => { fireEvent.change(input, { target: { value: 'ay' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /check/i })); });

    expect(screen.getByRole('button', { name: /OK!/ })).toBeTruthy();
  });

  it('strips characters that are not letters so a stray key cannot fail an item', async () => {
    const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
    render(<PhonicsGame mode="type-it" stages={3} only={['sh']} onSave={onSave} onExit={vi.fn()} />);

    const input = screen.getByLabelText(/type the letters/i);
    await act(async () => { fireEvent.change(input, { target: { value: 's4h!' } }); });
    expect(input.value).toBe('sh');
  });

  it('will not submit an empty answer', async () => {
    const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
    render(<PhonicsGame mode="type-it" stages={3} only={['sh']} onSave={onSave} onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /check/i }).disabled).toBe(true);
  });
});

describe('PhonicsGame — find-in-word mode', () => {
  it('does not show the word while the child is still answering', async () => {
    // Showing it would turn a listening task into a reading task, and the
    // attempt would be stored as if it had tested hearing.
    const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
    render(
      <PhonicsGame mode="find-in-word" stages={3} only={['sh']} onSave={onSave} onExit={vi.fn()} />,
    );

    const sh = ELEMENT_BY_KEY.sh;
    for (const word of sh.words) {
      expect(document.body.textContent).not.toContain(word);
    }
    expect(screen.getByRole('button', { name: /hear the word/i })).toBeTruthy();
  });

  it('reveals the word once the answer is in', async () => {
    const onSave = vi.fn(() => Promise.resolve({ saved: 1 }));
    render(
      <PhonicsGame mode="find-in-word" stages={3} only={['sh']} onSave={onSave} onExit={vi.fn()} />,
    );

    const group = screen.getByRole('group', { name: /sound choices/i });
    const tiles = [...group.querySelectorAll('button')];
    await act(async () => { fireEvent.click(tiles[0]); });

    const sh = ELEMENT_BY_KEY.sh;
    const shown = sh.words.some((w) => document.body.textContent.includes(w));
    expect(shown).toBe(true);
  });
});
