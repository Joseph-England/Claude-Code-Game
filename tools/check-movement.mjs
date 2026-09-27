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

const fmt = (x) => (x === undefined ? '' : +x.toFixed(2));
const results = [];
const failures = [];
function record(name, value, unit, lo, hi) {
  const ok = (lo === undefined || value >= lo) && (hi === undefined || value <= hi);
  results.push({ name, value, unit, target: lo === undefined && hi === undefined ? '' : `${fmt(lo)}…${fmt(hi)}`, ok });
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

// 5. Jumps on flat packed snow.
const flatW = world('flat', flat, 0);
function jumpApex(opts) {
  const c = spawn(flatW, [0, 0, 150], opts.vel ?? [0, 0, 0]);
  let apex = 0, air = 0, x0 = c.pos.z, landedAt = null;
  const ticks = run(c, 5, (i) => cmd({ moveY: opts.move ? 1 : 0, slideHeld: !!opts.slide, jumpPressed: i === 0, jumpHeld: i < (opts.hold ?? 1e9) }),
    (cc, i) => { apex = Math.max(apex, cc.pos.y); if (!cc.grounded) air = (i + 1) * DT; else if (i > 2) { landedAt = cc; return true; } });
  return { apex, air, dist: Math.abs(c.pos.z - x0), speedAfter: hspeed(c), c };
}
const full = jumpApex({});
record('jump height — full hold', full.apex, 'm', 1.3, 1.5);
record('jump airtime — full hold', full.air, 's', 0.8, 1.05);
const tap = jumpApex({ hold: 1 });
record('jump height — tap (released at once)', tap.apex, 'm', 0.4, 0.75);
const running = jumpApex({ move: true, vel: [0, 0, -7] });
record('running jump distance at 7 m/s', running.dist, 'm', 5, 8);
record('horizontal speed kept after landing', running.speedAfter, 'm/s', 6.8);
const sj = jumpApex({ slide: true, vel: [0, 0, -15] });
record('slide-jump height at 15 m/s', sj.apex, 'm', 0.6, full.apex - 0.2);
record('slide-jump distance at 15 m/s', sj.dist, 'm', 1.5 * running.dist);
record('slide-jump speed kept after landing', sj.speedAfter, 'm/s', 14.5);

// 6. Coyote time and jump buffer (run off a 3 m ledge at z = 0).
const ledge = world('ledge', (x, z) => (z > 0 ? 3 : 0), 0);
function ledgeJump(delay) {
  const c = spawn(ledge, [0, 0, 6], [0, 0, -7]);
  let airAt = -1, jumped = false;
  run(c, 2, (i, cc) => {
    if (airAt < 0 && !cc.grounded) airAt = i;
    return cmd({ moveY: 1, jumpPressed: airAt >= 0 && i === airAt + Math.round(delay / DT), jumpHeld: true });
  }, (cc) => { if (cc.events.some((e) => e.type === 'jump')) jumped = true; return jumped; });
  return jumped;
}
if (!ledgeJump(0.06)) failures.push('coyote: jump 60 ms after leaving a ledge should work');
if (ledgeJump(0.16)) failures.push('coyote: jump 160 ms after leaving a ledge should not work');
results.push({ name: 'coyote window', value: tuning.jump.coyote, unit: 's (60 ms ok, 160 ms refused)', target: '', ok: true });
{
  const c = spawn(flatW, [0, 1.2, 150], [0, 0, 0], false);
  let pressedAt = null, jumpedAt = null;
  run(c, 2, (i, cc) => {
    // Press jump ~0.1 s before touching down.
    const press = pressedAt === null && cc.pos.y + cc.vel.y * 0.1 + 0.5 * -18 * 0.01 < 0;
    if (press) pressedAt = i;
    return cmd({ jumpPressed: press, jumpHeld: true });
  }, (cc, i) => { if (cc.events.some((e) => e.type === 'jump')) { jumpedAt = i; return true; } });
  if (jumpedAt === null) failures.push('jump buffer: early press before landing should jump on touchdown');
  results.push({ name: 'jump buffer: pressed before landing', value: jumpedAt === null ? 'no' : ((jumpedAt - pressedAt) * DT * 1000).toFixed(0), unit: 'ms later it jumped', target: '', ok: jumpedAt !== null });
}

// 7. Landings: stumble threshold, downslope landing keeps speed.
for (const hDrop of [3, 4]) {
  const c = spawn(flatW, [0, hDrop, 150], [0, 0, -5], false);
  let stumbled = false;
  run(c, 2, cmd(), (cc) => { if (cc.events.some((e) => e.type === 'stumble')) stumbled = true; return cc.grounded; });
  results.push({ name: `flat landing from ${hDrop} m`, value: stumbled ? 'stumble' : 'clean', unit: '', target: hDrop === 3 ? 'clean' : 'stumble', ok: stumbled === (hDrop === 4) });
  if (stumbled !== (hDrop === 4)) failures.push(`landing from ${hDrop} m`);
}
{
  const w = world('down30', (x, z) => (z + 220) * Math.tan(30 * D), 0);
  const c = spawn(w, [0, 0, 100], [0, 0, -10], false);
  c.pos.y = w.heightfield.heightAt(0, 100) + 2;
  run(c, 2, cmd({ slideHeld: true }), (cc) => cc.grounded);
  record('land on 30° downslope at 10 m/s from 2 m: speed after', c.speed, 'm/s', 10);
}

// 8. Crest behaviour (convex crest of radius 20 m: launch speed √(g·R) ≈ 17.3 m/s).
const crest = world('crest', (x, z) => 40 - (z * z) / 40, 0);
for (const [v, slide, wantAir] of [[12, true, false], [22, true, true], [7, false, false]]) {
  const c = spawn(crest, [0, 0, 0.5], [0, 0, -v]);
  let airborne = false;
  run(c, 0.8, cmd({ slideHeld: slide, moveY: slide ? 0 : 1 }), (cc) => { if (!cc.grounded) airborne = true; });
  results.push({ name: `crest R=20 m at ${v} m/s (${slide ? 'slide' : 'run'})`, value: airborne ? 'launch' : 'stays down', unit: '', target: wantAir ? 'launch' : 'stays down', ok: airborne === wantAir });
  if (airborne !== wantAir) failures.push(`crest ${v} m/s`);
}

// 9. Frame-rate independence: same inputs through the real loop at different frame rates.
{
  const finals = [];
  for (const fps of [30, 60, 144, 240, 'jitter']) {
    const c = spawn(flatW, [0, 0, 150]);
    let t = 0, first = true, apex = 0;
    const loop = createLoop({
      update: (dt) => { c.step(dt, cmd({ moveY: 1, jumpPressed: first, jumpHeld: true }), 0); first = false; apex = Math.max(apex, c.pos.y); },
      render: () => {},
    });
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let steps = 0;
    while (t < 3 - 1e-9) {
      const dt = fps === 'jitter' ? Math.min(3 - t, 0.004 + rnd() * 0.04) : Math.min(3 - t, 1 / fps);
      steps += loop.advance(dt);
      t += dt;
    }
    finals.push({ fps, steps, z: c.pos.z, apex });
  }
  const zs = finals.map((f) => f.z), apexes = finals.map((f) => f.apex);
  const spread = Math.max(...zs) - Math.min(...zs), apexSpread = Math.max(...apexes) - Math.min(...apexes);
  record('frame-rate spread: position after 3 s (30/60/144/240/jitter fps)', spread, 'm', 0, 0.06);
  record('frame-rate spread: jump apex', apexSpread, 'm', 0, 1e-6);
  results.push({ name: 'physics steps in 3 s at each frame rate', value: finals.map((f) => f.steps).join('/'), unit: '', target: '360', ok: true });
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
