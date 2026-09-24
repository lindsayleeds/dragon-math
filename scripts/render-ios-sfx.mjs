#!/usr/bin/env node
// Renders every synthesized web sound effect the kid screens play to a short
// AAC (.m4a) file for the iOS app, plus ios/Sounds/manifest.json.
//
//   npm run ios:render-sfx
//
// The effects are not re-implemented here: the real src/utils/sounds.js and
// src/utils/soundEffects.js are loaded into headless Chromium (Playwright) and
// each play* function is handed an OfflineAudioContext instead of the live one,
// so the files are exactly what the web app plays. Math.random (the noise in the
// splash and applause) is seeded, so re-running produces the same audio.
//
// Needs macOS: the WAV → AAC step uses the system `afconvert`.
//
// Adding an effect: add it to EFFECTS below. Every effect with a caller in a
// kid screen must be listed — see ios/Sounds/README.md.

/* global OfflineAudioContext -- used inside page.evaluate, which runs in Chromium */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'ios', 'Sounds');
const SAMPLE_RATE = 44100;
const RENDER_SECONDS = 3; // longest effect (caught) is ~1.8s
const SILENCE = 1e-4; // ≈ -80 dBFS: anything quieter at the tail is trimmed
const TAIL_SECONDS = 0.02;
const AAC_BITRATE = 96000;
// Chromium's offline render is not bit-exact between runs (a few LSB of float
// rounding where many sources overlap), and every .m4a embeds its creation
// time. So an existing file is kept when its decoded audio is within this many
// 16-bit steps (≈ -60 dBFS, inaudible) of the new render — re-running without
// changing an effect leaves git clean.
const UNCHANGED_TOLERANCE = 32;

// name → where the web function lives and who calls it. `usedBy` is
// documentation for the iOS side, not load-bearing for the render.
const EFFECTS = [
  { name: 'correct', module: 'soundEffects', fn: 'playCorrect',
    usedBy: ['DragonPhonics', 'DragonSpelling', 'DragonMunchers', 'SteppingStones', 'DragonMemorizePage', 'usePhonicsRound'] },
  { name: 'wrong', module: 'soundEffects', fn: 'playWrong',
    usedBy: ['DragonPhonics', 'DragonSpelling', 'DragonMunchers', 'DragonMemorizePage', 'usePhonicsRound'] },
  { name: 'splash', module: 'soundEffects', fn: 'playSplash', usedBy: ['SteppingStones'] },
  { name: 'win', module: 'soundEffects', fn: 'playWin', usedBy: ['SteppingStones'] },
  { name: 'caught', module: 'soundEffects', fn: 'playCaught', usedBy: ['DragonMunchers'] },
  { name: 'yip', module: 'sounds', fn: 'playYip', usedBy: ['useBattle', 'DragonTrialPage'] },
  { name: 'growl', module: 'sounds', fn: 'playGrowl', usedBy: ['useBattle'] },
  { name: 'victory', module: 'sounds', fn: 'playVictory', usedBy: ['BattlePage', 'DragonTrialPage'] },
  { name: 'defeat', module: 'sounds', fn: 'playDefeat', usedBy: ['BattlePage'] },
];

const ORIGIN = 'http://sfx.render';
const MODULES = {
  sounds: 'src/utils/sounds.js',
  soundEffects: 'src/utils/soundEffects.js',
};

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    // The bundled Chromium may not be downloaded; the browser tests use the
    // installed Chrome channel, so fall back to that.
    console.warn(`Bundled Chromium unavailable (${err.message.split('\n')[0]}); trying Chrome.`);
    return chromium.launch({ channel: 'chrome' });
  }
}

async function renderAll() {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname.slice(1);
      if (path === '') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>sfx</title>' });
      }
      if (!Object.values(MODULES).includes(path)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(ROOT, path), 'utf8') });
    });
    await page.goto(`${ORIGIN}/`);

    const rendered = {};
    for (const effect of EFFECTS) {
      // Reseed per effect so one effect's output never depends on another.
      const pcm = await page.evaluate(async ({ effect, modulePath, sampleRate, seconds }) => {
        let seed = 0x5eed ^ [...effect.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
        Math.random = () => { // mulberry32
          seed = (seed + 0x6d2b79f5) >>> 0;
          let t = seed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const mod = await import(modulePath);
        const target = effect.module === 'soundEffects' ? mod.soundEffects : mod;
        const fn = target[effect.fn];
        if (typeof fn !== 'function') throw new Error(`${effect.fn} not exported by ${modulePath}`);
        const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate);
        fn.call(target, ctx);
        const buf = await ctx.startRendering();
        return Array.from(buf.getChannelData(0));
      }, { effect, modulePath: `/${MODULES[effect.module]}`, sampleRate: SAMPLE_RATE, seconds: RENDER_SECONDS });
      rendered[effect.name] = Float32Array.from(pcm);
    }
    return rendered;
  } finally {
    await browser.close();
  }
}

function trimTail(samples) {
  let last = samples.length - 1;
  while (last > 0 && Math.abs(samples[last]) < SILENCE) last--;
  if (last >= samples.length - 1) {
    throw new Error(`effect still sounding at ${RENDER_SECONDS}s — raise RENDER_SECONDS`);
  }
  const end = Math.min(samples.length, last + 1 + Math.round(TAIL_SECONDS * SAMPLE_RATE));
  return samples.subarray(0, end);
}

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i])); // same clamp the live destination applies
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Decodes an audio file to 16-bit PCM with afconvert and returns the samples.
function decodePcm(file, work) {
  const wav = join(work, 'decoded.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', file, wav]);
  const b = readFileSync(wav);
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + size));
    o += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk decoding ${file}`);
}

function sameAudio(existing, fresh, work) {
  if (!existsSync(existing)) return false;
  const a = decodePcm(existing, work);
  const b = decodePcm(fresh, work);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > UNCHANGED_TOLERANCE) return false;
  return true;
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('ios:render-sfx needs macOS (it encodes with the system afconvert).');
  }
  const rendered = await renderAll();

  mkdirSync(OUT_DIR, { recursive: true });
  // Remove stale renders so a renamed or dropped effect does not linger.
  const wanted = new Set(EFFECTS.map((e) => `${e.name}.m4a`));
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.m4a') && !wanted.has(f)) rmSync(join(OUT_DIR, f));

  const work = mkdtempSync(join(tmpdir(), 'dm-sfx-'));
  const manifest = {
    generatedBy: 'npm run ios:render-sfx (scripts/render-ios-sfx.mjs)',
    format: { container: 'm4a', codec: 'aac', sampleRate: SAMPLE_RATE, channels: 1, bitrate: AAC_BITRATE },
    effects: {},
  };
  try {
    for (const effect of EFFECTS) {
      const samples = trimTail(rendered[effect.name]);
      const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
      const wav = join(work, `${effect.name}.wav`);
      const file = `${effect.name}.m4a`;
      writeFileSync(wav, encodeWav(samples));
      const fresh = join(work, file);
      const dest = join(OUT_DIR, file);
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(AAC_BITRATE), wav, fresh]);
      const unchanged = sameAudio(dest, fresh, work);
      if (!unchanged) renameSync(fresh, dest);
      const duration = Number((samples.length / SAMPLE_RATE).toFixed(3));
      manifest.effects[effect.name] = {
        file,
        durationSeconds: duration,
        source: `${MODULES[effect.module]} ${effect.fn}`,
        usedBy: effect.usedBy,
      };
      console.log(`${file.padEnd(12)} ${duration.toFixed(3)}s  peak ${peak.toFixed(2)}${peak > 1 ? ' (clips, as on web)' : ''}${unchanged ? '  unchanged' : ''}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${EFFECTS.length} effects + manifest.json to ios/Sounds/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
