// Dragon Phonics progress: the kid records what they answered, and the kid or a
// linked grown-up reads back what that says they know.
//
// The verdict itself is NOT computed here — server/lib/phonicsMastery.js holds
// the rule as a pure function and this file only queries, validates and shapes.
// Mastery is always derived at read time from stored attempts, never written to
// a column, so changing the rule re-judges history rather than only the future.
//
// Two audiences, one rollup: `GET /api/phonics/mastery` answers for the logged-in
// child, and `GET /api/phonics/mastery/:childId` answers for a linked adult about
// that child. Both go through `buildReport()`, which is the same shape both ways
// so the kid's mastery map and the parent dashboard cannot drift apart (the same
// reasoning as schoolDetail()/schoolStudents() in school.js).

const express = require('express');
const { and, desc, eq, gte, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { classifyAll, confusionPairs, RECENT_WINDOW } = require('../lib/phonicsMastery');

const router = express.Router();
router.use(requireAuth);

const MODES = new Set(['type-it', 'choose', 'find-in-word', 'missing-sound']);

// An element key as the curriculum writes them: 'br', 'short-a', 'end-nk'.
// Shape only, deliberately not a membership check — see the schema comment on
// phonics_attempts.element_key.
const ELEMENT_KEY_RE = /^[a-z][a-z0-9-]{0,23}$/;

// One round is at most this many questions. A submission longer than this is a
// bug or a tampered client, not a long round.
const MAX_ATTEMPTS_PER_POST = 60;

// How far back the mastery read looks. Every attempt is kept forever, but a
// verdict only ever rests on the last RECENT_WINDOW attempts per element, so
// pulling a year of rows to throw nearly all of them away is wasted work. A
// generous window still comfortably contains RECENT_WINDOW attempts for any
// element a child actually practices.
const LOOKBACK_DAYS = 400;

function parseIntParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------- write

// POST /api/phonics/attempts
// Body: { attempts: [{ element_key, mode, correct, chosen?, response_ms? }] }
//
// A whole round lands in one request at the end rather than a request per
// question: a phonics item is answered in a couple of seconds, and per-question
// posts would put a network round trip inside the child's rhythm and drop the
// round entirely if the connection blinked mid-way.
router.post('/attempts', async (req, res) => {
  const userId = req.user.id;

  // One line, like every other call site: server/lib/rateLimit.test.js audits
  // these by scanning the source a line at a time, and a wrapped call is
  // invisible to it.
  const limit = await rateLimit({ key: `phonics-attempts:${userId}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many rounds too fast. Take a breath!' });
  }

  const raw = Array.isArray(req.body?.attempts) ? req.body.attempts : null;
  if (!raw) return res.status(400).json({ error: 'attempts must be an array' });
  if (raw.length === 0) return res.json({ saved: 0 });
  if (raw.length > MAX_ATTEMPTS_PER_POST) {
    return res.status(400).json({ error: `At most ${MAX_ATTEMPTS_PER_POST} attempts per request` });
  }

  const rows = [];
  for (const a of raw) {
    const elementKey = String(a?.element_key || '').toLowerCase();
    const mode = String(a?.mode || '');
    if (!ELEMENT_KEY_RE.test(elementKey)) {
      return res.status(400).json({ error: `Invalid element_key: ${elementKey.slice(0, 32)}` });
    }
    if (!MODES.has(mode)) {
      return res.status(400).json({ error: `Invalid mode: ${mode.slice(0, 32)}` });
    }
    // `chosen` is only meaningful as another element's key. Anything else (a
    // typo the child typed, say) is dropped rather than stored, because the only
    // consumer is the confusion report and a free-text value would just be noise
    // there. The attempt itself is still recorded as wrong.
    const chosenRaw = a?.chosen == null ? null : String(a.chosen).toLowerCase();
    const chosen = chosenRaw && ELEMENT_KEY_RE.test(chosenRaw) ? chosenRaw : null;

    const ms = Number(a?.response_ms);
    // A negative or absurd duration is a paused tab, not a thinking child.
    const responseMs = Number.isFinite(ms) && ms >= 0 && ms <= 120000 ? Math.round(ms) : null;

    rows.push({ userId, elementKey, mode, correct: !!a?.correct, chosen, responseMs });
  }

  await db.insert(schema.phonicsAttempts).values(rows);
  res.json({ saved: rows.length });
});

// ---------------------------------------------------------------- read

async function buildReport(userId) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const rows = await db
    .select({
      elementKey: schema.phonicsAttempts.elementKey,
      mode: schema.phonicsAttempts.mode,
      correct: schema.phonicsAttempts.correct,
      chosen: schema.phonicsAttempts.chosen,
      createdAt: schema.phonicsAttempts.createdAt,
    })
    .from(schema.phonicsAttempts)
    .where(and(
      eq(schema.phonicsAttempts.userId, userId),
      gte(schema.phonicsAttempts.createdAt, since),
    ))
    .orderBy(desc(schema.phonicsAttempts.createdAt));

  const elements = classifyAll(rows);

  // Per-mode totals, so the UI can say "you have never tried typing these" —
  // which is the most common reason an element is stuck at `solid`.
  const byMode = {};
  for (const row of rows) {
    const m = (byMode[row.mode] ||= { attempts: 0, correct: 0 });
    m.attempts += 1;
    if (row.correct) m.correct += 1;
  }

  return {
    elements,
    confusions: confusionPairs(rows),
    by_mode: byMode,
    total_attempts: rows.length,
    // Published so a client rendering "3 of 10 recent" does not hard-code the
    // window and quietly disagree with the server after a rule change.
    recent_window: RECENT_WINDOW,
  };
}

// GET /api/phonics/mastery — the logged-in kid's own picture.
router.get('/mastery', async (req, res) => {
  res.json(await buildReport(req.user.id));
});

// GET /api/phonics/mastery/:childId — a linked adult's view of one child.
//
// Scoped by parent_child_links exactly like the rest of the parent API. A child
// asking for their own id is allowed through (it is the same answer as the route
// above); a child asking for anyone else's is not.
router.get('/mastery/:childId', async (req, res) => {
  const childId = parseIntParam(req.params.childId);
  if (!childId) return res.status(400).json({ error: 'Invalid child id' });

  if (req.user.account_type === 'child') {
    if (childId !== req.user.id) return res.status(403).json({ error: 'Not your progress' });
    return res.json(await buildReport(childId));
  }

  const [link] = await db
    .select({ childId: schema.parentChildLinks.childId })
    .from(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, req.user.id),
      eq(schema.parentChildLinks.childId, childId),
    ))
    .limit(1);
  if (!link) return res.status(403).json({ error: 'Not your child' });

  res.json(await buildReport(childId));
});

// GET /api/phonics/activity — attempts per local day, for the trend strip.
// Counted in the server's timezone via date_trunc so it lines up with the rest
// of the day-scoped reporting; the timezone travels with the payload so a client
// renders it in the same frame of reference (see the CLAUDE.md note on windows).
router.get('/activity', async (req, res) => {
  const days = Math.min(Math.max(parseIntParam(req.query.days) || 30, 1), 180);
  const since = new Date(Date.now() - days * 86400000);

  const rows = await db
    .select({
      day: sql`to_char(date_trunc('day', ${schema.phonicsAttempts.createdAt}), 'YYYY-MM-DD')`,
      attempts: sql`count(*)::int`,
      correct: sql`sum(case when ${schema.phonicsAttempts.correct} then 1 else 0 end)::int`,
    })
    .from(schema.phonicsAttempts)
    .where(and(
      eq(schema.phonicsAttempts.userId, req.user.id),
      gte(schema.phonicsAttempts.createdAt, since),
    ))
    .groupBy(sql`date_trunc('day', ${schema.phonicsAttempts.createdAt})`)
    .orderBy(sql`date_trunc('day', ${schema.phonicsAttempts.createdAt})`);

  res.json({
    days: rows,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

module.exports = router;
