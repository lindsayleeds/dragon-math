import { act } from 'react';
import { page } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../components/UpdateBanner';
import family from './FamilyLinkPage.module.css';
import guestBanner from './GuestBanner.module.css';
import map from './MapPagePaper.module.css';
import profile from './ProfileModal.module.css';
import steppingStones from './SteppingStones.module.css';
import './global.css';

vi.mock('../hooks/useVersionCheck', () => ({
  useVersionCheck: () => ({ updateAvailable: true, reload: vi.fn() }),
}));

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
  it('contains normal, fixed, drawer, and full-width controls in landscape', async () => {
    await page.viewport(844, 390);
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

  it('contains controls beneath portrait top and bottom hardware', async () => {
    await page.viewport(390, 844);
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <button data-normal>Navigate</button>
      <button class="${guestBanner.banner}" data-banner>Sign up</button>
      <div class="${profile.overlay}">
        <section class="${profile.modal}" data-long-modal>
          <button class="${profile.closeBtn}" data-modal>Close profile</button>
          <div style="height: 1200px; display: flex; flex-direction: column; justify-content: space-between">
            <span>Profile settings</span>
            <button data-modal-bottom>Save profile</button>
          </div>
        </section>
      </div>
      <div class="${family.overlay}">
        <section class="${family.card} ${family.switcherCard}" data-family-card>
          <button class="${family.close}" data-family-close>Close family switcher</button>
          <div style="height: 1200px; display: flex; flex-direction: column; justify-content: space-between">
            <span>Choose a player</span>
            <button data-family-bottom>Choose player</button>
          </div>
        </section>
      </div>
      <div data-update></div>
    `;
    document.body.append(root);
    const updateRoot = createRoot(root.querySelector('[data-update]'));
    await act(async () => updateRoot.render(<UpdateBanner />));

    for (const selector of ['[data-normal]', '[data-banner]', '[data-long-modal]', '[data-modal]', '[data-family-card]', '[data-family-close]', '[data-update] button']) {
      expectInside(root.querySelector(selector), insets);
    }
    const modal = root.querySelector('[data-long-modal]');
    modal.scrollTop = modal.scrollHeight;
    await new Promise(requestAnimationFrame);
    expectInside(root.querySelector('[data-modal-bottom]'), insets);
    const familyCard = root.querySelector('[data-family-card]');
    familyCard.scrollTop = familyCard.scrollHeight;
    await new Promise(requestAnimationFrame);
    expectInside(root.querySelector('[data-family-bottom]'), insets);
    await act(async () => updateRoot.unmount());
  });
});
