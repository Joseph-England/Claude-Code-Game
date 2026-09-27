// Procedural avatar (DESIGN §4 "Character", showcase #4): a small climber built from lathed and
// rounded primitives in a joint hierarchy, animated entirely in code — a gait cycle driven by
// distance travelled (walk → sprint), a boot-ski crouch for slides, a tuck in the air, a real
// sitting pose for rests, lying in the snow and getting up (the opening), a reach down to leave a
// stone, a stumble wobble — plus a red scarf simulated as a cloth strip in the wind.
// Standing still is still: no idle sway or breathing bob (user playtest, DECISIONS #64). Lean is
// deliberately small (DECISIONS #50).
import * as THREE from 'three';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const THIGH = 0.44, SHIN = 0.44, TORSO = 0.54;

// Pose parameters that blend smoothly between states (the gait adds on top).
const POSES = {
  stand: { thigh: 0, knee: 0.04, torso: 0.03, armOut: 0.1, arm: 0.04, elbow: 0.2, head: 0, reach: 0 },
  run: { thigh: 0, knee: 0.1, torso: 0.12, armOut: 0.1, arm: 0, elbow: 0.9, head: -0.05, reach: 0 },
  slide: { thigh: 1.0, knee: 1.75, torso: 0.45, armOut: 0.85, arm: 0.35, elbow: 0.5, head: -0.3, reach: 0 },
  air: { thigh: 0.55, knee: 1.0, torso: 0.2, armOut: 0.45, arm: 0.5, elbow: 0.6, head: -0.1, reach: 0 },
  sit: { thigh: 2.2, knee: 2.3, torso: 0.3, armOut: 0.16, arm: 1.0, elbow: 0.95, head: 0.12, reach: 0 },
  lie: { thigh: 0.9, knee: 1.4, torso: 0, armOut: 0.35, arm: 0.1, elbow: 0.2, head: -0.15, reach: 0 },
  stone: { thigh: 1.2, knee: 2.0, torso: 0.7, armOut: 0.05, arm: 0.9, elbow: 0.3, head: -0.4, reach: 1 },
};
const KEYS = Object.keys(POSES.stand);

const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
};
const capsule = (r, len, mat, parent, y) => mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat, parent, 0, y);
/** A lathed profile [[r, y]…] around the y axis (jacket, beanie). */
const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

export class Avatar {
  constructor(scene, tuning) {
    this.t = tuning;
    const M = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness });
    const jacket = M(0x3b5f7a, 0.72), jacketDark = M(0x2a445a, 0.8), trousers = M(0x262a36, 0.85);
    const skin = M(0xd9bca5, 0.6), wool = M(0xc9b48a, 0.95), boots = M(0x3a2a22, 0.7), pack = M(0x6b4a33, 0.85);
    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.root.add(this.lean);
    this.hips = new THREE.Group();
    this.lean.add(this.hips);
    // Torso pivots at the hips: a lathed jacket, a collar, a small pack; head and arms hang off it.
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    mesh(lathe([[0, -0.06], [0.15, -0.05], [0.18, 0.04], [0.19, 0.22], [0.2, 0.38], [0.18, 0.48], [0.1, TORSO + 0.02], [0, TORSO + 0.03]]), jacket, this.torso).scale.set(1, 1, 0.78);
    mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 16), jacketDark, this.torso, 0, 0.02).scale.set(1, 1, 0.8); // hem
    mesh(new THREE.TorusGeometry(0.085, 0.035, 8, 16), jacketDark, this.torso, 0, TORSO, 0).rotation.x = Math.PI / 2; // collar
    const packM = mesh(new THREE.CapsuleGeometry(0.12, 0.2, 4, 10), pack, this.torso, 0, 0.3, 0.2);
    packM.scale.set(1.15, 1, 0.6);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 10), wool, this.torso, 0, 0.51, 0.2).rotation.z = Math.PI / 2; // bedroll
    this.neck = new THREE.Group();
    this.neck.position.y = TORSO + 0.04;
    this.torso.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    mesh(new THREE.SphereGeometry(0.11, 16, 12), skin, this.head, 0, 0.13).scale.set(0.95, 1.05, 1);
    mesh(lathe([[0.118, 0.1], [0.12, 0.16], [0.105, 0.22], [0.07, 0.26], [0, 0.275]]), wool, this.head); // beanie
    mesh(new THREE.TorusGeometry(0.117, 0.02, 6, 16), wool, this.head, 0, 0.11).rotation.x = Math.PI / 2; // cuff
    mesh(new THREE.SphereGeometry(0.04, 8, 6), wool, this.head, 0, 0.29);
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.2, TORSO - 0.08, 0);
      this.torso.add(shoulder);
      mesh(new THREE.SphereGeometry(0.075, 10, 8), jacket, shoulder);
      capsule(0.06, 0.2, jacket, shoulder, -0.14);
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      capsule(0.055, 0.18, jacket, elbow, -0.12);
      mesh(new THREE.SphereGeometry(0.058, 10, 8), jacketDark, elbow, 0, -0.26).scale.set(0.9, 1.1, 1); // mitten
      return { shoulder, elbow, side };
    });
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, 0, 0);
      this.hips.add(hip);
      capsule(0.08, THIGH - 0.12, trousers, hip, -THIGH / 2);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      capsule(0.07, SHIN - 0.14, trousers, knee, -SHIN / 2 + 0.02);
      mesh(new THREE.CapsuleGeometry(0.075, 0.1, 4, 8), boots, knee, 0, -SHIN + 0.04, -0.035).rotation.x = Math.PI / 2; // boot
      mesh(new THREE.CylinderGeometry(0.082, 0.078, 0.1, 10), boots, knee, 0, -SHIN + 0.1); // boot cuff
      return { hip, knee, side };
    });
    scene.add(this.root);

    this.pose = { ...POSES.lie };
    this.phase = 0; // gait cycle 0…1 (left foot strikes at 0, right at 0.5)
    this.gait = 0; // 0 still … 1 moving
    this.ikW = 0; // 0 posed legs … 1 feet planted by IK
    this.prevYaw = 0;
    this.side = 0;
    this.fwd = 0;
    this.wake = 1; // 0 lying in the snow … 1 up (the opening sets 0 and animates it)
    this.reach = 0; // leaving a stone: 0 … 1 … 0 (driven by the game)
    this.admire = 0; // the ending: 0 … 1 lifts the head a little to the view
    this.scarf = new Scarf(scene);
    this._neckW = new THREE.Vector3();
    this._chestW = new THREE.Vector3();
    this._rightW = new THREE.Vector3();
    this._fwdW = new THREE.Vector3();
    this.wind = new THREE.Vector3();
    // Scarf colliders (DECISIONS #76): capsules [parent, a, b, radius] in the parent's local space,
    // turned into world space every frame — the jacket, the pack, the bedroll, the head, the upper
    // arms. The old single chest sphere left the pack, bedroll, shoulders and neck uncovered.
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.scarfShapes = [
      [this.torso, V(0, 0.06, 0), V(0, 0.44, 0), 0.19],
      [this.torso, V(0, 0.16, 0.2), V(0, 0.42, 0.2), 0.1],
      [this.torso, V(-0.14, 0.51, 0.2), V(0.14, 0.51, 0.2), 0.065],
      [this.head, V(0, 0.13, 0), V(0, 0.2, 0), 0.13],
      ...this.arms.map((arm) => [arm.shoulder, V(0, 0, 0), V(0, -0.3, 0), 0.075]),
    ];
    this.scarfCaps = this.scarfShapes.map(([, , , r]) => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r }));
  }

  reset() { this.scarf.needsReset = true; }

  update(ctl, pos, alpha, dt) {
    const g = this.t.gravity, a = this.t.avatar;
    this.root.position.copy(pos);
    this.root.rotation.y = lerpAngle(ctl.prevFacing, ctl.facing, alpha);
    const state = ctl.state;
    const hs = Math.hypot(ctl.vel.x, ctl.vel.z);
    const k = 1 - Math.exp(-10 * dt);

    // Target pose for the state, blended.
    let target = POSES.stand;
    if (state === 'slide' || state === 'stumble') target = POSES.slide;
    else if (state === 'air') target = ctl.jumpFromSlide ? POSES.slide : POSES.air;
    else if (state === 'sit') target = POSES.sit;
    else if (hs > 0.4) target = POSES.run;
    // Opening: lying → sitting → standing as `wake` goes 0 → 1.
    const up = smooth(0, 0.55, this.wake), stand = smooth(0.45, 1, this.wake);
    const P = this.pose;
    const kp = state === 'sit' || this.wake < 1 ? 1 - Math.exp(-4 * dt) : 1 - Math.exp(-12 * dt);
    for (const key of KEYS) {
      let want = target[key];
      if (this.wake < 1) want = THREE.MathUtils.lerp(THREE.MathUtils.lerp(POSES.lie[key], POSES.sit[key], up), target[key], stand);
      if (this.reach > 0) want = THREE.MathUtils.lerp(want, POSES.stone[key], this.reach);
      P[key] += (want - P[key]) * (this.wake < 1 ? 1 : kp);
    }

    // --- Legs (DECISIONS #74). On foot the feet are placed, not swung: each foot is planted for
    // its stance and stays where it landed while the body passes over it, then lifts and is
    // carried forward; two-bone IK bends the leg to reach the snow under that foot, so on a slope
    // the uphill knee bends and the hips settle onto the downhill leg. Cadence and stance share
    // follow speed (brisk walk → sprint), feet lift higher in powder, the body leans into a climb,
    // and turning on the spot is done in small steps.
    const yaw = this.root.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const hf = ctl.world?.heightfield;
    const onFoot = state === 'run' && ctl.grounded && this.wake >= 1;
    this.ikW += ((onFoot ? 1 - this.reach : 0) - this.ikW) * (onFoot ? k : 1 - Math.exp(-18 * dt));
    let yawRate = Math.atan2(Math.sin(yaw - this.prevYaw), Math.cos(yaw - this.prevYaw)) / Math.max(dt, 1e-4);
    this.prevYaw = yaw;
    if (!onFoot) yawRate = 0;
    const run = smooth(5.5, 9, hs), moveW = onFoot ? smooth(0.15, 1, hs) : 0;
    const turnW = onFoot ? smooth(0.3, 1.2, Math.abs(yawRate)) * (1 - moveW) : 0;
    const powder = ctl.groundSurface === 1;
    const cadence = 1.9 + 0.32 * hs - (powder ? 0.2 : 0); // steps per second
    // Stance share of the cycle, chosen so a planted foot travels ±0.3–0.42 m about the hip: long
    // stances when slow (a walk), short ones with a flight phase when fast (a jog, a run).
    const reachFwd = THREE.MathUtils.lerp(0.3, 0.42, smooth(1, 9, hs));
    const duty = clamp((reachFwd * cadence) / Math.max(hs, 0.1), 0.22, 0.62);
    if (onFoot) this.phase = (this.phase + dt * (moveW * cadence * 0.5 + turnW * 1.1)) % 1;
    this.gait += (moveW - this.gait) * k;
    const A = moveW * (duty * hs) / cadence + turnW * 0.07; // foot travel either side of the hip
    const lift = moveW * (0.07 + 0.08 * run + (powder ? 0.1 : 0)) + turnW * 0.05;
    const n = ctl.groundNormal, uphill = clamp(-(n.x * fx + n.z * fz) / Math.max(n.y, 0.3), -0.6, 1);
    const g0 = hf ? hf.heightAt(pos.x, pos.z) : 0, onCollider = (ctl.heightAboveGround ?? 0) > 0.05;
    // Going downhill the hips ride steadily lower (where the next heel strike will need them),
    // instead of dropping at every step.
    const ride = Math.min(0.9, 0.06 + Math.sqrt(0.87 ** 2 - Math.min(A, 0.6) ** 2) + Math.min(0, uphill * A));
    let pelvis = ride - moveW * (0.02 + 0.04 * run) * (0.5 + 0.5 * Math.cos(4 * Math.PI * (this.phase - duty / 2)));
    for (const leg of this.legs) {
      const u = (this.phase + (leg.side > 0 ? 0.5 : 0)) % 1;
      let sx, up = 0;
      // Stance: the foot stays put; late in it the heel peels up (toe-off), which lets the back leg
      // reach further so the hips don't dip on every step of a slope.
      if (u < duty) { sx = A * (1 - (2 * u) / duty); up = A > 0.01 ? 0.1 * moveW * Math.max(0, -sx / A) ** 2 : 0; }
      else { const e = (u - duty) / (1 - duty); sx = -A + 2 * A * e * e * (3 - 2 * e); up = lift * Math.sin(Math.PI * e) + 0.1 * moveW * (1 - e) ** 2; }
      const wx = pos.x + fx * sx + rx * leg.side * 0.1, wz = pos.z + fz * sx + rz * leg.side * 0.1;
      const g = hf && !onCollider ? clamp(hf.heightAt(wx, wz) - g0, -0.5, 0.5) : 0;
      // Heel strike: the foot comes down at the start of its stance.
      if (onFoot && leg.prevU !== undefined && u < leg.prevU && (moveW > 0.3 || turnW > 0.3) && this.onFoot) {
        this.onFoot(wx, wz, ctl, leg.side, moveW < 0.3);
      }
      leg.prevU = u;
      leg.sx = sx; leg.g = g; leg.up = up;
      // Only a planted foot holds the hips down; a swinging one just folds its knee.
      if (u < duty || moveW < 0.05) pelvis = Math.min(pelvis, g + up + 0.06 + Math.sqrt(Math.max(0, 0.87 ** 2 - sx * sx)));
    }
    // Drops at once (a planted foot must stay reachable), rises smoothly.
    this.pelvis = this.pelvis === undefined || pelvis < this.pelvis ? pelvis : this.pelvis + (pelvis - this.pelvis) * (1 - Math.exp(-25 * dt));
    let poseDrop = 0;
    for (const leg of this.legs) {
      // Two-bone IK in the leg's plane: thigh angle from the hip toward the ankle plus the knee's
      // share; the knee bends forward.
      const down = this.pelvis - (leg.g + leg.up + 0.06);
      const D = clamp(Math.hypot(leg.sx, down), 0.2, THIGH + SHIN - 0.002);
      const bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
      const thigh = Math.atan2(leg.sx, down) + Math.acos(clamp((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
      leg.hip.rotation.x = THREE.MathUtils.lerp(P.thigh, thigh, this.ikW);
      leg.knee.rotation.x = THREE.MathUtils.lerp(-P.knee, -bend, this.ikW);
      poseDrop = Math.max(poseDrop, THIGH * Math.cos(P.thigh) + SHIN * Math.cos(P.thigh - P.knee) + 0.06);
    }
    // Lying: the hips tip back and rest on the snow.
    const tilt = 1.45 * (1 - up);
    this.hips.rotation.x = tilt;
    const hipsPose = state === 'air' ? THIGH + SHIN - 0.1 : THREE.MathUtils.lerp(0.13, poseDrop, up);
    this.hips.position.y = THREE.MathUtils.lerp(hipsPose, this.pelvis, this.ikW);

    // Upper body: leans into a climb (and a little back going down), more when sprinting; the
    // shoulders counter-rotate against the stride; the arms swing with the opposite foot.
    const [L, Rl] = this.legs;
    const climb = clamp(uphill, -0.4, 0.9) * 0.32 * this.ikW * (0.4 + 0.6 * moveW);
    this.torso.rotation.x = -(P.torso + (0.02 + 0.12 * run) * this.gait + climb);
    this.torso.rotation.y = (Rl.sx - L.sx) * 0.18 * this.ikW;
    this.head.rotation.x = -P.head * 0.6 + 0.06 * run + climb * 0.7 + 0.16 * this.admire;
    for (const arm of this.arms) {
      const opp = arm.side > 0 ? L : Rl;
      const swing = (opp.sx / 0.55) * (0.45 + 0.35 * run) * this.ikW;
      const reach = arm.side > 0 ? P.reach : 0; // the right hand places the stone
      arm.shoulder.rotation.x = P.arm + swing + reach * 0.5;
      arm.shoulder.rotation.z = arm.side * P.armOut;
      arm.elbow.rotation.x = P.elbow + (0.35 + 0.6 * run) * this.gait * this.ikW + Math.max(0, swing) * 0.35 - reach * 0.2;
    }

    // Lean: small into turns (tan θ = a_lat/g, scaled), a little forward with acceleration.
    const latAcc = THREE.MathUtils.lerp(ctl.prevLean.y, ctl.lean.y, alpha);
    const fwdAcc = THREE.MathUtils.lerp(ctl.prevLean.x, ctl.lean.x, alpha);
    const sliding = state === 'slide';
    const maxSide = sliding ? a.leanSlide : a.leanRun;
    const sideWant = ctl.grounded && hs > 2 ? clamp(Math.atan2(latAcc, g) * a.leanScale, -maxSide, maxSide) : 0;
    const fwdWant = ctl.grounded && hs > 1 ? clamp(Math.atan2(fwdAcc, g) * 0.3, -0.12, 0.12) : 0;
    const kl = 1 - Math.exp(-6 * dt);
    this.side += (sideWant - this.side) * kl;
    this.fwd += (fwdWant - this.fwd) * kl;
    this.lean.rotation.set(-this.fwd, 0, -this.side, 'YXZ');
    if (state === 'stumble') this.lean.rotation.x += Math.sin(ctl.time * 40) * 0.12;

    // Scarf: tied at the back of the collar; the body's capsules keep it outside the figure.
    this.root.updateMatrixWorld(true);
    this.neck.getWorldPosition(this._neckW);
    this.torso.localToWorld(this._chestW.set(0, 0.3, 0.08));
    this.scarfShapes.forEach(([obj, a, b], i) => { obj.localToWorld(this.scarfCaps[i].a.copy(a)); obj.localToWorld(this.scarfCaps[i].b.copy(b)); });
    this._rightW.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this._fwdW.set(fx, 0, fz);
    this._neckW.addScaledVector(this._fwdW, -0.1);
    this.scarf.update(dt, this._neckW, this._rightW, this.wind, this._chestW, this.scarfCaps);
  }
}

// Scarf: a strip of 10 particles simulated as position-based cloth at a fixed 240 Hz — gravity,
// aerodynamic drag toward the wind's velocity (so it streams back in proportion to your speed
// through the air, not to your acceleration), stretch and bend constraints, and capsule colliders
// for the body.
// Rendered as a double-sided ribbon plus a knot at the neck.
class Scarf {
  constructor(scene, n = 10, seg = 0.08) {
    this.n = n;
    this.seg = seg;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.v = Array.from({ length: n }, () => new THREE.Vector3());
    this.anchorPrev = new THREE.Vector3();
    this.needsReset = true;
    this.acc = 0;
    this.time = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8211d, roughness: 0.8, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.band = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.04, 8, 16), mat);
    this.band.castShadow = true;
    scene.add(this.band);
    this._t = new THREE.Vector3();
    this._a = new THREE.Vector3();
  }

  update(dt, anchor, right, wind, chest, caps) {
    const { p, prev, v, n, seg } = this, tmp = this._t, a = this._a;
    if (this.needsReset || p[0].distanceToSquared(anchor) > 1) {
      for (let i = 0; i < n; i++) { p[i].copy(anchor).y -= i * seg; v[i].set(0, 0, 0); }
      this.anchorPrev.copy(anchor);
      this.needsReset = false;
    }
    this.band.position.set(chest.x, anchor.y - 0.02, chest.z).lerp(anchor, 0.35);
    this.band.rotation.set(Math.PI / 2, 0, Math.atan2(right.z, right.x));
    const H = 1 / 240;
    this.acc = Math.min(this.acc + dt, 10 * H);
    const drag = 3.2, damp = 0.6, steps = Math.floor(this.acc / H);
    this.acc -= steps * H;
    for (let st = 1; st <= steps; st++) {
      this.time += H;
      p[0].lerpVectors(this.anchorPrev, anchor, st / steps); // the anchor moves smoothly across substeps
      // Gentle gustiness: the air velocity wavers a little (a few % of the wind, slowly).
      const w = 0.15 + 0.1 * Math.sin(this.time * 2.3);
      for (let i = 1; i < n; i++) {
        const ph = this.time * 5.1 - i * 0.7; // a slow travelling ripple, not a shake
        a.set(wind.x * (1 + w * Math.sin(ph)), Math.sin(ph * 1.3) * 0.25, wind.z * (1 + w * Math.cos(ph)));
        a.sub(v[i]).multiplyScalar(drag); // drag toward the air's velocity
        a.y -= 9.8;
        v[i].addScaledVector(a, H).multiplyScalar(1 - damp * H);
        prev[i].copy(p[i]);
        p[i].addScaledVector(v[i], H);
      }
      // Symmetric projection (the root has infinite mass). Moving only the child — "follow the
      // leader" — pumps energy into a swinging strip; that was the old scarf's wild flailing.
      for (let it = 0; it < 6; it++) {
        for (let i = 1; i < n; i++) {
          tmp.subVectors(p[i], p[i - 1]);
          const d = tmp.length() || 1e-6, c = (seg - d) / d;
          if (i === 1) p[i].addScaledVector(tmp, c);
          else { p[i].addScaledVector(tmp, c * 0.5); p[i - 1].addScaledVector(tmp, -c * 0.5); }
        }
        // Bend: keep i and i+2 at least 1.7 segments apart (a strip of wool, not a chain).
        for (let i = 0; i < n - 2; i++) {
          tmp.subVectors(p[i + 2], p[i]);
          const d = tmp.length() || 1e-6, min = 1.7 * seg;
          if (d < min) { const c = ((min - d) / d) * 0.5; if (i > 0) p[i].addScaledVector(tmp, -c); p[i + 2].addScaledVector(tmp, c); }
        }
        // Push out of the body's capsules, with a margin for the ribbon's half-width.
        for (let i = 1; i < n; i++) {
          for (const c of caps) {
            a.subVectors(c.b, c.a);
            const u = Math.max(0, Math.min(1, tmp.subVectors(p[i], c.a).dot(a) / a.lengthSq()));
            tmp.copy(c.a).addScaledVector(a, u).sub(p[i]).negate(); // closest point → particle
            const r = tmp.length(), R = c.r + 0.045;
            if (r < R) p[i].addScaledVector(tmp, (R - r) / (r || 1e-6));
          }
        }
      }
      for (let i = 1; i < n; i++) v[i].subVectors(p[i], prev[i]).divideScalar(H);
    }
    this.anchorPrev.copy(anchor);
    p[0].copy(anchor);
    // The ribbon's width lies across the strip (the shoulders' direction with the strip's own
    // direction taken out), so it never folds edge-on into a thin rod when it streams sideways.
    const wdt = 0.055, side = this._a, t = this._t;
    for (let i = 0; i < n; i++) {
      t.subVectors(p[Math.min(i + 1, n - 1)], p[Math.max(i - 1, 0)]).normalize();
      side.copy(right).addScaledVector(t, -right.dot(t));
      if (side.lengthSq() < 0.09) { side.crossVectors(t, UP); if (side.lengthSq() < 1e-4) side.copy(right); }
      side.normalize();
      const o = i * 6, taper = wdt * (1 - 0.25 * (i / n));
      this.pos[o] = p[i].x - side.x * taper; this.pos[o + 1] = p[i].y - side.y * taper; this.pos[o + 2] = p[i].z - side.z * taper;
      this.pos[o + 3] = p[i].x + side.x * taper; this.pos[o + 4] = p[i].y + side.y * taper; this.pos[o + 5] = p[i].z + side.z * taper;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
