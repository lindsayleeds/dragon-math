import { readFileSync } from 'node:fs';
import {
  familyIdentifier, primaryFamily, renderSwiftFontThemes, SWIFT_FONT_THEMES_PATH,
} from '../../scripts/generate-swift-font-themes.mjs';
import { FONT_THEMES } from './fontThemes.js';

// The iOS font picker's themes are generated from fontThemes.js. A theme
// added, renamed or re-fonted here but not regenerated would leave the app
// offering different fonts from the web (and ids the server may not know), so
// a stale Swift file fails.
describe('iOS font themes', () => {
  it('match src/data/fontThemes.js (run `npm run ios:font-themes`)', () => {
    expect(readFileSync(SWIFT_FONT_THEMES_PATH, 'utf8')).toBe(renderSwiftFontThemes());
  });

  it('name each family by the first entry of its CSS stack', () => {
    expect(primaryFamily("'Baloo 2', cursive")).toBe('Baloo 2');
    expect(familyIdentifier('Patrick Hand')).toBe('patrickHand');
    expect(familyIdentifier('Baloo 2')).toBe('baloo2');
    const families = new Set(FONT_THEMES.flatMap(t => [t.display, t.body].map(primaryFamily)));
    expect([...families]).toEqual(['Caveat', 'Patrick Hand', 'Fredoka', 'Nunito', 'Baloo 2', 'Quicksand', 'Comic Neue']);
  });
});
