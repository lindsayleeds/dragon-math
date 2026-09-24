import { readFileSync } from 'node:fs';
import { renderSwiftGameCatalog, SWIFT_CATALOG_PATH } from '../../scripts/generate-swift-game-catalog.mjs';

// The iOS lair's catalog is generated from games.js. A game added, renamed,
// re-subjected or made paid here but not regenerated would leave the app
// listing a different lair from the web, so a stale Swift file fails.
describe('iOS Learning Lair catalog', () => {
  it('matches src/data/games.js (run `npm run ios:game-catalog`)', () => {
    expect(readFileSync(SWIFT_CATALOG_PATH, 'utf8')).toBe(renderSwiftGameCatalog());
  });
});
