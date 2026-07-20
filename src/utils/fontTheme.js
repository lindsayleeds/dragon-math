import { getFontTheme } from '../data/fontThemes';

// Inject the chosen font combo into the document's CSS custom properties.
// Every component's font-family resolves through var(--font-display) /
// var(--font-body), so setting these two variables restyles the whole app live.
// Unknown / undefined ids fall back to the default theme.
export function applyFontTheme(id) {
  const theme = getFontTheme(id);
  const root = document.documentElement;
  root.style.setProperty('--font-display', theme.display);
  root.style.setProperty('--font-body', theme.body);
}
