import styles from '../styles/FatDragonAvatar.module.css';

export function FatDragonAvatar({ number, size = 'medium' }) {
  const sizeClass = `size-${size}`;

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

          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap');
          `}</style>
        </defs>

        {/* Back leg (left) */}
        <ellipse cx="65" cy="180" rx="18" ry="28" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Back leg (right) */}
        <ellipse cx="135" cy="180" rx="18" ry="28" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Large round belly - the main feature */}
        <circle cx="100" cy="120" r="65" fill="#d4a957" stroke="#3d3528" strokeWidth="3" filter="url(#sketch)" />

        {/* Belly highlight/watercolor effect */}
        <circle cx="90" cy="100" r="35" fill="#e8c570" opacity="0.4" filter="url(#sketch)" />

        {/* Chest/body */}
        <ellipse cx="100" cy="70" rx="50" ry="45" fill="#a07859" stroke="#3d3528" strokeWidth="2.5" filter="url(#sketch)" />

        {/* Chest highlight */}
        <ellipse cx="95" cy="55" rx="28" ry="25" fill="#c89968" opacity="0.5" filter="url(#sketch)" />

        {/* Head */}
        <circle cx="100" cy="30" r="32" fill="#a07859" stroke="#3d3528" strokeWidth="2.5" filter="url(#sketch)" />

        {/* Snout/nose */}
        <ellipse cx="100" cy="45" rx="20" ry="16" fill="#c89968" stroke="#3d3528" strokeWidth="2" filter="url(#sketch)" />

        {/* Left eye */}
        <circle cx="85" cy="20" r="5" fill="#3d3528" />
        <circle cx="86" cy="18" r="2" fill="white" />

        {/* Right eye */}
        <circle cx="115" cy="20" r="5" fill="#3d3528" />
        <circle cx="116" cy="18" r="2" fill="white" />

        {/* Nose nostrils */}
        <circle cx="92" cy="48" r="2.5" fill="#3d3528" />
        <circle cx="108" cy="48" r="2.5" fill="#3d3528" />

        {/* Left horn */}
        <path
          d="M 75 8 Q 70 -5 68 -15"
          stroke="#3d3528"
          strokeWidth="2.8"
          fill="none"
          strokeLinecap="round"
          filter="url(#sketch)"
        />
        <path
          d="M 75 8 Q 70 -5 68 -15"
          stroke="#d97474"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Right horn */}
        <path
          d="M 125 8 Q 130 -5 132 -15"
          stroke="#3d3528"
          strokeWidth="2.8"
          fill="none"
          strokeLinecap="round"
          filter="url(#sketch)"
        />
        <path
          d="M 125 8 Q 130 -5 132 -15"
          stroke="#d97474"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* Left wing */}
        <path
          d="M 60 80 Q 30 60 25 100 Q 35 110 60 95"
          fill="#7d9d6c"
          stroke="#3d3528"
          strokeWidth="2.5"
          opacity="0.8"
          filter="url(#sketch)"
        />

        {/* Right wing */}
        <path
          d="M 140 80 Q 170 60 175 100 Q 165 110 140 95"
          fill="#7d9d6c"
          stroke="#3d3528"
          strokeWidth="2.5"
          opacity="0.8"
          filter="url(#sketch)"
        />

        {/* Tail */}
        <path
          d="M 150 140 Q 180 120 190 160 Q 185 180 160 175"
          fill="#a07859"
          stroke="#3d3528"
          strokeWidth="2.5"
          opacity="0.85"
          filter="url(#sketch)"
        />

        {/* Front left foot */}
        <ellipse cx="75" cy="175" rx="16" ry="24" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Front right foot */}
        <ellipse cx="125" cy="175" rx="16" ry="24" fill="#7d9d6c" stroke="#3d3528" strokeWidth="2.5" opacity="0.85" filter="url(#sketch)" />

        {/* Belly spots for character */}
        <circle cx="80" cy="110" r="6" fill="#c89968" opacity="0.6" />
        <circle cx="120" cy="135" r="5" fill="#c89968" opacity="0.6" />
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
