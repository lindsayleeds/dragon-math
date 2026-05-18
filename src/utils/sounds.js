// Synthesized battle SFX via Web Audio API — no asset files, no network.
// Yip: short, bright, rising chirp (player got it right).
// Growl: low, gnarly rumble with vibrato (the dragon scored).

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Some browsers suspend the context until a user gesture; resume is a no-op
  // if it's already running.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function playYip() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Two quick chirps — second a touch higher, like a happy puppy yip.
  const chirp = (start, f0, f1, dur, gain) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  };

  chirp(now,        700, 1300, 0.10, 0.22);
  chirp(now + 0.09, 900, 1600, 0.12, 0.20);
}

export function playGrowl() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const dur = 0.55;

  // Sawtooth body, low frequency, with an LFO wobbling the pitch for a growly
  // character. A lowpass filter takes the edge off so it sounds rumbly, not buzzy.
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(95, now);
  osc.frequency.linearRampToValueAtTime(70, now + dur);

  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 22;       // vibrato rate
  lfoGain.gain.value = 14;        // vibrato depth in Hz
  lfo.connect(lfoGain).connect(osc.frequency);

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 6;

  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.32, now + 0.05);
  g.gain.linearRampToValueAtTime(0.22, now + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(filter).connect(g).connect(ac.destination);
  osc.start(now);
  lfo.start(now);
  osc.stop(now + dur + 0.02);
  lfo.stop(now + dur + 0.02);
}

export function playVictory() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Triumphant fanfare: C5 - E5 - G5 - C6 arpeggio with a sustained final chord.
  const notes = [
    { f: 523.25, t: 0.00, d: 0.18 }, // C5
    { f: 659.25, t: 0.12, d: 0.18 }, // E5
    { f: 783.99, t: 0.24, d: 0.18 }, // G5
    { f: 1046.5, t: 0.36, d: 0.60 }, // C6 (held)
  ];
  notes.forEach(({ f, t, d }) => {
    const start = now + t;
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = f;
    osc2.frequency.value = f * 2; // bright octave overtone
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.22, start + 0.02);
    g.gain.linearRampToValueAtTime(0.18, start + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    const overtone = ac.createGain();
    overtone.gain.value = 0.08;
    osc.connect(g).connect(ac.destination);
    osc2.connect(overtone).connect(g);
    osc.start(start);
    osc2.start(start);
    osc.stop(start + d + 0.02);
    osc2.stop(start + d + 0.02);
  });

  // Applause-like crackle: filtered white noise burst that swells then fades.
  const applauseStart = now + 0.30;
  const applauseDur = 0.9;
  const bufSize = Math.floor(ac.sampleRate * applauseDur);
  const noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    // Sparse "claps" — random spikes layered over softer noise sound like a crowd.
    const spike = Math.random() < 0.012 ? (Math.random() * 2 - 1) : 0;
    data[i] = (Math.random() * 2 - 1) * 0.25 + spike * 0.9;
  }
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseFilter = ac.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2400;
  noiseFilter.Q.value = 0.7;
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0, applauseStart);
  noiseGain.gain.linearRampToValueAtTime(0.18, applauseStart + 0.15);
  noiseGain.gain.linearRampToValueAtTime(0.14, applauseStart + applauseDur - 0.2);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, applauseStart + applauseDur);
  noise.connect(noiseFilter).connect(noiseGain).connect(ac.destination);
  noise.start(applauseStart);
  noise.stop(applauseStart + applauseDur + 0.02);
}

export function playDefeat() {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Classic "sad trombone" descending wah-wah-wah-waaah.
  const notes = [
    { f: 392.00, t: 0.00, d: 0.22 }, // G4
    { f: 369.99, t: 0.22, d: 0.22 }, // F#4
    { f: 349.23, t: 0.44, d: 0.22 }, // F4
    { f: 311.13, t: 0.66, d: 0.85 }, // Eb4 (held, droopy)
  ];
  notes.forEach(({ f, t, d }, i) => {
    const start = now + t;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    // Slight downward bend on the final long note for the "waaah" droop.
    if (i === notes.length - 1) {
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.linearRampToValueAtTime(f * 0.88, start + d);
    } else {
      osc.frequency.value = f;
    }
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.24, start + 0.03);
    g.gain.linearRampToValueAtTime(0.20, start + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(filter).connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + d + 0.02);
  });
}
