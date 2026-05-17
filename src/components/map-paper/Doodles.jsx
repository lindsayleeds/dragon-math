import { WORLDS } from '../../data/mapData';
import { seeded, SVG_HEIGHT } from './paperUtils';

// Margin doodles — hand-drawn glyphs scattered along the SVG margins.
// Generated deterministically from per-world palettes so each chapter has its
// own colored flecks (sage/mustard for the forest, amber for honey, etc.).
const GLYPHS = ['✿', '✦', '~', '★', '✧', '♣', '☼', '✶'];

// Per-world doodle palettes — each pulls from that world's accent family.
const DOODLE_COLORS = {
  1: ['#7d9d6c', '#d4a957', '#d97474', '#a07859'],
  2: ['#d9923c', '#d4a957', '#b8852f', '#7d9d6c'],
  3: ['#8eb0cc', '#c79bb8', '#a07859', '#9d7fc4'],
  4: ['#c78aa6', '#d97474', '#d4a957', '#a07859'],
  5: ['#7fa6c4', '#c79bb8', '#8eb0cc', '#d4a957'],
};

function worldIdForY(y) {
  const w = WORLDS.find(w => y >= w.bandY.top && y < w.bandY.bottom);
  return w ? w.id : 1;
}

// Build doodles once at module load — same seed values every render.
const DOODLES = (() => {
  const out = [];
  const count = 64;
  for (let i = 0; i < count; i++) {
    const y = 60 + (i * (SVG_HEIGHT - 120)) / count + (seeded(i + 3) - 0.5) * 18;
    const onLeft = i % 2 === 0;
    const x = onLeft
      ? 18 + (seeded(i * 7) - 0.5) * 10
      : 378 + (seeded(i * 11) - 0.5) * 10;
    const rot = (seeded(i + 23) - 0.5) * 28;
    const wid = worldIdForY(y);
    const palette = DOODLE_COLORS[wid] || DOODLE_COLORS[1];
    const color = palette[Math.floor(seeded(i + 41) * palette.length)];
    const glyph = GLYPHS[Math.floor(seeded(i + 53) * GLYPHS.length)];
    const size = 15 + Math.floor(seeded(i + 61) * 9);
    out.push({ x, y, glyph, size, rot, color });
  }
  return out;
})();

// "home" anchor at the very bottom; "the end?" up top.
const TEXT_NOTES = [
  { x: 200, y: SVG_HEIGHT - 12, glyph: '~ home ~', size: 14, rot: -2, color: '#7d5a3f' },
  { x: 320, y: 38,              glyph: 'the end?', size: 14, rot: -4, color: '#7d5a3f' },
];

export function Doodles() {
  return (
    <g aria-hidden>
      {DOODLES.map((d, i) => (
        <text
          key={`g-${i}`}
          x={d.x}
          y={d.y}
          fontFamily="'Caveat', cursive"
          fontWeight={700}
          fontSize={d.size}
          fill={d.color}
          opacity={0.55}
          textAnchor="middle"
          transform={`rotate(${d.rot} ${d.x} ${d.y})`}
        >
          {d.glyph}
        </text>
      ))}
      {TEXT_NOTES.map((d, i) => (
        <text
          key={`t-${i}`}
          x={d.x}
          y={d.y}
          fontFamily="'Caveat', cursive"
          fontWeight={700}
          fontSize={d.size}
          fill={d.color}
          opacity={0.65}
          textAnchor="middle"
          transform={`rotate(${d.rot} ${d.x} ${d.y})`}
        >
          {d.glyph}
        </text>
      ))}
    </g>
  );
}
