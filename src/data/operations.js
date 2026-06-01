// The four arithmetic skills shown in the Learning Lair. `key` matches the
// `operator` value stored in problem_attempts and returned by /api/mastery; it
// is also the slug used in the /learning-lair/:operation URL. Accent colors are
// drawn from the journal palette (sage / sky / rose / mustard).
export const OPERATIONS = [
  { key: 'add', label: 'Addition',       symbol: '+', color: '#7d9d6c', blurb: 'sums & totals' },
  { key: 'sub', label: 'Subtraction',    symbol: '−', color: '#8eb0cc', blurb: 'taking away' },
  { key: 'mul', label: 'Multiplication', symbol: '×', color: '#d97474', blurb: 'times tables' },
  { key: 'div', label: 'Division',       symbol: '÷', color: '#d4a957', blurb: 'sharing fairly' },
];

export const OPERATION_BY_KEY = Object.fromEntries(
  OPERATIONS.map(op => [op.key, op])
);

// Bucket a mastery cell ({ total, childWins, accuracy }) into a visual tier.
// A handful of attempts ('new') isn't enough to claim mastery, so we hold off
// on the accuracy-based tiers until there's a little practice behind a number.
export function masteryTier(cell) {
  if (!cell || cell.total === 0) return 'none';
  if (cell.total < 3) return 'new';
  const a = cell.accuracy;
  if (a >= 0.9) return 'mastered';
  if (a >= 0.7) return 'strong';
  if (a >= 0.5) return 'practicing';
  return 'learning';
}
