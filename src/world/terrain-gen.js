// Deterministic mountain generation (DECISIONS #8 as refined by #36): runs in a Web Worker in the
// game and directly in Node for the tools. Pipeline:
//   1. macro shape on a 4 m grid: inverse-distance blend of the route's heights + a cone that rises
//      toward the summit, plus domain-warped ridged multifractal that grows away from the route
//   2. hydraulic + thermal erosion on that grid
//   3. bicubic upsample to the 1 m play heightfield + fine fBm detail
//   4. route distance field (nearest arc length s and signed lateral offset d per sample)
//   5. carve the route cross-sections into the terrain (spline SDF)
//   6. splat map: surface ids by section, route, slope
//   7. the distant ranges (render only), grown by stream-power erosion (ranges.js)
import { Noise, rng } from './noise.js';
import { erode } from './erosion.js';
import { Route } from './route.js';
import { generateRanges } from './ranges.js';
import { SURFACE } from './surfaces.js';

export const WORLD = { size: 1024, cell: 1, seed: 1917, valley: -150 };
export const BACKDROP = { size: 14000, n: 225 };
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

// Blend from a profile edge (height e at distance d0) out to natural terrain N. The blend widens
// with the height difference so shoulders stay walkable (≈ 21° average, ≈ 31° at the steepest).
function shoulder(e, N, d0, width, d) {
  const w = Math.max(width, 2.6 * Math.abs(N - e));
  return lerp(e, N, smooth(d0, d0 + w, d));
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
      return shoulder(H + p.depth, N, dTop, p.shoulder, d);
    }
    case 'ridge': case 'summit': {
      // Flat crest, a 3 m parabolic fillet, then a 52° fall of `drop` metres; then natural.
      const e = Math.max(0, d - (p.w - 1.5));
      const fall = e < 3 ? (T52 * e * e) / 6 : T52 * (e - 1.5);
      // On the summit pyramid (`natural`): the fall simply runs into the mountain's own faces — no
      // smoothing shoulder, which rounded the top into a dome (DECISIONS #89). Beside the bed the
      // face may also rise (a ledge cut across a face), at most at 52° from the bed's edge.
      if (p.natural || p.type === 'summit') {
        if (d <= p.w) return H;
        const nat = Math.min(N, H + (d - p.w) * T52);
        return lerp(Math.max(H - fall, nat), nat, smooth(p.w + 2, p.w + 14, d));
      }
      if (fall <= p.drop) return H - fall;
      const dSide = p.w - 1.5 + p.drop / T52 + 1.5;
      return shoulder(H - p.drop, N, dSide, p.shoulder, d);
    }
    case 'cave': {
      const dWall = p.w + p.wall / T70;
      if (d <= p.w) return H;
      if (d <= dWall) return H + (d - p.w) * T70;
      return shoulder(H + p.wall, N, dWall + 4, p.shoulder, d);
    }
    case 'plateau': {
      if (d <= p.w) return H;
      if (d <= p.w + p.bank / T45) return H + (d - p.w) * T45;
      const d0 = p.w + p.bank / T45;
      return shoulder(H + p.bank, N, d0, p.shoulder, d);
    }
    case 'col': {
      // The path through the gap: a flat bed, then the flanks climb all the way to the natural
      // (horned) terrain by the edge of the route's reach, so there is no seam where carving stops.
      if (d <= p.w) return H;
      return lerp(H, N, smooth(p.w, 62, d));
    }
    default: // trail, basin
      return shoulder(H, N, p.w, p.shoulder, d);
  }
}

/** Half-width of the walkable bed (used by the splat map and the bot). */
export function bedWidth(p) {
  return p.w;
}

export function generateTerrain(opts = {}, onProgress = () => {}) {
  const seed = opts.seed ?? WORLD.seed;
  const noise = new Noise(seed), detail = new Noise(seed + 101);
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
  // The summit peak (user playtest: the top looked like "a big snowball"; DECISIONS #89). The
  // mountain near the top is the intersection of planes: the route's last arête is a crest that
  // follows the path up (its height, falling ~52° to both sides), two steep faces make the back of
  // the peak and the arêtes where they meet, and two flank faces take over away from the route.
  // Ribs and couloirs roughen the faces. Face azimuths are relative to the direction from the top
  // back down the route; slope = rise per metre.
  const back = route.at(route.length - 70), azR = Math.atan2(back.x - summit[0], -(back.z - summit[1]));
  const peakH = summit[2] - 1.5; // just under the route's top, so the path stays on the crest
  // Detail for steep rock faces: couloirs and rock ribs running down the fall line (noise
  // stretched along it; u across the face, v down it), and rock bands — gently dipping strata that
  // step a face into snowy ledges and steep risers. w: how much (0 near a summit point).
  const rockFace = (h, u, v, x, z, w) => {
    h += (noise.ridged(u / 15 + 7.7, v / 60 - 3.1, 3) - 0.5) * 14 * w;
    const band = 10, q = (h + 0.04 * x - 0.03 * z) / band, fr = q - Math.floor(q);
    return lerp(h, (Math.floor(q) + smooth(0.3, 0.7, fr)) * band - 0.04 * x + 0.03 * z, 0.45 * w);
  };
  const pushS0 = route.sections.find((sec) => sec.name === 'Summit Push').s0;
  const face = ([da, sl]) => [Math.sin(azR + da), -Math.cos(azR + da), sl];
  const BACK = [[2.45, 1.45], [-2.45, 1.45]].map(face), FLANK = [[1.35, 1.3], [-1.35, 1.3]].map(face);
  const peak = (x, z, sN, dN) => {
    const dx = x - summit[0], dz = z - summit[1], r = Math.hypot(dx, dz);
    // The plane in charge here, and its fall line (u across it, v down it).
    let b = 0, bn = BACK[0], f = 0, fn = FLANK[0];
    for (const F of BACK) { const v = F[2] * (dx * F[0] + dz * F[1]); if (v > b) { b = v; bn = F; } }
    for (const F of FLANK) { const v = F[2] * (dx * F[0] + dz * F[1]); if (v > f) { f = v; fn = F; } }
    const onArete = sN >= pushS0 - 10;
    const front = onArete ? route.heightAt(sN) - 1.5 - 1.28 * dN : peakH - f;
    let h, u, v;
    if (peakH - b < front) { h = peakH - b; u = dx * -bn[1] + dz * bn[0]; v = dx * bn[0] + dz * bn[1]; }
    else if (onArete) { h = front; u = sN; v = dN; }
    else { h = front; u = dx * -fn[1] + dz * fn[0]; v = dx * fn[0] + dz * fn[1]; }
    return rockFace(h, u, v, x, z, smooth(6, 40, r));
  };
  // Horns either side of the col (DECISIONS #77, reshaped by #89): separate rock peaks, pointed,
  // below the summit, each the intersection of three planes with the same couloirs and strata, so
  // the gap is walled by towers rather than flat-topped curtains.
  const hornSec = route.sections.find((sec) => sec.horns);
  const hornPeaks = (hornSec?.horns.peaks ?? []).map(([ls, d, rise], q) => {
    const p = route.at(hornSec.s0 + ls), R = rng(seed * 7 + q * 13);
    const a0 = R() * Math.PI * 2;
    return {
      x: p.x + p.rx * d, z: p.z + p.rz * d, h: Math.min(summit[2] - 25, route.heightAt(hornSec.s0 + ls) + rise),
      faces: [0, 1, 2].map((f) => { const a = a0 + f * 2.1 + (R() - 0.5) * 0.6; return [Math.sin(a), -Math.cos(a), 1.05 + 0.3 * R()]; }),
    };
  });
  const hornAt = (x, z) => {
    let best = -Infinity;
    for (const hp of hornPeaks) {
      const dx = x - hp.x, dz = z - hp.z, r = Math.hypot(dx, dz);
      if (r > 190) continue;
      let desc = 0, fn = hp.faces[0];
      for (const F of hp.faces) { const v = F[2] * (dx * F[0] + dz * F[1]); if (v > desc) { desc = v; fn = F; } }
      best = Math.max(best, rockFace(hp.h - desc, dx * -fn[1] + dz * fn[0], dx * fn[0] + dz * fn[1], x, z, smooth(4, 30, r)));
    }
    return best;
  };
  const warp = [0, 0];
  for (let j = 0; j < cn; j++) {
    const z = origin + j * CC;
    for (let i = 0; i < cn; i++) {
      const x = origin + i * CC;
      let wsum = 0, hs = 0, rs = 0, dmin = Infinity, imin = 0;
      for (let q = 0; q < pts.length; q++) {
        const p = pts[q];
        const d2 = (x - p[0]) ** 2 + (z - p[1]) ** 2;
        if (d2 < dmin) { dmin = d2; imin = q; }
        const w = 1 / ((d2 + 900) ** 1.5);
        wsum += w; hs += w * p[2]; rs += w * p[3];
      }
      const dRoute = Math.sqrt(dmin);
      // Nearest point on the route polyline (for the summit's arête): project onto the segments
      // either side of the nearest sample; past the end, the distance is radial.
      let sN = imin * 8, dN = dRoute;
      for (const q of [imin - 1, imin]) {
        if (q < 0 || q >= pts.length - 1) continue;
        const a = pts[q], b = pts[q + 1], ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez;
        const u = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / L2));
        const dd = Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u);
        if (dd < dN) { dN = dd; sN = Math.min(route.length, (q + u) * 8); }
      }
      const r = Math.hypot(x - summit[0], z - summit[1]);
      let h = hs / wsum + 0.5 * (rs / wsum - r);
      // Rugged relief grows away from the route so the corridor stays readable.
      noise.warp(x / 520, z / 520, 0.5, 3, warp);
      const ridged = noise.ridged(warp[0], warp[1], 6);
      const amp = 8 + 42 * smooth(20, 160, dRoute);
      h += (ridged - 0.45) * amp * 1.5;
      // Nothing may rise above a cone hung from the summit, so the top reads as the top and the
      // summit view is open (soft minimum, k = 12 m) — except the summit pyramid itself, which
      // takes over close to the top.
      const cap = summit[2] - 18 - 0.22 * r, k = 12;
      const hh = Math.max(k - Math.abs(h - cap), 0) / k;
      h = Math.min(h, cap) - hh * hh * k * 0.25;
      // The faces fall until they meet a steep base cone around the peak, which blends into the
      // surrounding terrain further out (a col toward the gap, long falls to the valley elsewhere).
      if (r < 400) h = lerp(Math.max(peak(x, z, sN, dN), summit[2] - 40 - 0.8 * r), h, smooth(110, 400, r));
      // The horns stand above the cone (it would flatten them): soft maximum.
      const top = hornAt(x, z);
      if (top > -1e9) { const kk = 8, d = top - h; h = d > kk ? top : d > -kk ? h + (d + kk) ** 2 / (4 * kk) : h; }
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
    // The summit pyramid keeps its steep faces: no thermal slumping near the top.
    const thermalMask = new Uint8Array(cn * cn);
    for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) thermalMask[j * cn + i] = Math.hypot(origin + i * CC - summit[0], origin + j * CC - summit[1]) > 150 ? 1 : 0;
    erode(coarse, cn, CC, { seed, droplets: 70000, thermalMask, onProgress: (f) => onProgress(0.2 + 0.3 * f, 'eroding') });
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
    // Past the route's end the offset is radial: keep a small round top, then the peak's own faces.
    if (sp.p.type === 'summit' && s >= route.length - 0.05 && d > sp.p.w) h = Math.max(N, H - 2.5 * T52 * (d - sp.p.w));
    const into = s - sp.s0;
    // Far from the centreline the blend stretches, so profile changes never leave radial cliffs.
    // A sharp change (the ridge's end above the cave) stays sharp only near the centreline.
    const L = sp.p.sharp ? 0.8 * Math.max(0, d - 16) : 8 + 0.8 * d;
    if (k > 0 && into < L && spans[k - 1].p !== sp.p) {
      h = lerp(profileHeight(spans[k - 1].p, H, N, d), h, smooth(0, L, into));
    }
    // Crevasses cut across the whole corridor with 70° walls (vertical cliffs make the bicubic
    // surface ring, and the ringing spikes at the lip stopped launches dead).
    for (const [g0, g1, depth] of route.gaps) {
      if (s > g0 && s < g1 && d < 40) {
        const cut = Math.min(depth, Math.min(s - g0, g1 - s) * T70);
        h = Math.min(h, route.heightAt(s, true) - cut);
      }
    }
    heights[idx] = h;
    if ((idx & 262143) === 0) onProgress(0.8 + 0.1 * (idx / (n * n)), 'carving');
  }
  t = mark('carve', t);

  // --- 6. Splat map.
  const surfaces = new Uint8Array(n * n);
  const slopeRock = TAN(56), slopeCrust = TAN(36), slopeRockPeak = TAN(46);
  const summitXZ = [route.at(route.length).x, route.at(route.length).z];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const hl = heights[j * n + Math.max(i - 1, 0)], hr = heights[j * n + Math.min(i + 1, n - 1)];
      const hd = heights[Math.max(j - 1, 0) * n + i], hu = heights[Math.min(j + 1, n - 1) * n + i];
      const grad = Math.hypot(hr - hl, hu - hd) / (2 * cell);
      // Rock shows sooner on the summit pyramid's faces (steep snow slides off them).
      const rs = Math.hypot(origin + i * cell - summitXZ[0], origin + j * cell - summitXZ[1]);
      const rockAt = rs < 260 ? lerp(slopeRockPeak, slopeRock, smooth(120, 260, rs)) : slopeRock;
      let surf = grad > rockAt ? SURFACE.ROCK : grad > slopeCrust ? SURFACE.SNOW : SURFACE.POWDER;
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

  // --- 7. Backdrop: the distant ranges (render only), grown by stream-power erosion (ranges.js,
  // DECISIONS #88). Their valley floor sits a little under the play area's edge.
  const bn = BACKDROP.n, bsize = BACKDROP.size;
  onProgress(0.9, 'raising the ranges');
  const backdrop = generateRanges({ n: bn, size: bsize, seed: seed + 5, valley: WORLD.valley - 45, inner: 800, relief: 1900, iterations: 120 });
  mark('backdrop', t);
  timings.total = Date.now() - t0;
  onProgress(1, 'done');
  return { n, size, cell, origin, heights, surfaces, routeS, routeD, backdrop, backdropN: bn, backdropSize: bsize, timings };
}
