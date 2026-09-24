import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildArtAssets,
  buildCatalogFiles,
  catalogGroups,
  toCatalogSvg,
} from '../../../scripts/ios-art/artAssets.js';
import { WORLDS } from '../../data/mapData';
import { BOSS_ART } from './bossArt';

// The iOS app ships the paper-map and boss art as vector imagesets generated
// from these components (issue #133). This pins the committed export to the
// current art, so an art change without `npm run ios:export-art` fails here
// instead of silently drifting from the web.
// (A path string, not `new URL(...)`: under jsdom the global URL is jsdom's,
// which node's fileURLToPath refuses.)
const EXPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../ios/ArtExports');
// The app's asset catalog holds copies of the groups it uses so far; they must
// stay identical to the export (copy the folder again after regenerating).
const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../ios/DragonAcademy/Assets.xcassets');

function listFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe('iOS art export', () => {
  const assets = buildArtAssets();
  const files = buildCatalogFiles(assets);

  it('exports every world background and road, every boss, and every battle wallpaper', () => {
    const names = assets.map(a => a.name);
    for (const world of WORLDS) {
      expect(names).toContain(`MapWorld${world.id}Background`);
      expect(names).toContain(`MapWorld${world.id}Road`);
      expect(names).toContain(`BattleWallpaperWorld${world.id}`);
    }
    expect(assets.filter(a => a.group === 'Bosses')).toHaveLength(Object.keys(BOSS_ART).length);
  });

  it('marks every imageset as a preserved vector', () => {
    for (const { group, name } of assets) {
      const contents = JSON.parse(files[`${group}/${name}.imageset/Contents.json`]);
      expect(contents.properties['preserves-vector-representation']).toBe(true);
      expect(contents.images[0].filename).toBe(`${name}.svg`);
    }
  });

  it('rejects markup CoreSVG could not draw standalone', () => {
    expect(() => toCatalogSvg('<svg><text>hi</text></svg>')).toThrow(/<text>/);
    expect(() => toCatalogSvg('<svg><rect fill="url(#dotGrid)"/></svg>')).toThrow(/defs/);
    expect(toCatalogSvg('<svg><g filter="url(#paperWobble)" style="pointer-events:none"></g></svg>'))
      .toContain('<svg><g></g></svg>');
  });

  it('matches the committed ios/ArtExports (re-run `npm run ios:export-art`)', () => {
    const owned = catalogGroups(assets);
    const onDisk = listFiles(EXPORT_DIR)
      .map(path => relative(EXPORT_DIR, path).split('\\').join('/'))
      .filter(path => path === 'manifest.json' || owned.some(g => path.startsWith(`${g}/`)))
      .filter(path => !path.endsWith('.DS_Store'))
      .sort();
    expect(onDisk).toEqual(Object.keys(files).sort());
    for (const [path, contents] of Object.entries(files)) {
      expect(readFileSync(join(EXPORT_DIR, path), 'utf8'), path).toBe(contents);
    }
  });

  it('keeps the app asset catalog copies identical to the export', () => {
    const copied = catalogGroups(assets).filter(g => {
      try {
        return statSync(join(CATALOG_DIR, g)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(copied).toContain('Battle');
    for (const group of copied) {
      const inCatalog = listFiles(join(CATALOG_DIR, group))
        .map(path => relative(CATALOG_DIR, path).split('\\').join('/'))
        .filter(path => !path.endsWith('.DS_Store'))
        .sort();
      const exported = Object.keys(files).filter(path => path.startsWith(`${group}/`)).sort();
      expect(inCatalog, group).toEqual(exported);
      for (const path of exported) {
        expect(readFileSync(join(CATALOG_DIR, path), 'utf8'), path).toBe(files[path]);
      }
    }
  });
});
