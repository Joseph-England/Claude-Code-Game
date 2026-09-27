// The visual story arc (DESIGN §1 "Emotional arc", §4 "Arc"): everything that changes with route
// progress lives here — sun elevation (DECISIONS #12, #52), and the per-section colour grade.
import * as THREE from 'three';

const D2R = Math.PI / 180;
export const SUN_AZIMUTH = 112 * D2R; // west-south-west: into the sun on the summit push, sunset ahead from the top

/** Sun elevation (rad) for route progress fraction p (0..1) and seconds since reaching the summit. */
export function sunElevation(p, sinceSummit = -1) {
  const e = 12 - 11.2 * Math.pow(THREE.MathUtils.clamp(p, 0, 1), 1.15); // +12° → +0.8° at the top
  if (sinceSummit < 0) return e * D2R;
  // After arrival the sun keeps going: under the horizon to −5° over ~40 s (Phase 5's ending owns it).
  const u = THREE.MathUtils.smootherstep(sinceSummit, 0, 40);
  return THREE.MathUtils.lerp(e, -5, u) * D2R;
}

// Snowfall density per section (0 Opening … 8 Summit): light flurries, more on the ridge, the
// blizzard in the whiteout (driven by level.wind.whiteout on top of this), then clear skies.
const SNOW = [0.12, 0.08, 0.15, 0.1, 0.3, 0.05, 0.4, 0.04, 0];

/** Smoothly interpolated per-section value at route arc length s. */
export function sectionValue(route, table, s) {
  const k = route.sectionIndexAt(s), sec = route.sections[k];
  const u = (s - sec.s0) / sec.len;
  const next = table[Math.min(k + 1, table.length - 1)], prev = table[Math.max(k - 1, 0)];
  if (u > 0.85) return THREE.MathUtils.lerp(table[k], next, THREE.MathUtils.smoothstep(u, 0.85, 1.15) );
  if (u < 0.15) return THREE.MathUtils.lerp(prev, table[k], THREE.MathUtils.smoothstep(u, -0.15, 0.15));
  return table[k];
}
export const snowDensity = (route, s) => sectionValue(route, SNOW, s);

// Colour grade per section: [saturation, temperature (− cool, + warm), contrast]. Numb and grey at
// the start, warming as you climb, cold in the cave, drained in the whiteout, the colour climax
// after the storm, a cooler blue hour on the summit (DESIGN §1 "Emotional arc", §4 "Arc").
const GRADE = [
  [0.45, -0.3, 0.92], [0.6, -0.15, 0.95], [0.72, 0, 1.0], [1.0, 0.25, 1.05], [1.05, 0.3, 1.08],
  [0.85, -0.5, 1.0], [0.2, -0.1, 0.9], [1.3, 0.45, 1.1], [1.15, -0.1, 1.05],
];
export function grade(route, s) {
  return [0, 1, 2].map((i) => sectionValue(route, GRADE.map((g) => g[i]), s));
}
