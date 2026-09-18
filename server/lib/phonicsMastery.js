// What it means to KNOW a phonics element, expressed as a pure function.
//
// This is the whole claim behind Dragon Phonics' progress reporting, so it is
// deliberately a module with no database and no imports: the rule can be read,
// argued with, and tested on plain arrays (server/lib/phonicsMastery.test.js).
// The route in server/routes/phonics.js does the querying and hands rows here.
//
// THE RULE, AND WHY IT IS SHAPED THIS WAY.
//
// 1. Only the RECENT window counts. A child who missed /sh/ twenty times in
//    March and has since got it right every time knows /sh/; a lifetime average
//    would say otherwise for months. So each element is judged on its last
//    `RECENT_WINDOW` attempts and old attempts fall out of the verdict — they
//    stay in the table for the trend chart, they just stop voting.
//
// 2. Mastery requires MORE THAN ONE GAME MODE. This is the part that makes
//    "comprehensively understands phonics" mean something. Picking /br/ from
//    four tiles is recognition; typing `br` from the sound alone is recall; and
//    hearing "brick" and finding /br/ inside it is analysis. A child can look
//    fluent on the multiple-choice game by elimination, so a high score in one
//    mode tops out at `solid` — `mastered` is only reachable by being right in
//    at least `MODES_FOR_MASTERY` different modes.
//
// 3. Accuracy alone is not enough — there is a floor on how many attempts a
//    verdict may rest on. Three-for-three is a good day, not proof.
//
// 4. Mastery goes STALE rather than being revoked. Decoding decays without
//    practice, but a child who has not seen /oi/ in two months has not got
//    worse at it — we simply no longer know. `stale` says "re-check this",
//    which is what drives the review round, and it never silently rewrites a
//    level the child earned.

// Attempts considered per element. Ten is roughly one round's worth of an
// element in the mixed-review game, so a bad day is recoverable within a day.
const RECENT_WINDOW = 10;

const MIN_ATTEMPTS_SOLID = 4;
const MIN_ATTEMPTS_MASTERED = 6;
const SOLID_ACCURACY = 0.75;
const MASTERED_ACCURACY = 0.9;
const MODES_FOR_MASTERY = 2;

// After this long unpracticed, a solid/mastered element is flagged for review.
const STALE_AFTER_DAYS = 45;

// Ranked worst to best. The UI colours tiles by this, and `LEVELS.indexOf` is
// how "did this child improve?" is compared, so the order is load-bearing.
const LEVELS = ['new', 'learning', 'solid', 'mastered'];

// Separator for the confusion-pair tally key. A tab can never appear in an
// element key (they are ASCII letters and hyphens), so it cannot collide.
const PAIR_SEP = '\t';

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Judge one element from its attempt history.
 *
 * @param {Array<{mode: string, correct: boolean, createdAt: Date|string}>} attempts
 *        Newest first. Extra fields are ignored.
 * @param {Date} [now]  injected so tests can pin "today".
 * @returns {{level: string, attempts: number, correct: number, accuracy: number|null,
 *            modes: string[], lastSeenAt: string|null, stale: boolean, total: number}}
 */
function classifyElement(attempts, now = new Date()) {
  const all = Array.isArray(attempts) ? attempts : [];
  const recent = all.slice(0, RECENT_WINDOW);
  const total = all.length;

  if (recent.length === 0) {
    return {
      level: 'new',
      attempts: 0,
      correct: 0,
      accuracy: null,
      modes: [],
      lastSeenAt: null,
      stale: false,
      total: 0,
    };
  }

  const correct = recent.filter((a) => a.correct).length;
  const accuracy = correct / recent.length;

  // Modes only count when the child was RIGHT in them: being wrong in three
  // different games is not three kinds of evidence that they know it.
  const modes = [...new Set(recent.filter((a) => a.correct).map((a) => a.mode))].sort();

  let level = 'learning';
  if (
    recent.length >= MIN_ATTEMPTS_MASTERED
    && accuracy >= MASTERED_ACCURACY
    && modes.length >= MODES_FOR_MASTERY
  ) {
    level = 'mastered';
  } else if (recent.length >= MIN_ATTEMPTS_SOLID && accuracy >= SOLID_ACCURACY) {
    level = 'solid';
  }

  const lastSeen = toDate(recent[0].createdAt);
  const stale = level !== 'learning'
    && lastSeen != null
    && (now.getTime() - lastSeen.getTime()) > STALE_AFTER_DAYS * 86400000;

  return {
    level,
    attempts: recent.length,
    correct,
    accuracy,
    modes,
    lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
    stale,
    total,
  };
}

/**
 * Judge every element a child has attempted.
 *
 * Elements the child has NEVER attempted are deliberately absent rather than
 * seeded as `new`: the curriculum lives in the frontend (src/data/
 * phonicsCurriculum.js), so the server does not know the full element list and
 * must not pretend to. The client fills the gaps — which also means adding an
 * element to the curriculum does not need a server deploy.
 *
 * @param {Array<{elementKey: string, mode: string, correct: boolean, createdAt: Date|string}>} rows
 *        Any order; grouped and sorted here.
 * @param {Date} [now]
 * @returns {Record<string, ReturnType<typeof classifyElement>>}
 */
function classifyAll(rows, now = new Date()) {
  const byElement = new Map();
  for (const row of rows || []) {
    const key = row.elementKey;
    if (!key) continue;
    if (!byElement.has(key)) byElement.set(key, []);
    byElement.get(key).push(row);
  }

  const out = {};
  for (const [key, attempts] of byElement) {
    attempts.sort((a, b) => {
      const at = toDate(a.createdAt)?.getTime() ?? 0;
      const bt = toDate(b.createdAt)?.getTime() ?? 0;
      return bt - at; // newest first
    });
    out[key] = classifyElement(attempts, now);
  }
  return out;
}

/**
 * The pairs a child actually mixes up, strongest first.
 *
 * A wrong answer only lands here when the child CHOSE a specific other element
 * (`chosen`), which the multiple-choice and find-in-word games always record and
 * the type-it game records when what they typed matches another element's
 * spelling. That is the difference between "gets /sh/ wrong" and "reads /sh/ as
 * /ch/" — only the second one tells a grown-up what to teach.
 *
 * @param {Array<{elementKey: string, chosen: string|null, correct: boolean}>} rows
 * @param {number} [limit]
 * @returns {Array<{element: string, chose: string, count: number}>}
 */
function confusionPairs(rows, limit = 8) {
  const counts = new Map();
  for (const row of rows || []) {
    if (row.correct) continue;
    if (!row.elementKey || !row.chosen) continue;
    if (row.chosen === row.elementKey) continue; // not a confusion
    const id = `${row.elementKey}${PAIR_SEP}${row.chosen}`;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => {
      const [element, chose] = id.split(PAIR_SEP);
      return { element, chose, count };
    })
    // A single slip is noise; two of the same mistake is a pattern.
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count || a.element.localeCompare(b.element))
    .slice(0, limit);
}

module.exports = {
  RECENT_WINDOW,
  MIN_ATTEMPTS_SOLID,
  MIN_ATTEMPTS_MASTERED,
  SOLID_ACCURACY,
  MASTERED_ACCURACY,
  MODES_FOR_MASTERY,
  STALE_AFTER_DAYS,
  LEVELS,
  classifyElement,
  classifyAll,
  confusionPairs,
};
