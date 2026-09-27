// Dev check for the foot-planted gait (DECISIONS #74): drives the avatar in Node over flat ground
// and slopes at walk and sprint speed and measures, per foot, how far a planted foot slides and
// how far the sole sits above/below the snow while planted. Usage: node tools/check-gait.mjs
import * as THREE from 'three';
import { Avatar } from '../src/player/avatar.js';
import { tuning } from '../src/tuning.js';

const SHIN = 0.44;
function run(speed, slope, heading = 0) {
  const hf = { heightAt: (x, z) => -z * slope }; // uphill toward -z
  const scene = new THREE.Scene(), av = new Avatar(scene, tuning);
  av.wake = 1;
  const n = new THREE.Vector3(0, 1, slope).normalize();
  const ctl = {
    world: { heightfield: hf }, state: 'run', grounded: true, groundSurface: 0, groundNormal: n, heightAboveGround: 0,
    vel: new THREE.Vector3(Math.sin(heading) * -speed, 0, -Math.cos(heading) * speed), facing: heading, prevFacing: heading,
    lean: new THREE.Vector2(), prevLean: new THREE.Vector2(), time: 0,
  };
  const pos = new THREE.Vector3(), dt = 1 / 60, p = new THREE.Vector3();
  const stats = av.legs.map(() => ({ slide: 0, pen: 0, float: 0, n: 0, last: null }));
  let steps = 0, pmin = 9, pmax = 0, kmax = 0;
  av.onFoot = () => steps++;
  for (let f = 0; f < 240; f++) {
    pos.x += ctl.vel.x * dt; pos.z += ctl.vel.z * dt; pos.y = hf.heightAt(pos.x, pos.z);
    av.update(ctl, pos, 1, dt);
    if (f < 60) continue;
    pmin = Math.min(pmin, av.pelvis); pmax = Math.max(pmax, av.pelvis);
    for (const leg of av.legs) kmax = Math.max(kmax, -leg.knee.rotation.x);
    av.legs.forEach((leg, i) => {
      leg.knee.localToWorld(p.set(0, -SHIN, 0));
      const sole = p.y - 0.06 - hf.heightAt(p.x, p.z), st = stats[i];
      if (leg.up === 0) { // planted
        if (st.last) st.slide = Math.max(st.slide, Math.hypot(p.x - st.last.x, p.z - st.last.z) / dt);
        st.pen = Math.min(st.pen, sole); st.float = Math.max(st.float, sole); st.last = p.clone();
      } else st.last = null;
    });
  }
  const f = (v) => v.toFixed(3);
  console.log(`speed ${speed} slope ${slope.toFixed(2)} heading ${heading.toFixed(2)}: steps/s ${(steps / 4).toFixed(1)}, hips ${f(pmin)}…${f(pmax)} m, knee ≤ ${kmax.toFixed(2)} rad | ` + stats.map((s, i) => `${i ? 'R' : 'L'} slip ${f(s.slide)} m/s, sole ${f(s.pen)}…${f(s.float)} m`).join(' | '));
}
for (const sp of [2, 5, 9]) for (const sl of [0, 0.36, -0.36]) run(sp, sl);
run(5, 0.36, Math.PI / 2);

// Scarf: deepest any scarf vertex (ribbon edges included) gets inside the body's capsules (true
// radii, no margin), walking, sprinting, turning, in a side gust and standing in a headwind.
function scarf(label, speed, turn, wind) {
  const hf = { heightAt: () => 0 };
  const av = new Avatar(new THREE.Scene(), tuning);
  av.wake = 1;
  const ctl = {
    world: { heightfield: hf }, state: 'run', grounded: true, groundSurface: 0, groundNormal: new THREE.Vector3(0, 1, 0), heightAboveGround: 0,
    vel: new THREE.Vector3(), facing: 0, prevFacing: 0, lean: new THREE.Vector2(), prevLean: new THREE.Vector2(), time: 0,
  };
  const pos = new THREE.Vector3(), dt = 1 / 60, q = new THREE.Vector3(), ab = new THREE.Vector3();
  let worst = 0;
  for (let f = 0; f < 600; f++) {
    ctl.prevFacing = ctl.facing; ctl.facing += turn * dt;
    ctl.vel.set(-Math.sin(ctl.facing) * speed, 0, -Math.cos(ctl.facing) * speed);
    pos.addScaledVector(ctl.vel, dt);
    av.wind.set(wind[0] - ctl.vel.x, 0, wind[1] - ctl.vel.z);
    av.update(ctl, pos, 1, dt);
    if (f < 60) continue;
    const P = av.scarf.pos;
    for (let v = 4; v < P.length / 3; v++) { // skip the knot end (vertices 0–3)
      q.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      av.scarfCaps.forEach((c) => {
        ab.subVectors(c.b, c.a);
        const u = Math.max(0, Math.min(1, q.clone().sub(c.a).dot(ab) / ab.lengthSq()));
        const d = q.distanceTo(c.a.clone().addScaledVector(ab, u));
        worst = Math.max(worst, c.r - 0.01 - d);
      });
    }
  }
  console.log(`scarf ${label}: deepest inside the body ${Math.max(0, worst).toFixed(3)} m`);
}
scarf('standing, breeze', 0, 0, [1.7, 0.8]);
scarf('walk', 5, 0, [1.7, 0.8]);
scarf('sprint', 9, 0, [1.7, 0.8]);
scarf('walk turning', 5, 2.5, [1.7, 0.8]);
scarf('standing, side gust', 0, 0, [9, 0]);
scarf('standing, headwind', 0, 0, [0, 12]);
scarf('turning on the spot', 0, 4, [1.7, 0.8]);
scarf('standing, tailwind', 0, 0, [0, -12]);
scarf('walk, tailwind gust', 3, 0, [0, -14]);
