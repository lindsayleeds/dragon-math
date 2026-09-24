import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_PATH,
  MANIFEST_PATH,
  SWIFT_PATH,
  buildSwift,
  catalogStrings,
  formatCatalog,
  iosNodes,
  iosWorlds,
  updateCatalog,
} from '../../scripts/ios-map/mapDataSwift.js';
import { NODE_TYPE } from './mapData';

// The iOS map is generated from this file (issue #134). These pin the
// committed Swift data and String Catalog to it, so a map change without
// `npm run ios:map-data` fails here instead of the two apps drifting apart.
// (A path string, not `new URL(...)`: under jsdom the global URL is jsdom's,
// which node's fileURLToPath refuses.)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(join(ROOT, path), 'utf8');

describe('iOS map data', () => {
  it('shows the five worlds and 41 nodes that have battle configs, a boss ending each world', () => {
    const worlds = iosWorlds();
    expect(worlds.map(w => w.id)).toEqual([1, 2, 3, 4, 5]);
    const nodes = iosNodes(worlds);
    expect(nodes.map(n => n.id)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(nodes.filter(n => n.type === NODE_TYPE.BOSS).map(n => n.id)).toEqual(
      worlds.map(w => w.nodeRange[1]));
  });

  it('matches the committed MapNodes.swift (re-run `npm run ios:map-data`)', () => {
    expect(read(SWIFT_PATH)).toBe(buildSwift(read(MANIFEST_PATH)));
  });

  it('has every map name in the String Catalog (re-run `npm run ios:map-data`)', () => {
    const catalog = read(CATALOG_PATH);
    expect(updateCatalog(catalog)).toBe(catalog);
    const keys = Object.keys(JSON.parse(catalog).strings);
    for (const [key] of catalogStrings()) expect(keys).toContain(key);
  });

  it('writes the catalog the way Xcode does', () => {
    const catalog = read(CATALOG_PATH);
    expect(formatCatalog(JSON.parse(catalog))).toBe(catalog);
  });
});
