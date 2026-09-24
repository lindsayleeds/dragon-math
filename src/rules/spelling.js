// Dragon Spelling rules — which words a round plays, in what order, and how
// Easy mode scrambles a word's letters into tiles.
//
// Pure: every random choice takes an injected `rng` (any `() => number` in
// [0, 1)), defaulting to Math.random — what the web uses. From a fixed seed a
// round is repeatable, so golden/spelling.json can pin it for the Swift port
// (ADR 0005). The word catalogs and the grade/list sources stay in
// src/data/spellingWords.js, which re-exports these.
//
// Draw order (the Swift port must consume draws exactly like this):
//   - shuffle(items): Fisher-Yates from the end, one draw per step:
//     for i = n-1 down to 1, j = floor(rng() * (i + 1)), swap items[i] and
//     items[j]. n items take n-1 draws (none for 0 or 1 item).
//   - drawRound(source): shuffle(source.words) — the WHOLE pool, so a 100-word
//     grade catalog takes 99 draws — then the first
//     min(source.perRound || n, n) words.
//   - letterTiles(word): shuffle of the word's letters as {id, letter}, where
//     id is the letter's index in the word: length-1 draws.
//   A game on one generator: drawRound first, then — in Easy only — letterTiles
//   for each word in round order as it comes up. Medium and Hard draw nothing
//   after the round. "Play again" draws a fresh round from the same generator.

export function shuffle(items, rng = Math.random) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// The words for one round, shuffled so the order differs every time. A grade
// source plays `perRound` (10) of its words; a custom list plays all of them.
export function drawRound(source, rng = Math.random) {
  if (!source) return [];
  const pool = shuffle(source.words, rng);
  return pool.slice(0, Math.min(source.perRound || pool.length, pool.length));
}

// Easy mode: the word's letters as scrambled tiles. `id` is the letter's
// position in the word, so repeated letters stay distinct.
export function letterTiles(word, rng = Math.random) {
  if (!word) return [];
  return shuffle(word.split('').map((letter, id) => ({ id, letter })), rng);
}
