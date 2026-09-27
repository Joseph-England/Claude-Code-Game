// Web Worker: generates the mountain off the main thread and reports progress (DECISIONS #8).
import { generateTerrain } from './terrain-gen.js';

self.onmessage = (e) => {
  let last = -1;
  const g = generateTerrain(e.data ?? {}, (f, label) => {
    const pct = Math.floor(f * 100);
    if (pct !== last) { last = pct; self.postMessage({ type: 'progress', f, label }); }
  });
  const transfer = [g.heights.buffer, g.surfaces.buffer, g.routeS.buffer, g.routeD.buffer, g.backdrop.buffer];
  self.postMessage({ type: 'done', g }, transfer);
};
