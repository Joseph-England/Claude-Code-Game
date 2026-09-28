// Dev check for the foot-planted gait (DECISIONS #74, #82): drives the avatar in Node over flat
// ground and slopes at walk and sprint speed and measures, per foot, how far the planted contact
// slides (the heel at strike, the whole sole when flat, the ball at toe-off: the slower of heel and
// ball each frame) and how far the sole sits above/below the snow while planted.
// Usage: node tools/check-gait.mjs
import * as THREE from 'three';
import { Avatar, ANKLE_H, BALL_F, HEEL_B } from '../src/player/avatar.js';
import { tuning } from '../src/tuning.js';

function run(speed, slope, heading = 0) {
  const hf = { heightAt: (x, z) => -z * slope }; // uphill toward -z (no sample(): the avatar differentiates)
  const scene = new THREE.Scene(), av = new Avatar(scene, tuning);
  av.wake = 1;
  const n = new THREE.Vector3(0, 1, slope).normalize();
  const ctl = {
    world: { heightfield: hf }, state: 'run', grounded: true, groundSurface: 0, groundNormal: n, heightAboveGround: 0,
    vel: new THREE.Vector3(Math.sin(heading) * -speed, 0, -Math.cos(heading) * speed), facing: heading, prevFacing: heading,
    lean: new THREE.Vector2(), prevLean: new THREE.Vector2(), time: 0,
  };
  const pos = new THREE.Vector3(), dt = 1 / 60, heel = new THREE.Vector3(), ball = new THREE.Vector3();
  const stats = av.legs.map(() => ({ slide: 0, pen: 0, float: 0, last: null }));
  let steps = 0, pmin = 9, pmax = 0, kmax = 0, tmin = 9, tmax = -9;
  av.onFoot = () => steps++;
  for (let f = 0; f < 240; f++) {
    pos.x += ctl.vel.x * dt; pos.z += ctl.vel.z * dt; pos.y = hf.heightAt(pos.x, pos.z);
    av.update(ctl, pos, 1, dt);
    av.root.updateMatrixWorld(true);
    if (f < 60) continue;
    pmin = Math.min(pmin, av.pelvis); pmax = Math.max(pmax, av.pelvis);
    av.legs.forEach((leg, i) => {
      kmax = Math.max(kmax, -leg.knee.rotation.x);
      leg.ankle.localToWorld(heel.set(0, -ANKLE_H, HEEL_B));
      leg.ankle.localToWorld(ball.set(0, -ANKLE_H, -BALL_F));
      const st = stats[i];
      if (leg.stance) {
        if (st.last) {
          const vh = Math.hypot(heel.x - st.last[0].x, heel.z - st.last[0].z) / dt, vb = Math.hypot(ball.x - st.last[1].x, ball.z - st.last[1].z) / dt;
          st.slide = Math.max(st.slide, Math.min(vh, vb));
        }
        const sole = Math.min(heel.y - hf.heightAt(heel.x, heel.z), ball.y - hf.heightAt(ball.x, ball.z));
        st.pen = Math.min(st.pen, sole); st.float = Math.max(st.float, sole); st.last = [heel.clone(), ball.clone()];
        const toe = leg.pitch; tmin = Math.min(tmin, toe); tmax = Math.max(tmax, toe);
      } else st.last = null;
    });
  }
  const f = (v) => v.toFixed(3);
  console.log(`speed ${speed} slope ${slope.toFixed(2)} heading ${heading.toFixed(2)}: steps/s ${(steps / 4).toFixed(1)}, hips ${f(pmin)}…${f(pmax)} m, knee ≤ ${kmax.toFixed(2)} rad, foot pitch in stance ${tmin.toFixed(2)}…${tmax.toFixed(2)} | ` + stats.map((s, i) => `${i ? 'R' : 'L'} slip ${f(s.slide)} m/s, sole ${f(s.pen)}…${f(s.float)} m`).join(' | '));
}
for (const sp of [2, 5, 9]) for (const sl of [0, 0.36, -0.36]) run(sp, sl);
run(5, 0.36, Math.PI / 2);
