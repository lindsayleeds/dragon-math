export class SoundEffects {
  constructor() {
    this.audioContext = null;
  }

  getAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioContext;
  }

  playCorrect() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;
    const duration = 0.4;

    // Two ascending tones for success
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.frequency.setValueAtTime(523, now); // C5
    osc1.frequency.setValueAtTime(659, now + 0.15); // E5
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc1.start(now);
    osc1.stop(now + duration);
  }

  playWrong() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;
    const duration = 0.4;

    // Buzzy wrong answer sound - louder and more noticeable
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Buzzy tone that drops
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.setValueAtTime(150, now + 0.2);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  playSplash() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;
    const duration = 0.5;

    // Filtered white-noise burst that sweeps down = a watery "sploosh".
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // fade out
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + duration);
    filter.Q.value = 0.8;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);

    // A low "bloop" for the plunge underneath the splash.
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.25);
    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playWin() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;

    // A bright rising fanfare — a C-major arpeggio that lands on a held high C
    // chord, for the "you crossed the river!" celebration.
    const notes = [
      { freq: 523, at: 0.0 }, // C5
      { freq: 659, at: 0.12 }, // E5
      { freq: 784, at: 0.24 }, // G5
      { freq: 1047, at: 0.36 }, // C6
    ];
    for (const { freq, at } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.3, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, now + at + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.4);
    }

    // A sparkly held triad to cap it off after the arpeggio.
    const chordAt = now + 0.5;
    for (const freq of [523, 659, 784, 1047]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, chordAt);
      gain.gain.setValueAtTime(0.0001, chordAt);
      gain.gain.exponentialRampToValueAtTime(0.18, chordAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, chordAt + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(chordAt);
      osc.stop(chordAt + 1.0);
    }
  }

  playCollision() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;
    const duration = 0.25;

    // Short buzzy tone for enemy collision
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(110, now); // A2
    osc.frequency.exponentialRampToValueAtTime(55, now + duration); // Drop to A1
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  // The classic "wah-wah-wah-waaah" sad trombone, played when a monster
  // catches the muncher: four descending brassy notes, each sliding downward,
  // with the last one held and drooping the furthest.
  playCaught() {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;

    const notes = [
      { start: 0.0, dur: 0.32, from: 311, to: 277 }, // Eb4 → Db4
      { start: 0.34, dur: 0.32, from: 277, to: 247 }, // Db4 → B3
      { start: 0.68, dur: 0.32, from: 247, to: 220 }, // B3  → A3
      { start: 1.02, dur: 0.75, from: 220, to: 165 }, // A3  → E3 (the big droop)
    ];

    for (const { start, dur, from, to } of notes) {
      const t = now + start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Sawtooth gives the brassy buzz of a trombone...
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.linearRampToValueAtTime(to, t + dur);

      // ...and a lowpass that closes over each note rounds it into a "wah".
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, t);
      filter.frequency.exponentialRampToValueAtTime(650, t + dur);
      filter.Q.value = 4;

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
      gain.gain.setValueAtTime(0.3, t + dur - 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }
}

export const soundEffects = new SoundEffects();
