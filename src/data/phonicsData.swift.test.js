import { readFileSync } from 'node:fs';
import {
  renderSwiftPhonicsData,
  SWIFT_PHONICS_DATA_PATH,
} from '../../scripts/generate-swift-phonics-data.mjs';

// The iOS app deals phonics rounds from a generated Swift copy of the
// curriculum, modes and Missing Sound words. A sound added, removed, reordered
// or given another spelling here but not regenerated would deal the app
// different rounds from the web (and golden/phonics.json), so a stale Swift
// file fails.
describe('iOS phonics data', () => {
  it('matches src/data/phonics*.js (run `npm run ios:phonics-data`)', () => {
    expect(readFileSync(SWIFT_PHONICS_DATA_PATH, 'utf8')).toBe(renderSwiftPhonicsData());
  });
});
