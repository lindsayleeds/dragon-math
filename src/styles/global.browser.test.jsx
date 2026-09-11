import { act } from 'react';
import { page } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../components/UpdateBanner';
import classroom from './ClassroomPage.module.css';
import collection from './DragonCollectionPage.module.css';
import family from './FamilyLinkPage.module.css';
import guestBanner from './GuestBanner.module.css';
import learningLair from './LearningLair.module.css';
import map from './MapPagePaper.module.css';
import phonics from './DragonPhonics.module.css';
import profile from './ProfileModal.module.css';
import provingGrounds from './ProvingGrounds.module.css';
import spelling from './DragonSpelling.module.css';
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
  it.each([
    ['Classroom', classroom],
    ['Dragon Collection', collection],
    ['Learning Lair', learningLair],
    ['Proving Grounds', provingGrounds],
  ])('applies the top inset once to the %s back button', async (_name, styles) => {
    await page.viewport(844, 844);
    const insets = { top: 59, right: 0, bottom: 34, left: 0 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <div class="${styles.page}" data-page>
        <button class="${styles.backTab}" data-back>Back to classroom</button>
      </div>
    `;
    document.body.append(root);

    const appPage = root.querySelector('[data-page]');
    const back = root.querySelector('[data-back]');
    back.style.transform = 'none';
    expect(appPage.getBoundingClientRect().top).toBe(insets.top);
    expect(back.getBoundingClientRect().top - appPage.getBoundingClientRect().top).toBe(47);
  });

  it('keeps the Dragon Phonics back button clear of the title below a Dynamic Island', async () => {
    await page.viewport(390, 844);
    const insets = { top: 59, right: 0, bottom: 34, left: 0 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <div class="${phonics.page}">
        <header class="${phonics.header}">
          <button class="${phonics.backTab}" data-phonics-back>← back</button>
          <h1 class="${phonics.title}" data-phonics-title>
            <span class="${phonics.titleIcon}">🐲</span>Dragon Phonics
          </h1>
          <p class="${phonics.subtitle}">listen to the word, then find the missing sound</p>
        </header>
      </div>
    `;
    document.body.append(root);

    const back = root.querySelector('[data-phonics-back]');
    const title = root.querySelector('[data-phonics-title]');
    expectInside(back, insets);
    expect(back.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      title.getBoundingClientRect().top,
    );
  });

  it('keeps the Dragon Spelling back button clear of the title below a Dynamic Island', async () => {
    await page.viewport(390, 844);
    const insets = { top: 59, right: 0, bottom: 34, left: 0 };
    setInsets(insets);

    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <div class="${spelling.page}">
        <header class="${spelling.header}">
          <button class="${spelling.backTab}" data-spelling-back>← back</button>
          <h1 class="${spelling.title}" data-spelling-title>
            <span class="${spelling.titleIcon}">🐲</span>Dragon Spelling
          </h1>
          <p class="${spelling.subtitle}">listen to the word, then spell it</p>
        </header>
      </div>
    `;
    document.body.append(root);

    const back = root.querySelector('[data-spelling-back]');
    const title = root.querySelector('[data-spelling-title]');
    expectInside(back, insets);
    expect(back.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      title.getBoundingClientRect().top,
    );
  });

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
