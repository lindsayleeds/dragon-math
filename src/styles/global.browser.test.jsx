import { afterEach, describe, expect, it } from 'vitest';
import guestBanner from './GuestBanner.module.css';
import map from './MapPagePaper.module.css';
import profile from './ProfileModal.module.css';
import steppingStones from './SteppingStones.module.css';
import './global.css';

const edges = ['top', 'right', 'bottom', 'left'];

function setInsets({ top, right, bottom, left }) {
  const values = { top, right, bottom, left };
  for (const edge of edges) {
    document.documentElement.style.setProperty(`--app-safe-area-${edge}`, `${values[edge]}px`);
  }
}

function expectInside(element, { top, right, bottom, left }) {
  const rect = element.getBoundingClientRect();
  expect(rect.top).toBeGreaterThanOrEqual(top);
  expect(rect.left).toBeGreaterThanOrEqual(left);
  expect(rect.right).toBeLessThanOrEqual(innerWidth - right);
  expect(rect.bottom).toBeLessThanOrEqual(innerHeight - bottom);
}

afterEach(() => {
  document.querySelector('#root')?.remove();
  for (const edge of edges) {
    document.documentElement.style.removeProperty(`--app-safe-area-${edge}`);
  }
});

describe('iOS safe-area boundary', () => {
  it('contains normal, fixed, drawer, and full-width controls in landscape', () => {
    const insets = { top: 0, right: 47, bottom: 21, left: 59 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <button data-normal>Navigate</button>
      <button class="${guestBanner.banner}" data-banner>Sign up</button>
      <div class="${profile.overlay}"><button data-modal>Close profile</button></div>
      <main class="${steppingStones.container}">
        <header class="${steppingStones.header}"><span>Progress</span><button data-game>Quit</button></header>
      </main>
      <aside class="${map.fieldNotes} ${map.fieldNotesOpen}"><button class="${map.drawerClose}" data-drawer>Close notes</button></aside>
    `;
    document.body.append(root);

    for (const selector of ['[data-normal]', '[data-banner]', '[data-modal]', '[data-game]', '[data-drawer]']) {
      expectInside(root.querySelector(selector), insets);
    }
  });

  it('contains controls beneath portrait top and bottom hardware', () => {
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <button data-normal>Navigate</button>
      <button class="${guestBanner.banner}" data-banner>Sign up</button>
      <div class="${profile.overlay}"><button data-modal>Close profile</button></div>
    `;
    document.body.append(root);

    for (const selector of ['[data-normal]', '[data-banner]', '[data-modal]']) {
      expectInside(root.querySelector(selector), insets);
    }
  });
});
