import { seeded, SVG_WIDTH } from './paperUtils';

// Per-world atmospheric "wallpaper" — drawn beneath the path and nodes but
// above the flat watercolor wash. Each world has a distinct motif palette
// hand-scattered (deterministic seeded random) inside its bandY range so the
// chapter reads as a different place without competing with the road.
//
// Density / scale / opacity are tuned so the motifs read as background
// texture, never as foreground decoration. Each motif is also a tiny <g>
// component so we can lean into world-specific shapes (crystals, hexes,
// petals) rather than re-skinning one generic glyph.

// ---------- motif primitives ----------------------------------------------

import {
  Bamboo, Blossom, Clover, CloudWisp, Crystal, EmberSpark, Fern, Hex, Mushroom,
  Petal, Sparkle, Star4, Sunflower, SteamPuff, Swirl, VolcanicRock, Wheat,
} from './mapMotifs';

// ---------- per-world scatter generators ----------------------------------
//
// Each generator returns a flat array of React elements positioned inside
// the world's bandY range. Density tuned per motif: showy shapes (sunflower,
// crystal) stay sparse; small filler glyphs (clover, sparkle, star) can be
// denser.

function scatterMushroomForest(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  // mushrooms
  for (let i = 0; i < 14; i++) {
    const r = seeded(i + 101);
    const x = 20 + seeded(i + 13) * (SVG_WIDTH - 40);
    const y = top + 10 + seeded(i + 31) * (bottom - top - 20);
    const scale = 0.7 + r * 0.7;
    const rot = (seeded(i + 47) - 0.5) * 18;
    const cap = i % 3 === 0 ? '#e9a07a' : i % 3 === 1 ? '#d97474' : '#c78aa6';
    out.push(<Mushroom key={`m1-m-${i}`} x={x} y={y} scale={scale} rot={rot} color={cap} />);
  }
  // ferns
  for (let i = 0; i < 11; i++) {
    const x = 16 + seeded(i + 71) * (SVG_WIDTH - 32);
    const y = top + 26 + seeded(i + 83) * (bottom - top - 60);
    const scale = 0.6 + seeded(i + 97) * 0.5;
    const rot = (seeded(i + 109) - 0.5) * 40;
    out.push(<Fern key={`m1-f-${i}`} x={x} y={y} scale={scale} rot={rot} color="#8aa87a" />);
  }
  // clovers — small filler dots of green
  for (let i = 0; i < 26; i++) {
    const x = 12 + seeded(i + 131) * (SVG_WIDTH - 24);
    const y = top + 8 + seeded(i + 137) * (bottom - top - 16);
    const scale = 0.45 + seeded(i + 149) * 0.4;
    const rot = (seeded(i + 151) - 0.5) * 60;
    out.push(<Clover key={`m1-c-${i}`} x={x} y={y} scale={scale} rot={rot} color="#9ab487" />);
  }
  return out;
}

function scatterHoneyfieldPlains(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  // honeycomb — sparse, large amber hexagons, rotated/offset to feel painted
  for (let i = 0; i < 9; i++) {
    const x = 20 + seeded(i + 201) * (SVG_WIDTH - 40);
    const y = top + 30 + seeded(i + 211) * (bottom - top - 60);
    const scale = 0.9 + seeded(i + 223) * 0.5;
    // cluster of 3 hexes around (x,y) for honeycomb feel
    const dx = 16 * scale;
    const dy = 14 * scale;
    out.push(<Hex key={`m2-h-${i}-a`} x={x} y={y} scale={scale} color="#f0d28a" stroke="#c79a48" />);
    out.push(<Hex key={`m2-h-${i}-b`} x={x + dx} y={y + dy * 0.6} scale={scale} color="#e8c074" stroke="#b8852f" />);
    out.push(<Hex key={`m2-h-${i}-c`} x={x - dx} y={y + dy * 0.6} scale={scale} color="#f3d99b" stroke="#c79a48" />);
  }
  // wheat
  for (let i = 0; i < 13; i++) {
    const x = 16 + seeded(i + 241) * (SVG_WIDTH - 32);
    const y = top + 10 + seeded(i + 251) * (bottom - top - 20);
    const scale = 0.6 + seeded(i + 263) * 0.5;
    const rot = (seeded(i + 271) - 0.5) * 30;
    out.push(<Wheat key={`m2-w-${i}`} x={x} y={y} scale={scale} rot={rot} color="#b8852f" />);
  }
  // sunflowers
  for (let i = 0; i < 7; i++) {
    const x = 22 + seeded(i + 287) * (SVG_WIDTH - 44);
    const y = top + 20 + seeded(i + 293) * (bottom - top - 40);
    const scale = 0.8 + seeded(i + 307) * 0.4;
    const rot = (seeded(i + 311) - 0.5) * 20;
    out.push(<Sunflower key={`m2-s-${i}`} x={x} y={y} scale={scale} rot={rot} />);
  }
  return out;
}

function scatterCrystalCaves(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  // crystal clusters (2-3 per cluster)
  for (let i = 0; i < 9; i++) {
    const x = 30 + seeded(i + 401) * (SVG_WIDTH - 60);
    const y = top + 30 + seeded(i + 411) * (bottom - top - 60);
    const scale = 0.7 + seeded(i + 423) * 0.6;
    const tint = i % 3 === 0 ? '#a98ed1' : i % 3 === 1 ? '#8eb0cc' : '#c79bb8';
    out.push(<Crystal key={`m3-c-${i}-a`} x={x} y={y} scale={scale} color={tint} highlight="#dcd0ef" />);
    out.push(
      <Crystal
        key={`m3-c-${i}-b`}
        x={x + 8 * scale}
        y={y + 4 * scale}
        scale={scale * 0.7}
        rot={-8}
        color={tint}
        highlight="#dcd0ef"
      />
    );
    if (i % 2 === 0) {
      out.push(
        <Crystal
          key={`m3-c-${i}-c`}
          x={x - 7 * scale}
          y={y + 3 * scale}
          scale={scale * 0.6}
          rot={10}
          color={tint}
          highlight="#dcd0ef"
        />
      );
    }
  }
  // sparkles
  for (let i = 0; i < 36; i++) {
    const x = 14 + seeded(i + 461) * (SVG_WIDTH - 28);
    const y = top + 6 + seeded(i + 469) * (bottom - top - 12);
    const scale = 0.35 + seeded(i + 479) * 0.45;
    const tint = i % 2 === 0 ? '#9d7fc4' : '#c79bb8';
    out.push(<Sparkle key={`m3-sp-${i}`} x={x} y={y} scale={scale} color={tint} />);
  }
  return out;
}

function scatterSakuraVale(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  // petals — these drift across the band; more horizontal sprawl than vertical
  for (let i = 0; i < 38; i++) {
    const x = 8 + seeded(i + 601) * (SVG_WIDTH - 16);
    const y = top + 6 + seeded(i + 613) * (bottom - top - 12);
    const scale = 0.55 + seeded(i + 619) * 0.6;
    const rot = seeded(i + 631) * 360;
    const tint = i % 4 === 0 ? '#f0c5d4' : i % 4 === 1 ? '#e7b7c7' : i % 4 === 2 ? '#f6dbe4' : '#dba7bc';
    out.push(<Petal key={`m4-p-${i}`} x={x} y={y} scale={scale} rot={rot} color={tint} />);
  }
  // blossoms (5-petal flower clusters)
  for (let i = 0; i < 11; i++) {
    const x = 24 + seeded(i + 657) * (SVG_WIDTH - 48);
    const y = top + 20 + seeded(i + 671) * (bottom - top - 40);
    const scale = 0.7 + seeded(i + 683) * 0.5;
    const rot = (seeded(i + 691) - 0.5) * 40;
    out.push(<Blossom key={`m4-b-${i}`} x={x} y={y} scale={scale} rot={rot} />);
  }
  // bamboo stalks
  for (let i = 0; i < 6; i++) {
    const x = 18 + seeded(i + 701) * (SVG_WIDTH - 36);
    const y = top + 30 + seeded(i + 711) * (bottom - top - 60);
    const scale = 0.8 + seeded(i + 727) * 0.6;
    const rot = (seeded(i + 733) - 0.5) * 16;
    out.push(<Bamboo key={`m4-bb-${i}`} x={x} y={y} scale={scale} rot={rot} color="#9bb589" />);
  }
  return out;
}


function scatterEmberHighlands(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  for (let i = 0; i < 40; i++) {
    const x = 10 + seeded(i + 1001) * (SVG_WIDTH - 20);
    const y = top + 6 + seeded(i + 1013) * (bottom - top - 12);
    const scale = 0.3 + seeded(i + 1021) * 0.5;
    const tint = i % 3 === 0 ? '#e8a03a' : i % 3 === 1 ? '#d97042' : '#f0c060';
    out.push(<EmberSpark key={`m6-es-${i}`} x={x} y={y} scale={scale} color={tint} />);
  }
  for (let i = 0; i < 10; i++) {
    const x = 20 + seeded(i + 1051) * (SVG_WIDTH - 40);
    const y = top + 20 + seeded(i + 1063) * (bottom - top - 40);
    const scale = 0.7 + seeded(i + 1071) * 0.6;
    const rot = (seeded(i + 1081) - 0.5) * 40;
    const tint = i % 2 === 0 ? '#a86048' : '#8a5038';
    out.push(<VolcanicRock key={`m6-vr-${i}`} x={x} y={y} scale={scale} rot={rot} color={tint} />);
  }
  for (let i = 0; i < 7; i++) {
    const x = 28 + seeded(i + 1101) * (SVG_WIDTH - 56);
    const y = top + 30 + seeded(i + 1111) * (bottom - top - 60);
    const scale = 1.0 + seeded(i + 1121) * 0.8;
    const rot = (seeded(i + 1129) - 0.5) * 15;
    out.push(<SteamPuff key={`m6-sp-${i}`} x={x} y={y} scale={scale} rot={rot} />);
  }
  return out;
}

function scatterCloudspireHeights(world) {
  const { top, bottom } = world.bandY;
  const out = [];
  // soft cloud wisps
  for (let i = 0; i < 9; i++) {
    const x = 30 + seeded(i + 801) * (SVG_WIDTH - 60);
    const y = top + 30 + seeded(i + 813) * (bottom - top - 60);
    const scale = 1.0 + seeded(i + 821) * 0.9;
    const rot = (seeded(i + 829) - 0.5) * 8;
    out.push(<CloudWisp key={`m5-cw-${i}`} x={x} y={y} scale={scale} rot={rot} color="#dde7f2" />);
  }
  // stars
  for (let i = 0; i < 24; i++) {
    const x = 14 + seeded(i + 851) * (SVG_WIDTH - 28);
    const y = top + 8 + seeded(i + 863) * (bottom - top - 16);
    const scale = 0.45 + seeded(i + 877) * 0.5;
    const rot = seeded(i + 883) * 45;
    const tint = i % 3 === 0 ? '#7fa6c4' : i % 3 === 1 ? '#c79bb8' : '#d4a957';
    out.push(<Star4 key={`m5-st-${i}`} x={x} y={y} scale={scale} rot={rot} color={tint} />);
  }
  // wind swirls
  for (let i = 0; i < 7; i++) {
    const x = 30 + seeded(i + 911) * (SVG_WIDTH - 60);
    const y = top + 30 + seeded(i + 919) * (bottom - top - 60);
    const scale = 0.9 + seeded(i + 929) * 0.6;
    const rot = (seeded(i + 937) - 0.5) * 60;
    out.push(<Swirl key={`m5-sw-${i}`} x={x} y={y} scale={scale} rot={rot} color="#9bb5cc" />);
  }
  return out;
}

// Exported for WorldWallpaper.jsx, which renders every world at once.
export const SCATTERERS = {
  1: scatterMushroomForest,
  2: scatterHoneyfieldPlains,
  3: scatterCrystalCaves,
  4: scatterSakuraVale,
  5: scatterCloudspireHeights,
  6: scatterEmberHighlands,
};

// Returns an array of React elements for the given world scattered within
// the supplied bandY range. Used by both the map wallpaper and the battle
// wallpaper (which passes a viewport-sized bandY).
export function getWorldMotifs(worldId, bandY) {
  const fn = SCATTERERS[worldId];
  if (!fn) return [];
  return fn({ bandY });
}
