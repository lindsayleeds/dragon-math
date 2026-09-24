#!/usr/bin/env node
// Rasterises the map art from ios/ArtExports/Map into @2x/@3x PNG imagesets in
// the app's asset catalog (ios/DragonAcademy/Assets.xcassets/MapRaster).
//
// Why: the map tiles are large, detailed SVGs. iOS renders catalog SVGs at
// runtime on the main thread, and drawing every world at once took ~14s on
// the simulator before the map appeared. Bitmaps made at build time load
// immediately and look the same at the sizes the app shows them. The vector
// originals stay in ios/ArtExports as the source of truth.
//
//   npm run ios:map-raster    # re-run after `npm run ios:export-art`
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'ios', 'ArtExports', 'Map');
const OUT = join(ROOT, 'ios', 'DragonAcademy', 'Assets.xcassets', 'MapRaster');
const INFO = { author: 'xcode', version: 1 };
const SCALES = [2, 3];

const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function main() {
  const sets = (await readdir(SOURCE)).filter(name => name.endsWith('.imageset')).sort();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'Contents.json'), json({ info: INFO }));
  for (const set of sets) {
    const name = set.replace(/\.imageset$/, '');
    const svg = await readFile(join(SOURCE, set, `${name}.svg`));
    const dir = join(OUT, set);
    await mkdir(dir, { recursive: true });
    const images = [];
    for (const scale of SCALES) {
      const filename = `${name}@${scale}x.png`;
      // One SVG unit is one point, so 72 dpi × scale gives that scale's pixels.
      await sharp(svg, { density: 72 * scale }).png({ compressionLevel: 9 }).toFile(join(dir, filename));
      images.push({ filename, idiom: 'universal', scale: `${scale}x` });
    }
    await writeFile(join(dir, 'Contents.json'), json({ images, info: INFO }));
    console.log(`  MapRaster/${set}`);
  }
  console.log(`Rasterised ${sets.length} map tiles to ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
