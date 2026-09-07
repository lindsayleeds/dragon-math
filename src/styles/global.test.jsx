import { afterEach, describe, expect, it } from 'vitest';
import munchers from './DragonMunchers.module.css';
import guestBanner from './GuestBanner.module.css';
import steppingStones from './SteppingStones.module.css';
import './global.css';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('global iOS safe-area boundary', () => {
  it('insets normal-flow content on every edge', () => {
    document.body.innerHTML = '<div id="root"><button>Navigate</button></div>';
    const root = document.querySelector('#root');

    expect(getComputedStyle(root).paddingTop).toBe('var(--app-safe-area-top)');
    expect(getComputedStyle(root).paddingRight).toBe('var(--app-safe-area-right)');
    expect(getComputedStyle(root).paddingBottom).toBe('var(--app-safe-area-bottom)');
    expect(getComputedStyle(root).paddingLeft).toBe('var(--app-safe-area-left)');
  });

  it('keeps fixed controls and landscape games inside the safe rectangle', () => {
    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <button class="${guestBanner.banner}">Sign up</button>
      <main class="${munchers.container}"><button>Quit munchers</button></main>
      <main class="${steppingStones.container}"><button>Quit stepping stones</button></main>
    `;
    document.body.append(root);

    const bannerStyle = getComputedStyle(root.firstElementChild);
    expect(bannerStyle.bottom).toBe('calc(16px + var(--app-safe-area-bottom))');
    expect(bannerStyle.maxWidth).toContain('var(--app-safe-area-left)');
    expect(bannerStyle.maxWidth).toContain('var(--app-safe-area-right)');

    for (const game of root.querySelectorAll('main')) {
      const style = getComputedStyle(game);
      expect(style.paddingRight).toBe('var(--app-safe-area-right)');
      expect(style.paddingBottom).toBe('var(--app-safe-area-bottom)');
      expect(style.paddingLeft).toBe('var(--app-safe-area-left)');
      expect(style.marginLeft).toBe('calc(-1 * var(--app-safe-area-left))');
    }
  });
});
