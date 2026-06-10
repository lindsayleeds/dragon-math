#!/usr/bin/env node
/**
 * Pre-generate Dragon Spelling word audio with ElevenLabs text-to-speech.
 *
 * For every word in src/data/spellingWords.js it writes one MP3 named after the
 * word into public/audio/spelling/<word>.mp3. The game plays these files; until
 * they exist it falls back to the browser's built-in speech, so running this is
 * a quality upgrade, not a hard requirement.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/generate-spelling-audio.cjs
 *   node scripts/generate-spelling-audio.cjs --force      # re-make existing files
 *   node scripts/generate-spelling-audio.cjs --grade 3    # only one grade
 *
 * Env (see .env.example):
 *   ELEVENLABS_API_KEY   (required) your ElevenLabs API key
 *   ELEVENLABS_VOICE_ID  (optional) voice to use; defaults to a clear narrator
 *   ELEVENLABS_MODEL_ID  (optional) defaults to eleven_turbo_v2 (English-only).
 *                        An English model is important here: multilingual_v2 has
 *                        no language anchor for a context-free single word and
 *                        drifts to continental vowels (e.g. "van" → "vawn"). The
 *                        English models also honor the <phoneme> tags below.
 *
 * Existing files are skipped (idempotent), so re-running only fills gaps and
 * adding new words is cheap.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah"
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
const DELAY_MS = 250; // be gentle on the API between calls

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const gradeFlagIdx = args.indexOf('--grade');
const ONLY_GRADE = gradeFlagIdx !== -1 ? Number(args[gradeFlagIdx + 1]) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ttsToFile(word, destPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spokenText(word),
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
  if (!API_KEY) {
    console.error('✗ ELEVENLABS_API_KEY is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'data', 'spellingWords.js')).href);
  const { SPELLING_WORDS } = mod;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Collect the unique set of words to make (one file per word, even if a word
  // appears in more than one grade).
  const grades = ONLY_GRADE ? [ONLY_GRADE] : Object.keys(SPELLING_WORDS).map(Number);
  const words = [...new Set(grades.flatMap((g) => SPELLING_WORDS[g] || []))].sort();

  console.log(`Dragon Spelling audio → ${OUT_DIR}`);
  console.log(`Voice: ${VOICE_ID}  Model: ${MODEL_ID}`);
  console.log(`${words.length} unique words${ONLY_GRADE ? ` (grade ${ONLY_GRADE})` : ''}${FORCE ? ', --force' : ''}\n`);

  let made = 0;
  let skipped = 0;
  const failed = [];

  for (const word of words) {
    const dest = path.join(OUT_DIR, `${word.toLowerCase()}.mp3`);
    if (!FORCE && fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      await ttsToFile(word, dest);
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
