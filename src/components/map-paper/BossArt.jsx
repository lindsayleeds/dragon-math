// Custom SVG dragons for boss nodes. Each is drawn centered on (0,0) and sized
// to fit a boss medallion (r = 36) with a small margin for the completion
// stamp in the top-right corner. Wrap content in the shared paperWobble filter
// so the dragon shares the same crayon shimmer as the medallion.

export function CrystalDragon() {
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* wing flare behind the head */}
      <path
        d="M -22 8 Q -28 18 -14 18 Q 0 22 14 18 Q 28 18 22 8 Q 14 12 0 12 Q -14 12 -22 8 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinejoin="round"
        opacity={0.9}
      />

      {/* head / face — rounded crystal-egg shape */}
      <path
        d="M -16 -3 Q -16 -17 0 -17 Q 16 -17 16 -3 Q 16 12 0 14 Q -16 12 -16 -3 Z"
        fill="#c79bb8"
        stroke="#3d3528"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* crystal horns */}
      <path
        d="M -11 -15 L -14 -24 L -5 -19 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path
        d="M  11 -15 L  14 -24 L  5 -19 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* small back-spike crystal between horns */}
      <path
        d="M 0 -17 L -2 -22 L 2 -22 Z"
        fill="#fff8e2"
        stroke="#3d3528"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />

      {/* whisker curls (eastern-dragon touch) */}
      <path
        d="M -14 2 Q -22 4 -20 10"
        fill="none"
        stroke="#3d3528"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <path
        d="M  14 2 Q  22 4  20 10"
        fill="none"
        stroke="#3d3528"
        strokeWidth={1.3}
        strokeLinecap="round"
      />

      {/* eyes — sclera */}
      <circle cx={-6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      <circle cx={ 6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      {/* pupils */}
      <circle cx={-5} cy={-4} r={1.4} fill="#3d3528" />
      <circle cx={ 7} cy={-4} r={1.4} fill="#3d3528" />

      {/* nostrils */}
      <ellipse cx={-2.2} cy={3} rx={0.9} ry={0.7} fill="#3d3528" />
      <ellipse cx={ 2.2} cy={3} rx={0.9} ry={0.7} fill="#3d3528" />

      {/* smile */}
      <path
        d="M -5 7 Q 0 11 5 7"
        fill="none"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* waxy highlight on cheek */}
      <ellipse
        cx={-7}
        cy={-11}
        rx={4}
        ry={1.6}
        fill="#fff8e2"
        opacity={0.55}
        transform="rotate(-18)"
      />
    </g>
  );
}

export function SakuraDragon() {
  // Side-profile sage dragon head facing right, with mane spikes, a curl of
  // body visible below, and sakura petals drifting around. Sage body chosen
  // so the dragon contrasts against both rose (available) and lavender
  // (completed) medallion fills.
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* sakura petals — behind everything */}
      <g transform="translate(-19, -15) rotate(-30)">
        <ellipse cx="0" cy="0" rx="4.5" ry="2.2" fill="#f0c6cf" stroke="#3d3528" strokeWidth="1" />
      </g>
      <g transform="translate(18, -17) rotate(40)">
        <ellipse cx="0" cy="0" rx="4" ry="2" fill="#f0c6cf" stroke="#3d3528" strokeWidth="1" />
      </g>
      <g transform="translate(-22, 12) rotate(-60)">
        <ellipse cx="0" cy="0" rx="3" ry="1.6" fill="#f0c6cf" stroke="#3d3528" strokeWidth="0.9" />
      </g>

      {/* body curl visible below the head */}
      <path
        d="M -22 16 Q -16 4 -2 6 Q 16 8 22 18 Q 16 22 0 21 Q -14 21 -22 16 Z"
        fill="#7d9d6c"
        stroke="#3d3528"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* cream belly highlight on body */}
      <path
        d="M -14 17 Q -6 12 6 13 Q 14 14 17 17"
        fill="none"
        stroke="#fff8e2"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* head — bean shape, snout pointing right */}
      <path
        d="M -12 -2 Q -14 -10 -2 -12 Q 14 -12 20 -4 Q 22 4 16 7 Q 6 9 -2 8 Q -12 7 -12 -2 Z"
        fill="#7d9d6c"
        stroke="#3d3528"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* snout — darker sage bump */}
      <path
        d="M 16 -2 Q 20 -2 21 1 Q 20 4 16 4"
        fill="#5a7d4c"
        stroke="#3d3528"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* nostril */}
      <ellipse cx="19" cy="-0.5" rx="0.9" ry="1.1" fill="#3d3528" />

      {/* mouth */}
      <path d="M 12 4 Q 16 5.5 19 4" fill="none" stroke="#3d3528" strokeWidth="1.3" strokeLinecap="round" />

      {/* mane spikes along the back/top of head — cream like crystal accents */}
      <path d="M -6 -10 L -4 -18 L -1 -11 Z" fill="#fff8e2" stroke="#3d3528" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M 1 -12 L 3 -19 L 6 -11 Z" fill="#fff8e2" stroke="#3d3528" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M 8 -11 L 10 -17 L 13 -10 Z" fill="#fff8e2" stroke="#3d3528" strokeWidth="1.2" strokeLinejoin="round" />

      {/* eye */}
      <circle cx="5" cy="-3" r="2.6" fill="#fff8e2" stroke="#3d3528" strokeWidth="1.2" />
      <circle cx="6" cy="-2.5" r="1.2" fill="#3d3528" />

      {/* whisker curling under chin */}
      <path
        d="M 16 5 Q 12 12 4 14 Q -2 15 -6 12"
        fill="none"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinecap="round"
      />

      {/* cheek highlight */}
      <ellipse cx="0" cy="-7" rx="4" ry="1.4" fill="#fff8e2" opacity="0.55" transform="rotate(-15)" />
    </g>
  );
}

export function SunfireDragon() {
  // Friendly front-facing mustard dragon with a soft sunburst halo and little
  // flame tufts at the cheeks. Designed to feel bright and warm — matches the
  // wholesome tone of the Crystal and Sakura dragons rather than the old
  // charcoal silhouette.
  const rays = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * 30) * Math.PI / 180;
    rays.push([Math.cos(a), Math.sin(a)]);
  }
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* sunburst rays behind everything — alternating long/short for that
          hand-drawn sun look */}
      <g opacity="0.9" stroke="#d4a957" strokeLinecap="round">
        {rays.map(([cx, cy], i) => {
          const long = i % 2 === 0;
          const inner = long ? 20 : 21;
          const outer = long ? 31 : 26;
          return (
            <line
              key={i}
              x1={cx * inner}
              y1={cy * inner}
              x2={cx * outer}
              y2={cy * outer}
              strokeWidth={long ? 3 : 2}
            />
          );
        })}
      </g>

      {/* soft sun-disc halo */}
      <circle r="19" fill="#d4a957" opacity="0.35" />

      {/* flame tufts to either side of the head — rose outer, mustard inner */}
      <path
        d="M -18 -2 Q -24 -10 -20 -14 Q -19 -8 -16 -8 Q -19 -4 -16 0 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M -17 -3 Q -20 -8 -18 -11 Q -17 -7 -15 -6"
        fill="#d4a957"
        stroke="none"
      />
      <path
        d="M 18 -2 Q 24 -10 20 -14 Q 19 -8 16 -8 Q 19 -4 16 0 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M 17 -3 Q 20 -8 18 -11 Q 17 -7 15 -6"
        fill="#d4a957"
        stroke="none"
      />

      {/* curly mustache-style horns sweeping up and out */}
      <path
        d="M -6 -13 Q -10 -20 -14 -19 Q -12 -22 -8 -21 Q -4 -19 -3 -14 Z"
        fill="#a07859"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M  6 -13 Q 10 -20 14 -19 Q 12 -22  8 -21 Q  4 -19  3 -14 Z"
        fill="#a07859"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />

      {/* head — round friendly mustard face */}
      <path
        d="M -15 -3 Q -15 -16 0 -16 Q 15 -16 15 -3 Q 15 11 0 13 Q -15 11 -15 -3 Z"
        fill="#d4a957"
        stroke="#3d3528"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* warm belly/snout highlight — kraft wash */}
      <path
        d="M -8 4 Q 0 9 8 4 Q 6 10 0 11 Q -6 10 -8 4 Z"
        fill="#c08a4a"
        stroke="#3d3528"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* eyes — sclera */}
      <circle cx={-6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      <circle cx={ 6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      {/* pupils — looking slightly up, happy */}
      <circle cx={-5.6} cy={-5.6} r={1.4} fill="#3d3528" />
      <circle cx={ 6.4} cy={-5.6} r={1.4} fill="#3d3528" />
      {/* eye sparkles */}
      <circle cx={-5} cy={-6.2} r={0.5} fill="#fff8e2" />
      <circle cx={ 7} cy={-6.2} r={0.5} fill="#fff8e2" />

      {/* nostrils */}
      <ellipse cx={-2} cy={2} rx={0.8} ry={0.6} fill="#3d3528" />
      <ellipse cx={ 2} cy={2} rx={0.8} ry={0.6} fill="#3d3528" />

      {/* friendly smile */}
      <path
        d="M -4 7 Q 0 10 4 7"
        fill="none"
        stroke="#3d3528"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* rosy cheek blushes */}
      <ellipse cx={-9} cy={3} rx={2.2} ry={1.2} fill="#d97474" opacity="0.6" />
      <ellipse cx={ 9} cy={3} rx={2.2} ry={1.2} fill="#d97474" opacity="0.6" />

      {/* waxy highlight on forehead */}
      <ellipse
        cx={-5}
        cy={-11}
        rx={4.5}
        ry={1.8}
        fill="#fff8e2"
        opacity="0.55"
        transform="rotate(-18)"
      />

      {/* tiny flame tuft on top of head */}
      <path
        d="M -2 -16 Q 0 -22 2 -16 Q 1 -18 0 -19 Q -1 -18 -2 -16 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M -1 -16 Q 0 -20 1 -16 Z"
        fill="#d4a957"
      />
    </g>
  );
}

export function StormDragon() {
  // Sky-blue dragon peeking out of a cloud bank with a mustard lightning bolt
  // crackling behind. Front-facing friendly head to match the rhythm of the
  // other bosses.
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* lightning bolt behind everything — mustard zigzag */}
      <path
        d="M 6 -26 L -4 -8 L 2 -8 L -6 12 L 8 -6 L 1 -6 L 10 -24 Z"
        fill="#d4a957"
        stroke="#3d3528"
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity="0.95"
      />

      {/* back cloud puff — sits behind the head */}
      <path
        d="M -24 -2 Q -28 -10 -20 -12 Q -18 -18 -10 -16 Q -4 -20 4 -17 Q 14 -20 18 -13 Q 26 -12 24 -3 Q 26 4 18 4 Q 12 8 4 6 Q -4 8 -12 6 Q -22 6 -24 -2 Z"
        fill="#fff8e2"
        stroke="#3d3528"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.95"
      />
      {/* cloud rule line for shading */}
      <path
        d="M -18 0 Q -8 3 6 1 Q 14 0 20 1"
        fill="none"
        stroke="#c4b290"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />

      {/* horns — pale sky, swept back */}
      <path
        d="M -6 -12 Q -11 -20 -15 -19 Q -9 -14 -4 -10 Z"
        fill="#b9d2e6"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M  6 -12 Q 11 -20  15 -19 Q  9 -14  4 -10 Z"
        fill="#b9d2e6"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />

      {/* head — round sky-blue face */}
      <path
        d="M -15 -2 Q -15 -15 0 -15 Q 15 -15 15 -2 Q 15 12 0 14 Q -15 12 -15 -2 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* belly/snout patch — cream */}
      <path
        d="M -8 5 Q 0 10 8 5 Q 6 11 0 12 Q -6 11 -8 5 Z"
        fill="#fff8e2"
        stroke="#3d3528"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* eyes — sclera */}
      <circle cx={-6} cy={-4} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      <circle cx={ 6} cy={-4} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      {/* pupils */}
      <circle cx={-5.6} cy={-4.6} r={1.4} fill="#3d3528" />
      <circle cx={ 6.4} cy={-4.6} r={1.4} fill="#3d3528" />
      {/* eye sparkles */}
      <circle cx={-5} cy={-5.2} r={0.5} fill="#fff8e2" />
      <circle cx={ 7} cy={-5.2} r={0.5} fill="#fff8e2" />

      {/* nostrils */}
      <ellipse cx={-2} cy={3} rx={0.8} ry={0.6} fill="#3d3528" />
      <ellipse cx={ 2} cy={3} rx={0.8} ry={0.6} fill="#3d3528" />

      {/* friendly smile */}
      <path
        d="M -4 7 Q 0 10 4 7"
        fill="none"
        stroke="#3d3528"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* cool blue cheek dots */}
      <ellipse cx={-9} cy={4} rx={2} ry={1.1} fill="#5e8aab" opacity="0.5" />
      <ellipse cx={ 9} cy={4} rx={2} ry={1.1} fill="#5e8aab" opacity="0.5" />

      {/* waxy highlight on forehead */}
      <ellipse
        cx={-5}
        cy={-10}
        rx={4.5}
        ry={1.8}
        fill="#fff8e2"
        opacity="0.6"
        transform="rotate(-18)"
      />

      {/* tiny lightning sparks around the head */}
      <path
        d="M -22 -16 L -20 -12 L -22 -12 L -19 -8"
        fill="none"
        stroke="#d4a957"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 22 8 L 20 12 L 22 12 L 19 16"
        fill="none"
        stroke="#d4a957"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* a couple raindrops below the cloud */}
      <path
        d="M -10 16 Q -11 19 -8 19 Q -8 17 -10 16 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M 10 17 Q 9 20 12 20 Q 12 18 10 17 Z"
        fill="#8eb0cc"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </g>
  );
}

export function ForestDragon() {
  // Friendly front-facing forest-green dragon for the Mushroom Forest boss
  // (node 8). Leafy antler horns, two red-cap mushrooms flanking the head
  // (mirroring Sunfire's flame tufts), drifting leaves behind (mirroring
  // Sakura's petals). Body uses World 1's accent #5a9e6f so the dragon reads
  // distinctly from the sage Sakura dragon.
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* drifting leaves — behind everything */}
      <g transform="translate(-22, -12) rotate(-35)">
        <path
          d="M 0 0 Q 3 -4 6 0 Q 3 4 0 0 Z"
          fill="#7d9d6c"
          stroke="#3d3528"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path d="M 0 0 L 6 0" stroke="#3d3528" strokeWidth="0.7" />
      </g>
      <g transform="translate(22, -14) rotate(50)">
        <path
          d="M 0 0 Q 3 -3.5 5.5 0 Q 3 3.5 0 0 Z"
          fill="#d4a957"
          stroke="#3d3528"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path d="M 0 0 L 5.5 0" stroke="#3d3528" strokeWidth="0.7" />
      </g>
      <g transform="translate(-24, 14) rotate(-70)">
        <path
          d="M 0 0 Q 2.5 -3 5 0 Q 2.5 3 0 0 Z"
          fill="#7d9d6c"
          stroke="#3d3528"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      </g>

      {/* red-cap mushrooms flanking the head — stems first */}
      <rect x={-21} y={-2} width={4} height={7} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.1} rx={1} />
      <path
        d="M -25 -2 Q -19 -10 -13 -2 Q -19 -1 -25 -2 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <circle cx={-22} cy={-4} r={0.9} fill="#fff8e2" />
      <circle cx={-18} cy={-5} r={1.1} fill="#fff8e2" />
      <circle cx={-15} cy={-3} r={0.8} fill="#fff8e2" />

      <rect x={17} y={-2} width={4} height={7} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.1} rx={1} />
      <path
        d="M 13 -2 Q 19 -10 25 -2 Q 19 -1 13 -2 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <circle cx={16} cy={-3} r={0.8} fill="#fff8e2" />
      <circle cx={19} cy={-5} r={1.1} fill="#fff8e2" />
      <circle cx={22} cy={-4} r={0.9} fill="#fff8e2" />

      {/* leafy antler horns — kraft branches */}
      <path
        d="M -8 -14 Q -12 -20 -14 -22 M -12 -19 Q -15 -19 -16 -21 M -10 -17 Q -8 -21 -8 -23"
        fill="none"
        stroke="#7d5a3f"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path
        d="M  8 -14 Q  12 -20  14 -22 M  12 -19 Q  15 -19  16 -21 M  10 -17 Q  8 -21  8 -23"
        fill="none"
        stroke="#7d5a3f"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* tiny sage leaves on the antlers */}
      <path d="M -14 -22 Q -17 -23 -15 -25 Q -13 -24 -14 -22 Z" fill="#7d9d6c" stroke="#3d3528" strokeWidth={0.9} strokeLinejoin="round" />
      <path d="M -8 -23 Q -6 -25 -8 -27 Q -10 -25 -8 -23 Z" fill="#7d9d6c" stroke="#3d3528" strokeWidth={0.9} strokeLinejoin="round" />
      <path d="M  14 -22 Q  17 -23  15 -25 Q  13 -24  14 -22 Z" fill="#7d9d6c" stroke="#3d3528" strokeWidth={0.9} strokeLinejoin="round" />
      <path d="M   8 -23 Q   6 -25   8 -27 Q  10 -25   8 -23 Z" fill="#7d9d6c" stroke="#3d3528" strokeWidth={0.9} strokeLinejoin="round" />

      {/* head — rounded forest-green face */}
      <path
        d="M -15 -3 Q -15 -16 0 -16 Q 15 -16 15 -3 Q 15 11 0 13 Q -15 11 -15 -3 Z"
        fill="#5a9e6f"
        stroke="#3d3528"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* pale belly/snout patch */}
      <path
        d="M -8 4 Q 0 9 8 4 Q 6 10 0 11 Q -6 10 -8 4 Z"
        fill="#c8efd8"
        stroke="#3d3528"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />

      {/* mossy back-spike tuft between the horns */}
      <path
        d="M -3 -16 Q -1 -20 0 -16 Q 1 -20 3 -16 Z"
        fill="#7d9d6c"
        stroke="#3d3528"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />

      {/* eyes — sclera */}
      <circle cx={-6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      <circle cx={ 6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      {/* pupils — happy upward look */}
      <circle cx={-5.6} cy={-5.6} r={1.4} fill="#3d3528" />
      <circle cx={ 6.4} cy={-5.6} r={1.4} fill="#3d3528" />
      {/* eye sparkles */}
      <circle cx={-5} cy={-6.2} r={0.5} fill="#fff8e2" />
      <circle cx={ 7} cy={-6.2} r={0.5} fill="#fff8e2" />

      {/* nostrils */}
      <ellipse cx={-2} cy={2} rx={0.8} ry={0.6} fill="#3d3528" />
      <ellipse cx={ 2} cy={2} rx={0.8} ry={0.6} fill="#3d3528" />

      {/* friendly smile */}
      <path
        d="M -4 7 Q 0 10 4 7"
        fill="none"
        stroke="#3d3528"
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* rosy cheek blushes */}
      <ellipse cx={-9} cy={3} rx={2.2} ry={1.2} fill="#d97474" opacity={0.6} />
      <ellipse cx={ 9} cy={3} rx={2.2} ry={1.2} fill="#d97474" opacity={0.6} />

      {/* waxy highlight on forehead */}
      <ellipse
        cx={-5}
        cy={-11}
        rx={4.5}
        ry={1.8}
        fill="#fff8e2"
        opacity={0.55}
        transform="rotate(-18)"
      />
    </g>
  );
}

export function MagmaDragon() {
  // Final-boss Magma Dragon (node 49). Rose body with glowing mustard cracks
  // running across the face (cooling lava), kraft cracked-stone horns, smoke
  // wisps drifting up behind, and a couple of lava droplets falling below.
  // Brighter than the old Sunfire silhouette so it still reads as wholesome,
  // but the hottest dragon on the map — uses the deepest rose available.
  return (
    <g style={{ pointerEvents: 'none' }} filter="url(#paperWobble)">
      {/* smoke wisps behind the head */}
      <path
        d="M -16 -20 Q -20 -24 -16 -26 Q -12 -24 -14 -22 Q -12 -20 -16 -20 Z"
        fill="#c4b290"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
        opacity="0.75"
      />
      <path
        d="M 0 -24 Q -4 -28 0 -30 Q 4 -28 2 -26 Q 4 -24 0 -24 Z"
        fill="#c4b290"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
        opacity="0.75"
      />
      <path
        d="M 14 -20 Q 10 -24 14 -26 Q 18 -24 16 -22 Q 18 -20 14 -20 Z"
        fill="#c4b290"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
        opacity="0.75"
      />

      {/* lava pool halo behind the head — soft rose wash */}
      <ellipse cx={0} cy={4} rx={22} ry={10} fill="#d97474" opacity="0.35" />

      {/* cracked-stone horns — kraft with charcoal seams */}
      <path
        d="M -7 -13 Q -12 -22 -16 -22 Q -10 -16 -5 -11 Z"
        fill="#a07859"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M -10 -16 L -13 -19" stroke="#3d3528" strokeWidth="0.9" strokeLinecap="round" />
      <path
        d="M  7 -13 Q 12 -22  16 -22 Q 10 -16  5 -11 Z"
        fill="#a07859"
        stroke="#3d3528"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M  10 -16 L  13 -19" stroke="#3d3528" strokeWidth="0.9" strokeLinecap="round" />

      {/* head — round deep-rose face */}
      <path
        d="M -15 -3 Q -15 -16 0 -16 Q 15 -16 15 -3 Q 15 12 0 14 Q -15 12 -15 -3 Z"
        fill="#c25a5a"
        stroke="#3d3528"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* glowing magma cracks across the face — mustard */}
      <path
        d="M -12 -8 L -8 -5 L -10 -2 L -6 1"
        fill="none"
        stroke="#d4a957"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 11 -7 L 8 -4 L 12 -1"
        fill="none"
        stroke="#d4a957"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 0 -13 L -2 -10 L 1 -8"
        fill="none"
        stroke="#d4a957"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* warm belly/snout — mustard-leaning */}
      <path
        d="M -8 4 Q 0 10 8 4 Q 6 11 0 12 Q -6 11 -8 4 Z"
        fill="#e8a85a"
        stroke="#3d3528"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* small spike between the horns */}
      <path
        d="M -2 -16 Q 0 -22 2 -16 Z"
        fill="#a07859"
        stroke="#3d3528"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />

      {/* eyes — sclera */}
      <circle cx={-6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      <circle cx={ 6} cy={-5} r={3.2} fill="#fff8e2" stroke="#3d3528" strokeWidth={1.2} />
      {/* pupils — slightly determined, looking forward */}
      <circle cx={-5.4} cy={-4.6} r={1.5} fill="#3d3528" />
      <circle cx={ 6.6} cy={-4.6} r={1.5} fill="#3d3528" />
      {/* eye sparkles — mustard glow to suggest heat */}
      <circle cx={-5} cy={-5.6} r={0.5} fill="#d4a957" />
      <circle cx={ 7} cy={-5.6} r={0.5} fill="#d4a957" />

      {/* nostrils */}
      <ellipse cx={-2} cy={2} rx={0.9} ry={0.7} fill="#3d3528" />
      <ellipse cx={ 2} cy={2} rx={0.9} ry={0.7} fill="#3d3528" />

      {/* friendly smile */}
      <path
        d="M -4 7 Q 0 10 4 7"
        fill="none"
        stroke="#3d3528"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* mustard glowing cheek blushes — molten */}
      <ellipse cx={-9} cy={3} rx={2.2} ry={1.2} fill="#d4a957" opacity="0.7" />
      <ellipse cx={ 9} cy={3} rx={2.2} ry={1.2} fill="#d4a957" opacity="0.7" />

      {/* waxy highlight on forehead */}
      <ellipse
        cx={-5}
        cy={-11}
        rx={4.5}
        ry={1.8}
        fill="#fff8e2"
        opacity="0.5"
        transform="rotate(-18)"
      />

      {/* tiny flame tuft on top of head */}
      <path
        d="M -2 -16 Q 0 -22 2 -16 Q 1 -18 0 -19 Q -1 -18 -2 -16 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M -1 -16 Q 0 -20 1 -16 Z"
        fill="#d4a957"
      />

      {/* lava droplets falling below */}
      <path
        d="M -10 16 Q -11 20 -8 20 Q -8 18 -10 16 Z"
        fill="#d4a957"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M 11 18 Q 10 22 13 22 Q 13 19 11 18 Z"
        fill="#d97474"
        stroke="#3d3528"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </g>
  );
}

// Registry: boss node id → custom dragon component.
// Bosses without an entry fall back to the emoji glyph in PaperNode.
export const BOSS_ART = {
  8:  ForestDragon,  // Forest Dragon
  16: SunfireDragon, // Sunfire Dragon
  25: CrystalDragon, // Crystal Dragon
  33: SakuraDragon,  // Sakura Dragon
  41: StormDragon,   // Storm Dragon
  49: MagmaDragon,   // Magma Dragon
};
