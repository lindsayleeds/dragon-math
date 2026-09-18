import { speakWord } from './speakWord';

// Play one ISOLATED phonics sound — /br/, /sh/, /oi/ — for Dragon Phonics.
//
// This is deliberately NOT speakWord(). Handing "br" to the browser's speech
// synthesiser makes it read the letter NAMES ("bee arr"), which is precisely the
// thing the child is being asked to decode past, so a grapheme cannot go through
// a text-to-speech path at all. The sound comes from a pre-generated clip at
// /audio/phonics/<key>.mp3 (scripts/generate-phonics-audio.cjs).
//
// The fallback matters because those files may be missing on a fresh checkout,
// and it cannot be "say the grapheme": it says the sound the only other way a
// synthesiser can, by speaking an example word. A child who hears "brick"
// instead of /br/ is doing an easier task, not a broken one — so the game stays
// playable while being honestly weaker. `soundAudioReady()` lets a caller tell
// the two situations apart.

export const phonicsAudioUrl = (key) => `/audio/phonics/${key}.mp3`;

// Element -> did its real clip play? Populated as clips are tried, so the UI can
// note (once, quietly) that it is running on the fallback.
const clipStatus = new Map();

export function soundAudioReady(key) {
  return clipStatus.get(key) ?? null; // null = not tried yet
}

const audioCache = new Map();

function getAudio(url) {
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    audioCache.set(url, audio);
  }
  return audio;
}

// Resolves true once the clip finishes, false if it could not be played at all.
function playUrl(url) {
  const audio = getAudio(url);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      resolve(ok);
    };
    const onEnded = () => settle(true);
    const onError = () => settle(false);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    try {
      audio.currentTime = 0;
    } catch {
      /* not loaded yet — fine */
    }
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => settle(false));
    }
  });
}

/**
 * Say one element's sound on its own.
 * @param {object} element  a PHONICS_ELEMENTS entry
 */
export async function speakSound(element) {
  if (!element) return;
  const ok = await playUrl(phonicsAudioUrl(element.key));
  clipStatus.set(element.key, ok);
  if (ok) return;
  // No clip: fall back to an example word, which speakWord can say properly.
  await speakWord(element.words[0]);
}

/**
 * Say the sound in context — "/sh/ … as in … ship". Used by the hint button and
 * by feedback after a wrong answer, where hearing it inside a real word is what
 * actually teaches the sound.
 * @param {object} element
 * @param {string} [word]  which example word; defaults to the first.
 */
export async function speakSoundInWord(element, word) {
  if (!element) return;
  const example = word || element.words[0];
  const ok = await playUrl(phonicsAudioUrl(element.key));
  clipStatus.set(element.key, ok);
  // A beat between the sound and the word, so they don't run together into one
  // unintelligible blur.
  if (ok) await new Promise((r) => setTimeout(r, 350));
  await speakWord(example);
}

// Warm the audio pipeline on game start, the same reason speakWord's primeSpeech
// exists: the first play of a session is otherwise swallowed on some engines.
export function primeSounds(elements = []) {
  try {
    window.speechSynthesis?.getVoices();
  } catch {
    /* no-op */
  }
  // Touch the first few clips so the common case is already in the HTTP cache.
  for (const el of elements.slice(0, 6)) getAudio(phonicsAudioUrl(el.key));
}
