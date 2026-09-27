// Procedural Web Audio (DESIGN §5, DECISIONS #23): no sample files. Everything below is built from
// noise and oscillators at startup: a master chain, two convolution reverbs with generated impulse
// responses (open air, and a close "sheltered" space for the hollow and the whiteout), bells under
// the inner-voice lines, wind that follows altitude, speed and gusts, surface-aware footsteps,
// landings, a slide hiss, breath, and the generative score (music.js).
import { Music } from './music.js';
import { footstep } from './steps.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** Stereo impulse response: decaying noise that darkens as it decays, with a few early reflections. */
function impulse(ctx, seconds, decay, bright, seed = 1) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      const k = bright * Math.exp(-t * 2.5) + 0.02; // one-pole lowpass that closes over time
      lp += (rand() - lp) * k;
      d[i] = lp * Math.exp(-t / decay) * (t < 0.004 ? t / 0.004 : 1);
    }
    for (let e = 0; e < 6; e++) d[Math.floor((0.01 + 0.012 * e + 0.004 * c) * ctx.sampleRate)] += 0.4 * Math.exp(-e * 0.5) * (e % 2 ? -1 : 1);
  }
  return buf;
}

/** Mono noise buffer: white, pink (Voss-McCartney-ish) or brown. */
function noise(ctx, seconds, kind, seed = 7) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let r = seed, b0 = 0, b1 = 0, b2 = 0, br = 0;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const w = rand();
    if (kind === 'pink') { b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w; d[i] = (b0 + b1 + b2 + 0.02 * w) * 1.6; }
    else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.2; }
    else d[i] = w;
  }
  return buf;
}

/** Render a short one-shot into a buffer: fn(t, rand) → sample. */
function oneShot(ctx, seconds, fn, seed) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const state = {};
  for (let i = 0; i < n; i++) d[i] = fn(i / ctx.sampleRate, rand, state);
  return buf;
}

/** AudioBuffer from a Float32Array. */
function toBuffer(ctx, data) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

export class Audio {
  constructor() { this.ctx = null; this.state = {}; }

  /** Create (or resume) the audio graph. Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const g = (v, to) => { const n = ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; };
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(ctx.destination);
    this.master = g(0, comp);
    this.master.gain.setTargetAtTime(1.6, ctx.currentTime, 1.5);
    // Reverbs: a long open-air tail for music and voices, a close dark room for "sheltered" spaces.
    this.open = ctx.createConvolver(); this.open.buffer = impulse(ctx, 4.5, 1.3, 0.5, 3); this.open.connect(g(0.8, this.master));
    this.near = ctx.createConvolver(); this.near.buffer = impulse(ctx, 1.4, 0.35, 0.25, 5); this.nearOut = g(0, this.master); this.near.connect(this.nearOut);
    this.sfx = g(0.8, this.master); this.sfx.connect(g(0.1, this.open)); this.sfx.connect(g(0.5, this.near));
    this.voice = g(0.5, this.master); this.voice.connect(g(0.7, this.open));
    this.musicBus = g(0.55, this.master); this.musicBus.connect(g(0.9, this.open));
    this.buf = { white: noise(ctx, 2, 'white', 11), pink: noise(ctx, 6, 'pink', 13), brown: noise(ctx, 6, 'brown', 17) };
    // Footsteps (steps.js): 8 variations per surface, plus 3 heavier ones per surface for landings.
    this.steps = [0, 1, 2, 3].map((srf) => Array.from({ length: 8 }, (_, v) => toBuffer(ctx, footstep(srf, v + 1, ctx.sampleRate))));
    this.lands = [0, 1, 2, 3].map((srf) => Array.from({ length: 3 }, (_, v) => toBuffer(ctx, footstep(srf, v + 21, ctx.sampleRate, 2.5))));
    this.lastStep = [-1, -1, -1, -1];
    this.breathBuf = [0, 1].map((k) => oneShot(ctx, 1.1, (t, rand, s) => {
      s.b = (s.b ?? 0) + (rand() - (s.b ?? 0)) * 0.12;
      const e = k === 0 ? Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 2 * (t < 0.9 ? 1 : 0) : Math.min(1, t / 0.06) * Math.exp(-t / 0.28);
      return s.b * e * 1.4;
    }, 23 + k));
    this.initWind();
    this.initSlide();
    this.music = new Music(ctx, this.musicBus);
  }

  loop(buffer, to, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = 0; s.loopEnd = buffer.duration;
    s.connect(to);
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  // --- Wind: looped pink noise through a low rumble, a soft whistle band and a high hiss; a gust
  // layer (a deep roar and a broad rush, with turbulence) that you hear coming; and the storm's
  // howl for the gap (DECISIONS #73). Level motion comes from per-frame turbulence, not from
  // sweeping narrow filters (the old gust was one narrow band sliding up: a synthetic "shhh").
  initWind() {
    const ctx = this.ctx, out = ctx.createGain();
    out.connect(this.master);
    const band = (type, f, q, pan, rate = 1) => {
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      this.loop(this.buf.pink, flt, rate * (1 + 0.07 * pan)); flt.connect(gain); gain.connect(p); p.connect(out);
      return { flt, gain, p };
    };
    this.wind = {
      out, rumble: band('lowpass', 380, 0.7, -0.3), whistle: band('bandpass', 900, 3.5, 0.35), hiss: band('highpass', 3200, 0.5, 0),
      roar: band('lowpass', 300, 0.6, 0, 0.93), rush: band('bandpass', 900, 0.6, 0, 1.11),
      howl: [band('bandpass', 290, 5, -0.4, 0.97), band('bandpass', 430, 5, 0.4, 1.03)],
      drift: 0, gustEnv: 0, turb: 0,
    };
  }

  initSlide() {
    const ctx = this.ctx, flt = ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 1200; flt.Q.value = 1;
    const gain = ctx.createGain(); gain.gain.value = 0;
    this.loop(this.buf.white, flt); flt.connect(gain); gain.connect(this.sfx);
    this.slide = { flt, gain };
  }

  play(buffer, gain = 1, rate = 1, to = this.sfx, when = 0) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buffer; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); g.connect(to);
    s.start(this.ctx.currentTime + when);
  }

  /**
   * One step. No two alike: a different variation than last time, and on every play a little
   * change of rate (pitch and length), level, pan (toward the foot) and a random presence dip or
   * lift, so a walk never sounds like a loop (user playtest: powder was too repetitive).
   */
  footstep(surface, speed, side = 0) {
    if (!this.ctx) return;
    const v = this.steps[surface] ?? this.steps[0];
    let k = Math.floor(Math.random() * v.length);
    if (k === this.lastStep[surface]) k = (k + 1 + Math.floor(Math.random() * (v.length - 1))) % v.length;
    this.lastStep[surface] = k;
    const sprint = clamp((speed - 5) / 4);
    const gain = (0.45 + 0.02 * Math.min(speed, 9)) * Math.pow(10, (Math.random() - 0.5) * 0.15);
    this.shaped(v[k], gain, 0.94 + Math.random() * 0.12 + 0.04 * sprint, side * 0.07 + (Math.random() - 0.5) * 0.06);
  }

  /** Play a one-shot through a random peaking filter (±3 dB at 0.5–2.5 kHz) and a panner. */
  shaped(buffer, gain, rate, pan) {
    const ctx = this.ctx, s = ctx.createBufferSource(), eq = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = buffer; s.playbackRate.value = rate;
    eq.type = 'peaking'; eq.frequency.value = 500 * Math.pow(5, Math.random()); eq.Q.value = 1; eq.gain.value = (Math.random() - 0.5) * 6;
    g.gain.value = gain; p.pan.value = pan;
    s.connect(eq); eq.connect(g); g.connect(p); p.connect(this.sfx);
    s.start();
  }

  land(surface, impact) {
    if (!this.ctx || impact < 1.5) return;
    const k = clamp(impact / 12);
    const v = this.lands[surface] ?? this.lands[0];
    this.shaped(v[Math.floor(Math.random() * v.length)], 0.3 + 0.5 * k, 0.92 + Math.random() * 0.08 - 0.08 * k, 0);
    if (impact > 7) this.breath(1, 0.7);
  }

  breath(kind = 0, gain = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.breathBuf[kind]; s.playbackRate.value = 0.9 + Math.random() * 0.15;
    f.type = 'bandpass'; f.frequency.value = kind ? 1300 : 900; f.Q.value = 0.8;
    g.gain.value = gain * 0.35;
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start();
  }

  /** A few pebbles knocking: leaving a stone on the cairn. */
  stone() {
    if (!this.ctx) return;
    this.play(this.steps[3][1], 0.6, 1.7);
    this.play(this.steps[3][4], 0.35, 1.9, this.sfx, 0.14);
  }

  /** Soft FM bell under each inner-voice line: the Weight low and dull, You warm, notes bright. */
  bell(voice) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const spec = voice === 'W' ? { f: 73.4, ratio: 1.41, index: 2.2, decay: 4, gain: 0.5, lp: 700 }
      : voice[0] === 'O' ? { f: voice === 'O' ? 1174.7 : 1760, ratio: 2, index: 0.8, decay: 2.2, gain: 0.1, lp: 6000 }
        : { f: this.music ? this.music.bellNote() : 440, ratio: 3.5, index: 1.1, decay: 3.2, gain: 0.2, lp: 4000 };
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    car.frequency.value = spec.f; mod.frequency.value = spec.f * spec.ratio;
    mg.gain.setValueAtTime(spec.f * spec.index, t); mg.gain.exponentialRampToValueAtTime(spec.f * 0.02, t + spec.decay * 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(spec.gain, t + (voice === 'W' ? 0.25 : 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay);
    lp.type = 'lowpass'; lp.frequency.value = spec.lp;
    mod.connect(mg); mg.connect(car.frequency); car.connect(lp); lp.connect(g); g.connect(this.voice);
    car.start(t); mod.start(t); car.stop(t + spec.decay + 0.1); mod.stop(t + spec.decay + 0.1);
    if (voice === 'O') setTimeout(() => this.bell('O2'), 180);
  }

  /**
   * Per frame. s: { alt 0…1, speed, airSpeed, sliding, grounded, surface, gust, gustSide −1…1,
   * gustWarn, whiteout (the storm here), stormNear 0…1 (the gap ahead), shelter 0…1, section,
   * calm 0…1 (the ending), sprinting, powder }.
   */
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, W = this.wind, set = (p, v, tc = 0.25) => p.setTargetAtTime(v, t, tc);
    const quiet = 1 - 0.55 * s.shelter, calm = 1 - 0.8 * s.calm, storm = s.whiteout, near = s.stormNear ?? 0;
    W.drift += (Math.random() - 0.5) * dt * 2;
    W.drift *= 1 - dt * 0.3;
    // Turbulence: slow swells in the bed, a faster flutter inside gusts and the storm.
    const tt = this.ctx.currentTime;
    const swell = 0.5 + 0.3 * Math.sin(tt * 0.31) + 0.2 * Math.sin(tt * 0.83 + 1.7);
    W.turb += ((Math.random() - 0.5) * 2 - W.turb) * Math.min(1, dt * 7);
    const flutter = 1 + 0.25 * W.turb + 0.12 * Math.sin(tt * 5.3) + 0.08 * Math.sin(tt * 8.9 + 2);
    // Base: altitude, the gap's roar growing as you climb toward it (heard, muffled, before you're in).
    const base = (0.05 + 0.2 * s.alt) * quiet * calm * (0.8 + 0.4 * swell);
    set(W.rumble.gain.gain, base * (1 + 0.9 * storm + 0.8 * near) * (1 + 0.15 * W.drift), 0.6);
    set(W.rumble.flt.frequency, 280 + 180 * s.alt + 220 * storm + 60 * near);
    const air = Math.min(s.airSpeed, 30);
    set(W.whistle.gain.gain, (0.003 + 0.0022 * air + 0.007 * s.alt + 0.012 * storm) * quiet * calm, 0.4);
    set(W.whistle.flt.frequency, 480 + 40 * air + 160 * W.drift + 250 * s.alt, 0.6);
    set(W.hiss.gain.gain, (0.008 + 0.045 * storm + 0.0015 * air) * quiet * calm * flutter, 0.3);
    set(W.whistle.p.pan, 0.4 * Math.sin(tt * 0.13), 1);
    // Gusts: the envelope rises slowly from the warning (you hear it coming across the slope),
    // peaks with the push, and dies away over ~2 s after it, with turbulence all through.
    const want = Math.max(s.gust, s.gustWarn ? 0.3 : 0);
    W.gustEnv += (want - W.gustEnv) * Math.min(1, dt * (want > W.gustEnv ? 2.6 : 0.9));
    const ge = W.gustEnv * calm;
    set(W.roar.gain.gain, 0.16 * ge * flutter, 0.08);
    set(W.roar.flt.frequency, 260 + 500 * ge, 0.2);
    set(W.rush.gain.gain, 0.18 * ge * ge * flutter, 0.08);
    set(W.rush.flt.frequency, 650 + 700 * ge + 120 * W.turb, 0.15);
    // The gust comes from upwind: panned that way while it builds, round you at its peak.
    const pan = clamp(-0.6 * s.gustSide * (1 - 0.6 * clamp(s.gust)), -1, 1);
    set(W.roar.p.pan, pan, 0.4); set(W.rush.p.pan, pan * 0.7, 0.4);
    // The storm's howl: two soft resonances wandering in pitch.
    W.howl.forEach((h, i) => {
      set(h.gain.gain, 0.22 * (storm + 0.25 * near) * calm * (0.7 + 0.5 * (i ? swell : 1 - swell)) * flutter, 0.3);
      set(h.flt.frequency, (i ? 430 : 290) * (1 + 0.12 * Math.sin(tt * (0.21 + 0.07 * i) + i * 2) + 0.05 * W.drift), 0.5);
    });
    // Slide hiss: speed and surface.
    const sl = this.slide, on = s.sliding && s.grounded;
    const f = [1300, 600, 2600, 900][s.surface] ?? 1200, q = [1, 0.7, 2.2, 1.4][s.surface] ?? 1;
    set(sl.gain.gain, on ? clamp(s.speed / 18) * (s.surface === 1 ? 0.35 : 0.22) : 0, on ? 0.05 : 0.12);
    set(sl.flt.frequency, f * (0.7 + 0.03 * Math.min(s.speed, 25)), 0.1);
    sl.flt.Q.value = q;
    // Breathing: effort in powder and when sprinting uphill; calm, slow breaths while sitting.
    this.breathT = (this.breathT ?? 2) - dt;
    if (this.breathT <= 0) {
      const effort = s.grounded && !s.sliding && (s.powder || s.sprinting) && s.speed > 2;
      if (effort) { this.breath(this.breathK = 1 - (this.breathK ?? 0), 0.45); this.breathT = 0.9 + Math.random() * 0.3; }
      else if (s.sitting) { this.breath(this.breathK = 1 - (this.breathK ?? 0), 0.25); this.breathT = 2.2 + Math.random() * 0.6; }
      else this.breathT = 0.5;
    }
    set(this.nearOut.gain, 0.5 * Math.max(s.shelter, s.whiteout * 0.7), 1);
    this.music.update(dt, s);
  }
}
