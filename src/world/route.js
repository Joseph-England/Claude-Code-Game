// Route centreline built from level.js: a constant-curvature "turtle" path sampled every 0.5 m
// with exact arc length, a designed height profile, cross-section profiles and bed surfaces.
// Pure JS (no three): used by the terrain worker, the game and the Node tools alike.
import { SECTIONS, START } from './level.js';
import { SURFACE } from './surfaces.js';

export const ROUTE_STEP = 0.5;
const D2R = Math.PI / 180;
const SMOOTH_HALF = 5; // m, half-window of the height smoothing

function interpKnots(knots, s) {
  if (s <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k++) {
    const [s1, h1] = knots[k];
    if (s <= s1) {
      const [s0, h0] = knots[k - 1];
      return s1 > s0 ? h0 + ((h1 - h0) * (s - s0)) / (s1 - s0) : h1;
    }
  }
  return knots[knots.length - 1][1];
}

export class Route {
  constructor(sections = SECTIONS, start = START) {
    this.sections = sections;
    let s0 = 0;
    for (const sec of sections) { sec.s0 = s0; s0 += sec.len; sec.s1 = s0; }
    this.length = s0;
    const n = Math.round(this.length / ROUTE_STEP) + 1;
    this.n = n;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.yaw = new Float64Array(n);
    this.h = new Float64Array(n);
    this.sec = new Uint8Array(n);

    // Centreline: heading changes linearly within each section (constant curvature).
    let x = start.x, z = start.z, yaw = start.yaw * D2R;
    for (let i = 0; i < n; i++) {
      const s = i * ROUTE_STEP;
      const k = this.sectionIndexAt(s);
      this.sec[i] = k;
      this.x[i] = x; this.z[i] = z; this.yaw[i] = yaw;
      const sec = sections[k];
      const turnRate = (sec.turn * D2R) / sec.len;
      // Midpoint integration of the arc.
      const ym = yaw + turnRate * ROUTE_STEP * 0.5;
      x -= Math.sin(ym) * ROUTE_STEP;
      z -= Math.cos(ym) * ROUTE_STEP;
      yaw += turnRate * ROUTE_STEP;
    }

    // Heights: one knot list along the whole route (section-local knots shifted to global s), linear,
    // smoothed with a moving average that never crosses a hard knot, so steps, kickers and the
    // ridge-to-cave cliff stay sharp while section joins stay smooth.
    const knots = sections.flatMap((sec) => sec.knots.map(([ls, h, hard]) => [sec.s0 + ls, h, hard]));
    const hardAt = knots.filter((k) => k[2]).map((k) => k[0]);
    const raw = new Float64Array(n), piece = new Int32Array(n), hardSeg = new Uint8Array(n);
    let hk = 0;
    for (let i = 0; i < n; i++) {
      const s = i * ROUTE_STEP;
      // At a pair of hard knots sharing one s (a cliff), the later one wins.
      raw[i] = interpKnots(knots, s + 1e-9);
      while (hk < hardAt.length && s >= hardAt[hk] - 1e-9) hk++;
      piece[i] = hk;
    }
    for (let k = 1; k < knots.length; k++) {
      const [sa, , ha] = knots[k - 1], [sb, , hb] = knots[k];
      if (!ha || !hb) continue;
      for (let i = Math.ceil(sa / ROUTE_STEP); i <= Math.floor(sb / ROUTE_STEP); i++) hardSeg[i] = 1;
    }
    const W = Math.round(SMOOTH_HALF / ROUTE_STEP);
    for (let i = 0; i < n; i++) {
      let h = raw[i];
      if (!hardSeg[i]) {
        let sum = 0, c = 0;
        for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
          if (piece[j] !== piece[i] || hardSeg[j]) continue;
          sum += raw[j]; c++;
        }
        if (c) h = sum / c;
      }
      this.h[i] = h;
    }
    // hBase keeps the height with crevasses bridged: out-of-bounds checks measure falls from it.
    this.hBase = this.h.slice();
    this.gapDepth = new Float64Array(n);
    this.gaps = [];
    for (const sec of sections) {
      for (const [at, len, depth] of sec.gaps ?? []) {
        this.gaps.push([sec.s0 + at, sec.s0 + at + len, depth]);
        for (let i = Math.floor((sec.s0 + at) / ROUTE_STEP); i <= Math.ceil((sec.s0 + at + len) / ROUTE_STEP); i++) {
          const ls = i * ROUTE_STEP - sec.s0;
          if (ls > at && ls < at + len) { this.h[i] -= depth; this.gapDepth[i] = depth; }
        }
      }
    }
  }

  sectionIndexAt(s) {
    const S = this.sections;
    for (let k = 0; k < S.length; k++) if (s < S[k].s1) return k;
    return S.length - 1;
  }

  /** Index of the sample at/below arc length s (clamped). */
  index(s) {
    return Math.min(this.n - 1, Math.max(0, Math.round(s / ROUTE_STEP)));
  }

  /** Interpolated centreline point: { x, z, h, dx, dz (unit heading), rx, rz (unit right) }. */
  at(s, out = {}) {
    const f = Math.min(this.n - 1.000001, Math.max(0, s / ROUTE_STEP));
    const i = Math.floor(f), t = f - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.h = this.h[i] + (this.h[i + 1] - this.h[i]) * t;
    const yaw = this.yaw[i] + (this.yaw[i + 1] - this.yaw[i]) * t;
    out.dx = -Math.sin(yaw); out.dz = -Math.cos(yaw);
    out.rx = -out.dz; out.rz = out.dx;
    out.yaw = yaw;
    return out;
  }

  heightAt(s, base = false) {
    const H = base ? this.hBase : this.h;
    const f = Math.min(this.n - 1.000001, Math.max(0, s / ROUTE_STEP));
    const i = Math.floor(f);
    return H[i] + (H[i + 1] - H[i]) * (f - i);
  }

  section(s) { return this.sections[this.sectionIndexAt(s)]; }

  /** Cross-section profile in effect at arc length s. */
  profileAt(s) {
    const sec = this.section(s), ls = s - sec.s0;
    for (const [a, b, p] of sec.profiles ?? []) if (ls >= a && ls < b) return p;
    return sec.profile;
  }

  /** Lateral offset of a section's packed trail (basin/plateau) at arc length s, or null. */
  trailOffset(s) {
    const sec = this.section(s);
    if (!sec.trail) return null;
    const ls = s - sec.s0, { amp, wave } = sec.trail;
    // Fades in from the section start so it joins the centreline.
    return amp * Math.sin((2 * Math.PI * ls) / wave) * Math.min(1, ls / 20) * Math.min(1, (sec.len - ls) / 20);
  }

  /** Bed surface at arc length s and signed lateral offset d. */
  surfaceAt(s, d) {
    const sec = this.section(s), ls = s - sec.s0;
    let surf = sec.surface;
    if (sec.trail) {
      const off = this.trailOffset(s);
      if (Math.abs(d - off) < sec.trail.w) surf = SURFACE.PACKED;
    }
    for (const [a, b, sf, dMin = -Infinity, dMax = Infinity] of sec.paint ?? []) {
      if (ls >= a && ls < b && d >= dMin && d <= dMax) surf = sf;
    }
    return surf;
  }

  /** World position of a (section index, localS, d) anchor. */
  place(k, ls, d = 0) {
    const p = this.at(this.sections[k].s0 + ls);
    return { x: p.x + p.rx * d, z: p.z + p.rz * d, h: p.h, yaw: p.yaw, s: this.sections[k].s0 + ls };
  }
}
