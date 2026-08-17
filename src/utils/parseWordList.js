// Client-side preview of what the server will accept for a custom spelling list.
//
// Mirrors parseWords() in server/lib/spellingLists.js — keep the two in sync.
// The server is authoritative (its response carries the real `rejected` list);
// this exists so the editor can show a grown-up, as they paste, which tokens
// are going to be dropped instead of surprising them after they hit Save.

const MAX_WORD_LEN = 24;
const WORD_RE = /^[a-z]+$/;

function stripDecoration(token) {
  return token
    .replace(/^[\s\d]*[.)\]:-]+\s*/, '') // leading "1." / "3)" / "-"
    .replace(/^[“”"'‘’([{]+/, '')
    .replace(/[“”"'‘’)\]}.,;:!?]+$/, '')
    .trim();
}

export function parseWordList(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const words = [];
  const rejected = [];
  const seen = new Set();

  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const cleaned = stripDecoration(token).toLowerCase();
    if (!cleaned) continue;
    if (!WORD_RE.test(cleaned) || cleaned.length > MAX_WORD_LEN) {
      rejected.push(token);
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    words.push(cleaned);
  }

  return { words, rejected };
}
