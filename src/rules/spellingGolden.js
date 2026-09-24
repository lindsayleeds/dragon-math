// The `spelling` golden fixture (golden/spelling.json): what the Dragon
// Spelling rules (src/rules/spelling.js) produce from fixed seeds, for the
// Swift port to reproduce exactly (ADR 0005). Registered in buildGoldenFiles()
// in ./golden.js.
//
// Four parts:
//   - catalogs: every grade's word list, in catalog order (the shuffle input).
//   - rounds:   drawRound(gradeSource(grade)) for every grade × seed.
//   - games:    whole Easy games on one generator — a round, each word's
//               letter tiles as it comes up, then "play again" — per grade.
//   - sources:  custom lists (played in full) and perRound edges.

import { createSeededRandom } from './seededRandom.js';
import { drawRound, letterTiles } from './spelling.js';
import {
  SPELLING_GRADES,
  SPELLING_WORDS,
  WORDS_PER_ROUND,
  gradeSource,
  listSource,
} from '../data/spellingWords.js';

const SEEDS = ['0', '1', '42', '2024', '18446744073709551615'];
const GAME_SEEDS = ['1', '42'];
const GAME_ROUNDS = 2;

// Custom lists as GET /api/spelling/lists returns them (only the fields the
// rules read). Duplicates are allowed in a list and each copy is played.
const LISTS = [
  {
    id: 1,
    name: 'Week 3',
    words: ['forest', 'river', 'meadow', 'pebble', 'sparrow', 'thunder', 'blossom', 'canyon',
      'lantern', 'harbor', 'glacier', 'orchard', 'breeze', 'marble', 'puddle'],
  },
  { id: 2, name: 'Three words', words: ['otter', 'maple', 'comet'] },
  { id: 3, name: 'One word', words: ['dragon'] },
  { id: 4, name: 'With repeats', words: ['bee', 'bee', 'tree', 'bee'] },
  { id: 5, name: 'Empty', words: [] },
];

// Hand-built sources for the perRound edges: fewer words than perRound, and a
// perRound of 0 (falsy → the whole pool).
const EDGE_SOURCES = [
  { name: 'fewer-than-per-round', words: ['cat', 'dog', 'hen', 'pig', 'owl'], perRound: 10 },
  { name: 'per-round-zero', words: ['sun', 'moon', 'star', 'sky'], perRound: 0 },
  { name: 'per-round-two', words: ['red', 'blue', 'green', 'gold', 'pink', 'gray'], perRound: 2 },
];

const rngFor = seed => createSeededRandom(BigInt(seed)).next;
const tileOrder = tiles => tiles.map(t => t.id);

function playEasyGame(grade, seed) {
  const rng = rngFor(seed);
  const source = gradeSource(grade);
  const rounds = [];
  for (let r = 0; r < GAME_ROUNDS; r++) {
    const words = drawRound(source, rng);
    rounds.push({ words, tiles: words.map(word => tileOrder(letterTiles(word, rng))) });
  }
  return { grade, seed, rounds };
}

export function spellingFixture() {
  const grades = SPELLING_GRADES.map(g => g.grade);
  return {
    fixture: 'spelling',
    version: 1,
    description:
      'Dragon Spelling rules (src/rules/spelling.js), rng = createSeededRandom(seed).next from a fresh generator per case. ' +
      'shuffle is Fisher-Yates from the end, one draw per step: for i = n-1 down to 1, j = floor(rng() * (i + 1)), swap. ' +
      'drawRound(source) shuffles ALL of source.words (99 draws for a 100-word grade) and keeps the first ' +
      'min(perRound || n, n). letterTiles(word) shuffles {id, letter} with id = letter index (length-1 draws); ' +
      '`tiles` records each word\'s tile ids in shuffled order. ' +
      '`catalogs`: grade → words in catalog order; a grade round plays wordsPerRound of them. ' +
      '`rounds`: drawRound(gradeSource(grade)). ' +
      `\`games\`: an Easy game on ONE generator — drawRound, then letterTiles for each word in round order, repeated ${GAME_ROUNDS} times ("play again"). ` +
      'Medium and Hard draw only the round. ' +
      '`lists`: drawRound(listSource(list)) — a custom list plays every word (perRound = its length). ' +
      '`sources`: drawRound on hand-built {words, perRound} sources.',
    wordsPerRound: WORDS_PER_ROUND,
    catalogs: Object.fromEntries(grades.map(grade => [String(grade), SPELLING_WORDS[grade]])),
    rounds: grades.flatMap(grade =>
      SEEDS.map(seed => ({ grade, seed, words: drawRound(gradeSource(grade), rngFor(seed)) })),
    ),
    games: grades.flatMap(grade => GAME_SEEDS.map(seed => playEasyGame(grade, seed))),
    lists: LISTS.flatMap(list =>
      SEEDS.map(seed => ({
        list: list.name,
        input: list.words,
        seed,
        words: drawRound(listSource(list), rngFor(seed)),
      })),
    ),
    sources: EDGE_SOURCES.flatMap(({ name, words, perRound }) =>
      SEEDS.map(seed => ({
        source: name,
        input: words,
        perRound,
        seed,
        words: drawRound({ words, perRound }, rngFor(seed)),
      })),
    ),
  };
}
