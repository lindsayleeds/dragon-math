const { and, eq, sql } = require('drizzle-orm');
const schema = require('../db/schema');

const MAX_PASSAGES_PER_CHILD = 40;
const MAX_TITLE_LENGTH = 100;
const MAX_WORDS = 250;
const CATEGORIES = new Set(['verse', 'poem', 'quote', 'speech', 'definition', 'other']);

function passageWords(text) {
  return String(text || '').match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu) || [];
}

function firstMemoryLetter(word) {
  return [...String(word || '').normalize('NFKD').toLowerCase()][0] || '';
}

function validatePassage(input) {
  const title = typeof input?.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  const category = CATEGORIES.has(input?.category) ? input.category : 'other';
  const wordCount = passageWords(body).length;

  if (!title) return { ok: false, error: 'Give the passage a title or reference.' };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `Title must be at most ${MAX_TITLE_LENGTH} characters.` };
  }
  if (wordCount < 1) return { ok: false, error: 'Add at least one word to memorize.' };
  if (wordCount > MAX_WORDS) {
    return { ok: false, error: `A passage can contain at most ${MAX_WORDS} words.` };
  }
  const unsupported = passageWords(body).filter(word => !/^[a-z0-9]$/.test(firstMemoryLetter(word)));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `Each word must begin with A–Z or 0–9 so Hard mode can be played. Change: ${unsupported.slice(0, 3).join(', ')}.`,
    };
  }
  return { ok: true, passage: { title, body, category, wordCount } };
}

// The mastery_level completing a passage at each difficulty earns.
const DIFFICULTY_LEVEL = Object.freeze({ easy: 1, medium: 2, hard: 3 });

// Records that `childId` completed passage `passageId` at `difficulty`,
// practising the wording `body` of revision `revision` (the passage's
// updated_at as the child saw it, a Date). Shared by the web's
// POST /api/memory-passages/:id/progress and the iOS sync kind
// `memorize_progress` (./syncEvents.js), so both write the same row the same
// way. `exec` is `db` or a transaction's `tx`; nothing here opens one.
//
// The write is order independent, as sync requires: mastery keeps the hardest
// level ever completed and last_practiced_at the latest practice, whichever
// completion lands first.
//
// → { status: 'saved', passage }   the updated row
//   { status: 'not_found' }        no such passage, or not this child's
//   { status: 'changed' }          edited since that practice began: the
//                                  wording or revision no longer match, and
//                                  since an edit resets mastery, it isn't kept
async function recordMemoryProgress(exec, { childId, passageId, difficulty, body, revision, practicedAt }) {
  const level = DIFFICULTY_LEVEL[difficulty];
  if (!level) throw new Error(`unknown memorize difficulty ${difficulty}`);
  const [existing] = await exec.select().from(schema.memoryPassages)
    .where(eq(schema.memoryPassages.id, passageId)).limit(1);
  if (!existing || existing.childId !== childId) return { status: 'not_found' };
  if (existing.body !== body || new Date(existing.updatedAt).getTime() !== revision.getTime()) {
    return { status: 'changed' };
  }
  const t = schema.memoryPassages;
  const updated = await exec.update(t).set({
    masteryLevel: sql`GREATEST(${t.masteryLevel}, ${level})`,
    lastPracticedAt: sql`GREATEST(COALESCE(${t.lastPracticedAt}, ${practicedAt}), ${practicedAt})`,
  }).where(and(
    eq(t.id, passageId),
    eq(t.childId, childId),
    eq(t.body, body),
    eq(t.updatedAt, revision),
  )).returning();
  return updated.length ? { status: 'saved', passage: updated[0] } : { status: 'changed' };
}

module.exports = {
  CATEGORIES,
  DIFFICULTY_LEVEL,
  MAX_PASSAGES_PER_CHILD,
  MAX_TITLE_LENGTH,
  MAX_WORDS,
  passageWords,
  recordMemoryProgress,
  validatePassage,
};
