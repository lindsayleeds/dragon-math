// The motif atoms scattered across the map wallpaper: tiny pure-SVG <g> glyphs,
// one per world theme (mushrooms and ferns for the forest, hexes and wheat for
// the plains, crystals, petals, cloud wisps, embers). Each takes a position,
// scale and rotation and draws in local coordinates.
//
// They live apart from the scatter generators in ./worldMotifs.jsx so that this
// file exports only components and that one declares none — the two halves of
// what Fast Refresh needs to preserve map state while artwork is edited.

export function Mushroom({ x, y, scale = 1, rot = 0, color = '#d97474', accent = '#7d9d6c' }) {
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

export function Fern({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
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

export function Clover({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
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

export function Hex({ x, y, scale = 1, color = '#d4a957', stroke = '#b8852f' }) {
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

export function Wheat({ x, y, scale = 1, rot = 0, color = '#b8852f' }) {
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

export function Sunflower({ x, y, scale = 1, rot = 0, color = '#d4a957', center = '#7d5a3f' }) {
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

export function Crystal({ x, y, scale = 1, rot = 0, color = '#9d7fc4', highlight = '#c79bb8' }) {
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

export function Sparkle({ x, y, scale = 1, color = '#9d7fc4' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
      <path d="M 0 -6 L 1.2 -1.2 L 6 0 L 1.2 1.2 L 0 6 L -1.2 1.2 L -6 0 L -1.2 -1.2 Z" />
    </g>
  );
}

export function Petal({ x, y, scale = 1, rot = 0, color = '#e7b7c7' }) {
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

export function Blossom({ x, y, scale = 1, rot = 0, color = '#f0c5d4', center = '#d97474' }) {
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

export function Bamboo({ x, y, scale = 1, rot = 0, color = '#7d9d6c' }) {
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

export function CloudWisp({ x, y, scale = 1, rot = 0, color = '#cfdded' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color} stroke="#9bb5cc" strokeWidth={0.5}>
      <ellipse cx="-7" cy="0" rx="6" ry="3" />
      <ellipse cx="0" cy="-2" rx="7" ry="4" />
      <ellipse cx="8" cy="0" rx="6" ry="3" />
      <ellipse cx="-3" cy="2" rx="9" ry="2.4" />
    </g>
  );
}

export function Star4({ x, y, scale = 1, rot = 0, color = '#7fa6c4' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill={color}>
      <path d="M 0 -7 L 1.6 -1.6 L 7 0 L 1.6 1.6 L 0 7 L -1.6 1.6 L -7 0 L -1.6 -1.6 Z" />
      <circle cx="0" cy="0" r="0.9" fill="#f4ead5" />
    </g>
  );
}

export function Swirl({ x, y, scale = 1, rot = 0, color = '#9bb5cc' }) {
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

export function EmberSpark({ x, y, scale = 1, color = '#e8a03a' }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
      <path d="M 0 -5 L 0.8 -0.8 L 5 0 L 0.8 0.8 L 0 5 L -0.8 0.8 L -5 0 L -0.8 -0.8 Z" />
    </g>
  );
}

export function VolcanicRock({ x, y, scale = 1, rot = 0, color = '#a86048' }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <ellipse cx="0" cy="0" rx="8" ry="5" fill={color} stroke="#7a4030" strokeWidth={0.6} />
      <path d="M -4 -1 Q -2 -3 0 -2 Q 2 -3 4 -1" stroke="#7a4030" strokeWidth={0.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

export function SteamPuff({ x, y, scale = 1, rot = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`} fill="#f0e0cc" stroke="#d4b898" strokeWidth={0.4}>
      <ellipse cx="0" cy="0" rx="5" ry="3" opacity={0.8} />
      <ellipse cx="-3" cy="-3" rx="3.5" ry="2.5" opacity={0.7} />
      <ellipse cx="3" cy="-3" rx="3.5" ry="2.5" opacity={0.7} />
      <ellipse cx="0" cy="-6" rx="2.5" ry="2" opacity={0.6} />
    </g>
  );
}
