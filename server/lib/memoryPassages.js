const MAX_PASSAGES_PER_CHILD = 40;
const MAX_TITLE_LENGTH = 100;
const MAX_WORDS = 250;
const CATEGORIES = new Set(['verse', 'poem', 'quote', 'speech', 'definition', 'other']);

function passageWords(text) {
  return String(text || '').match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu) || [];
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
  return { ok: true, passage: { title, body, category, wordCount } };
}

module.exports = {
  CATEGORIES,
  MAX_PASSAGES_PER_CHILD,
  MAX_TITLE_LENGTH,
  MAX_WORDS,
  passageWords,
  validatePassage,
};
