// Erosion on a square height grid (DESIGN §7 #2): particle-based hydraulic erosion (droplets pick
// up sediment where they speed up and drop it where they slow down) followed by a thermal pass
// that slumps slopes steeper than the talus angle. Deterministic for a given seed.
import { rng } from './noise.js';

/**
 * @param H Float32Array n×n heights (m), modified in place
 * @param n grid size
 * @param cell spacing (m)
 * @param opts { seed, droplets, onProgress(fraction) }
 */
export function erode(H, n, cell, opts = {}) {
  const {
    seed = 1, droplets = 50000, maxSteps = 48, inertia = 0.08, capacity = 5, minSlope = 0.01,
    erodeRate = 0.35, depositRate = 0.25, evaporate = 0.03, gravity = 9, onProgress,
  } = opts;
  const rand = rng(seed ^ 0x5eed);
  const heightGrad = (x, y, out) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const k = j * n + i;
    const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
    out[0] = ((b - a) * (1 - v) + (d - c) * v) / cell;
    out[1] = ((c - a) * (1 - u) + (d - b) * u) / cell;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  const g = [0, 0], g2 = [0, 0];
  for (let p = 0; p < droplets; p++) {
    let x = 1 + rand() * (n - 3), y = 1 + rand() * (n - 3);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < maxSteps; step++) {
      const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
      const h = heightGrad(x, y, g);
      dx = dx * inertia - g[0] * (1 - inertia);
      dy = dy * inertia - g[1] * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < 1 || y < 1 || x >= n - 2 || y >= n - 2) break;
      const dh = heightGrad(x, y, g2) - h;
      const cap = Math.max(-dh / cell, minSlope) * speed * water * capacity;
      const k = j * n + i;
      if (sediment > cap || dh > 0) {
        // Deposit (fill the pit we climbed into, or drop the excess), bilinearly.
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositRate;
        sediment -= amt;
        H[k] += amt * (1 - u) * (1 - v); H[k + 1] += amt * u * (1 - v);
        H[k + n] += amt * (1 - u) * v; H[k + n + 1] += amt * u * v;
      } else {
        const amt = Math.min((cap - sediment) * erodeRate, -dh);
        sediment += amt;
        H[k] -= amt * (1 - u) * (1 - v); H[k + 1] -= amt * u * (1 - v);
        H[k + n] -= amt * (1 - u) * v; H[k + n + 1] -= amt * u * v;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity / cell));
      water *= 1 - evaporate;
    }
    if (onProgress && (p & 4095) === 0) onProgress(p / droplets);
  }
  thermal(H, n, cell, opts.talus ?? 42, opts.thermalIters ?? 6);
}

/** Move material down any slope steeper than the talus angle (deg). */
export function thermal(H, n, cell, talusDeg, iters) {
  const maxDiff = Math.tan((talusDeg * Math.PI) / 180) * cell;
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const nb = [k - 1, k + 1, k - n, k + n];
        let lowest = -1, most = maxDiff;
        for (const m of nb) { const d = H[k] - H[m]; if (d > most) { most = d; lowest = m; } }
        if (lowest >= 0) { const move = (most - maxDiff) * 0.25; H[k] -= move; H[lowest] += move; }
      }
    }
  }
}
