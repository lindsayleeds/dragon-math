import styles from '../styles/FatDragonAvatar.module.css';

// The pudgy dragon is drawn once and recoloured per variant. Every palette keeps
// the same wholesome, nature-forward feel (warm gold, sky blue, berry, meadow)
// and the charcoal outline is shared, so they read as siblings of one species.
const PALETTES = {
  ember: { limb: '#7d9d6c', belly: '#d4a957', bellyHi: '#e8c570', body: '#a07859', bodyHi: '#c89968', snout: '#c89968', hornAccent: '#d97474', spot: '#c89968' },
  sky: { limb: '#6f97b8', belly: '#7fb4d4', bellyHi: '#a9d2ea', body: '#4f7a99', bodyHi: '#7ba6c0', snout: '#9cc3da', hornAccent: '#f0c674', spot: '#a9d2ea' },
  berry: { limb: '#9d7d96', belly: '#c79bb8', bellyHi: '#e2bcd6', body: '#8a5f80', bodyHi: '#b78dac', snout: '#d4a9c8', hornAccent: '#f0a6a6', spot: '#e2bcd6' },
  meadow: { limb: '#c89968', belly: '#8bbd6c', bellyHi: '#b3d99a', body: '#5f8a4f', bodyHi: '#86b56f', snout: '#9fc785', hornAccent: '#f0c674', spot: '#b3d99a' },
  longneck: { limb: '#c89968', belly: '#8bbd6c', bellyHi: '#b3d99a', body: '#5f8a4f', bodyHi: '#86b56f', snout: '#9fc785', hornAccent: '#f0c674', spot: '#b3d99a' },
  wyvern: { limb: '#6f97b8', belly: '#7fb4d4', bellyHi: '#a9d2ea', body: '#4f7a99', bodyHi: '#7ba6c0', snout: '#9cc3da', hornAccent: '#f0c674', spot: '#a9d2ea' },
  nimbus: { limb: '#6f97b8', belly: '#7fb4d4', bellyHi: '#a9d2ea', body: '#4f7a99', bodyHi: '#7ba6c0', snout: '#9cc3da', hornAccent: '#f0c674', spot: '#a9d2ea' },
};

// Illustrated (PNG) dragons live in /public/dragon_pngs. Variants whose id is a
// key here are rendered as an <img> instead of the hand-drawn SVG dragons.
const PNG_DRAGONS = {
  blaze: '/dragon_pngs/250.png',
  fern: '/dragon_pngs/138.png',
};

// Player-facing list of choices. The first entry is the default. Iterate this
// for the picker UI; PNG variants resolve via PNG_DRAGONS, SVG ones via PALETTES.
export const DRAGON_VARIANTS = [
  { id: 'blaze', name: 'Blaze' },
  { id: 'fern', name: 'Fern' },
];

const STROKE = '#3d3528';

export function FatDragonAvatar({ number, size = 'medium', variant = 'ember' }) {
  // Illustrated PNG dragons get their own image renderer.
  if (PNG_DRAGONS[variant]) return <ImageDragonAvatar number={number} size={size} variant={variant} />;
  // Two variants are different species, not just recolours — hand them off to
  // their own drawings (still palette-aware, so they read as siblings).
  if (variant === 'longneck') return <LongneckDragonAvatar number={number} size={size} variant={variant} />;
  if (variant === 'wyvern') return <BabyWyvernAvatar number={number} size={size} variant={variant} />;
  if (variant === 'nimbus') return <NimbusDragonAvatar number={number} size={size} variant={variant} />;

  const sizeClass = `size-${size}`;
  const p = PALETTES[variant] ?? PALETTES.ember;

  return (
    <div className={`${styles.dragonContainer} ${styles[sizeClass]}`}>
      <svg
        viewBox="0 0 200 240"
        className={styles.dragonSvg}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Define stroke pattern for hand-drawn effect */}
        <defs>
          <filter id="sketch">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>

        {/* Back leg (left) */}
        <ellipse cx="65" cy="180" rx="18" ry="28" fill={p.limb} stroke={STROKE} strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Back leg (right) */}
        <ellipse cx="135" cy="180" rx="18" ry="28" fill={p.limb} stroke={STROKE} strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Large round belly - the main feature */}
        <circle cx="100" cy="120" r="65" fill={p.belly} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />

        {/* Belly highlight/watercolor effect */}
        <circle cx="90" cy="100" r="35" fill={p.bellyHi} opacity="0.4" filter="url(#sketch)" />

        {/* Chest/body */}
        <ellipse cx="100" cy="70" rx="50" ry="45" fill={p.body} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />

        {/* Chest highlight */}
        <ellipse cx="95" cy="55" rx="28" ry="25" fill={p.bodyHi} opacity="0.5" filter="url(#sketch)" />

        {/* Head */}
        <circle cx="100" cy="30" r="32" fill={p.body} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />

        {/* Snout/nose */}
        <ellipse cx="100" cy="45" rx="20" ry="16" fill={p.snout} stroke={STROKE} strokeWidth="2" filter="url(#sketch)" />

        {/* Left eye */}
        <circle cx="85" cy="20" r="5" fill={STROKE} />
        <circle cx="86" cy="18" r="2" fill="white" />

        {/* Right eye */}
        <circle cx="115" cy="20" r="5" fill={STROKE} />
        <circle cx="116" cy="18" r="2" fill="white" />

        {/* Nose nostrils */}
        <circle cx="92" cy="48" r="2.5" fill={STROKE} />
        <circle cx="108" cy="48" r="2.5" fill={STROKE} />

        {/* Left horn */}
        <path
          d="M 75 8 Q 70 -5 68 -15"
          stroke={STROKE}
          strokeWidth="2.8"
          fill="none"
          strokeLinecap="round"
          filter="url(#sketch)"
        />
        <path
          d="M 75 8 Q 70 -5 68 -15"
          stroke={p.hornAccent}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Right horn */}
        <path
          d="M 125 8 Q 130 -5 132 -15"
          stroke={STROKE}
          strokeWidth="2.8"
          fill="none"
          strokeLinecap="round"
          filter="url(#sketch)"
        />
        <path
          d="M 125 8 Q 130 -5 132 -15"
          stroke={p.hornAccent}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Left wing */}
        <path
          d="M 60 80 Q 30 60 25 100 Q 35 110 60 95"
          fill={p.limb}
          stroke={STROKE}
          strokeWidth="2.5"
          opacity="0.8"
          filter="url(#sketch)"
        />

        {/* Right wing */}
        <path
          d="M 140 80 Q 170 60 175 100 Q 165 110 140 95"
          fill={p.limb}
          stroke={STROKE}
          strokeWidth="2.5"
          opacity="0.8"
          filter="url(#sketch)"
        />

        {/* Tail */}
        <path
          d="M 150 140 Q 180 120 190 160 Q 185 180 160 175"
          fill={p.body}
          stroke={STROKE}
          strokeWidth="2.5"
          opacity="0.85"
          filter="url(#sketch)"
        />

        {/* Front left foot */}
        <ellipse cx="75" cy="175" rx="16" ry="24" fill={p.limb} stroke={STROKE} strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Front right foot */}
        <ellipse cx="125" cy="175" rx="16" ry="24" fill={p.limb} stroke={STROKE} strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Belly spots for character */}
        <circle cx="80" cy="110" r="6" fill={p.spot} opacity="0.6" />
        <circle cx="120" cy="135" r="5" fill={p.spot} opacity="0.6" />
      </svg>

      {/* Number display in belly */}
      {number !== undefined && (
        <div className={styles.bellyNumber}>
          {number}
        </div>
      )}
    </div>
  );
}

// An illustrated dragon rendered from a PNG in /public/dragon_pngs. The belly
// number still overlays in the centre so it works wherever the SVG dragons do.
export function ImageDragonAvatar({ number, size = 'medium', variant }) {
  const src = PNG_DRAGONS[variant];

  return (
    <div className={`${styles.dragonContainer} ${styles[`size-${size}`]}`}>
      {/* eager + high priority so the dragon-picker thumbnails don't show an
          unloaded/broken-image flash on slow connections; the PNGs are large. */}
      <img
        src={src}
        alt=""
        className={styles.dragonImage}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        draggable={false}
      />

      {number !== undefined && (
        <div className={styles.bellyNumber}>{number}</div>
      )}
    </div>
  );
}

// A long-necked, gentle plant-eater dragon. Same charcoal outline + sketchy
// wobble as its siblings, recoloured per palette (defaults to the meadow greens).
export function LongneckDragonAvatar({ number, size = 'medium', variant = 'longneck' }) {
  const p = PALETTES[variant] ?? PALETTES.longneck;

  return (
    <div className={`${styles.dragonContainer} ${styles[`size-${size}`]}`}>
      <svg viewBox="0 0 200 240" className={styles.dragonSvg} preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="sketch">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>

        {/* Tail */}
        <path d="M 150 150 Q 190 140 185 190" fill="none" stroke={STROKE} strokeWidth="8" strokeLinecap="round" filter="url(#sketch)" />

        {/* Legs */}
        <rect x="70" y="150" width="12" height="40" rx="6" fill={p.limb} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />
        <rect x="118" y="150" width="12" height="40" rx="6" fill={p.limb} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />

        {/* Body */}
        <ellipse cx="100" cy="130" rx="45" ry="35" fill={p.belly} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />
        <ellipse cx="92" cy="120" rx="22" ry="16" fill={p.bellyHi} opacity="0.4" filter="url(#sketch)" />

        {/* Neck */}
        <path d="M 95 100 Q 80 50 95 15" fill="none" stroke={p.body} strokeWidth="22" strokeLinecap="round" filter="url(#sketch)" />

        {/* Head */}
        <circle cx="95" cy="15" r="20" fill={p.body} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />

        {/* Snout */}
        <ellipse cx="95" cy="24" rx="13" ry="9" fill={p.snout} stroke={STROKE} strokeWidth="2" filter="url(#sketch)" />

        {/* Eye */}
        <circle cx="89" cy="9" r="4" fill={STROKE} />
        <circle cx="90" cy="7" r="1.6" fill="white" />

        {/* Nostril */}
        <circle cx="91" cy="26" r="1.8" fill={STROKE} />
      </svg>

      {number !== undefined && (
        <div className={styles.bellyNumber}>{number}</div>
      )}
    </div>
  );
}

// A friendly cloud dragon drifting on a puff of sky. Same charcoal outline as its
// siblings, recoloured per palette (defaults to the sky blues).
export function NimbusDragonAvatar({ number, size = 'medium', variant = 'nimbus' }) {
  const p = PALETTES[variant] ?? PALETTES.nimbus;

  return (
    <div className={`${styles.dragonContainer} ${styles[`size-${size}`]}`}>
      <svg viewBox="0 0 200 240" className={styles.dragonSvg} preserveAspectRatio="xMidYMid meet">
        {/* Cloud body */}
        <circle cx="80" cy="120" r="28" fill={p.bellyHi} />
        <circle cx="105" cy="105" r="24" fill={p.belly} />
        <circle cx="130" cy="125" r="26" fill={p.bellyHi} />
        <circle cx="110" cy="145" r="22" fill={p.belly} />

        {/* Outline */}
        <path
          d="
            M 55 120
            Q 75 85 105 95
            Q 145 95 155 125
            Q 150 155 110 165
            Q 75 160 55 120
          "
          fill="none"
          stroke={STROKE}
          strokeWidth="3"
        />

        {/* Head */}
        <circle cx="75" cy="75" r="24" fill={p.body} stroke={STROKE} strokeWidth="3" />

        {/* Snout */}
        <ellipse cx="75" cy="87" rx="14" ry="10" fill={p.snout} stroke={STROKE} strokeWidth="2" />

        {/* Eyes */}
        <circle cx="67" cy="70" r="4" fill={STROKE} />
        <circle cx="83" cy="70" r="4" fill={STROKE} />

        {/* Whiskers */}
        <path d="M 58 84 Q 40 80 30 70" stroke={STROKE} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 92 84 Q 110 80 120 70" stroke={STROKE} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>

      {number !== undefined && (
        <div className={styles.bellyNumber}>{number}</div>
      )}
    </div>
  );
}

// A wide-eyed baby wyvern — big wings, tiny feet. Recoloured per palette
// (defaults to the sky blues).
export function BabyWyvernAvatar({ number, size = 'medium', variant = 'wyvern' }) {
  const p = PALETTES[variant] ?? PALETTES.wyvern;

  return (
    <div className={`${styles.dragonContainer} ${styles[`size-${size}`]}`}>
      <svg viewBox="0 0 200 240" className={styles.dragonSvg} preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="sketch">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
          </filter>
        </defs>

        {/* Left wing */}
        <path d="M 80 90 Q 20 40 30 130" fill={p.snout} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />

        {/* Right wing */}
        <path d="M 120 90 Q 180 40 170 130" fill={p.snout} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />

        {/* Tiny feet */}
        <ellipse cx="85" cy="185" rx="10" ry="12" fill={p.limb} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />
        <ellipse cx="115" cy="185" rx="10" ry="12" fill={p.limb} stroke={STROKE} strokeWidth="2.5" filter="url(#sketch)" />

        {/* Body */}
        <ellipse cx="100" cy="120" rx="40" ry="55" fill={p.belly} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />
        <ellipse cx="92" cy="105" rx="20" ry="26" fill={p.bellyHi} opacity="0.4" filter="url(#sketch)" />

        {/* Head */}
        <circle cx="100" cy="55" r="28" fill={p.body} stroke={STROKE} strokeWidth="3" filter="url(#sketch)" />

        {/* Giant eyes */}
        <circle cx="88" cy="50" r="7" fill="white" stroke={STROKE} strokeWidth="1.5" />
        <circle cx="112" cy="50" r="7" fill="white" stroke={STROKE} strokeWidth="1.5" />
        <circle cx="89" cy="51" r="3.2" fill={STROKE} />
        <circle cx="113" cy="51" r="3.2" fill={STROKE} />
        <circle cx="90.5" cy="49.5" r="1.1" fill="white" />
        <circle cx="114.5" cy="49.5" r="1.1" fill="white" />
      </svg>

      {number !== undefined && (
        <div className={styles.bellyNumber}>{number}</div>
      )}
    </div>
  );
}
