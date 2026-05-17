export function WorldLabel({ world }) {
  // Position the label at the top of the world's y range
  // World 1: nodes 1-8, y range ~880–1720, label at y~800
  // World 2: nodes 9-17, y range ~55–760, label at y~820 (top of world 2 zone)
  const labelY = world.id === 1 ? 810 : 830;

  return (
    <g>
      {/* Divider line */}
      <line
        x1={20}
        y1={labelY + 5}
        x2={380}
        y2={labelY + 5}
        stroke={world.accentColor}
        strokeWidth="1.5"
        strokeDasharray="6 4"
        opacity="0.5"
      />
      {/* Badge background */}
      <rect
        x={110}
        y={labelY - 16}
        width={180}
        height={26}
        rx={13}
        fill={world.bgColor}
        stroke={world.accentColor}
        strokeWidth="1.5"
        opacity="0.9"
      />
      {/* World name */}
      <text
        x={200}
        y={labelY + 3}
        textAnchor="middle"
        fontSize={11}
        fontWeight="700"
        fill={world.accentColor}
        fontFamily="inherit"
        letterSpacing="0.5"
      >
        ✦ {world.name.toUpperCase()} ✦
      </text>
    </g>
  );
}
