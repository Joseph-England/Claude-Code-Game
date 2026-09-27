// The mountain as the game sees it: heightfield (collision + render data), route, and O(1) route
// projection from the generator's distance field. loadMountain() uses the worker; Node tools call
// generateMountain() directly (same deterministic output).
import { Heightfield } from './heightfield.js';
import { Route } from './route.js';
import { generateTerrain } from './terrain-gen.js';

export function buildMountain(g) {
  const heightfield = new Heightfield(g.size, g.cell);
  heightfield.heights = g.heights;
  heightfield.surfaces = g.surfaces;
  heightfield.normals = null; // the terrain renderer derives normals on the GPU
  const route = new Route();
  const { n, origin, cell, routeS, routeD } = g;
  return {
    ...g,
    heightfield,
    route,
    /** Nearest route arc length s and signed lateral offset d (s = -1 when > 100 m away). */
    project(x, z, out = {}) {
      const i = Math.min(n - 1, Math.max(0, Math.round((x - origin) / cell)));
      const j = Math.min(n - 1, Math.max(0, Math.round((z - origin) / cell)));
      out.s = routeS[j * n + i];
      out.d = routeD[j * n + i];
      return out;
    },
  };
}

export function generateMountain(opts) {
  return buildMountain(generateTerrain(opts));
}

/** Generate in a worker; onProgress(fraction, label). Falls back to the main thread. */
export function loadMountain(onProgress = () => {}, opts = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(buildMountain(generateTerrain(opts, onProgress)));
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data.f, e.data.label);
      else { worker.terminate(); resolve(buildMountain(e.data.g)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(e); };
    worker.postMessage(opts);
  });
}
