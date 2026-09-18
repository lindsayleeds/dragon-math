// Decide which spelling words need a spoken example sentence, and write those
// sentences. This is deliberately separate from spellingAudio.js so the same
// AI decision can be reused by the offline built-in-audio generator.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CONTEXT_MODEL = process.env.SPELLING_CONTEXT_MODEL || 'claude-haiku-4-5';
const CONTEXT_ENABLED = !!ANTHROPIC_API_KEY;
const REQUEST_TIMEOUT_MS = 12000;

const SYSTEM_PROMPT = [
  'You prepare spoken spelling prompts for children in a wholesome, nature-forward learning game.',
  'Be extremely selective: almost every word should receive null.',
  'A word needs an example sentence ONLY when you can name a common, differently spelled English word that sounds',
  'the same or is routinely confused from speech alone, such as new/knew, ceiling/sealing, current/currant, or desert/dessert.',
  'A sentence is not a definition or pronunciation aid. Return null for long or difficult words, abstract words, words with',
  'multiple meanings but one spelling (bat), and words with multiple pronunciations but one spelling (wind).',
  'For a word that needs context, write one natural, age-appropriate sentence of 4 to 12 words.',
  'The sentence must contain the exact target word once, make its meaning clear, and must not mention letters or spelling.',
  'Avoid frightening, violent, spiritual, occult, or mature subject matter.',
].join(' ');

function cleanSentence(word, value) {
  if (typeof value !== 'string') return null;
  const sentence = value.trim();
  if (!sentence || sentence.length > 140 || /[\r\n]/.test(sentence)) return null;
  const matches = sentence.match(new RegExp(`\\b${word}\\b`, 'gi')) || [];
  if (matches.length !== 1) return null;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function cleanDecision(word, value) {
  if (value === null) return null;
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`AI decision for "${word}" was not null or an object`);
  }
  const confusedWith = typeof value.confused_with === 'string'
    ? value.confused_with.trim().toLowerCase()
    : '';
  if (!/^[a-z]+$/.test(confusedWith) || confusedWith === word) {
    throw new Error(`AI decision for "${word}" lacked a different confusable spelling`);
  }
  const sentence = cleanSentence(word, value.sentence);
  if (!sentence) throw new Error(`AI decision for "${word}" had an invalid sentence`);
  return sentence;
}

function parseContextResponse(words, text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI response did not contain JSON');
  const raw = JSON.parse(match[0]);
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
    throw new Error('AI response was not an object');
  }
  for (const word of words) {
    if (!Object.hasOwn(raw, word)) throw new Error(`AI response omitted "${word}"`);
  }
  const requested = new Set(words);
  const sentences = new Map();
  for (const word of words) sentences.set(word, null);
  for (const [word, value] of Object.entries(raw)) {
    if (requested.has(word)) sentences.set(word, cleanDecision(word, value));
  }
  return sentences;
}

async function requestBatch(words) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CONTEXT_MODEL,
      max_tokens: Math.min(4096, 160 + words.length * 55),
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content:
          `Words: ${JSON.stringify(words)}\n\n` +
          'Reply with ONLY one JSON object. Include every supplied word as a key. ' +
          'Use null unless a genuinely confusable alternate spelling exists. Otherwise use an object with ' +
          '"sentence" and "confused_with". Example: ' +
          '{"new":{"sentence":"I have a new pair of shoes.","confused_with":"knew"},"rabbit":null}',
      }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status} — ${detail.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (data?.content || [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  return parseContextResponse(words, text);
}

/**
 * Classify lower-case spelling words in bounded batches.
 *
 * `checked:false` means callers should keep the word-only behavior and retry on
 * a later save/backfill. An AI outage must never stop a homework list saving.
 */
async function exampleSentencesFor(words) {
  const unique = [...new Set((words || []).filter(Boolean))];
  if (unique.length === 0) return { checked: true, sentences: new Map() };
  if (!CONTEXT_ENABLED) return { checked: false, sentences: new Map() };

  try {
    // Custom lists top out at 60 words, while the offline backfill can contain
    // hundreds. Small batches keep the required all-keys JSON response inside
    // the model's output limit.
    const sentences = new Map();
    for (let i = 0; i < unique.length; i += 50) {
      const batch = await requestBatch(unique.slice(i, i + 50));
      for (const [word, sentence] of batch) sentences.set(word, sentence);
    }
    return { checked: true, sentences };
  } catch (err) {
    console.error('[spelling-context] AI check failed — using word-only prompts:', err?.message || err);
    return { checked: false, sentences: new Map() };
  }
}

module.exports = {
  CONTEXT_ENABLED,
  CONTEXT_MODEL,
  cleanSentence,
  cleanDecision,
  parseContextResponse,
  exampleSentencesFor,
};
