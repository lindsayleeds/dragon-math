// Word catalogs for Dragon Phonics ("Missing Sound") — hear a word, then pick
// the missing sound (grapheme) that belongs in the blank.
//
// Unlike Dragon Spelling (which memorizes whole-word spellings across grades),
// phonics is skill-laddered: each LEVEL targets one decoding skill and gets
// harder, so there's no per-grade split here. The three levels are:
//   1. Vowel Sounds     — CVC words, the middle vowel is blanked.
//   2. First & Last      — a beginning or ending consonant is blanked.
//   3. Blends & Digraphs — a two-letter blend/digraph (sh, ch, fr, st…) blanked.
//
// Curation rules (keep these invariants when editing the lists):
//   • Every word is a real, wholesome, nature-forward word (project theme):
//     animals, plants, food, weather, cozy objects — no dark/scary content.
//   • Each entry lists its GRAPHEMES in order (`g`) and which one is hidden
//     (`b`, a 0-based index). For levels 1–2 each grapheme is a single letter;
//     for level 3 a grapheme may be a two-letter blend/digraph.
//   • The blanked grapheme's audio comes from speaking the whole word — the
//     child hears the word and reasons out the missing sound. Audio reuses the
//     spelling TTS fallback (utils/speakWord.js), so no new audio files needed.

// --- Option pools -----------------------------------------------------------
// When a grapheme is blanked, the wrong choices ("distractors") are drawn from
// the SAME category so the child discriminates by sound, not by shape.
export const VOWELS = ['a', 'e', 'i', 'o', 'u'];

export const CONSONANTS = [
  'b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm',
  'n', 'p', 'r', 's', 't', 'v', 'w', 'y', 'z',
];

export const BLENDS = [
  'sh', 'ch', 'th', 'wh', 'ck', 'ng',
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr',
  'pl', 'pr', 'sl', 'sn', 'sp', 'st', 'sw', 'tr',
];

// Which pool a blanked grapheme's distractors come from.
export function poolFor(grapheme) {
  if (grapheme.length > 1) return BLENDS;
  if (VOWELS.includes(grapheme)) return VOWELS;
  return CONSONANTS;
}

// --- Entry helpers ----------------------------------------------------------
// letters('cat', 1) → { g: ['c','a','t'], b: 1 }  (single-letter graphemes)
const letters = (word, b) => ({ g: word.split(''), b });
// seg(['sh','i','p'], 0) → { g: ['sh','i','p'], b: 0 }  (custom segmentation)
const seg = (g, b) => ({ g, b });

// The word an entry spells (used for audio + the answer key).
export const wordOf = (entry) => entry.g.join('');
// The correct grapheme for the blank.
export const answerOf = (entry) => entry.g[entry.b];

// --- Level 1: Vowel Sounds — CVC words, middle vowel blanked ---------------
const LEVEL_1 = [
  'cat', 'dog', 'pig', 'sun', 'bed', 'cup', 'hat', 'bug', 'fan', 'jam',
  'log', 'mud', 'net', 'pot', 'rug', 'van', 'web', 'wig', 'zip', 'bat',
  'dad', 'fig', 'gum', 'ham', 'hen', 'jet', 'kid', 'lip', 'mop', 'nut',
  'pan', 'rat', 'tan', 'bus', 'cut', 'dig', 'fox', 'hop', 'jog', 'kit',
  'lap', 'mat', 'nap', 'pet', 'tap', 'fit', 'hug', 'top', 'big', 'red',
  'ten', 'six', 'bee', 'owl', 'sap',
].map((w) => letters(w, 1));

// --- Level 2: First & Last Sounds — an outer consonant blanked -------------
// Mix of first (b:0) and last (b:2) blanks so both are practiced.
const LEVEL_2 = [
  letters('cat', 0), letters('dog', 2), letters('sun', 0), letters('bed', 2),
  letters('map', 0), letters('leg', 2), letters('cup', 0), letters('fan', 2),
  letters('bug', 0), letters('web', 2), letters('hen', 0), letters('lip', 2),
  letters('nut', 0), letters('pot', 2), letters('rug', 0), letters('van', 2),
  letters('jam', 0), letters('bat', 2), letters('fox', 0), letters('jet', 2),
  letters('kid', 0), letters('mop', 2), letters('pig', 0), letters('rat', 2),
  letters('ten', 0), letters('gum', 2), letters('wig', 0), letters('bus', 2),
  letters('log', 0), letters('hat', 2), letters('pen', 0), letters('bell', 3),
  letters('duck', 0), letters('fish', 3), letters('sock', 0), letters('nest', 3),
  letters('lamp', 0), letters('hand', 3), letters('milk', 0), letters('gift', 3),
];

// --- Level 3: Blends & Digraphs — the blend/digraph blanked ----------------
const LEVEL_3 = [
  seg(['sh', 'i', 'p'], 0), seg(['ch', 'i', 'n'], 0), seg(['th', 'i', 'n'], 0),
  seg(['wh', 'i', 'p'], 0), seg(['sh', 'e', 'll'], 0), seg(['ch', 'e', 's', 't'], 0),
  seg(['fr', 'o', 'g'], 0), seg(['st', 'e', 'm'], 0), seg(['bl', 'o', 'ck'], 0),
  seg(['cr', 'a', 'b'], 0), seg(['dr', 'u', 'm'], 0), seg(['fl', 'a', 'g'], 0),
  seg(['gr', 'a', 's', 's'], 0), seg(['pl', 'a', 'n', 't'], 0), seg(['sl', 'e', 'd'], 0),
  seg(['sn', 'a', 'il'], 0), seg(['sp', 'i', 'n'], 0), seg(['sw', 'i', 'm'], 0),
  seg(['tr', 'e', 'e'], 0), seg(['br', 'i', 'ck'], 0), seg(['cl', 'a', 'p'], 0),
  seg(['gl', 'a', 'd'], 0), seg(['pr', 'i', 'z', 'e'], 0),
  // Final digraphs/blends.
  seg(['d', 'u', 'ck'], 2), seg(['s', 'o', 'ck'], 2), seg(['r', 'o', 'ck'], 2),
  seg(['fi', 'sh'], 1), seg(['di', 'sh'], 1), seg(['ba', 'th'], 1),
  seg(['ri', 'ng'], 1), seg(['ki', 'ng'], 1), seg(['so', 'ng'], 1),
  seg(['b', 'e', 'll'], 2), seg(['ne', 'st'], 1), seg(['ne', 'ck'], 1),
];

export const PHONICS_LEVELS = [
  {
    key: 'vowels',
    label: 'Vowel Sounds',
    emoji: '🌱',
    blurb: 'The middle vowel is missing — which one do you hear?',
    options: 3,
    words: LEVEL_1,
  },
  {
    key: 'edges',
    label: 'First & Last',
    emoji: '🌟',
    blurb: 'A beginning or ending sound is missing — tap the one you hear.',
    options: 4,
    words: LEVEL_2,
  },
  {
    key: 'blends',
    label: 'Blends & Digraphs',
    emoji: '🔥',
    blurb: 'Two letters make one sound (sh, ch, fr…) — find the missing pair.',
    options: 4,
    words: LEVEL_3,
  },
];

export const PHONICS_LEVEL_BY_KEY = Object.fromEntries(
  PHONICS_LEVELS.map((l) => [l.key, l]),
);

// How many words make up one phonics round.
export const WORDS_PER_ROUND = 10;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Pick `count` distinct random words from a level for one round.
export function pickPhonicsWords(levelKey, count = WORDS_PER_ROUND) {
  const level = PHONICS_LEVEL_BY_KEY[levelKey] || PHONICS_LEVELS[0];
  return shuffle(level.words).slice(0, Math.min(count, level.words.length));
}

// Build the choice tiles for an entry: the correct grapheme plus (n-1)
// same-category distractors, shuffled. Always includes the answer.
export function buildOptions(entry, count) {
  const answer = answerOf(entry);
  const pool = poolFor(answer).filter((g) => g !== answer);
  const distractors = shuffle(pool).slice(0, Math.max(0, count - 1));
  return shuffle([answer, ...distractors]);
}
