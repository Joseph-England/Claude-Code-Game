// Dev helper: preview the distant ranges (world/ranges.js) as a hillshaded PNG, plus a panorama
// (height silhouette seen from the summit, per azimuth) so the skyline can be judged without the
// browser. Usage: node tools/ranges.mjs out-prefix
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateRanges } from '../src/world/ranges.js';

const prefix = process.argv[2] ?? 'ranges';
const n = Number(process.argv[3] ?? 257), size = 14000, t0 = Date.now();
const h = generateRanges({ n, size, iterations: Number(process.argv[4] ?? 140) });
console.log(`ranges ${n}² in ${Date.now() - t0} ms`);
function png(file, W, H, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const cell = size / (n - 1);
let lo = Infinity, hi = -Infinity;
for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
const img = new Uint8Array(n * n * 3);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const k = j * n + i, a = h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)], b = h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i];
  const nx = -a / (2 * cell), nz = -b / (2 * cell), inv = 1 / Math.hypot(nx, 1, nz);
  const shade = Math.max(0.15, (nx * -0.6 + 0.6 + nz * -0.5) * inv / 0.97);
  const t = (h[k] - lo) / (hi - lo);
  const snow = t > 0.3 && inv > 0.55;
  const base = snow ? [235, 238, 245] : [120 + 60 * t, 110 + 60 * t, 100 + 60 * t];
  img.set(base.map((c) => Math.min(255, c * shade)), k * 3);
}
png(`${prefix}-map.png`, n, n, img);
// Panorama from the summit (≈ 120 m high at (-30, -220)): elevation angle of the skyline per azimuth.
const W = 1440, H = 300, pano = new Uint8Array(W * H * 3).fill(40);
const sx = -30, sz = -220, sy = 125;
for (let c = 0; c < W; c++) {
  const az = (c / W) * Math.PI * 2, dx = Math.sin(az), dz = -Math.cos(az);
  let best = -1;
  for (let d = 600; d < 7000; d += 20) {
    const x = sx + dx * d, z = sz + dz * d, i = Math.round((x + size / 2) / cell), j = Math.round((z + size / 2) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) break;
    best = Math.max(best, Math.atan2(h[j * n + i] - sy, d));
  }
  const top = Math.round(H * 0.85 - best * (180 / Math.PI) * 8); // 8 px per degree; the valley horizon at 85 %
  for (let y = Math.max(0, top); y < H; y++) pano.set([200, 205, 215], (y * W + c) * 3);
}
png(`${prefix}-pano.png`, W, H, pano);
console.log(`heights ${lo.toFixed(0)}…${hi.toFixed(0)} m; wrote ${prefix}-map.png, ${prefix}-pano.png`);
