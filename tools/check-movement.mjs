// Automated movement checks: measure feel numbers headlessly and assert design targets.
// Run: npm run check   (prints a markdown table; exits 1 if a target is missed)
import { Controller } from '../src/player/controller.js';
import { Heightfield } from '../src/world/heightfield.js';
import { SURFACE_NAMES } from '../src/world/surfaces.js';
import { tuning } from '../src/tuning.js';
import { createLoop, FIXED_DT } from '../src/core/loop.js';

const DT = FIXED_DT;
const D = Math.PI / 180;
const worlds = new Map();
function world(key, hFn, surface) {
  const k = `${key}:${surface}`;
  if (!worlds.has(k)) worlds.set(k, { heightfield: new Heightfield(440, 1).fill(hFn, () => surface) });
  return worlds.get(k);
}
const flat = () => 0;
const cmd = (o = {}) => ({ moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false, ...o });

function spawn(w, pos = [0, 0, 0], vel = [0, 0, 0], grounded = true) {
  const c = new Controller(w, tuning);
  c.teleport([pos[0], pos[1] ?? 0, pos[2]]);
  if (pos[1] === undefined || grounded) c.pos.y = w.heightfield.heightAt(pos[0], pos[2]);
  c.vel.set(...vel);
  c.grounded = grounded;
  if (!grounded) c.state = 'air';
  c.groundNormal.copy(w.heightfield.normalAt(c.pos.x, c.pos.z, c.groundNormal));
  return c;
}
function run(c, seconds, cmdFn, until) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    c.step(DT, typeof cmdFn === 'function' ? cmdFn(i, c) : cmdFn, 0);
    if (until?.(c, i)) return i + 1;
  }
  return n;
}
const hspeed = (c) => Math.hypot(c.vel.x, c.vel.z);

const results = [];
const failures = [];
function record(name, value, unit, lo, hi) {
  const ok = (lo === undefined || value >= lo) && (hi === undefined || value <= hi);
  results.push({ name, value, unit, target: lo === undefined && hi === undefined ? '' : `${lo ?? ''}…${hi ?? ''}`, ok });
  if (!ok) failures.push(name);
}

// 1. Flat running per surface: top speed, time to 90 %, stopping distance.
const runTargets = { packed: [6.8, 7.05], powder: [4.5, 6.2], ice: [6.5, 7.05], rock: [6.8, 7.05] };
const t90Targets = { packed: [1.2, 2.2], ice: [4, 12] };
for (let s = 0; s < 4; s++) {
  const name = SURFACE_NAMES[s];
  const w = world('flat', flat, s);
  const c = spawn(w, [0, 0, 180]);
  const fwd = cmd({ moveY: 1 });
  let t90 = null;
  run(c, 12, fwd);
  const top = hspeed(c);
  const c2 = spawn(w, [0, 0, 180]);
  run(c2, 12, fwd, (cc, i) => { if (hspeed(cc) >= 0.9 * top) { t90 = (i + 1) * DT; return true; } });
  record(`run top speed — ${name}`, top, 'm/s', ...(runTargets[name] ?? []));
  record(`run time to 90 % — ${name}`, t90, 's', ...(t90Targets[name] ?? []));
  const z0 = c.pos.z;
  const ticks = run(c, 30, cmd(), (cc) => hspeed(cc) < 0.01);
  record(`run stop distance — ${name}`, Math.abs(c.pos.z - z0), 'm', ...(name === 'packed' ? [1.5, 4] : name === 'ice' ? [12, 40] : []));
  record(`run stop time — ${name}`, ticks * DT, 's');
}

// 2. Slide stopping distance from 15 m/s on flat, per surface.
const slideStop = {};
for (let s = 0; s < 4; s++) {
  const c = spawn(world('flat', flat, s), [0, 0, 200], [0, 0, -15]);
  run(c, 120, cmd({ slideHeld: true }), (cc) => hspeed(cc) < 0.05);
  slideStop[SURFACE_NAMES[s]] = 200 - c.pos.z;
  record(`slide stop from 15 m/s — ${SURFACE_NAMES[s]}`, 200 - c.pos.z, 'm');
}
if (!(slideStop.rock < slideStop.powder && slideStop.powder < slideStop.packed && slideStop.packed < slideStop.ice)) failures.push('slide stop order rock<powder<packed<ice');

// 3. Uphill running on slopes (rising toward -z): speed after 5 s, forced slide?
const walkable = {};
for (const [s, angles] of [[0, [10, 20, 30, 37, 40]], [2, [10, 20, 30]], [3, [40, 45, 50, 58]]]) {
  for (const a of angles) {
    const w = world(`up${a}`, (x, z) => Math.max(0, -z) * Math.tan(a * D), s);
    const c = spawn(w, [0, 0, -5]);
    const y0 = c.pos.y;
    let best = 0;
    run(c, 6, cmd({ moveY: 1 }), (cc) => { best = Math.max(best, cc.pos.y - y0); });
    walkable[`${SURFACE_NAMES[s]}${a}`] = best > 4;
    record(`uphill run ${a}° — ${SURFACE_NAMES[s]}: climbed in 6 s`, best / Math.sin(a * D), 'm along slope');
  }
}
for (const [k, want] of Object.entries({ packed30: true, packed37: true, packed40: false, rock45: true, rock50: true, rock58: false, ice30: false })) {
  if (walkable[k] !== want) failures.push(`walkability ${k} should be ${want}`);
}

// 4. Downhill slides from rest (slope falls toward -z): speed after 50 m and 150 m, per surface.
for (const a of [10, 20, 30]) {
  for (let s = 0; s < 4; s++) {
    const w = world(`down${a}`, (x, z) => (z + 220) * Math.tan(a * D), s);
    const c = spawn(w, [0, 0, 200]);
    let v50 = null;
    run(c, 60, cmd({ slideHeld: true }), (cc) => {
      const d = (200 - cc.pos.z) / Math.cos(a * D);
      if (v50 === null && d >= 50) v50 = cc.speed;
      return d >= 150 || (cc.speed < 0.01 && cc.time > 2);
    });
    const d = (200 - c.pos.z) / Math.cos(a * D);
    results.push({ name: `slide ${a}° — ${SURFACE_NAMES[s]}`, value: c.speed, unit: `m/s at ${d.toFixed(0)} m (at 50 m: ${v50?.toFixed(1) ?? '—'})`, target: '', ok: true });
  }
}

// Write the table.
const pad = (s, n) => String(s).padEnd(n);
console.log(`| check | value | unit | target | ok |\n|---|---|---|---|---|`);
for (const r of results) {
  const v = typeof r.value === 'number' ? r.value.toFixed(2) : r.value;
  console.log(`| ${pad(r.name, 34)} | ${pad(v, 6)} | ${r.unit} | ${r.target} | ${r.ok ? '✓' : '✗'} |`);
}
if (failures.length) {
  console.log(`\nFAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nAll movement targets met.');
