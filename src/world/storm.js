// The storm in the gap (DECISIONS #77). The whiteout is not weather that switches on: the path
// crosses a col between two rock horns, and the wind that has been building over the mountain is
// squeezed through the gap and speeds up there (the same funnelling that makes gap winds and
// blizzards in real passes), tearing snow off the flanks. So the storm lives in one place in the
// world — a chain of soft vertical cylinders along the col — which you see from the climb out of
// the hollow, walk into, and look back at once you are through. The same numbers drive the fog
// pass (render/fog.js integrates them along every view ray), the player's wind and particles
// (levelstate), and the audio.
// Pure JS: runs in the game and in the Node tools.

export const STORM_R = 34; // m, cylinder radius
export const STORM_NORM = 2.6; // sum of overlapping cylinder densities on the centreline
export const STORM_HEAD = 2.4; // m/s² headwind at full storm (down the gap, into your face)
export const STORM_TOP = 34; // m above the col where the blowing snow thins out

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** [[x, z, strength, baseHeight]…] along the section marked `storm` (strongest mid-gap). */
export function stormCylinders(route) {
  const sec = route.sections.find((s) => s.storm);
  if (!sec) return [];
  const out = [];
  for (let ls = 4; ls <= sec.len + 22; ls += 16) {
    const p = route.at(sec.s0 + ls);
    out.push([p.x, p.z, smooth(-14, 30, ls) * (1 - smooth(130, 200, ls)), route.heightAt(sec.s0 + ls)]);
  }
  return out;
}

/** Storm strength 0…1 at a point (1 = the heart of the gap). */
export function stormAt(cyl, x, z) {
  let sum = 0;
  for (const [cx, cz, s] of cyl) {
    const r2 = ((x - cx) ** 2 + (z - cz) ** 2) / (STORM_R * STORM_R);
    if (r2 < 1) sum += s * (1 - r2);
  }
  return Math.min(1, sum / STORM_NORM);
}

/** 0…1: how close the storm is (for its roar, heard before you are in it). */
export function stormNear(cyl, x, z) {
  let best = 0;
  for (const [cx, cz, s] of cyl) {
    const r = Math.hypot(x - cx, z - cz);
    best = Math.max(best, s * (1 - smooth(STORM_R * 0.5, STORM_R + 150, r)));
  }
  return best;
}
