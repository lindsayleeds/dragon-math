// Font "combos" the player can pick from the Settings page. Each theme maps to
// the two CSS custom properties the whole app reads: --font-display (headings /
// display text) and --font-body (body / form text). The values are full
// font-family stacks including a generic fallback, so they drop straight into
// the variables. All families listed here must be loaded in index.html.
export const FONT_THEMES = [
  { id: 'handwritten', label: 'Handwritten ✍️',  display: "'Caveat', cursive",     body: "'Patrick Hand', cursive" },
  { id: 'bubbly',      label: 'Bold & Bubbly 🫧', display: "'Fredoka', sans-serif", body: "'Nunito', sans-serif" },
  { id: 'storybook',   label: 'Storybook 📖',     display: "'Baloo 2', cursive",    body: "'Quicksand', sans-serif" },
  { id: 'clean',       label: 'Clean & Clear 🔤', display: "'Comic Neue', cursive", body: "'Comic Neue', sans-serif" },
];

export const DEFAULT_FONT_THEME = 'clean';

export function getFontTheme(id) {
  return FONT_THEMES.find(t => t.id === id) || FONT_THEMES.find(t => t.id === DEFAULT_FONT_THEME);
}
