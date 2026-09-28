// The distant ranges (render only; DECISIONS #88). Real ranges get their look from rivers and
// glaciers cutting into rock that is being pushed up: valleys branch like trees, ridges run
// between them and rise to peaks, and a massif's peaks are joined by its divides. Noise alone gave
// "an erratic mess of up and down zig zags" (user playtest), so the ranges are grown instead with
// the stream-power law of landscape evolution (Braun & Willett 2013, "FastScape"):
//     ∂h/∂t = U − K·A^m·S
// U is uplift (a ring of ranges around the valley, some massifs higher), A the upstream drainage
// area and S the slope along the flow. Each step: uplift; route every cell to its steepest
// downhill neighbour (a pit spills to its lowest neighbour); order cells from the outlets upstream
// by walking the receiver tree; accumulate drainage area downstream; erode implicitly upstream
// (unconditionally stable). A slope limit then trims ridge crests to rock angles, and a little
// ridged detail roughens the faces. Deterministic; ~0.3 s for 257².
import { Noise, rng } from './noise.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @returns Float32Array n×n heights over a size × size square centred on the origin.
 * opts: { n, size, seed, valley (outlet height), inner (radius kept at the valley floor),
 *         relief (target height of the highest peak above the valley), iterations }
 */
export function generateRanges({ n = 257, size = 14000, seed = 7, valley = -150, inner = 900, relief = 2300, iterations = 140, sunAz = (248 * Math.PI) / 180 } = {}) {
  const N = n * n, cell = size / (n - 1), origin = -size / 2;
  const noise = new Noise(seed), rand = rng(seed * 31 + 7);
  const h = new Float32Array(N), U = new Float32Array(N), fixed = new Uint8Array(N);
  const warp = [0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = origin + i * cell, z = origin + j * cell, r = Math.hypot(x, z);
      const border = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      fixed[k] = border || r < inner ? 1 : 0;
      // Uplift: ranges from ~1.5 km out, modest close to the valley and higher with distance, so
      // from the summit they recede in layers (range after range) instead of standing as a wall;
      // massifs where a low-frequency field is high.
      noise.warp(x / 5200, z / 5200, 0.6, 2, warp);
      const massif = 0.3 + 0.7 * smooth(-0.35, 0.55, noise.fbm(warp[0] + 4.1, warp[1] - 2.3, 3));
      const ring = smooth(inner + 300, 2400, r) * (0.35 + 0.65 * smooth(2200, 5200, r));
      // Toward the setting sun (azimuth `sunAz`, clockwise from north) the ranges part into lower,
      // farther layers, so from the summit the sun goes down behind a distant range, not a wall.
      const az = Math.atan2(x, -z), dAz = Math.atan2(Math.sin(az - sunAz), Math.cos(az - sunAz));
      const sector = 1 - 0.8 * Math.exp(-((dAz / 0.5) ** 2));
      U[k] = fixed[k] ? 0 : ring * massif * sector;
      h[k] = fixed[k] ? 0 : rand() * 4 + 0.002 * (r - inner);
    }
  }
  // Neighbour offsets (8-connected) as flat index steps, and distances. Border cells are fixed, so
  // every free cell has all eight neighbours.
  const off = [], dst = new Float32Array(8), step = new Int32Array(8);
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) { step[off.length] = a + b * n; dst[off.length] = Math.hypot(a, b) * cell; off.push([a, b]); }
  const rec = new Int32Array(N), rd = new Float32Array(N), A = new Float32Array(N), stack = new Int32Array(N);
  const cnt = new Int32Array(N + 1), donors = new Int32Array(N), fill = new Int32Array(N);
  const m = 0.45, dt = 18, K = 1 / 30, area = cell * cell, Kdt = K * dt;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < N; k++) if (!fixed[k]) h[k] += U[k] * dt;
    // Receivers.
    for (let k = 0; k < N; k++) {
      if (fixed[k]) { rec[k] = k; rd[k] = 1; continue; }
      const hk = h[k];
      let best = 0, br = -1, bd = 1, low = Infinity, lr = k, ld = 1;
      for (let q = 0; q < 8; q++) {
        const kk = k + step[q], hh = h[kk], s = (hk - hh) / dst[q];
        if (s > best) { best = s; br = kk; bd = dst[q]; }
        if (hh < low) { low = hh; lr = kk; ld = dst[q]; }
      }
      if (br >= 0) { rec[k] = br; rd[k] = bd; } else { rec[k] = lr; rd[k] = ld; } // a pit spills
    }
    // Donor lists (CSR), then the stack: outlets first, each cell after its receiver.
    cnt.fill(0);
    for (let k = 0; k < N; k++) if (rec[k] !== k) cnt[rec[k] + 1]++;
    for (let k = 0; k < N; k++) cnt[k + 1] += cnt[k];
    fill.set(cnt.subarray(0, N));
    for (let k = 0; k < N; k++) if (rec[k] !== k) donors[fill[rec[k]]++] = k;
    let top = 0;
    for (let k = 0; k < N; k++) if (fixed[k]) stack[top++] = k;
    for (let s = 0; s < top; s++) {
      const k = stack[s];
      for (let d = cnt[k]; d < cnt[k + 1]; d++) stack[top++] = donors[d];
    }
    // Drainage area, downstream; erosion, upstream (implicit, n = 1).
    for (let s = 0; s < top; s++) A[stack[s]] = area;
    for (let s = top - 1; s >= 0; s--) { const k = stack[s]; if (rec[k] !== k) A[rec[k]] += A[k]; }
    for (let s = 0; s < top; s++) {
      const k = stack[s];
      if (fixed[k]) continue;
      const F = (Kdt * Math.exp(m * Math.log(A[k]))) / rd[k];
      h[k] = (h[k] + F * h[rec[k]]) / (1 + F);
    }
  }
  // Scale to the target relief, trim crests steeper than rock can hold, add a little texture.
  let hmax = 0;
  for (let k = 0; k < N; k++) hmax = Math.max(hmax, h[k]);
  const scale = relief / (hmax || 1);
  for (let k = 0; k < N; k++) h[k] *= scale;
  const maxDrop = Math.tan((58 * Math.PI) / 180) * cell;
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        let lo = Infinity;
        for (let q = 0; q < 8; q++) lo = Math.min(lo, h[k + step[q]] + maxDrop * (dst[q] / cell));
        if (h[k] > lo) h[k] = 0.5 * (h[k] + lo);
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = origin + i * cell, z = origin + j * cell;
      const t = h[k] / relief;
      h[k] += (noise.ridged(x / 700, z / 700, 3) - 0.5) * 45 * smooth(0.05, 0.4, t);
      h[k] = valley + h[k];
    }
  }
  return h;
}
