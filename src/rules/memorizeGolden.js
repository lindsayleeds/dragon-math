// The `memorize` golden fixture (golden/memorize.json): what the Dragon
// Memorize rules (src/rules/memorize.js) produce for fixed passages and seeds,
// for the Swift port to reproduce exactly (ADR 0005). Registered in
// buildGoldenFiles() in ./golden.js.
//
// Three parts:
//   - passages:  per passage, the sentence split and, per sentence, its words,
//                segments, easy-mode hidden indexes and each word's first
//                letter (what Hard mode matches); plus unsupportedMemoryWords.
//   - runs:      every passage × difficulty × seed: the tile bank each
//                sentence shows, drawn in sentence order from one generator.
//   - normalize: normalizeMemoryWord / firstMemoryLetter on tricky Unicode.

import { createSeededRandom } from './seededRandom.js';
import {
  firstMemoryLetter,
  hiddenWordIndexes,
  normalizeMemoryWord,
  passageSegments,
  passageWords,
  practiceTiles,
  splitPassage,
  unsupportedMemoryWords,
} from './memorize.js';

const SEEDS = ['0', '1', '42', '18446744073709551615'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Named passages covering the splitter's and tokenizer's edges.
const PASSAGES = [
  {
    name: 'psalm',
    body: 'The Lord is my shepherd; I shall not want. He makes me lie down in green pastures. He leads me beside still waters.',
  },
  {
    name: 'short-sentences',
    body: 'Be still. Know that I am here!',
  },
  {
    name: 'smart-quotes-and-ellipses',
    body: '...and then we began.”  “Keep going!’ Next.',
  },
  {
    name: 'punctuation-only-chunks',
    body: '... Hello. ... World.',
  },
  {
    name: 'apostrophes-and-dashes',
    body: "Don't be afraid. To be, or not—to be. It’s the dragon’s nest!",
  },
  {
    name: 'no-final-punctuation',
    body: 'Twinkle twinkle little star how I wonder what you are',
  },
  {
    name: 'numbers-and-decimals',
    body: 'Pi is about 3.14 and e is 2.72. Count 1 2 3 4 5 6 7 8 9 10?! Done.',
  },
  {
    name: 'abbreviation',
    body: 'Mr. Fox met Dr. Owl at 9 a.m. by the pond.',
  },
  {
    name: 'accents-and-unsupported',
    body: 'Émile ate crème brûlée. Ångström measured the ﬁne light. Ωmega and 猫 slept.',
  },
  {
    name: 'repeated-words',
    body: 'Row, row, row your boat. Row, row, row your boat.',
  },
  {
    name: 'single-word',
    body: 'Amen.',
  },
  {
    name: 'brackets-after-stop',
    body: '(Look up.) [See the stars!] {Make a wish.}',
  },
  {
    name: 'empty',
    body: '',
  },
];

const NORMALIZE_INPUTS = [
  'Shepherd', 'LORD', 'Émile', 'ﬁne', 'Ångström', 'İstanbul', 'ǅemal', '½', '２', 'Ωmega', '猫', "Don't", '',
];

const rngFor = seed => createSeededRandom(BigInt(seed)).next;

function analyzePassage({ name, body }) {
  return {
    name,
    body,
    unsupported: unsupportedMemoryWords(body),
    sentences: splitPassage(body).map((text, sentenceIndex) => {
      const words = passageWords(text);
      return {
        text,
        words,
        segments: passageSegments(text),
        hidden: hiddenWordIndexes(words, sentenceIndex),
        firstLetters: words.map(firstMemoryLetter),
      };
    }),
  };
}

function practiceRun({ name, body }, difficulty, seed) {
  const rng = rngFor(seed);
  return {
    passage: name,
    difficulty,
    seed,
    tiles: splitPassage(body).map((text, sentenceIndex) => {
      const words = passageWords(text);
      const hidden = hiddenWordIndexes(words, sentenceIndex);
      return practiceTiles(difficulty, words, hidden, rng).map(t => t.id);
    }),
  };
}

export function memorizeFixture() {
  return {
    fixture: 'memorize',
    version: 1,
    description:
      'Dragon Memorize rules (src/rules/memorize.js). `passages`: splitPassage(body) → sentences; per sentence ' +
      '(sentenceIndex = its position) passageWords, passageSegments, hiddenWordIndexes(words, sentenceIndex) — the ' +
      'easy blanks, every index where (index + sentenceIndex) % 4 === 1, else the last word — and firstMemoryLetter ' +
      'of each word (hard matches a key press against it); `unsupported` is unsupportedMemoryWords(body). ' +
      '`runs`: rng = createSeededRandom(seed).next, ONE generator per run; for each sentence in order, ' +
      'practiceTiles(difficulty, words, hidden, rng) → tile ids in shuffled order. easy shuffles the hidden words ' +
      '(ids index the hidden list), medium shuffles every word (ids index words), hard shuffles nothing ([], no draws). ' +
      'The shuffle is Fisher-Yates from the end: for i = n-1 down to 1, j = floor(rng() * (i + 1)), swap. ' +
      '`normalize`: normalizeMemoryWord (NFKD, then toLowerCase) and firstMemoryLetter (first code point of that).',
    passages: PASSAGES.map(analyzePassage),
    runs: PASSAGES.flatMap(passage =>
      DIFFICULTIES.flatMap(difficulty => SEEDS.map(seed => practiceRun(passage, difficulty, seed))),
    ),
    normalize: NORMALIZE_INPUTS.map(input => ({
      input,
      normalized: normalizeMemoryWord(input),
      firstLetter: firstMemoryLetter(input),
    })),
  };
}
