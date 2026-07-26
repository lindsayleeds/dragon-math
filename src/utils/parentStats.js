// Formatting shared by the parent-facing stats surfaces (the dashboard's
// "Today's practice" card and the per-child stats page), so both render the
// same numbers the same way.

export const OP_LABEL = { add: '+', sub: '−', mul: '×', div: '÷' };

// A pace of 0 ms is a real (if implausible) measurement; only a missing value
// reads as "no pace yet".
export function fmtMs(ms) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function pct(num, denom) {
  if (!denom) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}
