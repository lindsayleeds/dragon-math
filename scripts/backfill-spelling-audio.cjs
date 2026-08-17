#!/usr/bin/env node
/**
 * Generate any MISSING custom-word audio for the currently configured voice.
 *
 * Custom spelling-list words are normally generated at save time
 * (server/routes/spelling.js). This script exists for the two cases where that
 * isn't enough:
 *
 *   1. The voice changed. The shared cache is keyed by (word, VOICE_ID), so
 *      after ELEVENLABS_VOICE_ID is edited every existing list's words have no
 *      audio for the new voice and would silently fall back to the browser's
 *      built-in speech. Run this once after a voice change to bring them over.
 *   2. A save happened while ElevenLabs was down (or before a key was set), so
 *      some words saved without audio.
 *
 * It only ever ADDS rows — a word already generated for this voice is skipped,
 * and audio for the previous voice is left alone (harmless, and it makes
 * rolling the voice back free).
 *
 * Usage:
 *   node scripts/backfill-spelling-audio.cjs            # generate what's missing
 *   node scripts/backfill-spelling-audio.cjs --dry-run  # just report the gap
 *
 * Env: DATABASE_URL, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID — see .env.example.
 * This is the CUSTOM-list counterpart to generate-spelling-audio.cjs, which
 * writes the built-in grade catalogs to public/audio/spelling/ as static files.
 */
require('dotenv').config();

const { sql } = require('drizzle-orm');
const { db } = require('../server/db');
const { ensureAudio, cachedWords, VOICE_ID, MODEL_ID, AUDIO_ENABLED } = require('../server/lib/spellingAudio');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!AUDIO_ENABLED) {
    console.error('✗ ELEVENLABS_API_KEY is not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  const rows = await db.execute(sql`SELECT DISTINCT word FROM spelling_list_words ORDER BY word`);
  const words = rows.rows.map((r) => r.word);

  console.log(`Custom spelling-list audio backfill`);
  console.log(`Voice: ${VOICE_ID}  Model: ${MODEL_ID}`);
  console.log(`${words.length} distinct word(s) across all custom lists\n`);

  if (words.length === 0) {
    console.log('Nothing to do — no custom lists yet.');
    return;
  }

  const have = await cachedWords(words);
  const missing = words.filter((w) => !have.has(w));
  console.log(`${have.size} already generated for this voice, ${missing.length} missing.`);

  if (missing.length === 0) {
    console.log('✓ Every custom word already has audio for this voice.');
    return;
  }

  if (DRY_RUN) {
    console.log(`\n--dry-run — would generate: ${missing.join(', ')}`);
    return;
  }

  console.log(`\nGenerating ${missing.length}…`);
  const result = await ensureAudio(words);
  console.log(`\n✓ generated ${result.generated}, reused ${result.reused}, failed ${result.failed.length}`);
  if (result.failed.length > 0) {
    for (const f of result.failed) console.log(`  ✗ ${f.word}: ${f.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => {
    // The pg pool keeps the event loop alive otherwise.
    process.exit(process.exitCode || 0);
  });
