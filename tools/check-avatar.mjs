// Avatar animation check: drives the real Controller with scripted input on real heightfields and
// the Avatar on top of it (as the game does), then measures what makes a figure look wrong:
//   - NaN anywhere in the skeleton (the mesh vanishes for those frames),
//   - planted feet that slide, soles that sink or float,
//   - pops: the largest jump in any joint's acceleration in the world (m/s² beyond what the motion
//     itself explains), and where it happens,
//   - the standing height once settled (a crouch at rest), and how low the hips go in each move.
// Usage: node tools/check-avatar.mjs [scenario]   — exits 1 if a target is missed.
import * as THREE from 'three';
import { Controller } from '../src/player/controller.js';
import { Heightfield } from '../src/world/heightfield.js';
import { tuning } from '../src/tuning.js';
import { FIXED_DT } from '../src/core/loop.js';
import { Avatar, ANKLE_H, BALL_F, HEEL_B } from '../src/player/avatar.js';

const DT = FIXED_DT;
const only = process.argv[2];
const worlds = {};
const world = (name, fn) => (worlds[name] ??= { heightfield: new Heightfield(220, 1).fill(fn, () => 0) });
const cmd = (o = {}) => ({ moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false, sprintHeld: false, ...o });

const results = [], failures = [];
function record(scn, name, value, lo, hi, unit = '') {
  const ok = (lo === undefined || value >= lo) && (hi === undefined || value <= hi);
  results.push(`| ${scn} | ${name} | ${Number.isFinite(value) ? value.toFixed(3) : value} ${unit} | ${lo ?? ''}…${hi ?? ''} | ${ok ? '✓' : '✗'} |`);
  if (!ok) failures.push(`${scn}: ${name}`);
}

/**
 * Run one scenario. script(t, c, av) → cmd (and may set av.wake etc.). Returns the measurements.
 */
function scenario(name, w, seconds, script, { start = [0, 0, 60], wake = 1, yaw = 0, camYaw = 0, frames = null } = {}) {
  if (only && only !== name) return null;
  const c = new Controller(w, tuning);
  c.teleport([start[0], w.heightfield.heightAt(start[0], start[2]), start[2]], yaw);
  c.grounded = true;
  const av = new Avatar(new THREE.Scene(), tuning);
  av.wake = wake;
  const joints = () => [av.head, av.hips, ...av.legs.flatMap((l) => [l.knee, l.ankle]), ...av.arms.flatMap((a) => [a.elbow])];
  const names = ['head', 'hips', 'kneeL', 'ankleL', 'kneeR', 'ankleR', 'elbowL', 'elbowR'];
  const hist = [], m = { hipLo: 9, hipHi: -9, nan: 0, slip: 0, sink: 0, float: 0, pop: 0, popAt: '', popB: 0, popBAt: '', minHip: 9, restHip: null, restKnee: 0 };
  const heel = new THREE.Vector3(), ball = new THREE.Vector3(), p = new THREE.Vector3(), inv = new THREE.Matrix4();
  const last = [null, null];
  const n = Math.round(seconds / DT);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    c.step(DT, script(t, c, av), camYaw);
    // Render frames of their own length (hitches included) when a schedule is given.
    if (frames) { acc += DT; const fdt = frames(t); if (acc < fdt) continue; av.update(c, c.pos, 1, acc); acc = 0; }
    else av.update(c, c.pos, 1, DT);
    av.root.updateMatrixWorld(true);
    // NaN
    let bad = false;
    av.root.traverse((o) => { if (o.isBone && o.matrixWorld.elements.some((e) => !Number.isFinite(e))) bad = true; });
    if (bad) { m.nan++; continue; }
    // Joint positions in the world, as they are seen (steady travel has no acceleration, so it is no
    // "pop"; the controller's own steps — an instant stop at the snow on landing — are, unless the
    // figure absorbs them).
    const js = joints().map((j) => j.getWorldPosition(p.clone()));
    hist.push(js);
    // Pops: an acceleration spike that stands out from its neighbours (a velocity step), measured
    // on each joint: |A(k) − (A(k−1) + A(k+1)) / 2|. Smooth fast motion (a knee
    // snapping through in late swing) has a smooth acceleration curve and scores low.
    if (hist.length >= 5) {
      const P = hist.slice(-5);
      const A = (k, j) => P[k + 1][j].clone().add(P[k - 1][j]).sub(P[k][j].clone().multiplyScalar(2)).divideScalar(DT * DT);
      js.forEach((_, j) => {
        const a1 = A(1, j), a2 = A(2, j), a3 = A(3, j);
        const spike = a2.clone().sub(a1.clone().add(a3).multiplyScalar(0.5)).length();
        const at = `${names[j]} t=${(t - DT * 2).toFixed(3)} state ${c.state} v ${Math.hypot(c.vel.x, c.vel.z).toFixed(1)}`;
        if (t <= 0.1) return;
        if (/knee|ankle/.test(names[j])) { if (spike > m.pop) { m.pop = spike; m.popAt = at; } }
        else if (spike > m.popB) { m.popB = spike; m.popBAt = at; }
      });
    }
    // Feet
    av.legs.forEach((leg, k) => {
      if (!leg.stance || av.ikW < 0.999) { last[k] = null; return; } // (while the IK blends in over the pose the foot moves between the two by design)
      leg.ankle.localToWorld(heel.set(0, -ANKLE_H, HEEL_B));
      leg.ankle.localToWorld(ball.set(0, -ANKLE_H, -BALL_F));
      const gH = w.heightfield.heightAt(heel.x, heel.z), gB = w.heightfield.heightAt(ball.x, ball.z);
      const sole = Math.min(heel.y - gH, ball.y - gB);
      m.sink = Math.min(m.sink, sole); m.float = Math.max(m.float, sole);
      if (last[k]) { const sl = Math.min(heel.distanceTo(last[k][0]), ball.distanceTo(last[k][1])) / DT; if (sl > m.slip) { m.slip = sl; m.slipAt = `t=${t.toFixed(3)} leg${k} sole ${sole.toFixed(3)} v ${Math.hypot(c.vel.x, c.vel.z).toFixed(1)} state ${c.state} grounded ${c.grounded} hag ${(c.heightAboveGround ?? 0).toFixed(3)}`; } }
      last[k] = [heel.clone(), ball.clone()];
    });
    if (av.wake >= 1) m.minHip = Math.min(m.minHip, av.pelvis);
    if (av.pelvis !== undefined && av.ikW > 0.5) { m.hipLo = Math.min(m.hipLo, av.pelvis); m.hipHi = Math.max(m.hipHi, av.pelvis); }
    m.restHip = av.pelvis;
    m.restKnee = Math.max(-av.legs[0].knee.rotation.x, -av.legs[1].knee.rotation.x);
  }
  return m;
}

const flat = world('flat', () => 0);
const slope = world('slope', (x, z) => -z * 0.3); // uphill toward −z (≈17°)
const standH = ANKLE_H + (0.44 + 0.44) * 0.9975;
const common = (name, m, { minHip = 0.8 } = {}) => {
  if (!m) return;
  record(name, 'NaN frames', m.nan, 0, 0);
  record(name, 'planted foot slip', m.slip, 0, 0.02, 'm/s');
  record(name, 'sole below snow', -m.sink, 0, 0.005, 'm');
  record(name, 'sole above snow (planted)', m.float, 0, 0.012, 'm');
  record(name, 'body pop (head/hips/arms)', m.popB, 0, 150, 'm/s²');
  record(name, 'leg pop (knees/ankles)', m.pop, 0, 300, 'm/s²');
  record(name, 'lowest hips (awake)', m.minHip, minHip, undefined, 'm');
  console.log(`  ${name}: body pop at ${m.popBAt} | leg pop at ${m.popAt} | slip at ${m.slipAt}`);
};

// Walk / run / sprint, then let go and stand: the rest height must be the standing height.
for (const [name, sprint, moveY] of [['walk-slow', false, 0.35], ['run', false, 1], ['sprint', true, 1]]) {
  const m = scenario(name, flat, 5, (t) => cmd(t > 0.3 && t < 3 ? { moveY, sprintHeld: sprint } : {}));
  common(name, m, { minHip: name === 'sprint' ? 0.74 : 0.8 });
  if (m) { record(name, 'hips at rest (settled)', m.restHip, standH - 0.012, standH + 0.01, 'm'); record(name, 'knee bend at rest', m.restKnee, 0, 0.2, 'rad'); }
}
// Turn around on the spot (stand, then hold back: the controller turns and walks the other way).
common('turn-around', scenario('turn-around', flat, 4, (t) => cmd(t > 0.5 && t < 0.8 ? { moveY: -1 } : t > 1.5 && t < 1.65 ? { moveX: 1 } : {})));
// Slopes: up and down.
common('slope-up', scenario('slope-up', slope, 4, (t) => cmd(t > 0.3 && t < 3 ? { moveY: 1 } : {})), { minHip: 0.72 });
common('slope-down', scenario('slope-down', slope, 4, (t) => cmd(t > 0.3 && t < 3 ? { moveY: 1 } : {}), { yaw: Math.PI, camYaw: Math.PI }), { minHip: 0.72 });
// Turning round on a slope (the planted feet pivot on the incline).
common('slope-turn', scenario('slope-turn', slope, 4, (t) => cmd(t > 0.3 && t < 3 ? { moveY: 1 } : {}), { yaw: Math.PI }), { minHip: 0.7 });
// Jump and land running.
common('jump', scenario('jump', flat, 3, (t) => cmd({ moveY: t < 2 ? 1 : 0, jumpPressed: Math.abs(t - 0.8) < DT / 2, jumpHeld: t > 0.8 && t < 1.1 })), { minHip: 0.7 });
// The opening: lying → getting up over 2.6 s, as the game drives `wake`.
{
  const m = scenario('get-up', flat, 4, (t, c, av) => { av.wake = Math.min(1, Math.max(0, (t - 0.3) / 2.6)); return cmd(); }, { wake: 0 });
  if (m) {
    record('get-up', 'NaN frames', m.nan, 0, 0);
    record('get-up', 'body pop (head/hips/arms)', m.popB, 0, 150, 'm/s²');
    record('get-up', 'leg pop (knees/ankles)', m.pop, 0, 300, 'm/s²');
    record('get-up', 'hips at rest (settled)', m.restHip, standH - 0.012, standH + 0.01, 'm');
    console.log(`  get-up: pop at ${m.popAt}`);
  }
}

// Slow and uneven frames (loading, a busy machine): 16–110 ms. Nothing may blow up.
{
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const frames = () => (rnd() < 0.25 ? 0.07 + 0.04 * rnd() : 0.016 + 0.02 * rnd());
  for (const [name, wake, script] of [['hitch-getup', 0, (t, c, av) => { av.wake = Math.min(1, Math.max(0, (t - 0.3) / 2.6)); return cmd(); }], ['hitch-run', 1, (t) => cmd(t > 0.3 && t < 3 ? { moveY: 1 } : {})]]) {
    const m = scenario(name, flat, 4.5, script, { wake, frames });
    if (!m) continue;
    record(name, 'NaN frames', m.nan, 0, 0);
    record(name, 'hips lowest (IK on)', m.hipLo, 0.1, undefined, 'm');
    record(name, 'hips highest', m.hipHi, undefined, 1.0, 'm');
  }
}

console.log('\n| scenario | measure | value | target | ok |\n|---|---|---|---|---|');
console.log(results.join('\n'));
if (failures.length) { console.log(`\n${failures.length} missed: ${failures.join('; ')}`); process.exitCode = 1; } else console.log('\nAll avatar targets met.');
