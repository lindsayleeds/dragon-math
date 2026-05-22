import { useMemo } from 'react';
import { WORLDS } from '../../data/mapData';
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

function Mushroom({ x, y, scale = 1, rot = 0, color = '#d97474', accent = '#7d9d6c' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      {/* stem */}
      <path d="M -3 0 Q -2.8 5 -2 9 L 2 9 Q 2.8 5 3 0 Z" fill="#f4ead5" stroke={accent} strokeWidth={0.7} />
      {/* cap */}
      <path d="M -9 0 Q -9 -8 0 -8 Q 9 -8 9 0 Z" fill={color} stroke="#7d5a3f" strokeWidth={0.7} />
      {/* spots */}
      <circle cx="-3" cy="-3" r="1.2" fill="#f4ead5" opacity={0.9} />
      <circle cx="3" cy="-4" r="0.9" fill="#f4ead5" opacity={0.9} />
    </g>
  );
}

function Fern({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} stroke={color} strokeWidth={0.9} fill="none" strokeLinecap="round">
      <path d="M 0 0 Q -1 -6 -2 -14 Q -3 -22 -4 -28" />
      <path d="M -1 -5 Q -5 -7 -7 -8" />
      <path d="M -2 -11 Q -6 -13 -9 -14" />
      <path d="M -2 -17 Q -6 -19 -8 -20" />
      <path d="M -3 -23 Q -6 -24 -8 -25" />
      <path d="M -1 -5 Q 3 -7 5 -8" />
      <path d="M -2 -11 Q 2 -13 5 -14" />
      <path d="M -3 -17 Q 1 -19 4 -20" />
    </g>
  );
}

function Clover({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color} stroke="#5a7d4c" strokeWidth={0.4}>
      <ellipse cx="0" cy="-4" rx="2.2" ry="3.2" />
      <ellipse cx="-3.5" cy="1" rx="3.2" ry="2.2" />
      <ellipse cx="3.5" cy="1" rx="3.2" ry="2.2" />
      <ellipse cx="0" cy="4" rx="2.2" ry="3.2" />
      <circle cx="0" cy="0" r="0.9" fill="#5a7d4c" />
    </g>
  );
}

function Hex({ x, y, scale = 1, color = '#d4a957', stroke = '#b8852f' }) {
  // pointy-top hexagon
  const r = 10 * scale;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(x + Math.cos(a) * r).toFixed(2)},${(y + Math.sin(a) * r).toFixed(2)}`);
  }
  return (
    <polygon
      points={pts.join(' ')}
      fill={color}
      stroke={stroke}
      strokeWidth={0.8}
      strokeLinejoin="round"
    />
  );
}

function Wheat({ x, y, scale = 1, rot = 0, color = '#b8852f' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} stroke={color} fill={color} strokeWidth={0.7} strokeLinecap="round">
      <path d="M 0 14 L 0 -6" stroke={color} fill="none" />
      <ellipse cx="0" cy="-6" rx="1.4" ry="3" />
      <ellipse cx="-2.4" cy="-3" rx="1.2" ry="2.4" />
      <ellipse cx="2.4" cy="-3" rx="1.2" ry="2.4" />
      <ellipse cx="-2.4" cy="1" rx="1.2" ry="2.4" />
      <ellipse cx="2.4" cy="1" rx="1.2" ry="2.4" />
      <ellipse cx="-2.4" cy="5" rx="1.1" ry="2.2" />
      <ellipse cx="2.4" cy="5" rx="1.1" ry="2.2" />
    </g>
  );
}

function Sunflower({ x, y, scale = 1, rot = 0, color = '#d4a957', center = '#7d5a3f' }) {
  const petals = 10;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      {Array.from({ length: petals }).map((_, i) => {
        const a = (i / petals) * 360;
        return (
          <ellipse
            key={i}
            cx="0"
            cy="-5"
            rx="1.6"
            ry="3.4"
            fill={color}
            stroke="#b8852f"
            strokeWidth={0.4}
            transform={`rotate(${a})`}
          />
        );
      })}
      <circle cx="0" cy="0" r="2.3" fill={center} />
    </g>
  );
}

function Crystal({ x, y, scale = 1, rot = 0, color = '#9d7fc4', highlight = '#c79bb8' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <polygon
        points="0,-12 5,-6 4,8 -4,8 -5,-6"
        fill={color}
        stroke="#6a4f8f"
        strokeWidth={0.7}
        strokeLinejoin="round"
        opacity={0.85}
      />
      <polygon points="0,-12 -5,-6 -4,8" fill={highlight} opacity={0.55} />
      <polygon points="-5,-6 5,-6 4,-4 -4,-4" fill="#f4ead5" opacity={0.35} />
    </g>
  );
}

function Sparkle({ x, y, scale = 1, color = '#9d7fc4' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
      <path d="M 0 -6 L 1.2 -1.2 L 6 0 L 1.2 1.2 L 0 6 L -1.2 1.2 L -6 0 L -1.2 -1.2 Z" />
    </g>
  );
}

function Petal({ x, y, scale = 1, rot = 0, color = '#e7b7c7' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <path
        d="M 0 0 Q -3 -2 -3 -6 Q 0 -10 3 -6 Q 3 -2 0 0 Z"
        fill={color}
        stroke="#c78aa6"
        strokeWidth={0.4}
      />
    </g>
  );
}

function Blossom({ x, y, scale = 1, rot = 0, color = '#f0c5d4', center = '#d97474' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      {[0, 72, 144, 216, 288].map((a, i) => (
        <ellipse
          key={i}
          cx="0"
          cy="-4"
          rx="2.2"
          ry="3.4"
          fill={color}
          stroke="#c78aa6"
          strokeWidth={0.5}
          transform={`rotate(${a})`}
        />
      ))}
      <circle cx="0" cy="0" r="1.6" fill={center} />
    </g>
  );
}

function Bamboo({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round">
      <path d="M 0 0 L 0 -22" />
      <path d="M -3 -7 L 3 -7" strokeWidth={1.8} />
      <path d="M -3 -14 L 3 -14" strokeWidth={1.8} />
      <path d="M -3 -21 L 3 -21" strokeWidth={1.8} />
      <path d="M 1 -16 Q 6 -18 9 -14" />
      <path d="M -1 -9 Q -6 -10 -8 -7" />
    </g>
  );
}

function CloudWisp({ x, y, scale = 1, rot = 0, color = '#cfdded' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color} stroke="#9bb5cc" strokeWidth={0.5}>
      <ellipse cx="-7" cy="0" rx="6" ry="3" />
      <ellipse cx="0" cy="-2" rx="7" ry="4" />
      <ellipse cx="8" cy="0" rx="6" ry="3" />
      <ellipse cx="-3" cy="2" rx="9" ry="2.4" />
    </g>
  );
}

function Star4({ x, y, scale = 1, rot = 0, color = '#7fa6c4' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color}>
      <path d="M 0 -7 L 1.6 -1.6 L 7 0 L 1.6 1.6 L 0 7 L -1.6 1.6 L -7 0 L -1.6 -1.6 Z" />
      <circle cx="0" cy="0" r="0.9" fill="#f4ead5" />
    </g>
  );
}

function Swirl({ x, y, scale = 1, rot = 0, color = '#9bb5cc' }) {
  return (
    <path
      transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}
      d="M -14 0 Q -6 -8 0 -2 Q 6 6 14 -1 M 11 -3 L 14 -1 L 12 2"
      fill="none"
      stroke={color}
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

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

function EmberSpark({ x, y, scale = 1, color = '#e8a03a' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
      <path d="M 0 -5 L 0.8 -0.8 L 5 0 L 0.8 0.8 L 0 5 L -0.8 0.8 L -5 0 L -0.8 -0.8 Z" />
    </g>
  );
}

function VolcanicRock({ x, y, scale = 1, rot = 0, color = '#a86048' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <ellipse cx="0" cy="0" rx="8" ry="5" fill={color} stroke="#7a4030" strokeWidth={0.6} />
      <path d="M -4 -1 Q -2 -3 0 -2 Q 2 -3 4 -1" stroke="#7a4030" strokeWidth={0.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

function SteamPuff({ x, y, scale = 1, rot = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill="#f0e0cc" stroke="#d4b898" strokeWidth={0.4}>
      <ellipse cx="0" cy="0" rx="5" ry="3" opacity={0.8} />
      <ellipse cx="-3" cy="-3" rx="3.5" ry="2.5" opacity={0.7} />
      <ellipse cx="3" cy="-3" rx="3.5" ry="2.5" opacity={0.7} />
      <ellipse cx="0" cy="-6" rx="2.5" ry="2" opacity={0.6} />
    </g>
  );
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

const SCATTERERS = {
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

// Per-world wallpaper opacity. Crystal Caves and Cloudspire read better a
// hair brighter because their motifs are airier; the forest stays softer so
// mushrooms don't shout over the path.
const WORLD_OPACITY = {
  1: 0.42,
  2: 0.40,
  3: 0.48,
  4: 0.46,
  5: 0.50,
  6: 0.45,
};

export function WorldWallpaper() {
  const motifs = useMemo(() => {
    return WORLDS.map(world => {
      const fn = SCATTERERS[world.id];
      return {
        id: world.id,
        opacity: WORLD_OPACITY[world.id] ?? 0.4,
        elements: fn ? fn(world) : [],
      };
    });
  }, []);

  return (
    <g aria-hidden style={{ pointerEvents: 'none' }}>
      {motifs.map(m => (
        <g key={`wp-${m.id}`} opacity={m.opacity}>
          {m.elements}
        </g>
      ))}
    </g>
  );
}
