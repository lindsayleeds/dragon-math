import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_DIR,
  DRAGON_ART_PX,
  DRAGON_PNG_COUNT,
  MANIFEST_PATH,
  SOURCE_DIR,
  dragonIDs,
  groupContents,
  imageName,
  imagesetContents,
  pngSize,
  sha256,
} from '../../scripts/ios-dragon-art/dragonArt.js';

// The iOS app bundles a smaller copy of every dragon (issue #142), made by
// `npm run ios:dragon-art`. These pin the committed copy to the web's art and
// hold the issue's size budget: no more than half the originals.
// (A path string, not `new URL(...)`: under jsdom the global URL is jsdom's.)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8'));
const catalog = join(ROOT, CATALOG_DIR);
const bundledPng = id => join(catalog, `${imageName(id)}.imageset`, `${imageName(id)}.png`);

const STALE = 'run `npm run ios:dragon-art`';

describe('bundled iOS dragon art', () => {
  it('covers exactly the web art, 1 … DRAGON_PNG_COUNT', () => {
    const sources = readdirSync(join(ROOT, SOURCE_DIR)).filter(f => f.endsWith('.png'));
    expect(sources.map(f => Number(f.replace('.png', ''))).sort((a, b) => a - b)).toEqual(dragonIDs());
    expect(manifest.dragons.map(d => d.id)).toEqual(dragonIDs());
    const sets = readdirSync(catalog).filter(name => name !== 'Contents.json').sort();
    expect(sets).toEqual(dragonIDs().map(id => `${imageName(id)}.imageset`).sort());
  });

  it('was exported from the current art at the current size', () => {
    expect(manifest.pixels, STALE).toBe(DRAGON_ART_PX);
    const stale = manifest.dragons.filter(
      d => sha256(readFileSync(join(ROOT, SOURCE_DIR, `${d.id}.png`))) !== d.source,
    );
    expect(stale.map(d => d.id), STALE).toEqual([]);
  });

  it('commits what the export wrote', () => {
    expect(readFileSync(join(catalog, 'Contents.json'), 'utf8')).toBe(groupContents());
    for (const { id, bundled } of manifest.dragons) {
      const png = readFileSync(bundledPng(id));
      expect(sha256(png), `${imageName(id)} ${STALE}`).toBe(bundled);
      const { width, height } = pngSize(png);
      expect(Math.max(width, height), imageName(id)).toBe(DRAGON_ART_PX);
      expect(readFileSync(join(catalog, `${imageName(id)}.imageset`, 'Contents.json'), 'utf8')).toBe(
        imagesetContents(id),
      );
    }
  });

  it('is no more than half the size of the originals', () => {
    const size = path => statSync(path).size;
    const original = dragonIDs().reduce((sum, id) => sum + size(join(ROOT, SOURCE_DIR, `${id}.png`)), 0);
    const bundled = dragonIDs().reduce((sum, id) => sum + size(bundledPng(id)), 0);
    expect(DRAGON_PNG_COUNT).toBeGreaterThan(0);
    expect(bundled).toBeLessThanOrEqual(original / 2);
  });
});
