// Builds the iOS vector-art assets (issue #133) from the same React SVG
// components the web paper map draws with. Pure: returns file contents keyed by
// path, and never touches the disk — `scripts/ios-export-art.mjs` writes them,
// and `src/components/map-paper/iosArtExport.test.js` compares them to the
// committed copy so a change to the art can't ship without a re-export.
//
// Loaded through Vite (ssrLoadModule in the CLI, vitest in the test) because it
// imports .jsx components; it uses createElement so it stays plain JS itself.
//
// What CoreSVG (Xcode's SVG asset renderer) can draw decides what is exported:
//   - SVG filters (paperWobble, watercolorEdge, paperNoise) are stripped. The
//     crayon "wobble" and paper fibres are runtime effects, not geometry.
//   - Text is never baked in: chapter headings, node labels and margin doodles
//     depend on web fonts and are drawn natively on iOS with bundled fonts.
//   - The dot-grid <pattern> is expanded into plain dots.
//   - Nodes (bobbing, pulse ring, "you →", completion stamp, state colors) and
//     the road are left out of the backgrounds; the road ships as its own layer.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAP_NODES, WORLDS } from '../../src/data/mapData.js';
import { TornEdge } from '../../src/components/map-paper/TornEdge.jsx';
import { PencilRoad } from '../../src/components/map-paper/PencilRoad.jsx';
import { BOSS_ART } from '../../src/components/map-paper/bossArt.js';
import {
  BATTLE_WALLPAPER_OPACITY,
  MAP_WALLPAPER_OPACITY,
  SCATTERERS,
  getWorldMotifs,
} from '../../src/components/map-paper/worldMotifs.jsx';
import {
  BATTLE_VIEWBOX,
  DOT_GRID,
  SVG_HEIGHT,
  SVG_WIDTH,
  WASH_SPLOTCHES,
  WORLD_WASH_OPACITY,
} from '../../src/components/map-paper/paperUtils.js';

const PAPER = '#f4ead5';

// Boss art is drawn centered on (0,0) inside a boss medallion of r = 36, so the
// asset's frame is the medallion's: iOS sizes it to the medallion diameter.
const BOSS_RADIUS = 36;

// How far outside a world's band a neighbouring layer may still reach into it
// (torn-edge jag, motif overhang, splotch radius).
const BAND_REACH = 60;

// ---------- scenes -----------------------------------------------------------

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function worldsNear(top, bottom) {
  return WORLDS.filter(w => overlaps(w.bandY.top, w.bandY.bottom, top - BAND_REACH, bottom + BAND_REACH));
}

// The dot grid as a single path of tiny circles, restricted to [top, bottom).
// Dots never overlap, so one path at the combined opacity equals the web
// pattern (dot opacity inside a translucent layer).
function dotGrid(top, bottom) {
  const { spacing, dotX, dotY, r, fill, dotOpacity, layerOpacity } = DOT_GRID;
  let d = '';
  const firstRow = Math.ceil((top - dotY) / spacing);
  for (let row = firstRow; row * spacing + dotY < bottom; row++) {
    const y = row * spacing + dotY;
    for (let x = dotX; x < SVG_WIDTH; x += spacing) {
      d += `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
    }
  }
  return h('path', { key: 'dots', d, fill, opacity: +(dotOpacity * layerOpacity).toFixed(3) });
}

// One world's slice of the paper map, in map coordinates. Mirrors the layer
// order in MapPagePaper.jsx: paper, washes, splotches, tears, wallpaper, dots.
function mapBackground(world) {
  const { top, bottom } = world.bandY;
  const near = worldsNear(top, bottom);
  const tears = WORLDS.slice(0, -1)
    .map((lower, i) => ({ lower, seedOffset: i * 13 }))
    .filter(({ lower }) => overlaps(lower.bandY.top - BAND_REACH, lower.bandY.top + BAND_REACH, top, bottom));

  return [
    h('rect', { key: 'paper', x: 0, y: top, width: SVG_WIDTH, height: bottom - top, fill: PAPER }),
    // Unlike the web map the washes stop exactly at their band: without the
    // watercolorEdge wobble an overshoot would show as a hard stripe above
    // each torn edge.
    ...near.map(w => h('rect', {
      key: `wash-${w.id}`,
      x: 0,
      y: w.bandY.top,
      width: SVG_WIDTH,
      height: w.bandY.bottom - w.bandY.top,
      fill: w.washColor,
      opacity: WORLD_WASH_OPACITY,
    })),
    ...WASH_SPLOTCHES
      .filter(s => overlaps(s.cy - s.ry, s.cy + s.ry, top, bottom))
      .map(s => h('ellipse', { key: `splotch-${s.cy}`, ...s })),
    ...tears.map(({ lower, seedOffset }) => h(TornEdge, {
      key: `tear-${lower.id}`,
      y: lower.bandY.top,
      fillColor: lower.washColor,
      seedOffset,
    })),
    ...near.map(w => h('g', { key: `wp-${w.id}`, opacity: MAP_WALLPAPER_OPACITY[w.id] ?? 0.4 }, SCATTERERS[w.id](w))),
    dotGrid(top, bottom),
  ];
}

// ---------- SVG post-processing ---------------------------------------------

// Attributes that are web-only (interaction, accessibility, CSS) or that
// CoreSVG can't honour (filters). Removing them is what makes the markup a
// standalone, catalog-safe vector.
const STRIP_ATTRS = /\s(?:filter|style|role|pointer-events|class|aria-[a-z-]+)="[^"]*"/g;

// Long float tails from seeded layout math; two decimals is well below a
// point at any size the app draws these.
function roundNumbers(markup) {
  return markup.replace(/-?\d+\.\d{3,}/g, n => String(+Number(n).toFixed(2)));
}

export function toCatalogSvg(markup) {
  const svg = roundNumbers(markup.replace(STRIP_ATTRS, ''));
  const problems = [];
  if (/url\(#/.test(svg)) problems.push('references a <defs> id (filter/pattern/gradient)');
  if (/<text[\s>]/.test(svg)) problems.push('contains <text>, which needs web fonts');
  if (/var\(--/.test(svg)) problems.push('contains a CSS variable');
  if (problems.length) throw new Error(`SVG is not catalog-safe: ${problems.join('; ')}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`;
}

function renderSvg([x, y, width, height], children) {
  return toCatalogSvg(renderToStaticMarkup(h('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `${x} ${y} ${width} ${height}`,
    width,
    height,
  }, children)));
}

// ---------- asset list -------------------------------------------------------

function pascal(text) {
  return text.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase());
}

// Every exported asset: catalog group, asset name, the SVG, and the layout
// facts the SwiftUI side needs to place it.
export function buildArtAssets() {
  const assets = [];

  for (const world of WORLDS) {
    const { top, bottom } = world.bandY;
    const viewBox = [0, top, SVG_WIDTH, bottom - top];
    const meta = { world: world.id, worldName: world.name, mapY: top, viewBox };
    assets.push({
      group: 'Map',
      name: `MapWorld${world.id}Background`,
      svg: renderSvg(viewBox, mapBackground(world)),
      meta: { ...meta, layer: 'background' },
    });
    assets.push({
      group: 'Map',
      name: `MapWorld${world.id}Road`,
      svg: renderSvg(viewBox, h(PencilRoad)),
      meta: { ...meta, layer: 'road' },
    });
  }

  for (const [nodeId, Art] of Object.entries(BOSS_ART)) {
    const node = MAP_NODES.find(n => n.id === Number(nodeId));
    const viewBox = [-BOSS_RADIUS, -BOSS_RADIUS, BOSS_RADIUS * 2, BOSS_RADIUS * 2];
    assets.push({
      group: 'Bosses',
      name: `Boss${pascal(node.label)}`,
      svg: renderSvg(viewBox, h(Art)),
      meta: { nodeId: node.id, bossName: node.label, medallionRadius: BOSS_RADIUS, viewBox },
    });
  }

  for (const world of WORLDS) {
    const { width, height } = BATTLE_VIEWBOX;
    const viewBox = [0, 0, width, height];
    assets.push({
      group: 'Battle',
      name: `BattleWallpaperWorld${world.id}`,
      svg: renderSvg(viewBox, h('g', { opacity: BATTLE_WALLPAPER_OPACITY[world.id] ?? 0.22 },
        getWorldMotifs(world.id, { top: 0, bottom: height }))),
      meta: { world: world.id, worldName: world.name, viewBox, contentMode: 'fill' },
    });
  }

  return assets;
}

const XCODE_INFO = { author: 'xcode', version: 1 };

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// The files of the export, keyed by path relative to the output folder: one
// folder per group (drop-in for Assets.xcassets), an .imageset per asset
// flagged to keep its vector data, and a manifest of layout metadata.
export function buildCatalogFiles(assets = buildArtAssets()) {
  const files = {};
  for (const group of new Set(assets.map(a => a.group))) {
    files[`${group}/Contents.json`] = json({ info: XCODE_INFO });
  }
  for (const { group, name, svg } of assets) {
    files[`${group}/${name}.imageset/${name}.svg`] = svg;
    files[`${group}/${name}.imageset/Contents.json`] = json({
      images: [{ filename: `${name}.svg`, idiom: 'universal' }],
      info: XCODE_INFO,
      properties: { 'preserves-vector-representation': true },
    });
  }
  files['manifest.json'] = json({
    generatedBy: 'npm run ios:export-art',
    mapSize: { width: SVG_WIDTH, height: SVG_HEIGHT },
    assets: assets.map(({ group, name, meta }) => ({ group, name, ...meta })),
  });
  return files;
}

// Group folders the export owns; the CLI clears them before writing so a
// removed boss or world doesn't leave a stale imageset behind.
export function catalogGroups(assets = buildArtAssets()) {
  return [...new Set(assets.map(a => a.group))];
}
