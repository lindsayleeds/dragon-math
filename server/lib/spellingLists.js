// Parsing and validation for custom spelling lists. Deliberately pure (no db,
// no network) so it can be unit-tested directly — see spellingLists.test.js and
// the testing note in AGENTS.md.
//
// A grown-up pastes the week's words straight out of a school email, so the
// parser is forgiving about separators (newlines, commas, spaces, numbering)
// but strict about what counts as a word. The rules mirror the curation
// invariants documented in src/data/spellingWords.js: a single lowercase token
// of letters only. That keeps the typed answer unambiguous (no apostrophe or
// hyphen to guess at) and gives the audio cache a clean key.

const MAX_WORDS_PER_LIST = 60;
const MAX_LISTS_PER_CHILD = 40;
const MAX_WORD_LEN = 24;
const MAX_NAME_LEN = 40;

// Letters only. Anything a child would have to guess the punctuation of is out.
const WORD_RE = /^[a-z]+$/;

// Strip list numbering ("1.", "3)", "-", "•") that survives a copy-paste, plus
// any surrounding punctuation. Curly and straight quotes both appear in emails.
function stripDecoration(token) {
  return token
    .replace(/^[\s\d]*[.)\]:-]+\s*/, '') // leading "1." / "3)" / "-"
    .replace(/^[“”"'‘’([{]+/, '')
    .replace(/[“”"'‘’)\]}.,;:!?]+$/, '')
    .trim();
}

/**
 * Turn free-form typed/pasted text into a clean word list.
 *
 * @param {string} raw
 * @returns {{ words: string[], rejected: string[] }}
 *   `words` is lowercased, de-duplicated, in the order first seen.
 *   `rejected` is every token that survived splitting but isn't a usable word,
 *   so the editor can show the grown-up exactly what it dropped instead of
 *   silently eating "can't" or "ice cream".
 */
function parseWords(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const words = [];
  const rejected = [];
  const seen = new Set();

  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const cleaned = stripDecoration(token).toLowerCase();
    if (!cleaned) continue;
    if (!WORD_RE.test(cleaned) || cleaned.length > MAX_WORD_LEN) {
      // Show the grown-up what they typed, not our mangled version of it.
      rejected.push(token);
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    words.push(cleaned);
  }

  return { words, rejected };
}

/**
 * Validate a list name.
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
function validateName(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, error: 'Give the list a name, like "Week 1".' };
  if (name.length > MAX_NAME_LEN) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LEN} characters.` };
  }
  return { ok: true, name };
}

/**
 * Validate the word payload of a create/edit request. Accepts either an array
 * of words or one blob of pasted text (the editor sends the array; the API
 * tolerates both so a hand-rolled call doesn't have to pre-split).
 *
 * @returns {{ ok: true, words: string[], rejected: string[] } | { ok: false, error: string }}
 */
function validateWords(input) {
  const raw = Array.isArray(input) ? input.join('\n') : input;
  if (typeof raw !== 'string' && !Array.isArray(input)) {
    return { ok: false, error: 'words must be an array or a string.' };
  }
  const { words, rejected } = parseWords(raw);
  if (words.length === 0) {
    return { ok: false, error: 'Add at least one word (letters only — no spaces or apostrophes).' };
  }
  if (words.length > MAX_WORDS_PER_LIST) {
    return { ok: false, error: `A list can hold at most ${MAX_WORDS_PER_LIST} words.` };
  }
  return { ok: true, words, rejected };
}

module.exports = {
  MAX_WORDS_PER_LIST,
  MAX_LISTS_PER_CHILD,
  MAX_WORD_LEN,
  MAX_NAME_LEN,
  parseWords,
  validateName,
  validateWords,
};
