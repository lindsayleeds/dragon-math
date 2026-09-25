import { readFileSync } from 'node:fs';
import {
  renderSwiftSpellingWords,
  SWIFT_SPELLING_WORDS_PATH,
} from '../../scripts/generate-swift-spelling-words.mjs';

// The iOS app plays the grade catalogs from a generated Swift copy. A word
// added, removed or reordered here (or given an example sentence) but not
// regenerated would deal the app different rounds from the web, so a stale
// Swift file fails.
describe('iOS spelling word lists', () => {
  it('match src/data/spellingWords.js (run `npm run ios:spelling-words`)', () => {
    expect(readFileSync(SWIFT_SPELLING_WORDS_PATH, 'utf8')).toBe(renderSwiftSpellingWords());
  });
});
