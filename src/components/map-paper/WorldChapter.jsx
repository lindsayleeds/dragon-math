import { SVG_WIDTH } from './paperUtils';

// Book-chapter-style world heading: tiny patrick-hand "chapter X" line above
// a large caveat world name in the world's crayon color. No badges/cards —
// reads like the title page of a storybook chapter.
const CHAPTER_NUMBERS = ['one', 'two', 'three', 'four', 'five'];

export function WorldChapter({ world, index }) {
  const chapterNumber = CHAPTER_NUMBERS[index] || 'next';
  const y = world.chapterY;
  const x = world.chapterX ?? SVG_WIDTH / 2;

  return (
    <g aria-label={`Chapter: ${world.name}`}>
      <text
        x={x}
        y={y - 26}
        textAnchor="middle"
        fontFamily="'Patrick Hand', cursive"
        fontSize={14}
        fill="#5a4a3a"
        letterSpacing="3"
        opacity={0.85}
      >
        ~ chapter {chapterNumber} ~
      </text>
      <text
        x={x}
        y={y - 4}
        textAnchor="middle"
        fontFamily="'Caveat', cursive"
        fontWeight={700}
        fontSize={28}
        fill={world.chapterColor}
      >
        {world.name}
      </text>
    </g>
  );
}
