// Custom Dragon Spelling word lists — "Week 1", "Week 2", the 15 words that
// came home from school this week.
//
// A list belongs to ONE child. Two people may write it: the child themselves
// (from the Dragon Spelling picker) or a linked parent (from their dashboard).
// Both go through `resolveChildAccess` below; a child can only ever touch their
// own lists, an adult only their linked children's.
//
// Audio: saving a list blocks while ElevenLabs generates any word the site has
// never spoken before (server/lib/spellingAudio.js). The generated MP3s go into
// a shared, site-wide cache keyed by word, so each word is only ever paid for
// once no matter how many families put it on a list. A word whose audio fails
// still saves — the game falls back to browser speech for it.

const express = require('express');
const { and, asc, eq, inArray, sql } = require('drizzle-orm');
const { db, schema } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/rateLimit');
const { checkSpellingWords } = require('../lib/moderation');
const { ensureAudio, cachedWords, getAudio } = require('../lib/spellingAudio');
const {
  MAX_LISTS_PER_CHILD,
  validateName,
  validateWords,
} = require('../lib/spellingLists');

const router = express.Router();

// ---------------------------------------------------------------- audio (public)
//
// Deliberately BEFORE requireAuth: the browser plays this through `new Audio(url)`,
// which cannot carry an Authorization header. The content is a synthesised
// English word — the same thing the static public/audio/spelling/*.mp3 files
// already serve unauthenticated — so there is nothing here to protect.
const WORD_RE = /^[a-z]+$/;

router.get('/audio/:word', async (req, res) => {
  const word = String(req.params.word || '').replace(/\.mp3$/i, '').toLowerCase();
  if (!WORD_RE.test(word) || word.length > 24) {
    return res.status(400).json({ error: 'Invalid word' });
  }
  const row = await getAudio(word);
  // 404 is a normal outcome, not an error: the game's speakWord() treats a
  // missing file as "use the browser voice instead".
  if (!row) return res.status(404).json({ error: 'No audio for that word' });

  res.set('Content-Type', 'audio/mpeg');
  res.set('Content-Length', String(row.byteLength));
  // A week, not a year: the voice is an env setting, so a voice change should
  // reach players in days rather than being pinned in their cache forever.
  res.set('Cache-Control', 'public, max-age=604800');
  res.send(row.mp3);
});

// Everything below needs a session.
router.use(requireAuth);

// ---------------------------------------------------------------- access

// Which child's lists is this request allowed to touch?
//   child  → only their own (any child_id they pass is ignored)
//   adult  → only a child they're linked to via parent_child_links
// Returns the child id, or null if not permitted.
async function resolveChildAccess(user, requestedChildId) {
  if (user.account_type === 'child') {
    return requestedChildId && requestedChildId !== user.id ? null : user.id;
  }
  if (!Number.isInteger(requestedChildId) || requestedChildId <= 0) return null;
  const [link] = await db
    .select({ parentId: schema.parentChildLinks.parentId })
    .from(schema.parentChildLinks)
    .where(and(
      eq(schema.parentChildLinks.parentId, user.id),
      eq(schema.parentChildLinks.childId, requestedChildId),
    ))
    .limit(1);
  return link ? requestedChildId : null;
}

// Load a list and check the caller may touch it. Returns the row or null.
async function loadOwnedList(user, listId) {
  const [list] = await db
    .select({
      id: schema.spellingLists.id,
      childId: schema.spellingLists.childId,
      createdById: schema.spellingLists.createdById,
      name: schema.spellingLists.name,
    })
    .from(schema.spellingLists)
    .where(eq(schema.spellingLists.id, listId))
    .limit(1);
  if (!list) return null;
  const childId = await resolveChildAccess(user, list.childId);
  return childId === list.childId ? list : null;
}

function parseIntParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Caps how much list-writing one ACCOUNT can do per hour, shared by create and
// edit. Keyed per user rather than per IP because the cost being limited is
// ElevenLabs generation, not request volume — and a household behind one IP
// should not eat a sibling's budget. One middleware, so create and edit draw on
// a single allowance (and so there is one rateLimit call site to account for —
// see server/lib/rateLimit.test.js).
async function limitListWrites(req, res, next) {
  const limit = await rateLimit({ key: `spelling-list:${req.user.id}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many list changes. Try again later.' });
  }
  next();
}

// ---------------------------------------------------------------- read

// Shape the lists (plus their words, plus which words still lack audio) for one
// child. `audio_missing` only drives the editor's "browser voice" note — the
// game doesn't need it, because speakWord() already falls back on a 404.
async function listsForChild(childId, viewerId) {
  const lists = await db
    .select({
      id: schema.spellingLists.id,
      name: schema.spellingLists.name,
      child_id: schema.spellingLists.childId,
      created_by_id: schema.spellingLists.createdById,
      created_at: schema.spellingLists.createdAt,
      updated_at: schema.spellingLists.updatedAt,
    })
    .from(schema.spellingLists)
    .where(eq(schema.spellingLists.childId, childId))
    .orderBy(asc(schema.spellingLists.createdAt), asc(schema.spellingLists.id));

  if (lists.length === 0) return [];

  const wordRows = await db
    .select({
      listId: schema.spellingListWords.listId,
      word: schema.spellingListWords.word,
    })
    .from(schema.spellingListWords)
    .where(inArray(schema.spellingListWords.listId, lists.map((l) => l.id)))
    .orderBy(asc(schema.spellingListWords.listId), asc(schema.spellingListWords.position));

  const byList = new Map(lists.map((l) => [l.id, []]));
  for (const row of wordRows) byList.get(row.listId)?.push(row.word);

  const allWords = [...new Set(wordRows.map((r) => r.word))];
  const haveAudio = await cachedWords(allWords);

  return lists.map((l) => {
    const words = byList.get(l.id) || [];
    return {
      id: l.id,
      name: l.name,
      child_id: l.child_id,
      created_at: l.created_at,
      updated_at: l.updated_at,
      // Lets the UI say "added by a grown-up" without leaking who.
      created_by_self: l.created_by_id === viewerId,
      words,
      audio_missing: words.filter((w) => !haveAudio.has(w)),
    };
  });
}

// GET /api/spelling/lists[?child_id=N]
// A child gets their own lists; an adult must name a linked child.
router.get('/lists', async (req, res) => {
  const requested = req.query.child_id ? parseIntParam(req.query.child_id) : null;
  const childId = await resolveChildAccess(req.user, requested);
  if (!childId) return res.status(403).json({ error: 'Not your child' });
  res.json({ lists: await listsForChild(childId, req.user.id) });
});

// ---------------------------------------------------------------- write

// Replace a list's words wholesale, in one transaction. Editing 15 words is a
// rewrite, not a diff — there is no partial-update path to get wrong.
async function writeWords(tx, listId, words) {
  await tx.delete(schema.spellingListWords).where(eq(schema.spellingListWords.listId, listId));
  await tx.insert(schema.spellingListWords).values(
    words.map((word, position) => ({ listId, word, position })),
  );
}

// Screen words a CHILD typed for themselves. Grown-ups aren't screened — see
// checkSpellingWords. Returns an error string, or null to proceed.
async function moderateIfChild(user, words) {
  if (user.account_type !== 'child') return null;
  const verdict = await checkSpellingWords(words);
  if (verdict.allowed) return null;
  console.warn(`[spelling] blocked word list from child ${user.id}: ${verdict.reason}`);
  return "Some of those words aren't allowed here. Try your spelling words from school!";
}

// POST /api/spelling/lists — { child_id?, name, words }
// Blocks while any brand-new word is generated, then reports what got audio.
router.post('/lists', limitListWrites, async (req, res) => {
  const body = req.body || {};
  const requested = body.child_id != null ? parseIntParam(body.child_id) : null;
  const childId = await resolveChildAccess(req.user, requested);
  if (!childId) return res.status(403).json({ error: 'Not your child' });

  const name = validateName(body.name);
  if (!name.ok) return res.status(400).json({ error: name.error });
  const words = validateWords(body.words);
  if (!words.ok) return res.status(400).json({ error: words.error });

  const [{ count }] = await db
    .select({ count: sql`COUNT(*)::int`.as('count') })
    .from(schema.spellingLists)
    .where(eq(schema.spellingLists.childId, childId));
  if (count >= MAX_LISTS_PER_CHILD) {
    return res.status(400).json({
      error: `That's ${MAX_LISTS_PER_CHILD} lists already — delete an old one to add another.`,
    });
  }

  const blocked = await moderateIfChild(req.user, words.words);
  if (blocked) return res.status(400).json({ error: blocked });

  const list = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.spellingLists)
      .values({ childId, createdById: req.user.id, name: name.name })
      .returning({ id: schema.spellingLists.id });
    await writeWords(tx, inserted.id, words.words);
    return inserted;
  });

  // The list is already durable at this point — audio is a best-effort upgrade
  // on top of it, so a text-to-speech failure can't lose the parent's typing.
  const audio = await ensureAudio(words.words);

  res.status(201).json({
    list: {
      id: list.id,
      name: name.name,
      child_id: childId,
      words: words.words,
      created_by_self: true,
      audio_missing: audio.failed.map((f) => f.word),
    },
    rejected: words.rejected,
    audio: { generated: audio.generated, reused: audio.reused, failed: audio.failed.length },
  });
});

// PATCH /api/spelling/lists/:listId — { name?, words? }
router.patch('/lists/:listId', limitListWrites, async (req, res) => {
  const listId = parseIntParam(req.params.listId);
  if (!listId) return res.status(400).json({ error: 'Invalid list id' });
  const list = await loadOwnedList(req.user, listId);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const body = req.body || {};
  const hasName = 'name' in body;
  const hasWords = 'words' in body;
  if (!hasName && !hasWords) return res.status(400).json({ error: 'Nothing to update' });

  let name = null;
  if (hasName) {
    const checked = validateName(body.name);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    name = checked.name;
  }

  let words = null;
  if (hasWords) {
    const checked = validateWords(body.words);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const blocked = await moderateIfChild(req.user, checked.words);
    if (blocked) return res.status(400).json({ error: blocked });
    words = checked;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.spellingLists)
      .set({ ...(name ? { name } : {}), updatedAt: new Date() })
      .where(eq(schema.spellingLists.id, listId));
    if (words) await writeWords(tx, listId, words.words);
  });

  const audio = words
    ? await ensureAudio(words.words)
    : { generated: 0, reused: 0, failed: [] };

  res.json({
    list: {
      id: listId,
      name: name ?? list.name,
      child_id: list.childId,
      ...(words ? { words: words.words, audio_missing: audio.failed.map((f) => f.word) } : {}),
    },
    rejected: words ? words.rejected : [],
    audio: { generated: audio.generated, reused: audio.reused, failed: audio.failed.length },
  });
});

// DELETE /api/spelling/lists/:listId
// Only the list goes; the words' audio stays in the shared cache for everyone
// else who has (or will have) the same word.
router.delete('/lists/:listId', async (req, res) => {
  const listId = parseIntParam(req.params.listId);
  if (!listId) return res.status(400).json({ error: 'Invalid list id' });
  const list = await loadOwnedList(req.user, listId);
  if (!list) return res.status(404).json({ error: 'List not found' });

  await db.delete(schema.spellingLists).where(eq(schema.spellingLists.id, listId));
  res.json({ ok: true });
});

module.exports = router;
