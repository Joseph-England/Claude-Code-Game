// Dev helper: generate the mountain in Node and write a top-down hillshaded map (PNG) with the
// route, sections, cairns and surfaces. Usage: node tools/map.mjs [out.png] [scale=1] [x0 z0 x1 z1]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateTerrain } from '../src/world/terrain-gen.js';
import { Route } from '../src/world/route.js';

const [out = 'map.png', scaleArg = '1', ...box] = process.argv.slice(2);
const g = generateTerrain({}, () => {});
console.log('timings (ms)', JSON.stringify(g.timings));
const { n, heights, surfaces, origin } = g;
const [x0, z0, x1, z1] = box.length === 4 ? box.map(Number) : [origin, origin, -origin, -origin];
const scale = Number(scaleArg); // pixels per metre
const W = Math.round((x1 - x0) * scale), Hh = Math.round((z1 - z0) * scale);
const img = new Uint8Array(W * Hh * 3);
const tint = [[200, 205, 215], [245, 245, 252], [120, 175, 235], [110, 100, 95]];
const at = (x, z) => {
  const i = Math.min(n - 1, Math.max(0, Math.round(x - origin))), j = Math.min(n - 1, Math.max(0, Math.round(z - origin)));
  return j * n + i;
};
let hmin = Infinity, hmax = -Infinity;
for (const h of heights) { hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
for (let py = 0; py < Hh; py++) {
  for (let px = 0; px < W; px++) {
    const x = x0 + px / scale, z = z0 + py / scale;
    const k = at(x, z);
    const dx = heights[at(x + 1, z)] - heights[at(x - 1, z)], dz = heights[at(x, z + 1)] - heights[at(x, z - 1)];
    const nx = -dx / 2, nz = -dz / 2, inv = 1 / Math.hypot(nx, 1, nz);
    const shade = Math.max(0.25, (nx * -0.6 + 1 * 0.6 + nz * -0.5) * inv / 0.97);
    const hNorm = (heights[k] - hmin) / (hmax - hmin);
    const c = tint[surfaces[k]];
    const contour = Math.abs(((heights[k] % 10) + 10) % 10) < 0.35 ? 0.8 : 1;
    const o = (py * W + px) * 3;
    for (let ch = 0; ch < 3; ch++) img[o + ch] = Math.min(255, c[ch] * shade * contour * (0.75 + 0.25 * hNorm));
  }
}
const route = new Route();
const colors = [[255, 60, 60], [255, 160, 40], [240, 220, 40], [60, 200, 90], [40, 200, 220], [60, 90, 255], [170, 80, 255], [255, 80, 200], [30, 30, 30]];
const dot = (x, z, c, r = 1) => {
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    const px = Math.round((x - x0) * scale) + a, py = Math.round((z - z0) * scale) + b;
    if (px >= 0 && py >= 0 && px < W && py < Hh) img.set(c, (py * W + px) * 3);
  }
};
for (let s = 0; s < route.length; s += 0.5 / scale) { const p = route.at(s); dot(p.x, p.z, colors[route.sectionIndexAt(s)], 1); }
route.sections.forEach((sec, k) => (sec.cairns ?? []).forEach(([ls, d]) => { const p = route.place(k, ls, d); dot(p.x, p.z, [0, 0, 0], 2); }));
// PNG encode (RGB, filter 0).
const raw = Buffer.alloc((W * 3 + 1) * Hh);
for (let y = 0; y < Hh; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const crcTable = new Int32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Hh, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} ${W}×${Hh}, heights ${hmin.toFixed(0)}…${hmax.toFixed(0)} m`);
