// Gray-box test course (Phase 2). A 384 m heightfield plus box colliders that exercise every
// move and surface. Layout (north = -z):
//   Hub (0,0)            flat packed spawn with a cairn (sit test)
//   North  "The Run"     140 m descent: 12°→20°→28°; lanes: ice | rollers | smooth | kicker | powder
//   East   slope lanes   10/20/30/40° packed, 30° ice, 45° rock, 58° rock (walkability limits)
//   West   surface pads  15° launch slope into flat powder / packed / ice / rock strips (stopping)
//   South  half-pipe     trench descending ~8°, ending in a kicker
//   SW     walls         ice/rock chimney (wall-kick), box steps, long rock wall, tunnel
// A 45° rim around the edge keeps you in bounds.
import { Heightfield } from './heightfield.js';
import { SURFACE } from './surfaces.js';

const D = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const COURSE_SIZE = 384;
const RIM = 176;

// --- The Run: slope angle knots along u (metres uphill from its foot at z = -32).
const RUN_Z0 = -32, RUN_LEN = 140, RUN_HALF = 40;
const RUN_KNOTS = [[0, 0], [10, 12], [50, 12], [55, 20], [100, 20], [105, 28], [130, 28], [140, 0]];
const RUN_STEP = 0.1;
const runProfile = (() => {
  const angle = (u) => {
    for (let k = 1; k < RUN_KNOTS.length; k++) {
      const [u0, a0] = RUN_KNOTS[k - 1], [u1, a1] = RUN_KNOTS[k];
      if (u <= u1) return lerp(a0, a1, (u - u0) / (u1 - u0));
    }
    return 0;
  };
  const out = new Float32Array(Math.ceil(RUN_LEN / RUN_STEP) + 2);
  for (let k = 1; k < out.length; k++) out[k] = out[k - 1] + Math.tan(angle((k - 0.5) * RUN_STEP) * D) * RUN_STEP;
  return out;
})();
function runBase(u) {
  const f = Math.min(Math.max(u, 0), RUN_LEN) / RUN_STEP;
  const k = Math.floor(f);
  return lerp(runProfile[k], runProfile[k + 1], f - k);
}
export const RUN_TOP = runBase(RUN_LEN);

function runHeight(x, z) {
  const u = RUN_Z0 - z;
  if (u <= 0) return 0;
  let h = runBase(u);
  // Rollers (dips and rises) in x ∈ [-24,-4] on the 20° pitch.
  const inRollers = smooth(-25, -22, x) * (1 - smooth(-6, -3, x));
  h += 1.1 * Math.sin((2 * Math.PI * (u - 52)) / 16) * inRollers * smooth(52, 58, u) * (1 - smooth(94, 100, u));
  // Kicker in x ∈ [12,22]: concave ramp rising toward downhill, lip at u = 60.5.
  const inKicker = smooth(10, 12.5, x) * (1 - smooth(21.5, 24, x));
  let kick = 0;
  if (u >= 60.5 && u <= 66) kick = 1.6 * Math.pow((66 - u) / 5.5, 1.6);
  else if (u >= 59.5 && u < 60.5) kick = 1.6 * (u - 59.5);
  h += kick * inKicker;
  // Side slopes at 35° (walkable snow).
  h -= Math.max(0, Math.abs(x) - RUN_HALF) * Math.tan(35 * D);
  return Math.max(h, 0);
}
function runSurface(x, z) {
  const u = RUN_Z0 - z;
  if (u <= 0 || Math.abs(x) > RUN_HALF) return -1;
  if (x < -24) return SURFACE.ICE;
  if (x > 24) return u > 100 && u < 132 ? SURFACE.ROCK : SURFACE.POWDER;
  return -1;
}

// --- East slope lanes: rise eastward from x = 50 to a 16 m plateau.
const LANES = [
  { z: -30, a: 10, s: SURFACE.PACKED }, { z: -10, a: 20, s: SURFACE.PACKED },
  { z: 10, a: 30, s: SURFACE.PACKED }, { z: 30, a: 40, s: SURFACE.PACKED },
  { z: 50, a: 30, s: SURFACE.ICE }, { z: 70, a: 45, s: SURFACE.ROCK }, { z: 90, a: 58, s: SURFACE.ROCK },
];
export const LANE_X0 = 50;
const LANE_HALF = 6, LANE_TOP = 16;
function laneHeight(x, z) {
  if (x <= LANE_X0) return 0;
  let h = 0;
  for (const l of LANES) {
    const side = Math.max(0, Math.abs(z - l.z) - LANE_HALF) * Math.tan(50 * D);
    h = Math.max(h, Math.min(LANE_TOP, (x - LANE_X0) * Math.tan(l.a * D)) - side);
  }
  return h;
}
function laneSurface(x, z) {
  if (x <= LANE_X0 - 1) return -1;
  for (const l of LANES) if (Math.abs(z - l.z) <= LANE_HALF + 0.5 && l.s !== SURFACE.PACKED) return l.s;
  return -1;
}

// --- West surface pads: ramp up (24°) to an 8 m deck, 15° launch slope, then 106 m flat strips.
const PAD_Z0 = -30, PAD_Z1 = 50, PAD_FLAT_X = -72;
export const PAD_STRIPS = [
  { z0: -30, z1: -10, s: SURFACE.POWDER }, { z0: -10, z1: 10, s: SURFACE.PACKED },
  { z0: 10, z1: 30, s: SURFACE.ICE }, { z0: 30, z1: 50, s: SURFACE.ROCK },
];
function padHeight(x, z) {
  let h;
  if (x >= -12) h = 0;
  else if (x >= -30) h = ((-12 - x) * 8) / 18;
  else if (x >= -42) h = 8;
  else if (x >= PAD_FLAT_X) h = 8 - ((-42 - x) * 8) / 30;
  else h = 0;
  const out = Math.max(PAD_Z0 - z, z - PAD_Z1, 0);
  return Math.max(0, h - out * Math.tan(45 * D));
}
function padSurface(x, z) {
  if (x >= PAD_FLAT_X) return -1;
  for (const p of PAD_STRIPS) if (z >= p.z0 && z < p.z1) return p.s;
  return -1;
}

// --- South half-pipe trench along z at x = 0.
const HP_Z0 = 70, HP_ZDEEP = 155, HP_Z1 = 180, HP_DEPTH = 12;
function trenchCut(x, z) {
  if (z <= HP_Z0 || z >= HP_Z1) return 0;
  const depth = z < HP_ZDEEP ? (HP_DEPTH * (z - HP_Z0)) / (HP_ZDEEP - HP_Z0)
    : HP_DEPTH * (1 - (z - HP_ZDEEP) / (HP_Z1 - HP_ZDEEP));
  const d = Math.abs(x), floor = 2.5, R = 7, phi = 72 * D;
  const dEdge = floor + R * Math.sin(phi), hEdge = R * (1 - Math.cos(phi));
  let u;
  if (d <= floor) u = 0;
  else if (d <= dEdge) u = R - Math.sqrt(R * R - (d - floor) ** 2);
  else u = hEdge + (d - dEdge) * Math.tan(62 * D);
  return Math.min(0, u - depth);
}

function rim(x, z) {
  return Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - RIM);
}

export function courseHeight(x, z) {
  return Math.max(runHeight(x, z), laneHeight(x, z), padHeight(x, z)) + trenchCut(x, z) + rim(x, z);
}
export function courseSurface(x, z) {
  for (const f of [runSurface, laneSurface, padSurface]) {
    const s = f(x, z);
    if (s >= 0) return s;
  }
  return SURFACE.PACKED;
}

// Box colliders: center, size, surface (all axis-aligned, sitting on flat ground).
const box = (cx, cz, sx, sy, sz, surface, y0 = 0) => ({ center: [cx, y0 + sy / 2, cz], size: [sx, sy, sz], surface });
export const COURSE_BOXES = [
  // Chimney: ice wall + rock block 3.5 m apart; climb it by wall-kicking, top out on the block (8 m).
  box(-120, 100, 1, 12, 16, SURFACE.ICE),
  box(-112, 100, 8, 8, 16, SURFACE.ROCK),
  // Box steps 0.9 m apart in height.
  box(-90, 130, 4, 0.9, 4, SURFACE.PACKED), box(-86, 130, 4, 1.8, 4, SURFACE.PACKED),
  box(-82, 130, 4, 2.7, 4, SURFACE.PACKED), box(-78, 130, 4, 3.6, 4, SURFACE.PACKED),
  // Long rock wall for glancing kicks while running along it.
  box(-140, 150, 24, 10, 1, SURFACE.ROCK),
  // Tunnel (camera collision test).
  box(-74, 110, 1, 4, 16, SURFACE.ROCK), box(-66, 110, 1, 4, 16, SURFACE.ROCK),
  box(-70, 110, 9, 0.5, 16, SURFACE.ROCK, 4),
  // Cairn at the hub.
  box(5, -6, 1.2, 1.3, 1.2, SURFACE.ROCK),
];
export const CAIRNS = [[5, 0, -6]];

// Teleport stations (debug keys 1–7): position (feet) and camera yaw (0 = facing -z / north).
export const SPAWNS = [
  { name: 'hub', pos: [0, 0, 6], yaw: 0 },
  { name: 'run top', pos: [0, RUN_TOP, RUN_Z0 - RUN_LEN + 2], yaw: Math.PI },
  { name: 'surface pads', pos: [-36, 8, 0], yaw: Math.PI / 2 },
  { name: 'slope lanes', pos: [44, 0, 10], yaw: -Math.PI / 2 },
  { name: 'half-pipe', pos: [0, 0, 62], yaw: Math.PI },
  { name: 'wall-kick chimney', pos: [-117.75, 0, 112], yaw: 0 },
  { name: 'kicker line', pos: [17, runBase(84), RUN_Z0 - 84], yaw: Math.PI },
];

export function buildCourse() {
  const heightfield = new Heightfield(COURSE_SIZE, 1).fill(courseHeight, courseSurface);
  for (const s of SPAWNS) s.pos[1] = heightfield.heightAt(s.pos[0], s.pos[2]);
  return { heightfield, boxes: COURSE_BOXES, cairns: CAIRNS, spawns: SPAWNS };
}
