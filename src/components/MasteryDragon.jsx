import styles from '../styles/MasteryDragon.module.css';

// Dragon SVG components for each tier
const DragonSVGs = {
  none: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Tiny, sitting dragon - uncertain */}
      <g transform="translate(40, 45)">
        {/* Body - curled up */}
        <ellipse cx="0" cy="0" rx="12" ry="14" fill="currentColor" opacity="0.5" />

        {/* Head - down, shy */}
        <circle cx="8" cy="-8" r="8" fill="currentColor" opacity="0.55" />

        {/* Eyes - worried */}
        <circle cx="11" cy="-9" r="1.5" fill="#3d3528" opacity="0.4" />
        <circle cx="14" cy="-9" r="1.5" fill="#3d3528" opacity="0.4" />

        {/* Tiny horn */}
        <path d="M 13 -16 L 12 -20 L 14 -16 Z" fill="currentColor" opacity="0.5" />

        {/* Tail - wrapped around */}
        <path d="M -8 8 Q -12 6 -10 2" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5" />
      </g>
    </svg>
  ),

  new: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Small dragon - curious, standing */}
      <g transform="translate(40, 48)">
        {/* Body */}
        <ellipse cx="0" cy="0" rx="10" ry="12" fill="currentColor" />

        {/* Head - slightly raised */}
        <circle cx="10" cy="-6" r="7" fill="currentColor" />

        {/* Eyes - curious */}
        <circle cx="13" cy="-7" r="1.8" fill="#3d3528" />
        <circle cx="16" cy="-7" r="1.8" fill="#3d3528" />
        <circle cx="14.2" cy="-8" r="0.6" fill="white" opacity="0.8" />

        {/* Snout - friendly */}
        <ellipse cx="18" cy="-4" rx="3" ry="2" fill="currentColor" />

        {/* Small horn */}
        <path d="M 12 -12 L 11 -17 L 13 -12 Z" fill="currentColor" />

        {/* Tiny wings - folded */}
        <ellipse cx="-5" cy="-4" rx="4" ry="6" fill="currentColor" opacity="0.7" transform="rotate(-25 -5 -4)" />
        <ellipse cx="5" cy="-4" rx="4" ry="6" fill="currentColor" opacity="0.7" transform="rotate(25 5 -4)" />

        {/* Tail - perky */}
        <path d="M -8 8 Q -14 6 -12 -2" stroke="currentColor" strokeWidth="2.5" fill="none" />
      </g>
    </svg>
  ),

  learning: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Medium dragon - growing confidence */}
      <g transform="translate(40, 46)">
        {/* Body */}
        <ellipse cx="0" cy="0" rx="12" ry="14" fill="currentColor" />

        {/* Head - more upright */}
        <circle cx="12" cy="-7" r="8" fill="currentColor" />

        {/* Eyes - confident */}
        <circle cx="15" cy="-8" r="2" fill="#3d3528" />
        <circle cx="19" cy="-8" r="2" fill="#3d3528" />
        <circle cx="16.5" cy="-9" r="0.7" fill="white" />

        {/* Snout */}
        <ellipse cx="22" cy="-4" rx="3.5" ry="2.5" fill="currentColor" />

        {/* Horn - more prominent */}
        <path d="M 14 -14 L 12 -21 L 15 -14 Z" fill="currentColor" />

        {/* Wings - partially spread */}
        <ellipse cx="-6" cy="-3" rx="5" ry="8" fill="currentColor" opacity="0.8" transform="rotate(-35 -6 -3)" />
        <ellipse cx="6" cy="-3" rx="5" ry="8" fill="currentColor" opacity="0.8" transform="rotate(35 6 -3)" />

        {/* Tail - curved, expressive */}
        <path d="M -9 10 Q -16 8 -15 -4 Q -14 -8 -10 -6" stroke="currentColor" strokeWidth="3" fill="none" />

        {/* Front leg */}
        <rect x="5" y="14" width="3" height="6" rx="1.5" fill="currentColor" />
      </g>
    </svg>
  ),

  practicing: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Larger dragon - strong, practiced */}
      <g transform="translate(40, 42)">
        {/* Body */}
        <ellipse cx="0" cy="0" rx="14" ry="16" fill="currentColor" />

        {/* Head - alert, upright */}
        <circle cx="14" cy="-8" r="9" fill="currentColor" />

        {/* Eyes - alert, bright */}
        <circle cx="18" cy="-9" r="2.2" fill="#3d3528" />
        <circle cx="23" cy="-9" r="2.2" fill="#3d3528" />
        <circle cx="19.5" cy="-10.5" r="0.8" fill="white" />
        <circle cx="24.5" cy="-10.5" r="0.8" fill="white" />

        {/* Snout - confident */}
        <ellipse cx="26" cy="-4" rx="4" ry="3" fill="currentColor" />

        {/* Horns - prominent pair */}
        <path d="M 15 -16 L 13 -24 L 16 -16 Z" fill="currentColor" />
        <path d="M 21 -16 L 20 -24 L 23 -16 Z" fill="currentColor" />

        {/* Wings - spread out confidently */}
        <ellipse cx="-8" cy="-2" rx="6" ry="10" fill="currentColor" opacity="0.85" transform="rotate(-40 -8 -2)" />
        <ellipse cx="8" cy="-2" rx="6" ry="10" fill="currentColor" opacity="0.85" transform="rotate(40 8 -2)" />

        {/* Tail - strong curve */}
        <path d="M -10 12 Q -18 10 -18 -6 Q -16 -12 -8 -8" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        {/* Front legs */}
        <rect x="3" y="15" width="3.5" height="8" rx="1.5" fill="currentColor" />
        <rect x="8" y="15" width="3.5" height="8" rx="1.5" fill="currentColor" />
      </g>
    </svg>
  ),

  strong: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Large dragon - strong, powerful */}
      <g transform="translate(40, 40)">
        {/* Body - broad, muscular */}
        <ellipse cx="0" cy="0" rx="16" ry="17" fill="currentColor" />

        {/* Head - held high */}
        <circle cx="16" cy="-10" r="10" fill="currentColor" />

        {/* Eyes - keen, intelligent */}
        <circle cx="20" cy="-11" r="2.4" fill="#3d3528" />
        <circle cx="26" cy="-11" r="2.4" fill="#3d3528" />
        <circle cx="21" cy="-13" r="0.9" fill="white" />
        <circle cx="27" cy="-13" r="0.9" fill="white" />

        {/* Snout - strong */}
        <ellipse cx="30" cy="-5" rx="4.5" ry="3.5" fill="currentColor" />

        {/* Nostrils */}
        <circle cx="32" cy="-4" r="0.8" fill="#3d3528" opacity="0.5" />

        {/* Horns - majestic pair */}
        <path d="M 16 -18 L 13 -28 L 17 -18 Z" fill="currentColor" />
        <path d="M 24 -18 L 23 -28 L 27 -18 Z" fill="currentColor" />

        {/* Wings - fully spread, powerful */}
        <ellipse cx="-10" cy="-1" rx="7" ry="12" fill="currentColor" opacity="0.9" transform="rotate(-45 -10 -1)" />
        <ellipse cx="10" cy="-1" rx="7" ry="12" fill="currentColor" opacity="0.9" transform="rotate(45 10 -1)" />

        {/* Tail - long, curved powerfully */}
        <path d="M -12 14 Q -22 12 -22 -8 Q -20 -16 -10 -10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* Front legs - strong */}
        <rect x="2" y="16" width="4" height="10" rx="2" fill="currentColor" />
        <rect x="8" y="16" width="4" height="10" rx="2" fill="currentColor" />

        {/* Belly scales - pattern for texture */}
        <ellipse cx="0" cy="3" rx="8" ry="4" fill="currentColor" opacity="0.4" />
      </g>
    </svg>
  ),

  mastered: (
    <svg viewBox="0 0 80 80" className={styles.dragon} aria-hidden="true">
      {/* Majestic dragon - mighty, proud */}
      <defs>
        <radialGradient id="dragonGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Glow effect */}
      <circle cx="40" cy="40" r="32" fill="url(#dragonGlow)" />

      <g transform="translate(40, 38)">
        {/* Body - large, powerful */}
        <ellipse cx="0" cy="0" rx="18" ry="19" fill="currentColor" />

        {/* Head - noble, high */}
        <circle cx="18" cy="-12" r="11" fill="currentColor" />

        {/* Eyes - wise, confident */}
        <circle cx="23" cy="-13" r="2.6" fill="#3d3528" />
        <circle cx="30" cy="-13" r="2.6" fill="#3d3528" />
        <circle cx="24" cy="-15" r="1" fill="white" />
        <circle cx="31" cy="-15" r="1" fill="white" />

        {/* Snout - proud, strong */}
        <ellipse cx="35" cy="-6" rx="5" ry="4" fill="currentColor" />

        {/* Nostrils - detailed */}
        <circle cx="37" cy="-4" r="0.9" fill="#3d3528" opacity="0.6" />
        <circle cx="39" cy="-4" r="0.9" fill="#3d3528" opacity="0.6" />

        {/* Majestic horns - large, curved */}
        <path d="M 18 -22 Q 16 -32 14 -35" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 28 -22 Q 30 -32 32 -35" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Crest detail */}
        <path d="M 21 -22 L 19 -26 M 25 -22 L 27 -26" stroke="currentColor" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />

        {/* Wings - fully extended, majestic */}
        <ellipse cx="-12" cy="0" rx="8" ry="14" fill="currentColor" opacity="0.95" transform="rotate(-50 -12 0)" />
        <ellipse cx="12" cy="0" rx="8" ry="14" fill="currentColor" opacity="0.95" transform="rotate(50 12 0)" />

        {/* Wing details - feathers */}
        <path d="M -14 -8 L -18 -10 M -12 -4 L -16 -4 M -10 4 L -14 6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <path d="M 14 -8 L 18 -10 M 12 -4 L 16 -4 M 10 4 L 14 6" stroke="currentColor" strokeWidth="1" opacity="0.5" />

        {/* Tail - long, elegant, powerful */}
        <path d="M -14 17 Q -26 15 -28 -12 Q -26 -20 -14 -14" stroke="currentColor" strokeWidth="4.5" fill="none" strokeLinecap="round" />

        {/* Front legs - strong, commanding */}
        <rect x="1" y="18" width="4.5" height="12" rx="2" fill="currentColor" />
        <rect x="8" y="18" width="4.5" height="12" rx="2" fill="currentColor" />

        {/* Belly pattern - scales */}
        <ellipse cx="0" cy="4" rx="10" ry="6" fill="currentColor" opacity="0.35" />
        <path d="M -6 4 L -5 8 M 0 4 L 0 8 M 6 4 L 5 8" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />

        {/* Star accents */}
        <g opacity="0.6">
          <path d="M -5 -12 L -4.8 -11 L -5.8 -10.8 L -4.8 -10.6 L -5 -9.6 L -5.2 -10.6 L -6.2 -10.8 L -5.2 -11 Z" fill="currentColor" />
          <path d="M 30 -5 L 30.2 -4 L 29.2 -3.8 L 30.2 -3.6 L 30 -2.6 L 29.8 -3.6 L 28.8 -3.8 L 29.8 -4 Z" fill="currentColor" />
        </g>
      </g>
    </svg>
  ),
};

export function MasteryDragon({ tier, number, color }) {
  const colorMap = {
    none: '#a07859',       // kraft
    new: '#8eb0cc',        // sky
    learning: '#d97474',   // rose
    practicing: '#d4a957', // mustard
    strong: '#7d9d6c',     // sage
    mastered: '#d4a957',   // mustard (glowing gold effect)
  };

  const dragonColor = color || colorMap[tier];

  return (
    <div className={`${styles.dragonCell} ${styles[`tier_${tier}`]}`}>
      <div className={styles.dragonContainer} style={{ color: dragonColor }}>
        {DragonSVGs[tier]}
      </div>
      <div className={styles.numberLabel}>{number}</div>
    </div>
  );
}
