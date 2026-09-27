// Seeded, deterministic noise (DESIGN §7 #2): value + simplex 2D, fBm, ridged multifractal and
// domain warping. Pure functions of (seed, x, y); identical in the browser, the worker and Node.

/** mulberry32: small fast seeded PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of a lattice point → [0, 1). */
function hash2(seed, i, j) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float64Array(16);
for (let k = 0; k < 8; k++) { GRAD[2 * k] = Math.cos((k * Math.PI) / 4); GRAD[2 * k + 1] = Math.sin((k * Math.PI) / 4); }

/** A seeded noise source. Every method returns roughly [-1, 1] unless noted. */
export class Noise {
  constructor(seed = 1) {
    this.seed = seed | 0;
    const r = rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Smooth (quintic) value noise in [-1, 1]. */
  value(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const s = this.seed;
    const a = hash2(s, i, j), b = hash2(s, i + 1, j), c = hash2(s, i, j + 1), d = hash2(s, i + 1, j + 1);
    return 2 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) - 1;
  }

  /** 2D simplex noise in about [-1, 1]. */
  simplex(x, y) {
    const perm = this.perm;
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = (perm[ii + perm[jj]] & 7) * 2; t0 *= t0; n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = (perm[ii + i1 + perm[jj + j1]] & 7) * 2; t1 *= t1; n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = (perm[ii + 1 + perm[jj + 1]] & 7) * 2; t2 *= t2; n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2); }
    return 70 * n;
  }

  /** Fractal Brownian motion of simplex noise, normalised to about [-1, 1]. */
  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.simplex(x, y);
      norm += amp;
      amp *= gain;
      // Rotate each octave a little so lattice artefacts don't line up.
      const nx = (x * 0.8 - y * 0.6) * lacunarity, ny = (x * 0.6 + y * 0.8) * lacunarity;
      x = nx + 17.3; y = ny - 9.1;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal (Musgrave): sharp crests where the noise crosses zero; each octave is
   * weighted by the previous one so detail gathers on the ridges and valleys stay smooth. [0, ~1].
   */
  ridged(x, y, octaves = 6, lacunarity = 2, gain = 0.5, offset = 1) {
    let sum = 0, amp = 0.5, weight = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = offset - Math.abs(this.simplex(x, y));
      n *= n * weight;
      weight = Math.min(1, Math.max(0, n * 2));
      sum += n * amp;
      norm += amp;
      amp *= gain;
      const nx = (x * 0.8 - y * 0.6) * lacunarity, ny = (x * 0.6 + y * 0.8) * lacunarity;
      x = nx + 31.7; y = ny + 5.3;
    }
    return sum / norm;
  }

  /**
   * Domain warp: offsets (x, y) by a vector fBm field of the given strength (same units as x, y),
   * writing the warped coordinates to out[0], out[1]. Folds ridges into natural-looking curves.
   */
  warp(x, y, strength, octaves = 3, out = [0, 0]) {
    out[0] = x + strength * this.fbm(x + 5.2, y + 1.3, octaves);
    out[1] = y + strength * this.fbm(x - 8.3, y + 2.8, octaves);
    return out;
  }
}
