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
}

export const soundEffects = new SoundEffects();
