#!/usr/bin/env node
// Bundles the collectible dragon art for the iOS app (issue #142): every
// public/dragon_pngs/<id>.png, resized to the largest size iOS draws a dragon
// and re-encoded as a palette PNG, as the single-scale imageset
// `dragon-<id>` in ios/DragonAcademy/Assets.xcassets/Dragons. The web keeps
// the full-size originals.
//
//   npm run ios:dragon-art    # re-run after adding or changing dragon art
//
// Sizes and encoding are in scripts/ios-dragon-art/dragonArt.js.
// src/data/iosDragonArt.test.js fails when the export is stale or the bundled
// set grows past half the originals' size.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  CATALOG_DIR,
  DRAGON_ART_PX,
  MANIFEST_PATH,
  PNG_OPTIONS,
  SOURCE_DIR,
  catalogJson,
  dragonIDs,
  groupContents,
  imageName,
  imagesetContents,
  sha256,
} from './ios-dragon-art/dragonArt.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const out = join(ROOT, CATALOG_DIR);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'Contents.json'), groupContents());

  const dragons = [];
  let sourceBytes = 0;
  let bundledBytes = 0;
  for (const id of dragonIDs()) {
    const source = await readFile(join(ROOT, SOURCE_DIR, `${id}.png`));
    const png = await sharp(source)
      .resize(DRAGON_ART_PX, DRAGON_ART_PX, { fit: 'inside', withoutEnlargement: true })
      .png(PNG_OPTIONS)
      .toBuffer();
    const dir = join(out, `${imageName(id)}.imageset`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${imageName(id)}.png`), png);
    await writeFile(join(dir, 'Contents.json'), imagesetContents(id));
    sourceBytes += source.length;
    bundledBytes += png.length;
    dragons.push({ id, source: sha256(source), bundled: sha256(png), bytes: png.length });
  }

  await writeFile(
    join(ROOT, MANIFEST_PATH),
    catalogJson({ pixels: DRAGON_ART_PX, sourceBytes, bundledBytes, dragons }),
  );
  const mb = n => (n / 1024 / 1024).toFixed(1);
  console.log(`Bundled ${dragons.length} dragons: ${mb(sourceBytes)} MB → ${mb(bundledBytes)} MB in ${CATALOG_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
