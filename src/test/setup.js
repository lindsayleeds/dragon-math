// Per-test-file setup for the jsdom ('web') project.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom implements no media pipeline, so the celebratory <video> in Dragon
// Munchers logs "Not implemented: HTMLMediaElement's play()" for every render
// that reaches it. Stub it once rather than let that noise bury a real warning.
if (!HTMLMediaElement.prototype.play.__stubbed) {
  HTMLMediaElement.prototype.play = Object.assign(() => Promise.resolve(), { __stubbed: true });
  HTMLMediaElement.prototype.pause = () => {};
}

beforeEach(() => {
  // Several games persist a high score / leaderboard / chosen dragon in
  // localStorage. jsdom keeps one store per FILE, not per test, so without this
  // a test that writes a high score changes what the next test renders.
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  // Games schedule timers (gobble animations, hint offers, enemy moves). A test
  // that switched to fake timers must not leave them installed for the next one.
  vi.useRealTimers();
});
