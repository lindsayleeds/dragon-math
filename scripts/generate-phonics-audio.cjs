#!/usr/bin/env node
/**
 * Pre-generate Dragon Phonics ISOLATED-SOUND audio with ElevenLabs.
 *
 * For every element in src/data/phonicsCurriculum.js this writes one MP3 named
 * after the element's `key` into public/audio/phonics/<key>.mp3. The games play
 * these when they ask "what sound is this?" — and the whole program depends on
 * them, because that question cannot be asked with browser speech synthesis: a
 * synthesiser handed "br" reads the LETTER NAMES ("bee arr"), which is the exact
 * thing the child is supposed to be decoding past. So unlike the spelling audio,
 * this is not purely a quality upgrade. The fallback (utils/speakSound.js speaks
 * "<grapheme> as in <word>") keeps the game usable, but the pure sound-
 * discrimination item only works once these files exist.
 *
 * HOW THE SOUND IS PRODUCED. Each element carries an `arpabet` field, which is
 * wrapped in an ElevenLabs <phoneme> tag so the model says the phoneme rather
 * than reading the spelling. Two conventions in that data matter here:
 *   • stops and most blends carry a trailing unstressed schwa (B R AH0), because
 *     a plosive with nothing after it is nearly silent — this is also how the
 *     sound is taught aloud.
 *   • continuants (F, L, M, N, S, SH, TH, NG…) are held on their own, no schwa.
 * Only the ENGLISH models (turbo/flash v2) honour <phoneme>; multilingual_v2
 * ignores the tag and would read the letters, so the model id is not a free
 * choice here.
 *
 * SPOT-CHECK THE OUTPUT. A generated phoneme is not self-verifying: the script
 * can tell that a file arrived and is a plausible length, not that it sounds
 * like /shr/. After a run, listen to a sample — the blends in stage 4 and the
 * vowel teams in stage 7 are where a bad clip is most likely. Fixing one is a
 * data edit (change that element's `arpabet`) plus `--force --only <key>`.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/generate-phonics-audio.cjs
 *   node scripts/generate-phonics-audio.cjs --force            # re-make everything
 *   node scripts/generate-phonics-audio.cjs --stage 4          # one stage only
 *   node scripts/generate-phonics-audio.cjs --only br,shr      # named elements
 *   node scripts/generate-phonics-audio.cjs --dry-run          # print, call nothing
 *
 * Env: the same ELEVENLABS_* variables as scripts/generate-spelling-audio.cjs.
 * Keep the voice in sync with that script so one game does not sound like a
 * different narrator from the other.
 *
 * Existing files are skipped unless --force, so re-running only fills gaps and
 * adding an element to the curriculum is cheap.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah"
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

const OUT_DIR = path.join(__dirname, '..', 'public', 'audio', 'phonics');
const DELAY_MS = 250; // be gentle on the API between calls

// A clip this small is a silent or truncated generation rather than a sound —
// worth flagging even though the request succeeded. Roughly 0.1s of 128kbps mp3.
const SUSPICIOUS_BYTES = 1600;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const ONLY_STAGE = flagValue('--stage') ? Number(flagValue('--stage')) : null;
const ONLY_KEYS = flagValue('--only')
  ? new Set(flagValue('--only').split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The isolated sound, as a phoneme tag. The tag's *body* is the grapheme, which
// is what a model that ignored the tag would fall back to reading — keeping it
// there means a misconfigured model produces a recognisably wrong clip rather
// than silence.
function spokenText(element) {
  return `<phoneme alphabet="cmu-arpabet" ph="${element.arpabet}">${element.g}</phoneme>`;
}

async function ttsToFile(element, destPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spokenText(element),
      model_id: MODEL_ID,
      // Higher stability than the word script: a bare phoneme has no sentence
      // context to anchor it, and a "creative" reading of /shr/ is just wrong.
      voice_settings: { stability: 0.75, similarity_boost: 0.75, speed: 0.85 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('empty body');
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  const mod = await import(
    pathToFileURL(path.join(__dirname, '..', 'src', 'data', 'phonicsCurriculum.js')).href
  );
  const { PHONICS_ELEMENTS } = mod;

  let elements = PHONICS_ELEMENTS;
  if (ONLY_STAGE) elements = elements.filter((el) => el.stage === ONLY_STAGE);
  if (ONLY_KEYS) elements = elements.filter((el) => ONLY_KEYS.has(el.key));

  if (elements.length === 0) {
    console.error('✗ No elements matched --stage/--only.');
    process.exit(1);
  }

  console.log(`Dragon Phonics sound audio → ${OUT_DIR}`);
  console.log(`Voice: ${VOICE_ID}  Model: ${MODEL_ID}`);
  console.log(`${elements.length} elements${FORCE ? ', --force' : ''}${DRY_RUN ? ', --dry-run' : ''}\n`);

  if (DRY_RUN) {
    for (const el of elements) {
      console.log(`  ${el.key.padEnd(16)} ${el.sound.padEnd(8)} ${spokenText(el)}`);
    }
    return;
  }

  if (!API_KEY) {
    console.error('✗ ELEVENLABS_API_KEY is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let made = 0;
  let skipped = 0;
  const failed = [];
  const suspicious = [];

  for (const el of elements) {
    const dest = path.join(OUT_DIR, `${el.key}.mp3`);
    if (!FORCE && fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      const bytes = await ttsToFile(el, dest);
      made++;
      const flag = bytes < SUSPICIOUS_BYTES ? '  ⚠ very short' : '';
      if (bytes < SUSPICIOUS_BYTES) suspicious.push(el.key);
      process.stdout.write(`  ✓ ${el.key.padEnd(16)} ${el.sound.padEnd(8)} ${bytes}B${flag}\n`);
      await sleep(DELAY_MS);
    } catch (err) {
      failed.push(el.key);
      process.stdout.write(`  ✗ ${el.key.padEnd(16)} — ${err.message}\n`);
    }
  }

  console.log(`\nDone. ${made} created, ${skipped} already present, ${failed.length} failed.`);
  if (suspicious.length) {
    console.log(`⚠ Suspiciously short (listen to these first): ${suspicious.join(', ')}`);
  }
  if (made) {
    console.log('Now listen to a sample — a phoneme clip is not self-verifying (see the header).');
  }
  if (failed.length) {
    console.log(`Failed: ${failed.join(', ')}`);
    console.log('Re-run to retry just the failures (existing files are skipped).');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
