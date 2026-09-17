#!/usr/bin/env node
/**
 * Pre-generate Dragon Spelling word audio with ElevenLabs text-to-speech.
 *
 * For every word in src/data/spellingWords.js it writes an MP3 named after the
 * word. Word-only recordings live in public/audio/spelling/; recordings with
 * sentence context live in public/audio/spelling/prompts/. The game falls back
 * to the same prompt through browser speech when a file is absent, so running
 * this is a quality upgrade, not a hard requirement.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/generate-spelling-audio.cjs
 *   node scripts/generate-spelling-audio.cjs --force      # re-make existing files
 *   node scripts/generate-spelling-audio.cjs --grade 3    # only one grade
 *   node scripts/generate-spelling-audio.cjs --refresh-context # recheck with AI
 *   node scripts/generate-spelling-audio.cjs --refresh-context --context-only # no TTS
 *
 * Env (see .env.example):
 *   ELEVENLABS_API_KEY   required for audio; not needed with --context-only
 *   ELEVENLABS_STATIC_VOICE_ID (optional) voice for the built-in catalog;
 *                        defaults to Sarah, matching the existing grade files
 *   ELEVENLABS_MODEL_ID  (optional) defaults to eleven_turbo_v2 (English-only).
 *                        An English model is important here: multilingual_v2 has
 *                        no language anchor for a context-free single word and
 *                        drifts to continental vowels (e.g. "van" → "vawn"). The
 *                        English models also honor the <phoneme> tags below.
 *   ANTHROPIC_API_KEY    required to classify newly added catalog words or use
 *                        --refresh-context
 *   SPELLING_CONTEXT_MODEL (optional) model used for context classification
 *
 * Existing files and committed context decisions are skipped by default, so
 * re-running only fills gaps. --refresh-context deliberately rechecks choices.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { exampleSentencesFor, CONTEXT_MODEL } = require('../server/lib/spellingContext');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_STATIC_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah"
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

// Per-word pronunciation overrides for the handful of words the TTS still gets
// wrong even with the English model. Map a word (lowercase) to a CMU-arpabet
// phoneme string; it gets wrapped in an ElevenLabs <phoneme> tag so the exact
// vowels are forced, without changing what the child hears (still just the
// word). Stress goes on the vowel as a trailing digit: 1 = primary, 2 =
// secondary, 0 = unstressed. Only the English models (turbo/flash v2) honor
// these tags — multilingual_v2 ignores them.
//
// Add an entry only when a generated file actually sounds wrong; the English
// model handles the vast majority of the list correctly on its own.
const PHONEME_OVERRIDES = {
  // 'van': 'V AE1 N',
};

function spokenText(word) {
  const ph = PHONEME_OVERRIDES[word.toLowerCase()];
  // A trailing period makes ElevenLabs read a bare word as a clean statement
  // rather than a clipped fragment.
  if (ph) {
    return `<phoneme alphabet="cmu-arpabet" ph="${ph}">${word}</phoneme>.`;
  }
  return `${word}.`;
}

const OUT_DIR = path.join(__dirname, '..', 'public', 'audio', 'spelling');
const PROMPT_OUT_DIR = path.join(OUT_DIR, 'prompts');
const PROMPTS_SOURCE = path.join(__dirname, '..', 'src', 'data', 'spellingPrompts.js');
const DELAY_MS = 250; // be gentle on the API between calls

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const REFRESH_CONTEXT = args.includes('--refresh-context');
const CONTEXT_ONLY = args.includes('--context-only');
const gradeFlagIdx = args.indexOf('--grade');
const ONLY_GRADE = gradeFlagIdx !== -1 ? Number(args[gradeFlagIdx + 1]) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spokenPrompt(word, exampleSentence) {
  return exampleSentence
    ? `${word}. ${exampleSentence} ${word}.`
    : spokenText(word);
}

async function ttsToFile(word, exampleSentence, destPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spokenPrompt(word, exampleSentence),
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'data', 'spellingWords.js')).href);
  const promptMod = await import(pathToFileURL(PROMPTS_SOURCE).href + `?v=${Date.now()}`);
  const { SPELLING_WORDS } = mod;
  const exampleSentences = { ...promptMod.SPELLING_EXAMPLE_SENTENCES };
  const committedSentences = { ...exampleSentences };

  const writeCommittedSentences = () => {
    const sorted = Object.fromEntries(Object.entries(committedSentences).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(
      PROMPTS_SOURCE,
      '// Built-in words whose recorded prompt includes sentence context. The offline\n' +
      '// ElevenLabs generator maintains this map when it uses the AI context check for\n' +
      '// newly added catalog words. Keep values spoken-only; they are never shown to a\n' +
      '// child during an attempt.\n' +
      `export const SPELLING_EXAMPLE_SENTENCES = ${JSON.stringify(sorted, null, 2)};\n`,
    );
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROMPT_OUT_DIR, { recursive: true });

  // Collect the unique set of words to make (one file per word, even if a word
  // appears in more than one grade).
  const grades = ONLY_GRADE ? [ONLY_GRADE] : Object.keys(SPELLING_WORDS).map(Number);
  const words = [...new Set(grades.flatMap((g) => SPELLING_WORDS[g] || []))].sort();

  // A missing base recording identifies a newly added catalog word. Ask the AI
  // once before recording it; established words retain their committed choice.
  // --refresh-context deliberately rechecks the whole selected catalog.
  const wordsToCheck = REFRESH_CONTEXT
    ? words
    : words.filter((word) => (
      !fs.existsSync(path.join(OUT_DIR, `${word.toLowerCase()}.mp3`)) &&
      !Object.hasOwn(exampleSentences, word)
    ));
  const contextPending = new Set();
  const contextChanged = new Set();
  if (wordsToCheck.length > 0) {
    const context = await exampleSentencesFor(wordsToCheck);
    if (context.checked) {
      for (const word of wordsToCheck) {
        const sentence = context.sentences.get(word);
        if ((exampleSentences[word] || null) !== sentence) contextChanged.add(word);
        if (sentence) exampleSentences[word] = sentence;
        else delete exampleSentences[word];
      }
    } else {
      wordsToCheck.forEach((word) => contextPending.add(word));
      console.warn('⚠ AI context check unavailable; unchecked words will not be recorded yet.');
    }
  }

  if (CONTEXT_ONLY) {
    if (contextPending.size > 0) throw new Error('AI context check did not complete');
    for (const word of contextChanged) {
      const promptPath = path.join(PROMPT_OUT_DIR, `${word.toLowerCase()}.mp3`);
      if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath);
    }
    Object.keys(committedSentences).forEach((word) => delete committedSentences[word]);
    Object.assign(committedSentences, exampleSentences);
    writeCommittedSentences();
    console.log(`Context check complete: ${Object.keys(exampleSentences).length} contextual prompt(s).`);
    return;
  }

  if (!API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set. Add it to .env (see .env.example).');
  }

  console.log(`Dragon Spelling audio → ${OUT_DIR}`);
  console.log(`Voice: ${VOICE_ID}  Model: ${MODEL_ID}  Context model: ${CONTEXT_MODEL}`);
  console.log(`${words.length} unique words${ONLY_GRADE ? ` (grade ${ONLY_GRADE})` : ''}${FORCE ? ', --force' : ''}\n`);

  let made = 0;
  let skipped = 0;
  const failed = [];

  for (const word of words) {
    if (contextPending.has(word)) {
      failed.push(word);
      process.stdout.write(`  ✗ ${word} — AI context check unavailable\n`);
      continue;
    }
    const sentence = exampleSentences[word] || null;
    const dest = sentence
      ? path.join(PROMPT_OUT_DIR, `${word.toLowerCase()}.mp3`)
      : path.join(OUT_DIR, `${word.toLowerCase()}.mp3`);
    if (!FORCE && !contextChanged.has(word) && fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      await ttsToFile(word, sentence, dest);
      if (contextChanged.has(word)) {
        if (sentence) committedSentences[word] = sentence;
        else delete committedSentences[word];
        writeCommittedSentences();
      }
      made++;
      process.stdout.write(`  ✓ ${word}\n`);
      await sleep(DELAY_MS);
    } catch (err) {
      failed.push(word);
      process.stdout.write(`  ✗ ${word} — ${err.message}\n`);
    }
  }

  console.log(`\nDone. ${made} created, ${skipped} already present, ${failed.length} failed.`);
  if (failed.length) {
    console.log(`Failed words: ${failed.join(', ')}`);
    console.log('Re-run to retry just the failures (existing files are skipped).');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
