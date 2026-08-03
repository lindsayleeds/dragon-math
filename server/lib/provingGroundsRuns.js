// Proving Grounds medal rules — deliberately pure: no db, no express, so the
// validation can be tested without mocking anything. The queries that use these
// rules live in server/routes/provingGrounds.js.

const MODES = ['mul', 'div'];
const MEDALS = ['bronze', 'silver', 'gold'];
// Worst → best. Mirrors MEDAL_RANK in src/utils/provingGrounds.js: the client
// shows the best medal per level and this is the same ordering server-side.
const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };

const DIGIT_MIN = 2;
const DIGIT_MAX = 9;
// A 24-problem drill that beats the bronze threshold cannot legitimately take
// an hour. The cap is a sanity bound on a client-supplied number, not a scoring
// rule — the medal itself is still whatever the client says it earned.
const ELAPSED_MS_MAX = 60 * 60 * 1000;
const WRONG_COUNT_MAX = 24;

const DEFAULT_RECENT_LIMIT = 20;
const MAX_RECENT_LIMIT = 100;

// Validates a POSTed run. Returns `{ run }` with normalized fields, or a string
// error message suitable for a 400.
function validateRun(body) {
  const b = body || {};

  if (!MODES.includes(b.mode)) return `mode must be one of ${MODES.join(', ')}`;

  const digit = Number(b.digit);
  if (!Number.isInteger(digit) || digit < DIGIT_MIN || digit > DIGIT_MAX) {
    return `digit must be an integer ${DIGIT_MIN}-${DIGIT_MAX}`;
  }

  // Only medal-winning runs are stored, so a missing/none medal is a client bug
  // rather than a run worth a row.
  if (!MEDALS.includes(b.medal)) return `medal must be one of ${MEDALS.join(', ')}`;

  const elapsedMs = Number(b.elapsed_ms);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > ELAPSED_MS_MAX) {
    return `elapsed_ms must be a positive number up to ${ELAPSED_MS_MAX}`;
  }

  const wrongCount = b.wrong_count === undefined ? 0 : Number(b.wrong_count);
  if (!Number.isInteger(wrongCount) || wrongCount < 0 || wrongCount > WRONG_COUNT_MAX) {
    return `wrong_count must be an integer 0-${WRONG_COUNT_MAX}`;
  }

  return {
    run: { mode: b.mode, digit, medal: b.medal, elapsedMs: Math.round(elapsedMs), wrongCount },
  };
}

// Clamps a caller-supplied `limit` query param into range.
function normalizeLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_RECENT_LIMIT;
  return Math.min(n, MAX_RECENT_LIMIT);
}

module.exports = {
  MODES,
  MEDALS,
  MEDAL_RANK,
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  validateRun,
  normalizeLimit,
};
