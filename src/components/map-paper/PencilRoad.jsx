import { MAP_PATH } from '../../data/mapData';

// 3-pass hand-drawn pencil road: kraft smudge → main pencil dash → lighter accent.
// All passes share the paperWobble displacement filter so the line wavers organically.
export function PencilRoad() {
  return (
    <g filter="url(#paperWobble)">
      <path
        d={MAP_PATH}
        fill="none"
        stroke="#a07859"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.18}
      />
      <path
        d={MAP_PATH}
        fill="none"
        stroke="#5a4a3a"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2 5 4 3 2 6"
        opacity={0.85}
      />
      <path
        d={MAP_PATH}
        fill="none"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 4 2 8"
        opacity={0.55}
      />
    </g>
  );
}
