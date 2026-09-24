// Dragon Memorize rules — how a passage is split into sentences and words,
// which words each difficulty hides, what a Hard-mode key press must match, and
// how the word tiles are shuffled.
//
// A passage is practiced one sentence at a time (splitPassage). Per sentence:
//   - easy:   the words at hiddenWordIndexes(words, sentenceIndex) are blanks;
//             the child fills them, in order, from a shuffled bank of just
//             those words.
//   - medium: every word is a tile, shuffled; the child rebuilds the sentence.
//   - hard:   no tiles; the child presses firstMemoryLetter of each word in
//             order.
//
// Pure: the only random step, the tile shuffle, takes an injected `rng` (any
// `() => number` in [0, 1)), defaulting to Math.random — what the web uses.
// golden/memorize.json pins it for the Swift port (ADR 0005);
// src/utils/memoryPassage.js re-exports everything here.
//
// Draw order (the Swift port must consume draws exactly like this):
//   - shuffledTiles(words): tiles {id, word} with id = the word's index in the
//     list, then Fisher-Yates from the end: for i = n-1 down to 1,
//     j = floor(rng() * (i + 1)), swap tiles[i] and tiles[j]. n-1 draws.
//   - practiceTiles(difficulty, words, hidden): easy → shuffledTiles of the
//     hidden words in hidden order (ids index that list, not the sentence);
//     medium → shuffledTiles(words); hard (or anything else) → [] with no draws.
//   A practice run on one generator: practiceTiles for sentence 0, then for
//   sentence 1 when the child advances, and so on. Splitting, hiding and
//   letter matching draw nothing.
//
// Which words Easy hides is a tunable, served in the `memorize` section of
// GET /api/rule-settings: hiddenWordIndexes takes a `settings` argument
// defaulting to the web fallbacks (src/data/ruleSettings.js).

import { DEFAULT_MEMORIZE_SETTINGS } from '../data/ruleSettings.js';

const WORD_RE = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu;

export function passageWords(text) {
  return String(text || '').match(WORD_RE) || [];
}

export function passageSegments(text) {
  const source = String(text || '');
  const segments = [];
  let cursor = 0;
  let wordIndex = 0;
  for (const match of source.matchAll(WORD_RE)) {
    if (match.index > cursor) {
      segments.push({ type: 'separator', value: source.slice(cursor, match.index) });
    }
    segments.push({ type: 'word', value: match[0], wordIndex });
    cursor = match.index + match[0].length;
    wordIndex += 1;
  }
  if (cursor < source.length) {
    segments.push({ type: 'separator', value: source.slice(cursor) });
  }
  return segments;
}

export function splitPassage(text) {
  const source = String(text || '');
  if (!source) return [];
  const sentences = [];
  let start = 0;
  let index = 0;
  while (index < source.length) {
    if (!/[.!?]/.test(source[index])) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < source.length && /[.!?]/.test(source[end])) end += 1;
    while (end < source.length && /[”’"')\]}]/.test(source[end])) end += 1;
    if (end < source.length && !/\s/.test(source[end])) {
      index = end;
      continue;
    }
    while (end < source.length && /\s/.test(source[end])) end += 1;
    sentences.push(source.slice(start, end));
    start = end;
    index = end;
  }
  if (start < source.length) sentences.push(source.slice(start));
  const wordBearing = [];
  let leadingPunctuation = '';
  for (const sentence of sentences) {
    if (passageWords(sentence).length > 0) {
      wordBearing.push(leadingPunctuation + sentence);
      leadingPunctuation = '';
    } else if (wordBearing.length > 0) {
      wordBearing[wordBearing.length - 1] += sentence;
    } else {
      leadingPunctuation += sentence;
    }
  }
  if (leadingPunctuation && wordBearing.length > 0) {
    wordBearing[wordBearing.length - 1] += leadingPunctuation;
  }
  return wordBearing;
}

export function normalizeMemoryWord(word) {
  return String(word || '').normalize('NFKD').toLowerCase();
}

export function firstMemoryLetter(word) {
  return [...normalizeMemoryWord(word)][0] || '';
}

export function unsupportedMemoryWords(text) {
  return passageWords(text).filter(word => !/^[a-z0-9]$/.test(firstMemoryLetter(word)));
}

// Easy's blanks: word `index` of sentence `sentenceIndex` is hidden when
// (index + sentenceIndex) % easyHideEvery === easyHideOffset — every fourth
// word by default, staggered per sentence. A sentence too short to hit one
// hides its last word.
export function hiddenWordIndexes(words, sentenceIndex = 0, settings = DEFAULT_MEMORIZE_SETTINGS) {
  if (words.length === 0) return [];
  const { easyHideEvery, easyHideOffset } = settings;
  const hidden = words
    .map((_, index) => index)
    .filter(index => (index + sentenceIndex) % easyHideEvery === easyHideOffset);
  return hidden.length > 0 ? hidden : [words.length - 1];
}

export function shuffledTiles(words, random = Math.random) {
  const tiles = words.map((word, id) => ({ id, word }));
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

// The tile bank a sentence shows at `difficulty` (see the header for the draws).
export function practiceTiles(difficulty, words, hidden, random = Math.random) {
  if (difficulty === 'easy') return shuffledTiles(hidden.map(index => words[index]), random);
  if (difficulty === 'medium') return shuffledTiles(words, random);
  return [];
}
