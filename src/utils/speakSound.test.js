import { afterEach, describe, expect, it, vi } from 'vitest';
import { speakSound } from './speakSound';
import { stopSpeaking } from './speakWord';

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

const element = { key: 'gr', words: ['grass'] };
const originalUtterance = globalThis.SpeechSynthesisUtterance;

afterEach(() => {
  stopSpeaking();
  globalThis.SpeechSynthesisUtterance = originalUtterance;
});

describe('speakSound', () => {
  it('reports an isolated clip only after it finishes', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
      queueMicrotask(() => this.dispatchEvent(new Event('ended')));
      return Promise.resolve();
    });

    await expect(speakSound(element)).resolves.toEqual({
      source: 'audio',
      url: '/audio/phonics/gr.mp3',
    });
  });

  it('reports when playback degrades to the example word', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('missing'));
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
    window.speechSynthesis = {
      speak: vi.fn(utterance => queueMicrotask(() => utterance.onend?.())),
      cancel: vi.fn(),
      getVoices: vi.fn(),
    };

    await expect(speakSound(element)).resolves.toEqual({
      source: 'example-word',
      fallbackSource: 'device-voice',
    });
  });
});
