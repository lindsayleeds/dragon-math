// The Dragon Phonics scope-and-sequence: every sound-spelling ("element") the
// program teaches, in the order a K-2 reader meets them.
//
// This file is the source of truth for three things at once, which is why it is
// data rather than three parallel lists:
//   1. what the games ASK        (an element is one question's answer)
//   2. what progress MEASURES    (mastery is stored per `key` — see
//                                 server/lib/phonicsMastery.js)
//   3. what audio EXISTS         (`key` is the filename of the isolated-sound
//                                 clip: public/audio/phonics/<key>.mp3, made by
//                                 scripts/generate-phonics-audio.cjs)
// So `key` is a permanent identifier. Renaming one orphans a child's stored
// mastery AND its audio file; add a new element instead.
//
// PHONICS IS SOUND-FIRST, AND THAT SHAPES THE SCHEMA. A child who hears /ā/
// genuinely cannot know whether it is spelled `ai` or `ay` — that is spelling
// knowledge, which Dragon Spelling covers. So an element is ONE SOUND, and
// `accepts` lists every spelling that sound may legitimately be typed as. The
// type-it game marks any of them right; the multiple-choice game shows `g` as
// the answer tile and keeps the other accepted spellings OUT of the distractor
// pool, because an item with two right answers is an unfair item.
//
// Curation rules (keep these invariants when editing):
//   • Exemplar words are real, wholesome, nature-forward words (project theme):
//     animals, plants, food, weather, cozy things. No dark/scary content.
//   • Every word in `words` must actually CONTAIN the element's grapheme, and
//     for a positional element (initial blend, final blend, ending) it must
//     appear in that position. The data test in phonicsCurriculum.test.jsx
//     enforces this, so a typo fails a test rather than shipping a broken item.
//   • `near` lists the elements this one is genuinely confused with. Distractors
//     are drawn from `near` first, so a wrong answer is diagnostic rather than
//     random — that is what makes the confusion report in the parent dashboard
//     mean something.
//   • `arpabet` is the CMU-arpabet the audio generator speaks to produce the
//     ISOLATED sound. Stops and most blends carry a trailing unstressed schwa
//     (AH0) because a plosive with no vowel after it is close to silent — this
//     matches how phonics is taught aloud ("/b/ as in buh-ball"). Continuants
//     (f, l, m, n, s, sh, th, ng…) can be held on their own and get no schwa.

// --- Element types ----------------------------------------------------------
// The type decides which pool a random distractor falls back to when `near`
// runs out, so an item never offers a vowel as the answer to a blend.
export const ELEMENT_TYPES = {
  consonant: { label: 'Consonant', color: '#a07859' },
  'short-vowel': { label: 'Short vowel', color: '#7d9d6c' },
  digraph: { label: 'Digraph', color: '#c79bb8' },
  'blend-initial': { label: 'Beginning blend', color: '#6f96b8' },
  'blend-final': { label: 'Ending blend', color: '#5d8a8a' },
  'long-vowel': { label: 'Long vowel', color: '#d1a054' },
  'vowel-team': { label: 'Vowel team', color: '#b58a4e' },
  'r-controlled': { label: 'Bossy R', color: '#b5705c' },
  special: { label: 'Special sound', color: '#8d7bb0' },
  ending: { label: 'Word ending', color: '#7f9a56' },
};

// `e` builds one element. Defaults keep the table below readable: most elements
// accept only their own spelling and have no listed confusions.
const e = (key, { g = key, sound, type, stage, arpabet, words, near = [], accepts = null, note = '' }) => ({
  key,
  g,
  sound,
  type,
  stage,
  arpabet,
  words,
  near,
  // Every spelling that counts as typing this sound. Always includes `g`.
  accepts: accepts ? [...new Set([g, ...accepts])] : [g],
  note,
});

// ===========================================================================
// Stage 1 — Single Consonants
// ===========================================================================
const STAGE_1 = [
  e('b', { sound: '/b/', type: 'consonant', stage: 1, arpabet: 'B AH0', words: ['bat', 'bee', 'bud'], near: ['d', 'p'] }),
  e('c', { sound: '/k/', type: 'consonant', stage: 1, arpabet: 'K AH0', words: ['cat', 'cub', 'cap'], near: ['k', 'g'], accepts: ['k'] }),
  e('d', { sound: '/d/', type: 'consonant', stage: 1, arpabet: 'D AH0', words: ['dog', 'den', 'dig'], near: ['b', 't'] }),
  e('f', { sound: '/f/', type: 'consonant', stage: 1, arpabet: 'F', words: ['fox', 'fig', 'fan'], near: ['v', 'ph'] }),
  e('g', { sound: '/g/', type: 'consonant', stage: 1, arpabet: 'G AH0', words: ['goat', 'gum', 'gap'], near: ['c', 'k'] }),
  e('h', { sound: '/h/', type: 'consonant', stage: 1, arpabet: 'HH AH0', words: ['hen', 'hop', 'hug'], near: ['f'] }),
  e('j', { sound: '/j/', type: 'consonant', stage: 1, arpabet: 'JH AH0', words: ['jam', 'jet', 'jug'], near: ['g', 'ch'] }),
  e('k', { sound: '/k/', type: 'consonant', stage: 1, arpabet: 'K AH0', words: ['kid', 'kit', 'kelp'], near: ['c', 'g'], accepts: ['c'] }),
  e('l', { sound: '/l/', type: 'consonant', stage: 1, arpabet: 'L', words: ['leaf', 'log', 'lip'], near: ['r', 'w'] }),
  e('m', { sound: '/m/', type: 'consonant', stage: 1, arpabet: 'M', words: ['moss', 'mud', 'map'], near: ['n'] }),
  e('n', { sound: '/n/', type: 'consonant', stage: 1, arpabet: 'N', words: ['nest', 'nut', 'nap'], near: ['m', 'ng'] }),
  e('p', { sound: '/p/', type: 'consonant', stage: 1, arpabet: 'P AH0', words: ['pig', 'pot', 'pup'], near: ['b', 't'] }),
  e('r', { sound: '/r/', type: 'consonant', stage: 1, arpabet: 'R', words: ['rug', 'rain', 'rock'], near: ['l', 'w'] }),
  e('s', { sound: '/s/', type: 'consonant', stage: 1, arpabet: 'S', words: ['sun', 'sap', 'seed'], near: ['z', 'c'] }),
  e('t', { sound: '/t/', type: 'consonant', stage: 1, arpabet: 'T AH0', words: ['top', 'ten', 'tub'], near: ['d', 'p'] }),
  e('v', { sound: '/v/', type: 'consonant', stage: 1, arpabet: 'V', words: ['vine', 'van', 'vet'], near: ['f'] }),
  e('w', { sound: '/w/', type: 'consonant', stage: 1, arpabet: 'W AH0', words: ['web', 'wind', 'wag'], near: ['r', 'l'] }),
  e('y', { sound: '/y/', type: 'consonant', stage: 1, arpabet: 'Y AH0', words: ['yak', 'yarn', 'yes'], near: ['j', 'w'] }),
  e('z', { sound: '/z/', type: 'consonant', stage: 1, arpabet: 'Z', words: ['zip', 'zebra', 'zoo'], near: ['s'] }),
  e('qu', { sound: '/kw/', type: 'consonant', stage: 1, arpabet: 'K W AH0', words: ['quilt', 'queen', 'quick'], near: ['c', 'k'] }),
  e('x', { sound: '/ks/', type: 'consonant', stage: 1, arpabet: 'K S', words: ['fox', 'box', 'six'], near: ['s', 'k'], note: 'x sits at the END of these words' }),
];

// ===========================================================================
// Stage 2 — Short Vowels
// ===========================================================================
const STAGE_2 = [
  e('short-a', { g: 'a', sound: '/ă/', type: 'short-vowel', stage: 2, arpabet: 'AE1', words: ['cat', 'map', 'ham'], near: ['short-e', 'short-u'] }),
  e('short-e', { g: 'e', sound: '/ĕ/', type: 'short-vowel', stage: 2, arpabet: 'EH1', words: ['hen', 'bed', 'nest'], near: ['short-a', 'short-i'] }),
  e('short-i', { g: 'i', sound: '/ĭ/', type: 'short-vowel', stage: 2, arpabet: 'IH1', words: ['pig', 'fig', 'wind'], near: ['short-e', 'short-u'] }),
  e('short-o', { g: 'o', sound: '/ŏ/', type: 'short-vowel', stage: 2, arpabet: 'AA1', words: ['dog', 'pot', 'frog'], near: ['short-u', 'short-a'] }),
  e('short-u', { g: 'u', sound: '/ŭ/', type: 'short-vowel', stage: 2, arpabet: 'AH1', words: ['sun', 'cub', 'mud'], near: ['short-o', 'short-a'] }),
];

// ===========================================================================
// Stage 3 — Consonant Digraphs (two letters, one sound)
// ===========================================================================
const STAGE_3 = [
  e('sh', { sound: '/sh/', type: 'digraph', stage: 3, arpabet: 'SH', words: ['ship', 'shell', 'fish'], near: ['ch', 'th'] }),
  e('ch', { sound: '/ch/', type: 'digraph', stage: 3, arpabet: 'CH AH0', words: ['chin', 'chick', 'beach'], near: ['sh', 'th'] }),
  e('th', { sound: '/th/', type: 'digraph', stage: 3, arpabet: 'TH', words: ['thin', 'bath', 'moth'], near: ['sh', 'ch'] }),
  e('wh', { sound: '/wh/', type: 'digraph', stage: 3, arpabet: 'W AH0', words: ['whale', 'wheat', 'whisk'], near: ['w', 'sh'] }),
  e('ck', { sound: '/k/', type: 'digraph', stage: 3, arpabet: 'K AH0', words: ['duck', 'rock', 'sock'], near: ['k', 'c'], note: 'ck only comes at the END of a word' }),
  e('ng', { sound: '/ng/', type: 'digraph', stage: 3, arpabet: 'NG', words: ['ring', 'song', 'wing'], near: ['n', 'end-nk'] }),
  e('ph', { sound: '/f/', type: 'digraph', stage: 3, arpabet: 'F', words: ['phone', 'graph', 'dolphin'], near: ['f', 'th'] }),
];

// ===========================================================================
// Stage 4 — Beginning Blends (two sounds you can still hear separately)
// ===========================================================================
const blendNear = {
  bl: ['br', 'pl'], br: ['bl', 'pr'], cl: ['cr', 'gl'], cr: ['cl', 'gr'],
  dr: ['tr', 'gr'], fl: ['fr', 'bl'], fr: ['fl', 'thr'], gl: ['gr', 'cl'],
  gr: ['gl', 'cr'], pl: ['pr', 'bl'], pr: ['pl', 'br'], sl: ['sn', 'sw'],
  sc: ['sk', 'st'], sk: ['sc', 'sp'], sm: ['sn', 'sl'], sn: ['sm', 'sl'],
  sp: ['st', 'sk'], st: ['sp', 'sc'], sw: ['sl', 'sn'], tr: ['dr', 'tw'],
  tw: ['tr', 'sw'], scr: ['str', 'spr'], spl: ['spr', 'scr'], spr: ['scr', 'str'],
  str: ['scr', 'spr'], thr: ['fr', 'shr'], shr: ['thr', 'str'],
};
const STAGE_4 = [
  ['bl', 'B L AH0', ['block', 'blue', 'blossom']],
  ['br', 'B R AH0', ['brick', 'bread', 'branch']],
  ['cl', 'K L AH0', ['clap', 'cloud', 'clover']],
  ['cr', 'K R AH0', ['crab', 'crown', 'cricket']],
  ['dr', 'D R AH0', ['drum', 'dress', 'dragon']],
  ['fl', 'F L AH0', ['flag', 'flower', 'float']],
  ['fr', 'F R AH0', ['frog', 'fruit', 'fresh']],
  ['gl', 'G L AH0', ['glad', 'glow', 'glass']],
  ['gr', 'G R AH0', ['grass', 'green', 'grape']],
  ['pl', 'P L AH0', ['plant', 'plum', 'play']],
  ['pr', 'P R AH0', ['prize', 'pretty', 'present']],
  ['sl', 'S L AH0', ['sled', 'sleep', 'slow']],
  ['sc', 'S K AH0', ['scarf', 'scoop', 'scale']],
  ['sk', 'S K AH0', ['skip', 'sky', 'skate']],
  ['sm', 'S M AH0', ['smile', 'small', 'smell']],
  ['sn', 'S N AH0', ['snail', 'snow', 'snack']],
  ['sp', 'S P AH0', ['spin', 'spoon', 'spring']],
  ['st', 'S T AH0', ['stem', 'star', 'stone']],
  ['sw', 'S W AH0', ['swim', 'sweet', 'swan']],
  ['tr', 'T R AH0', ['tree', 'train', 'trail']],
  ['tw', 'T W AH0', ['twig', 'twin', 'twelve']],
  ['scr', 'S K R AH0', ['scrub', 'scrap', 'scramble']],
  ['spl', 'S P L AH0', ['splash', 'split', 'splendid']],
  ['spr', 'S P R AH0', ['spring', 'sprout', 'spray']],
  ['str', 'S T R AH0', ['string', 'straw', 'stream']],
  ['thr', 'TH R AH0', ['three', 'throw', 'thread']],
  ['shr', 'SH R AH0', ['shrub', 'shrimp', 'shred']],
].map(([key, arpabet, words]) => e(key, {
  sound: `/${key}/`, type: 'blend-initial', stage: 4, arpabet, words, near: blendNear[key] || [],
}));

// ===========================================================================
// Stage 5 — Ending Blends
// ===========================================================================
const STAGE_5 = [
  ['nd', 'N D', ['hand', 'pond', 'wind'], ['end-nt', 'end-nk']],
  ['nt', 'N T', ['plant', 'tent', 'ant'], ['end-nd', 'end-nk']],
  ['nk', 'NG K', ['pink', 'trunk', 'bank'], ['ng', 'end-nd']],
  ['mp', 'M P', ['lamp', 'jump', 'stump'], ['mb', 'end-nt']],
  ['st', 'S T', ['nest', 'mist', 'toast'], ['end-sk', 'end-sp']],
  ['sk', 'S K', ['desk', 'mask', 'tusk'], ['end-st', 'end-sp']],
  ['sp', 'S P', ['wasp', 'crisp', 'grasp'], ['end-st', 'end-sk']],
  ['lt', 'L T', ['melt', 'salt', 'quilt'], ['end-lk', 'end-lf']],
  ['lk', 'L K', ['milk', 'elk', 'silk'], ['end-lt', 'end-lf']],
  ['lf', 'L F', ['elf', 'shelf', 'wolf'], ['end-lt', 'end-lk']],
  ['ft', 'F T', ['gift', 'soft', 'raft'], ['end-lt', 'end-st']],
  ['pt', 'P T', ['kept', 'slept', 'crept'], ['end-ft', 'end-ct']],
  ['ct', 'K T', ['fact', 'insect', 'protect'], ['end-pt', 'end-ft']],
  ['nch', 'N CH', ['bench', 'branch', 'lunch'], ['end-nt', 'end-tch']],
  ['tch', 'CH', ['patch', 'hutch', 'stitch'], ['ch', 'end-nch']],
// An ending blend keys as `end-<letters>` because three of them (st, sk, sp)
// are ALSO beginning blends with their own sound clip and their own mastery —
// hearing /st/ at the start of "star" and at the end of "nest" are different
// skills, so they must not share a key.
].map(([letters, arpabet, words, near]) => e(`end-${letters}`, {
  g: letters, sound: `/${letters}/`, type: 'blend-final', stage: 5, arpabet, words, near,
}));

// ===========================================================================
// Stage 6 — Long Vowels (magic e)
// ===========================================================================
const STAGE_6 = [
  e('long-a', { g: 'a_e', sound: '/ā/', type: 'long-vowel', stage: 6, arpabet: 'EY1', words: ['cake', 'lake', 'grape'], near: ['long-e', 'short-a'], accepts: ['a-e', 'ae'] }),
  e('long-e', { g: 'e_e', sound: '/ē/', type: 'long-vowel', stage: 6, arpabet: 'IY1', words: ['these', 'theme', 'eve'], near: ['long-a', 'long-i'], accepts: ['e-e', 'ee'] }),
  e('long-i', { g: 'i_e', sound: '/ī/', type: 'long-vowel', stage: 6, arpabet: 'AY1', words: ['vine', 'kite', 'smile'], near: ['long-e', 'short-i'], accepts: ['i-e', 'ie'] }),
  e('long-o', { g: 'o_e', sound: '/ō/', type: 'long-vowel', stage: 6, arpabet: 'OW1', words: ['bone', 'stone', 'rose'], near: ['long-u', 'short-o'], accepts: ['o-e', 'oe'] }),
  e('long-u', { g: 'u_e', sound: '/ū/', type: 'long-vowel', stage: 6, arpabet: 'Y UW1', words: ['cube', 'mule', 'cute'], near: ['long-o', 'short-u'], accepts: ['u-e', 'ue'] }),
];

// ===========================================================================
// Stage 7 — Vowel Teams & Diphthongs
// Sound-first: `accepts` carries every spelling of the sound, because a listener
// cannot tell `ai` from `ay` by ear. See the note at the top of this file.
// ===========================================================================
const STAGE_7 = [
  e('team-ai', { g: 'ai', sound: '/ā/', type: 'vowel-team', stage: 7, arpabet: 'EY1', words: ['rain', 'trail', 'hay'], near: ['team-ee', 'team-oa'], accepts: ['ay'] }),
  e('team-ee', { g: 'ee', sound: '/ē/', type: 'vowel-team', stage: 7, arpabet: 'IY1', words: ['tree', 'seed', 'leaf'], near: ['team-ai', 'team-igh'], accepts: ['ea'] }),
  e('team-oa', { g: 'oa', sound: '/ō/', type: 'vowel-team', stage: 7, arpabet: 'OW1', words: ['goat', 'boat', 'snow'], near: ['team-oo-long', 'team-ai'], accepts: ['ow', 'oe'] }),
  e('team-igh', { g: 'igh', sound: '/ī/', type: 'vowel-team', stage: 7, arpabet: 'AY1', words: ['light', 'night', 'pie'], near: ['team-ee', 'team-oi'], accepts: ['ie'] }),
  e('team-oo-long', { g: 'oo', sound: '/o͞o/', type: 'vowel-team', stage: 7, arpabet: 'UW1', words: ['moon', 'spoon', 'bloom'], near: ['team-oo-short', 'team-oa'], accepts: ['ue', 'ew'], note: 'the "moon" sound' }),
  e('team-oo-short', { g: 'oo', sound: '/o͝o/', type: 'vowel-team', stage: 7, arpabet: 'UH1', words: ['book', 'wood', 'hook'], near: ['team-oo-long', 'short-u'], note: 'the "book" sound' }),
  e('team-oi', { g: 'oi', sound: '/oi/', type: 'vowel-team', stage: 7, arpabet: 'OY1', words: ['soil', 'coin', 'toy'], near: ['team-ou', 'team-aw'], accepts: ['oy'] }),
  e('team-ou', { g: 'ou', sound: '/ou/', type: 'vowel-team', stage: 7, arpabet: 'AW1', words: ['cloud', 'round', 'flower'], near: ['team-oi', 'team-aw'], accepts: ['ow'] }),
  e('team-aw', { g: 'aw', sound: '/aw/', type: 'vowel-team', stage: 7, arpabet: 'AO1', words: ['paw', 'straw', 'dawn'], near: ['team-ou', 'short-o'], accepts: ['au'] }),
];

// ===========================================================================
// Stage 8 — Bossy R, Soft Sounds, Silent Letters & Endings
// ===========================================================================
const STAGE_8 = [
  e('ar', { sound: '/ar/', type: 'r-controlled', stage: 8, arpabet: 'AA1 R', words: ['star', 'farm', 'barn'], near: ['or', 'er'] }),
  e('or', { sound: '/or/', type: 'r-controlled', stage: 8, arpabet: 'AO1 R', words: ['corn', 'storm', 'horn'], near: ['ar', 'er'] }),
  e('er', { sound: '/er/', type: 'r-controlled', stage: 8, arpabet: 'ER1', words: ['fern', 'bird', 'turtle'], near: ['ar', 'or'], accepts: ['ir', 'ur'], note: 'er, ir and ur all say /er/' }),
  e('soft-c', { g: 'c', sound: '/s/', type: 'special', stage: 8, arpabet: 'S', words: ['city', 'ice', 'cellar'], near: ['s', 'c'], note: 'c says /s/ before e, i and y' }),
  e('soft-g', { g: 'g', sound: '/j/', type: 'special', stage: 8, arpabet: 'JH AH0', words: ['gem', 'cage', 'giraffe'], near: ['j', 'g'], note: 'g says /j/ before e, i and y' }),
  e('kn', { sound: '/n/', type: 'special', stage: 8, arpabet: 'N', words: ['knee', 'knot', 'knit'], near: ['n', 'gn'], note: 'the k is silent' }),
  e('wr', { sound: '/r/', type: 'special', stage: 8, arpabet: 'R', words: ['wren', 'wrap', 'wrist'], near: ['r', 'kn'], note: 'the w is silent' }),
  e('mb', { sound: '/m/', type: 'special', stage: 8, arpabet: 'M', words: ['lamb', 'comb', 'thumb'], near: ['m', 'end-mp'], note: 'the b is silent' }),
  e('gn', { sound: '/n/', type: 'special', stage: 8, arpabet: 'N', words: ['gnat', 'sign', 'gnaw'], near: ['kn', 'n'], note: 'the g is silent' }),
  e('ing', { sound: '/ing/', type: 'ending', stage: 8, arpabet: 'IH0 NG', words: ['singing', 'growing', 'planting'], near: ['ng', 'ed'] }),
  e('ed', { sound: '/ed/', type: 'ending', stage: 8, arpabet: 'D', words: ['planted', 'hopped', 'wagged'], near: ['ing', 'd'] }),
  e('le', { sound: '/le/', type: 'ending', stage: 8, arpabet: 'AH0 L', words: ['table', 'apple', 'turtle'], near: ['ed', 'ing'] }),
  e('tion', { sound: '/shun/', type: 'ending', stage: 8, arpabet: 'SH AH0 N', words: ['station', 'motion', 'lotion'], near: ['sh', 'le'] }),
];

export const PHONICS_ELEMENTS = [
  ...STAGE_1, ...STAGE_2, ...STAGE_3, ...STAGE_4,
  ...STAGE_5, ...STAGE_6, ...STAGE_7, ...STAGE_8,
];

export const ELEMENT_BY_KEY = Object.fromEntries(PHONICS_ELEMENTS.map((el) => [el.key, el]));

// --- Stages -----------------------------------------------------------------
export const PHONICS_STAGES = [
  { stage: 1, label: 'Letter Sounds', emoji: '🌱', blurb: 'Every letter has a sound of its own.' },
  { stage: 2, label: 'Short Vowels', emoji: '🐣', blurb: 'The five little vowel sounds at the heart of a word.' },
  { stage: 3, label: 'Digraphs', emoji: '🍃', blurb: 'Two letters that team up to make one brand-new sound.' },
  { stage: 4, label: 'Beginning Blends', emoji: '🌤️', blurb: 'Two sounds that slide together at the start.' },
  { stage: 5, label: 'Ending Blends', emoji: '🪺', blurb: 'Two sounds that land together at the end.' },
  { stage: 6, label: 'Magic E', emoji: '✨', blurb: 'A silent e at the end makes the vowel say its name.' },
  { stage: 7, label: 'Vowel Teams', emoji: '🌈', blurb: 'Vowels working in pairs — rain, moon, cloud.' },
  { stage: 8, label: 'Bossy R & More', emoji: '🐉', blurb: 'Bossy r, soft sounds, silent letters and word endings.' },
].map((s) => ({
  ...s,
  key: `stage-${s.stage}`,
  elements: PHONICS_ELEMENTS.filter((el) => el.stage === s.stage).map((el) => el.key),
}));

export const STAGE_BY_NUMBER = Object.fromEntries(PHONICS_STAGES.map((s) => [s.stage, s]));

// Every element in a set of stages. `stages` may be a number, an array, or the
// string 'all' (the mixed review a child unlocks once several stages are solid).
export function elementsForStages(stages) {
  if (stages === 'all' || stages == null) return PHONICS_ELEMENTS;
  const wanted = new Set(Array.isArray(stages) ? stages : [stages]);
  return PHONICS_ELEMENTS.filter((el) => wanted.has(el.stage));
}

// --- Answer checking --------------------------------------------------------
// True when `typed` is a legitimate spelling of this element's sound. Case and
// surrounding space are ignored, and so is the underscore in a magic-e frame,
// so a child typing "ae", "a_e" or "a-e" for /ā/ all count.
export function isAcceptedSpelling(element, typed) {
  if (!element || typeof typed !== 'string') return false;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]/g, '');
  const t = norm(typed);
  if (!t) return false;
  return element.accepts.some((a) => norm(a) === t);
}

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export { shuffle as shufflePhonics };

// Distractor choices for a multiple-choice item, `count` tiles including the
// answer. `near` elements come first (a wrong tap there says something real
// about what the child confuses), then same-type elements from the same pool,
// then anything of the same type.
//
// An element whose grapheme is ALSO an accepted spelling of the answer is
// excluded: two right answers on one item is an unfair item.
export function buildElementOptions(element, count = 4, pool = PHONICS_ELEMENTS) {
  const answerSpellings = new Set(element.accepts.map((a) => a.toLowerCase()));
  const eligible = pool.filter(
    (el) => el.key !== element.key
      && !answerSpellings.has(el.g.toLowerCase())
      && !el.accepts.some((a) => answerSpellings.has(a.toLowerCase())),
  );
  const byKey = Object.fromEntries(eligible.map((el) => [el.key, el]));

  const picked = [];
  const take = (candidates) => {
    for (const el of candidates) {
      if (picked.length >= count - 1) return;
      if (el && !picked.some((p) => p.key === el.key)) picked.push(el);
    }
  };

  take(element.near.map((k) => byKey[k]));
  take(shuffle(eligible.filter((el) => el.type === element.type)));
  take(shuffle(eligible));

  return shuffle([element, ...picked]);
}
