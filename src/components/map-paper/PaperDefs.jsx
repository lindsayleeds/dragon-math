// Shared SVG <defs> for the paper map: filters, patterns. Applied once.
export function PaperDefs() {
  return (
    <defs>
      {/* paper fibers — feTurbulence noise overlay */}
      <filter id="paperNoise" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="7" />
        <feColorMatrix
          type="matrix"
          values="0 0 0 0 0.4
                  0 0 0 0 0.32
                  0 0 0 0 0.2
                  0 0 0 0.08 0"
        />
      </filter>

      {/* organic wobble — used by road and node circles */}
      <filter id="paperWobble" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.022"
          numOctaves="2"
          seed="3"
          result="t"
        />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="2.4" />
      </filter>

      {/* watercolor wash — for world 2 wash + splotches */}
      <filter id="watercolorEdge" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="5" />
        <feDisplacementMap in="SourceGraphic" scale="6" />
      </filter>

      {/* dot-grid notebook pattern overlay */}
      <pattern id="dotGrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="0.7" fill="#a07859" opacity="0.22" />
      </pattern>
    </defs>
  );
}
