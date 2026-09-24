#!/usr/bin/env node
// Exports the paper map, boss and battle-wallpaper art to vector SVG imagesets
// for the iOS asset catalog (issue #133). Re-run whenever the art changes:
//
//   npm run ios:export-art                 # write ios/ArtExports/
//   npm run ios:export-art -- --png <dir>  # also rasterise each SVG to PNG
//                                          # (librsvg via sharp) for a visual check
//
// The asset list and SVG conversion live in scripts/ios-art/artAssets.js; this
// file only loads it through Vite (it imports .jsx components) and writes files.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'ios', 'ArtExports');

function parseArgs(argv) {
  const pngIndex = argv.indexOf('--png');
  return { pngDir: pngIndex >= 0 ? resolve(argv[pngIndex + 1] || 'art-png') : null };
}

async function loadExporter() {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    plugins: [react()],
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    return { module: await server.ssrLoadModule('/scripts/ios-art/artAssets.js'), server };
  } catch (err) {
    await server.close();
    throw err;
  }
}

async function writePngs(assets, pngDir) {
  const { default: sharp } = await import('sharp');
  await mkdir(pngDir, { recursive: true });
  for (const { name, svg } of assets) {
    // 3x, matching the densest iOS scale.
    await sharp(Buffer.from(svg), { density: 72 * 3 }).png().toFile(join(pngDir, `${name}.png`));
  }
  console.log(`Rendered ${assets.length} PNG previews to ${pngDir}`);
}

async function main() {
  const { pngDir } = parseArgs(process.argv.slice(2));
  const { module, server } = await loadExporter();
  try {
    const assets = module.buildArtAssets();
    const files = module.buildCatalogFiles(assets);

    // The export owns its group folders outright: clearing them first keeps a
    // renamed or removed asset from lingering. README.md is hand-written and
    // left alone.
    for (const group of module.catalogGroups(assets)) {
      await rm(join(OUT_DIR, group), { recursive: true, force: true });
    }
    for (const [path, contents] of Object.entries(files)) {
      const target = join(OUT_DIR, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    console.log(`Exported ${assets.length} vector assets to ${OUT_DIR}`);
    for (const a of assets) console.log(`  ${a.group}/${a.name}.imageset`);

    if (pngDir) await writePngs(assets, pngDir);
  } finally {
    await server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
