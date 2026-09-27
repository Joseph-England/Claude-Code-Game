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
