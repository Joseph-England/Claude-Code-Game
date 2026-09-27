// Footstep synthesis (DESIGN §5, DECISIONS #73). Pure functions that return Float32Arrays, so the
// same code runs in the browser (audio.js wraps them in AudioBuffers) and in Node
// (tools/audio-check.mjs measures level and brightness).
//
// A step is a ground-reaction curve — a heel strike, then the roll onto the ball of the foot — and
// each surface turns that force into sound in its own way:
//   packed  the crust breaking: hundreds of tiny damped cracks in the 0.4–2 kHz band plus a low
//           body, so it crunches without hissing (user playtest: the old one was bright clicks)
//   powder  a soft low compression with a few muffled crunches and a faint spill of snow after
//   ice     a hard little tick and a short scrape with sparse glassy grit
//   rock    a boot heel on stone: a short dull knock (noise, never a tone — the old sine thud read
//           as a toy drum), grit crushed under the sole as it rolls, and a small toe scuff
// Every variant draws its timing, band and density from its own seed, and audio.js varies rate,
// level, pan and filter on every play, so no two steps are alike.

/** Park-Miller generator: returns () → [0, 1). */
export function rng(seed) {
  let r = (Math.floor(seed) % 2147483646) + 1;
  return () => (r = (r * 16807) % 2147483647) / 2147483647;
}

/** RBJ biquad (same formulas as Web Audio's BiquadFilterNode), applied in place. */
export function biquad(x, sr, type, f, q = 0.707, gainDb = 0) {
  const w = (2 * Math.PI * f) / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { // highshelf
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i], y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0;
  }
  return x;
}

/**
 * Perceived peak level of a one-shot: K-weighted (a gentle low cut and a +4 dB presence shelf,
 * like LUFS) RMS over the loudest 50 ms window, in dBFS.
 */
export function loudness(x, sr) {
  const k = biquad(biquad(Float32Array.from(x), sr, 'highpass', 60, 0.5), sr, 'highshelf', 1500, 0.707, 4);
  const win = Math.floor(0.05 * sr);
  let best = 0, acc = 0;
  for (let i = 0; i < k.length; i++) {
    acc += k[i] * k[i];
    if (i >= win) acc -= k[i - win] * k[i - win];
    if (i >= win - 1) best = Math.max(best, acc / win);
  }
  return 10 * Math.log10(best + 1e-12);
}

/** Spectral centroid (Hz) weighted by energy: a rough "how bright" number. */
export function centroid(x, sr) {
  const n = 1024;
  let num = 0, den = 0;
  for (let o = 0; o + n <= x.length; o += n / 2) {
    for (let b = 1; b < n / 2; b += 2) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n), a = (-2 * Math.PI * b * i) / n;
        re += x[o + i] * w * Math.cos(a); im += x[o + i] * w * Math.sin(a);
      }
      const p = re * re + im * im;
      num += p * (b * sr) / n; den += p;
    }
  }
  return num / (den || 1);
}

const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
const bump = (t, at, w) => Math.exp(-(((t - at) / w) ** 2));

/** Sum of short damped sinusoids ("cracks"): rate(t) grains/s, band [f0, f1] Hz, decay [d0, d1] s. */
function crackle(out, sr, R, rate, f0, f1, d0, d1, amp, shape = 2) {
  const dt = 1 / sr, n = out.length;
  for (let i = 0; i < n; i++) {
    if (R() >= rate(i * dt) * dt) continue;
    const f = f0 * Math.pow(f1 / f0, R()), tau = d0 + (d1 - d0) * R(), a = amp * Math.pow(R(), shape) * (R() < 0.5 ? -1 : 1);
    const len = Math.min(n - i, Math.ceil(tau * 5 * sr)), w = (6.283 * f) / sr;
    for (let j = 0; j < len; j++) out[i + j] += a * Math.exp(-j / (tau * sr)) * Math.sin(w * j); // from zero: no click
  }
}

/** White noise shaped by env(t), filtered. */
function shapedNoise(n, sr, R, envFn, filters) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (R() * 2 - 1) * envFn(i / sr);
  for (const [type, f, q] of filters) biquad(x, sr, type, f, q);
  return x;
}

function mix(out, x, g = 1) { for (let i = 0; i < out.length; i++) out[i] += x[i] * g; }

/**
 * One footstep. surface: 0 packed, 1 powder, 2 ice, 3 rock. weight: 1 a step, ~2.5 a landing.
 * Returns a Float32Array normalised to a per-surface loudness (see TARGET).
 */
export function footstep(surface, seed, sr, weight = 1) {
  const R = rng(seed * 7919 + surface * 131 + Math.round(weight * 17));
  const heavy = weight > 1;
  // The foot: heel at ~6 ms, the ball 60–110 ms later (quicker for a landing: both at once).
  const heel = 0.006 + 0.006 * R(), roll = heavy ? 0.03 + 0.02 * R() : 0.06 + 0.05 * R();
  const toeAmp = heavy ? 0.5 : 0.35 + 0.4 * R();
  const len = surface === 1 ? 0.42 : surface === 0 ? 0.34 : 0.26;
  const n = Math.floor(len * sr), out = new Float32Array(n);
  const force = (t, soft = 1) => env(t - heel + 0.006 * soft, 0.006 * soft, 0.035 * soft * weight) + toeAmp * bump(t, heel + roll, 0.03 * soft);

  if (surface === 0) {
    // Packed: the crunch. Dense cracks while the load comes on, big ones rarer and lower.
    const peak = 900 + 500 * R();
    crackle(out, sr, R, (t) => peak * Math.min(1.2, force(t)), 550, 2300 + 600 * R(), 0.0005, 0.0018, 0.4);
    crackle(out, sr, R, (t) => (force(t) > 0.3 ? 60 * force(t) : 0), 300, 800, 0.002, 0.005, 0.8, 3); // a few deeper cracks
    mix(out, shapedNoise(n, sr, R, (t) => force(t), [['lowpass', 260 + 120 * R(), 0.8]]), 0.55); // weight
    biquad(out, sr, 'lowpass', 3800 + 600 * R(), 0.6); // no hiss on top
  } else if (surface === 1) {
    // Powder: a soft low "whumpf" as the snow packs under the boot; a few muffled crunches; the
    // spill of loose snow off the boot just after.
    const soft = (t) => force(t, 2.2);
    mix(out, shapedNoise(n, sr, R, soft, [['lowpass', 320 + 280 * R(), 0.7], ['lowpass', 1400, 0.5]]), 2.2);
    crackle(out, sr, R, (t) => 260 * soft(t), 350, 1300, 0.0012, 0.0035, 0.22);
    const spillAt = heel + roll + 0.05 + 0.04 * R();
    mix(out, shapedNoise(n, sr, R, (t) => 0.5 * bump(t, spillAt, 0.06), [['bandpass', 1400 + 900 * R(), 0.9]]), 0.12);
  } else if (surface === 2) {
    // Ice: a hard tick, a short scrape and a little glassy grit.
    mix(out, shapedNoise(n, sr, R, (t) => env(t - heel, 0.0004, 0.003 * weight), [['highpass', 700, 0.7], ['lowpass', 6000, 0.7]]), 1.4);
    mix(out, shapedNoise(n, sr, R, (t) => 0.3 * bump(t, heel + roll * 0.7, 0.025), [['bandpass', 2400 + 1200 * R(), 1.2]]), 1);
    crackle(out, sr, R, (t) => 220 * force(t), 2000, 5500, 0.0003, 0.0008, 0.22);
    mix(out, shapedNoise(n, sr, R, (t) => force(t), [['lowpass', 350, 0.7]]), 0.5);
  } else {
    // Rock: heel knock (lowpassed noise, 1 ms attack, ~15 ms decay) and the boot's dull body; grit
    // crushed under the sole through the roll; a smaller knock and scuff at the toe.
    const knock = (t) => env(t - heel, 0.0008, 0.012 * weight) + 0.45 * env(t - heel - roll, 0.001, 0.01);
    mix(out, shapedNoise(n, sr, R, knock, [['lowpass', 1100 + 500 * R(), 0.7], ['lowpass', 2200, 0.6]]), 2.2);
    mix(out, shapedNoise(n, sr, R, (t) => env(t - heel, 0.002, 0.03 * weight), [['bandpass', 240 + 120 * R(), 0.9]]), 1.4);
    crackle(out, sr, R, (t) => 500 * bump(t, heel + roll * 0.5, roll * 0.7 + 0.01), 1200, 4200, 0.0002, 0.0008, 0.22, 2.5);
    mix(out, shapedNoise(n, sr, R, (t) => 0.35 * bump(t, heel + roll + 0.02, 0.018), [['bandpass', 900 + 700 * R(), 1.1]]), 1);
  }
  // Declick the tail and normalise to the surface's loudness.
  for (let i = 0; i < 256; i++) out[n - 1 - i] *= i / 256;
  const g = Math.pow(10, (TARGET[surface] + (heavy ? 6 : 0) - loudness(out, sr)) / 20);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// Per-surface loudness (dBFS, K-weighted peak 50 ms) before the per-play gain: powder is the
// softest, rock and packed the clearest.
export const TARGET = [-14, -17, -15, -14];
