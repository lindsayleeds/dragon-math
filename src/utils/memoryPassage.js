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
  return sentences;
}

export function normalizeMemoryWord(word) {
  return String(word || '').normalize('NFKD').toLocaleLowerCase();
}

export function firstMemoryLetter(word) {
  return [...normalizeMemoryWord(word)][0] || '';
}

export function unsupportedMemoryWords(text) {
  return passageWords(text).filter(word => !/^[a-z0-9]$/.test(firstMemoryLetter(word)));
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
