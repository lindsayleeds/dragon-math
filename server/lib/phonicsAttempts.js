// Writing Dragon Phonics attempts (phonics_attempts), shared by the web's
// POST /api/phonics/attempts (server/routes/phonics.js) and the iOS sync kind
// `phonics_attempt` (server/lib/syncEvents.js), so a round answered on either
// lands as the same rows and is judged by the same mastery rule
// (./phonicsMastery.js reads these rows back at read time).
//
// What is checked, and what is cleaned instead. The element key and the mode
// must be right — an attempt against a key or mode nothing can render is
// refused. The other two fields are only ever cleaned: a `chosen` that isn't
// shaped like an element key (a typo the child typed) becomes null, and so
// does a response time that is negative or absurd (a paused tab, not a
// thinking child). The attempt itself is still recorded.
const schema = require('../db/schema');

const PHONICS_MODES = Object.freeze(['type-it', 'choose', 'find-in-word', 'missing-sound']);

// An element key as src/data/phonicsCurriculum.js writes them: 'br',
// 'short-a', 'end-nk'. Shape only, deliberately not a membership check — see
// the schema comment on phonics_attempts.element_key.
const ELEMENT_KEY_RE = /^[a-z][a-z0-9-]{0,23}$/;

// Longer than this and the time says nothing about the child.
const MAX_RESPONSE_MS = 120000;

// `chosen` is only meaningful as another element's key; anything else is noise
// in the confusion report, its only consumer.
function cleanChosen(value) {
  const raw = value == null ? null : String(value).toLowerCase();
  return raw && ELEMENT_KEY_RE.test(raw) ? raw : null;
}

function cleanResponseMs(value) {
  if (value == null) return null;
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_RESPONSE_MS ? Math.round(ms) : null;
}

/**
 * One attempt as a phonics_attempts row, from the wire shape both callers use
 * ({ element_key, mode, correct, chosen?, response_ms? }).
 *
 * @param {number} userId
 * @param {object} attempt
 * @param {Date} [createdAt]  when it was answered; omitted = the insert's now()
 * @returns {{ row: object } | { error: string }}
 */
function phonicsAttemptRow(userId, attempt, createdAt) {
  const elementKey = String(attempt?.element_key || '').toLowerCase();
  const mode = String(attempt?.mode || '');
  if (!ELEMENT_KEY_RE.test(elementKey)) return { error: `Invalid element_key: ${elementKey.slice(0, 32)}` };
  if (!PHONICS_MODES.includes(mode)) return { error: `Invalid mode: ${mode.slice(0, 32)}` };
  const row = {
    userId,
    elementKey,
    mode,
    correct: !!attempt?.correct,
    chosen: cleanChosen(attempt?.chosen),
    responseMs: cleanResponseMs(attempt?.response_ms),
  };
  if (createdAt) row.createdAt = createdAt;
  return { row };
}

// Rows only ever add up, so the order attempts arrive in doesn't matter.
async function insertPhonicsAttempts(exec, rows) {
  if (!rows.length) return;
  await exec.insert(schema.phonicsAttempts).values(rows);
}

module.exports = {
  PHONICS_MODES,
  ELEMENT_KEY_RE,
  MAX_RESPONSE_MS,
  phonicsAttemptRow,
  insertPhonicsAttempts,
};
