import { useMemo } from 'react';
import { seeded, SVG_WIDTH } from './paperUtils';

// Jagged horizontal "torn paper" transition. The filled wedge re-paints the
// world below the tear (higher y) so it bleeds up into the world above,
// giving a hand-torn paper feel between chapters.
//
// Props:
//   y         — SVG y where the tear sits (the boundary line)
//   fillColor — paint to fill below the tear with (the lower world's wash)
//   seedOffset — different per-tear so each tear's jagged path is unique
export function TornEdge({ y, fillColor = '#f4ead5', seedOffset = 0 }) {
  const tornPath = useMemo(() => {
    const points = 42;
    const stepX = SVG_WIDTH / points;
    let d = `M -10 ${y + 32}`;
    for (let i = 0; i <= points; i++) {
      const x = i * stepX;
      const wobble = (seeded(i + 17 + seedOffset) - 0.5) * 10;
      const tilt = (seeded(i + 99 + seedOffset) - 0.5) * 4;
      const yy = y + wobble;
      if (i > 0 && i < points && i % 3 === 0) {
        d += ` L ${x - stepX * 0.4} ${yy + tilt - 2.4}`;
      }
      d += ` L ${x} ${yy}`;
    }
    d += ` L ${SVG_WIDTH + 10} ${y + 32} Z`;
    return d;
  }, [y, seedOffset]);

  const strokePath = useMemo(() => {
    const points = 42;
    const stepX = SVG_WIDTH / points;
    let d = `M -10 ${y + 4}`;
    for (let i = 0; i <= points; i++) {
      const x = i * stepX;
      const wobble = (seeded(i + 17 + seedOffset) - 0.5) * 10;
      d += ` L ${x} ${y + wobble}`;
    }
    d += ` L ${SVG_WIDTH + 10} ${y + 4}`;
    return d;
  }, [y, seedOffset]);

  return (
    <g>
      <path d={tornPath} fill={fillColor} />
      <path
        d={strokePath}
        fill="none"
        stroke="#a07859"
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
        filter="url(#paperWobble)"
      />
      {/* highlight just under the tear hints at paper thickness */}
      <path
        d={strokePath}
        fill="none"
        stroke="#f9f0d6"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.6}
        transform="translate(0, 1.5)"
      />
    </g>
  );
}
