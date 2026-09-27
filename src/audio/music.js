// Generative score (DESIGN §5): slow pad chords (detuned triangle + saw through a lowpass) and a
// sparse FM "glass piano" that plays notes and short rising phrases from the current scale. Each
// mood (a section, plus the climb out of the hollow) has its own chords, brightness, loudness and
// note density, and the harmony moves from D minor through suspended chords to an unresolved
// D major add9 at the summit. Thin in the whiteout, nearly silent where the path goes down.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const DM = [50, 53, 55, 57, 60, 62, 65, 67, 69, 72]; // D minor pentatonic
const FM = [53, 55, 57, 60, 62, 65, 67, 69, 72, 74]; // F major pentatonic
const BB = [50, 53, 55, 58, 60, 62, 65, 67, 70, 72]; // Bb major pentatonic
const DMAJ = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71]; // D major pentatonic

// [chords, scale, pad gain, lowpass Hz, seconds per chord, motif notes/s]
const MOODS = [
  [[[38, 45, 52]], DM, 0.45, 520, 16, 0.04], // 0 Opening: a hollow fifth and ninth
  [[[38, 45, 52, 57], [34, 41, 50, 57], [41, 48, 57, 60], [36, 43, 50, 55]], DM, 0.7, 800, 10, 0.12], // 1 The Foot
  [[[38, 45, 50, 53], [34, 41, 50, 53], [31, 43, 50, 53], [33, 45, 52, 55]], DM, 0.6, 650, 10, 0.07], // 2 Powder: effort
  [[[41, 48, 57, 64], [36, 48, 55, 62], [38, 50, 57, 65], [34, 46, 53, 62]], FM, 0.85, 1600, 7, 0.45], // 3 Chutes: joy
  [[[38, 50, 53, 57], [36, 48, 52, 55], [34, 50, 53, 57], [33, 48, 52, 57]], DM, 0.7, 1000, 8, 0.14], // 4 Ridge
  [[[38, 45]], DM, 0.2, 380, 16, 0.025], // 5 The Descent: almost nothing
  [[[33, 40, 47]], DM, 0.3, 420, 16, 0.03], // 6 Whiteout: cold and thin
  [[[34, 46, 53, 57, 62], [41, 48, 57, 64], [31, 46, 50, 57], [36, 48, 55, 64]], BB, 0.8, 1300, 8, 0.24], // 7 Summit push
  [[[38, 50, 54, 57, 64], [43, 50, 55, 59, 64]], DMAJ, 0.85, 1500, 13, 0.16], // 8 Summit: D add9 ↔ G maj7
  [[[34, 46, 53, 62], [41, 48, 57, 60], [36, 48, 55, 62]], BB, 0.6, 950, 9, 0.12], // 9 Climbing out of the hollow
];

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(out);
    this.mood = -1;
    this.chordT = 0;
    this.chordI = 0;
    this.voices = [];
    this.motifT = 3;
    this.level = 1; // overall level (the ending and credits fade it)
  }

  get scale() { return MOODS[Math.max(0, this.mood)][1]; }

  /** A note for a "You" bell, from the current scale (upper octave). */
  bellNote() { const s = this.scale; return mtof(s[5 + Math.floor(Math.random() * 4)]); }

  chord(notes, gain, cutoff, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * 0.05 / Math.sqrt(notes.length), t + 3.5);
    lp.connect(g); g.connect(this.out);
    const oscs = [];
    for (const m of notes) {
      for (const [type, cents, amp] of [['triangle', -6, 1], ['sawtooth', 7, 0.35]]) {
        const o = ctx.createOscillator(), a = ctx.createGain();
        o.type = type; o.frequency.value = mtof(m); o.detune.value = cents + (Math.random() - 0.5) * 4;
        a.gain.value = amp;
        o.connect(a); a.connect(lp); o.start(t);
        oscs.push(o);
      }
    }
    // Release the previous chord as this one swells in.
    for (const v of this.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0.0001, t + 4.5);
      for (const o of v.oscs) o.stop(t + 4.6);
    }
    this.voices = [{ g, oscs }];
    this.chordDur = dur;
  }

  /** One FM glass note. */
  note(m, when = 0, gain = 0.08) {
    const ctx = this.ctx, t = ctx.currentTime + when, f = mtof(m);
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(), p = ctx.createStereoPanner();
    car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.3, t); mg.gain.exponentialRampToValueAtTime(f * 0.01, t + 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    p.pan.value = (Math.random() - 0.5) * 0.8;
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(p); p.connect(this.out);
    car.start(t); mod.start(t); car.stop(t + 3.1); mod.stop(t + 3.1);
  }

  /** A short rising phrase, as the motif grows. */
  phrase() {
    const s = this.scale, start = Math.floor(Math.random() * 4), len = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < len; i++) this.note(s[Math.min(s.length - 1, start + i + (i > 2 ? 1 : 0))] + 12 * (Math.random() < 0.2), i * 0.42, 0.07 - i * 0.006);
  }

  /** Swell into the last chord (the final line). */
  resolve() {
    const [chords, , gain, cutoff] = MOODS[8];
    this.chord(chords[0], gain * 1.25, cutoff * 1.4, 60);
    this.chordT = -60;
    this.phrase();
  }

  update(dt, s) {
    const t = this.ctx.currentTime;
    const mood = s.mood ?? 0;
    this.out.gain.setTargetAtTime(this.level * (s.musicDuck ?? 1), t, 1.5);
    if (mood !== this.mood) {
      this.mood = mood;
      this.chordI = 0;
      this.chordT = 1e9; // change chord now
      this.motifT = 2 + Math.random() * 3;
    }
    const [chords, scale, gain, cutoff, dur, rate] = MOODS[mood];
    if ((this.chordT += dt) >= (this.chordDur ?? dur)) {
      this.chordT = 0;
      this.chord(chords[this.chordI++ % chords.length], gain, cutoff, dur);
    }
    if ((this.motifT -= dt) <= 0) {
      if (Math.random() < 0.25 && rate > 0.1) this.phrase();
      else this.note(scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.25 ? 12 : 0));
      this.motifT = -Math.log(1 - Math.random() * 0.95) / rate + 0.6; // Poisson spacing
    }
  }
}
