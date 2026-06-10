import { audioFileFor } from '../data/spellingWords';

// Say a spelling word out loud. Prefers the pre-generated ElevenLabs file at
// /audio/spelling/<word>.mp3; if that file isn't there yet (or fails to play),
// it falls back to the browser's built-in speech synthesis so the game still
// works before the audio has been generated.
//
// Returns a Promise that resolves once the word has finished playing (or
// immediately if no audio could be produced at all). Caches one Audio element
// per word so repeated "hear it again" taps are instant.
const audioCache = new Map();

function getAudio(word) {
  let audio = audioCache.get(word);
  if (!audio) {
    audio = new Audio(audioFileFor(word));
    audio.preload = 'auto';
    audioCache.set(word, audio);
  }
  return audio;
}

function browserSpeak(word) {
  return new Promise((resolve) => {
    const synth = typeof window !== 'undefined' && window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      resolve();
      return;
    }
    synth.cancel(); // stop anything mid-utterance
    const utter = new SpeechSynthesisUtterance(word);
    utter.rate = 0.85; // a touch slow so each sound is clear
    utter.pitch = 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    synth.speak(utter);
    // Safety net: some browsers never fire onend for short utterances.
    setTimeout(finish, 4000);
  });
}

export function speakWord(word) {
  if (!word) return Promise.resolve();
  const audio = getAudio(word);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fallback = () => {
      if (settled) return;
      browserSpeak(word).then(finish);
    };

    const onEnded = () => finish();
    const onError = () => fallback();
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });

    try {
      audio.currentTime = 0;
    } catch {
      /* not loaded yet — fine */
    }
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') {
      // play() rejects when the file is missing/blocked → use browser speech.
      playback.catch(fallback);
    }
  });
}

// Warm up the browser voice list (some engines load voices lazily, so the first
// utterance is silent unless we've nudged them). Safe to call on game start.
export function primeSpeech() {
  try {
    window.speechSynthesis?.getVoices();
  } catch {
    /* no-op */
  }
}
