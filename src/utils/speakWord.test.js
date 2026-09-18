import { afterEach, describe, expect, it, vi } from 'vitest';
import { speakWord, stopSpeaking } from './speakWord';

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

const originalUtterance = globalThis.SpeechSynthesisUtterance;

afterEach(() => {
  stopSpeaking();
  globalThis.SpeechSynthesisUtterance = originalUtterance;
});

describe('speakWord', () => {
  it('uses the complete contextual prompt for browser-speech fallback', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('missing'));
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    const speak = vi.fn((utterance) => queueMicrotask(() => utterance.onend?.()));
    window.speechSynthesis = { speak, cancel: vi.fn(), getVoices: vi.fn() };

    await speakWord('new', ['/missing-new.mp3'], 'I have a new bike.');

    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0].text).toBe('new. I have a new bike. new.');
  });

  it('stops an earlier recording before a replay starts', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    play.mockResolvedValueOnce().mockRejectedValueOnce(new Error('missing'));
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    const speak = vi.fn((utterance) => queueMicrotask(() => utterance.onend?.()));
    window.speechSynthesis = { speak, cancel: vi.fn(), getVoices: vi.fn() };

    const first = speakWord('new', ['/first-new.mp3'], 'I have a new bike.');
    await Promise.resolve();
    const second = speakWord('new', ['/second-new.mp3'], 'I have a new bike.');
    await Promise.all([first, second]);

    expect(pause).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledOnce();
  });
});
