// Deterministic mountain generation (DECISIONS #8 as refined by #36): runs in a Web Worker in the
// game and directly in Node for the tools. Pipeline:
//   1. macro shape on a 4 m grid: inverse-distance blend of the route's heights + a cone that rises
//      toward the summit, plus domain-warped ridged multifractal that grows away from the route
//   2. hydraulic + thermal erosion on that grid
//   3. bicubic upsample to the 1 m play heightfield + fine fBm detail
//   4. route distance field (nearest arc length s and signed lateral offset d per sample)
//   5. carve the route cross-sections into the terrain (spline SDF)
//   6. splat map: surface ids by section, route, slope
//   7. a coarse backdrop of distant ranges (render only)
import { Noise } from './noise.js';
import { erode } from './erosion.js';
import { Route } from './route.js';
import { SURFACE } from './surfaces.js';

export const WORLD = { size: 1024, cell: 1, seed: 1917, valley: -150 };
export const BACKDROP = { size: 14000, n: 113 };
const FAR = 100; // m: route influence radius (distance field extent)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const TAN = (deg) => Math.tan((deg * Math.PI) / 180);
const T52 = TAN(52), T70 = TAN(70), T62 = TAN(62), T45 = 1;

/** Catmull-Rom sample of an n×n grid at fractional grid coords. */
function bicubic(G, n, fx, fz) {
  fx = Math.min(Math.max(fx, 0), n - 1.000001);
  fz = Math.min(Math.max(fz, 0), n - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const w = (t) => [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2];
  const wx = w(tx), wz = w(tz);
  let h = 0;
  for (let b = 0; b < 4; b++) {
    const row = Math.min(Math.max(j + b - 1, 0), n - 1) * n;
    let r = 0;
    for (let a = 0; a < 4; a++) r += wx[a] * G[row + Math.min(Math.max(i + a - 1, 0), n - 1)];
    h += wz[b] * r;
  }
  return h;
}

/** Height of a route cross-section at |d| from the centreline, given natural height N. */
export function profileHeight(p, H, N, d) {
  switch (p.type) {
    case 'pipe': {
      const phi = (72 * Math.PI) / 180, dEdge = p.w + p.r * Math.sin(phi), hEdge = p.r * (1 - Math.cos(phi));
      let q;
      if (d <= p.w) q = 0;
      else if (d <= dEdge) q = p.r - Math.sqrt(p.r * p.r - (d - p.w) ** 2);
      else q = hEdge + (d - dEdge) * T62;
      if (q <= p.depth) return H + q;
      const dTop = dEdge + (p.depth - hEdge) / T62;
      return lerp(H + p.depth, N, smooth(dTop, dTop + p.shoulder, d));
    }
    case 'ridge': case 'summit': {
      // Flat crest, a 3 m parabolic fillet, then a 52° fall of `drop` metres; then natural.
      const e = Math.max(0, d - (p.w - 1.5));
      const fall = e < 3 ? (T52 * e * e) / 6 : T52 * (e - 1.5);
      if (fall <= p.drop) return H - fall;
      const dSide = p.w - 1.5 + p.drop / T52 + 1.5;
      return lerp(H - p.drop, N, smooth(dSide, dSide + p.shoulder, d));
    }
    case 'cave': {
      const dWall = p.w + p.wall / T70;
      if (d <= p.w) return H;
      if (d <= dWall) return H + (d - p.w) * T70;
      return lerp(H + p.wall, N, smooth(dWall + 4, dWall + 4 + p.shoulder, d));
    }
    case 'plateau': {
      if (d <= p.w) return H;
      if (d <= p.w + p.bank / T45) return H + (d - p.w) * T45;
      const d0 = p.w + p.bank / T45;
      return lerp(H + p.bank, N, smooth(d0, d0 + p.shoulder, d));
    }
    default: // trail, basin
      return lerp(H, N, smooth(p.w, p.w + p.shoulder, d));
  }
}

/** Half-width of the walkable bed (used by the splat map and the bot). */
export function bedWidth(p) {
  return p.w;
}

export function generateTerrain(opts = {}, onProgress = () => {}) {
  const seed = opts.seed ?? WORLD.seed;
  const noise = new Noise(seed), detail = new Noise(seed + 101), far = new Noise(seed + 202);
  const route = new Route();
  const { size, cell } = WORLD;
  const n = Math.round(size / cell) + 1, origin = -size / 2;
  const t0 = Date.now();
  const timings = {};
  const mark = (k, since) => { timings[k] = Date.now() - since; return Date.now(); };
  let t = Date.now();

  // --- 1. Macro shape on a coarse grid.
  const CC = 4, cn = Math.round(size / CC) + 1;
  const coarse = new Float32Array(cn * cn);
  const pts = [];
  for (let s = 0; s <= route.length; s += 8) { const p = route.at(s); pts.push([p.x, p.z, route.heightAt(s, true)]); }
  const summit = pts[pts.length - 1];
  for (const p of pts) p.push(Math.hypot(p[0] - summit[0], p[1] - summit[1]));
  const warp = [0, 0];
  for (let j = 0; j < cn; j++) {
    const z = origin + j * CC;
    for (let i = 0; i < cn; i++) {
      const x = origin + i * CC;
      let wsum = 0, hs = 0, rs = 0, dmin = Infinity;
      for (const p of pts) {
        const d2 = (x - p[0]) ** 2 + (z - p[1]) ** 2;
        if (d2 < dmin) dmin = d2;
        const w = 1 / ((d2 + 900) ** 1.5);
        wsum += w; hs += w * p[2]; rs += w * p[3];
      }
      const dRoute = Math.sqrt(dmin);
      const r = Math.hypot(x - summit[0], z - summit[1]);
      let h = hs / wsum + 0.5 * (rs / wsum - r);
      // Rugged relief grows away from the route so the corridor stays readable.
      noise.warp(x / 520, z / 520, 0.5, 3, warp);
      const ridged = noise.ridged(warp[0], warp[1], 6);
      const amp = 8 + 42 * smooth(20, 160, dRoute);
      h += (ridged - 0.45) * amp * 1.5;
      // Nothing may rise above a cone hung from the summit, so the top reads as the top and the
      // summit view is open (soft minimum, k = 12 m).
      const cap = summit[2] - 18 - 0.22 * r, k = 12;
      const hh = Math.max(k - Math.abs(h - cap), 0) / k;
      h = Math.min(h, cap) - hh * hh * k * 0.25;
      // Fall away to the valley floor at the map edge.
      const edge = Math.min(x - origin, origin + size - x, z - origin, origin + size - z);
      h = lerp(WORLD.valley, h, smooth(0, 140, edge));
      coarse[j * cn + i] = h;
    }
    if ((j & 15) === 0) onProgress(0.2 * (j / cn), 'shaping the mountain');
  }
  t = mark('macro', t);

  // --- 2. Erosion.
  if (opts.erosion !== false) {
    erode(coarse, cn, CC, { seed, droplets: 70000, onProgress: (f) => onProgress(0.2 + 0.3 * f, 'eroding') });
  }
  t = mark('erosion', t);

  // --- 3. Upsample to the play grid + fine detail.
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = origin + j * cell;
    for (let i = 0; i < n; i++) {
      const x = origin + i * cell;
      heights[j * n + i] = bicubic(coarse, cn, (x - origin) / CC, (z - origin) / CC) + 0.9 * detail.fbm(x / 22, z / 22, 3);
    }
    if ((j & 63) === 0) onProgress(0.5 + 0.1 * (j / n), 'detailing');
  }
  t = mark('upsample', t);

  // --- 4. Route distance field: rasterise each 1 m centreline segment into its neighbourhood.
  const routeS = new Float32Array(n * n).fill(-1);
  const routeD = new Float32Array(n * n);
  const best = new Float32Array(n * n).fill(FAR * FAR);
  const a = {}, b = {};
  const steps = Math.floor(route.length);
  for (let k = 0; k < steps; k++) {
    route.at(k, a); route.at(Math.min(k + 1, route.length), b);
    const sx = b.x - a.x, sz = b.z - a.z, len2 = sx * sx + sz * sz, segLen = Math.sqrt(len2);
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - FAR - origin) / cell));
    const i1 = Math.min(n - 1, Math.ceil((Math.max(a.x, b.x) + FAR - origin) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - FAR - origin) / cell));
    const j1 = Math.min(n - 1, Math.ceil((Math.max(a.z, b.z) + FAR - origin) / cell));
    const first = k === 0, last = k === steps - 1;
    for (let j = j0; j <= j1; j++) {
      const z = origin + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = origin + i * cell;
        let u = ((x - a.x) * sx + (z - a.z) * sz) / len2;
        if ((u < 0 && !first) || (u > 1 && !last)) u = u < 0 ? 0 : 1;
        const uc = Math.min(1, Math.max(0, u));
        const px = a.x + sx * uc, pz = a.z + sz * uc;
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        const idx = j * n + i;
        if (d2 < best[idx]) {
          best[idx] = d2;
          routeS[idx] = k + uc * segLen;
          // Signed lateral offset: + = right of travel (right = (-dz, dx) of the heading).
          const cross = ((x - px) * -sz + (z - pz) * sx) / segLen;
          routeD[idx] = Math.sign(cross || 1) * Math.sqrt(d2);
        }
      }
    }
    if ((k & 63) === 0) onProgress(0.6 + 0.2 * (k / steps), 'laying the route');
  }
  t = mark('distance', t);

  // --- 5. Carve. Profiles blend after a change unless the new one is marked sharp.
  const spans = [];
  for (const sec of route.sections) {
    const cuts = [0, sec.len, ...(sec.profiles ?? []).flatMap(([s0, s1]) => [s0, s1])].sort((x, y) => x - y);
    for (let c = 0; c < cuts.length - 1; c++) {
      if (cuts[c + 1] <= cuts[c]) continue;
      const mid = sec.s0 + (cuts[c] + cuts[c + 1]) / 2;
      spans.push({ s0: sec.s0 + cuts[c], s1: sec.s0 + cuts[c + 1], p: route.profileAt(mid) });
    }
  }
  const spanAt = (s) => { let k = 0; while (k < spans.length - 1 && s >= spans[k].s1) k++; return k; };
  for (let idx = 0; idx < n * n; idx++) {
    const s = routeS[idx];
    if (s < 0) continue;
    const d = Math.abs(routeD[idx]);
    const N = heights[idx];
    const H = route.heightAt(s);
    const k = spanAt(s), sp = spans[k];
    let h = profileHeight(sp.p, H, N, d);
    const into = s - sp.s0;
    // Far from the centreline the blend stretches, so profile changes never leave radial cliffs.
    // A sharp change (the ridge's end above the cave) stays sharp only near the centreline.
    const L = sp.p.sharp ? 0.8 * Math.max(0, d - 16) : 8 + 0.8 * d;
    if (k > 0 && into < L && spans[k - 1].p !== sp.p) {
      h = lerp(profileHeight(spans[k - 1].p, H, N, d), h, smooth(0, L, into));
    }
    // Crevasses cut straight down across the whole corridor.
    const gi = route.index(s);
    if (route.gapDepth[gi] > 0 && d < 40) h = Math.min(h, route.hBase[gi] - route.gapDepth[gi]);
    heights[idx] = h;
    if ((idx & 262143) === 0) onProgress(0.8 + 0.1 * (idx / (n * n)), 'carving');
  }
  t = mark('carve', t);

  // --- 6. Splat map.
  const surfaces = new Uint8Array(n * n);
  const slopeRock = TAN(56), slopeCrust = TAN(36);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const hl = heights[j * n + Math.max(i - 1, 0)], hr = heights[j * n + Math.min(i + 1, n - 1)];
      const hd = heights[Math.max(j - 1, 0) * n + i], hu = heights[Math.min(j + 1, n - 1) * n + i];
      const grad = Math.hypot(hr - hl, hu - hd) / (2 * cell);
      let surf = grad > slopeRock ? SURFACE.ROCK : grad > slopeCrust ? SURFACE.PACKED : SURFACE.POWDER;
      const s = routeS[idx];
      if (s >= 0) {
        const p = route.profileAt(s), d = Math.abs(routeD[idx]);
        const bed = p.type === 'pipe' ? p.w + 7 : p.type === 'cave' ? p.w + p.wall / T70 : p.w + 0.75;
        if (d <= bed && route.gapDepth[route.index(s)] === 0) surf = route.surfaceAt(s, routeD[idx]);
        else if (p.type === 'cave' && d <= bed + 2) surf = SURFACE.ICE;
      }
      surfaces[idx] = surf;
    }
  }
  t = mark('splat', t);

  // --- 7. Backdrop: distant ranges ringing the valley, higher than the summit in places.
  const bn = BACKDROP.n, bsize = BACKDROP.size, borigin = -bsize / 2, bcell = bsize / (bn - 1);
  const backdrop = new Float32Array(bn * bn);
  for (let j = 0; j < bn; j++) {
    for (let i = 0; i < bn; i++) {
      const x = borigin + i * bcell, z = borigin + j * bcell;
      const r = Math.max(Math.abs(x), Math.abs(z));
      far.warp(x / 2600, z / 2600, 0.5, 3, warp);
      const ridge = far.ridged(warp[0], warp[1], 5);
      const ring = smooth(size / 2 + 250, 3200, r);
      backdrop[j * bn + i] = r < size / 2 + 60 ? WORLD.valley - 40 : WORLD.valley + ring * (ridge * 1350 - 100);
    }
  }
  mark('backdrop', t);
  timings.total = Date.now() - t0;
  onProgress(1, 'done');
  return { n, size, cell, origin, heights, surfaces, routeS, routeD, backdrop, backdropN: bn, backdropSize: bsize, timings };
}
