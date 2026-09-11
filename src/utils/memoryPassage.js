const WORD_RE = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu;

export function passageWords(text) {
  return String(text || '').match(WORD_RE) || [];
}

export function splitPassage(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  return (clean.match(/[^.!?]+(?:[.!?]+[”"']?|$)/g) || [clean])
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

export function normalizeMemoryWord(word) {
  return String(word || '').normalize('NFKD').toLocaleLowerCase();
}

export function firstMemoryLetter(word) {
  return [...normalizeMemoryWord(word)][0] || '';
}

export function hiddenWordIndexes(words, sentenceIndex = 0) {
  if (words.length === 0) return [];
  const hidden = words
    .map((_, index) => index)
    .filter(index => (index + sentenceIndex) % 4 === 1);
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
