// Procedural avatar (DESIGN §4 "Character", showcase #4): a small climber built from lathed and
// rounded primitives in a joint hierarchy, animated entirely in code — a gait cycle driven by
// distance travelled (walk → sprint), a boot-ski crouch for slides, a tuck in the air, a real
// sitting pose for rests, lying in the snow and getting up (the opening), a reach down to leave a
// stone, a stumble wobble — plus a red scarf simulated as a cloth strip in the wind.
// Standing still is still: no idle sway or breathing bob (user playtest, DECISIONS #64). Lean is
// deliberately small (DECISIONS #50).
import * as THREE from 'three';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
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
    this.phase = 0;
    this.gait = 0; // 0 still … 1 full sprint stride
    this.side = 0;
    this.fwd = 0;
    this.wake = 1; // 0 lying in the snow … 1 up (the opening sets 0 and animates it)
    this.reach = 0; // leaving a stone: 0 … 1 … 0 (driven by the game)
    this.scarf = new Scarf(scene);
    this._neckW = new THREE.Vector3();
    this._chestW = new THREE.Vector3();
    this._rightW = new THREE.Vector3();
    this._fwdW = new THREE.Vector3();
    this.wind = new THREE.Vector3();
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

    // Gait: phase advances with distance; stride grows with speed (walk 5 → sprint 9 m/s).
    const running = state === 'run' && ctl.grounded && this.wake >= 1;
    const gWant = running ? clamp(hs / 9, 0, 1) : 0;
    this.gait += (gWant - this.gait) * k;
    const stride = 0.9 + 0.9 * this.gait; // metres per step
    if (running) this.phase += (Math.PI * hs * dt) / stride;
    const amp = this.gait > 0.02 ? 0.35 + 0.55 * this.gait : 0;
    const ph = this.phase;

    const yaw = this.root.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const leg of this.legs) {
      const p = ph + (leg.side > 0 ? Math.PI : 0);
      // Foot plant (leg at its forward-most point): report a footprint.
      const c = Math.cos(p);
      if (running && leg.prevC > 0 && c <= 0 && this.onFoot) {
        this.onFoot(pos.x + fz * -leg.side * 0.12 + fx * 0.3 * amp, pos.z - fx * -leg.side * 0.12 + fz * 0.3 * amp, ctl);
      }
      leg.prevC = c;
      const swing = Math.sin(p) * amp;
      const lift = Math.max(0, Math.cos(p)) * amp * 1.6; // knee bends while the leg swings through
      leg.hip.rotation.x = P.thigh + swing;
      leg.knee.rotation.x = -(P.knee + lift);
    }
    // Hip height: the lower of the two feet touches the ground.
    let drop = 0;
    for (const leg of this.legs) {
      const t1 = leg.hip.rotation.x, t2 = t1 + leg.knee.rotation.x;
      drop = Math.max(drop, THIGH * Math.cos(t1) + SHIN * Math.cos(t2) + 0.06);
    }
    // Lying: the hips tip back and rest on the snow.
    const tilt = 1.45 * (1 - up);
    this.hips.rotation.x = tilt;
    this.hips.position.y = state === 'air' ? THIGH + SHIN - 0.1 : THREE.MathUtils.lerp(0.13, drop, up);

    this.torso.rotation.x = -(P.torso + this.gait * 0.12);
    this.torso.rotation.y = Math.sin(ph) * 0.12 * amp;
    this.head.rotation.x = -P.head * 0.6 + this.gait * 0.1;
    for (const arm of this.arms) {
      const p = ph + (arm.side > 0 ? 0 : Math.PI);
      const reach = arm.side > 0 ? P.reach : 0; // the right hand places the stone
      arm.shoulder.rotation.x = P.arm + Math.sin(p) * amp * 0.9 + reach * 0.5;
      arm.shoulder.rotation.z = arm.side * P.armOut;
      arm.elbow.rotation.x = P.elbow + Math.max(0, Math.sin(p)) * amp * 0.4 - reach * 0.2;
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

    // Scarf: tied at the back of the neck, width across the shoulders; the chest keeps it off.
    this.root.updateMatrixWorld(true);
    this.neck.getWorldPosition(this._neckW);
    this.torso.localToWorld(this._chestW.set(0, 0.3, 0.08)); // chest + pack
    this._rightW.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this._fwdW.set(fx, 0, fz);
    this._neckW.addScaledVector(this._fwdW, -0.07);
    this.scarf.update(dt, this._neckW, this._rightW, this.wind, this._chestW);
  }
}

// Scarf: a strip of 10 particles simulated as position-based cloth at a fixed 240 Hz — gravity,
// aerodynamic drag toward the wind's velocity (so it streams back in proportion to your speed
// through the air, not to your acceleration), stretch and bend constraints, and a chest sphere.
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

  update(dt, anchor, right, wind, chest) {
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
        for (let i = 1; i < n; i++) {
          tmp.subVectors(p[i], chest);
          const r = tmp.length(), R = 0.26;
          if (r < R) p[i].addScaledVector(tmp, (R - r) / (r || 1e-6));
        }
      }
      for (let i = 1; i < n; i++) v[i].subVectors(p[i], prev[i]).divideScalar(H);
    }
    this.anchorPrev.copy(anchor);
    p[0].copy(anchor);
    const wdt = 0.055;
    for (let i = 0; i < n; i++) {
      const o = i * 6, taper = wdt * (1 - 0.25 * (i / n));
      this.pos[o] = p[i].x - right.x * taper; this.pos[o + 1] = p[i].y; this.pos[o + 2] = p[i].z - right.z * taper;
      this.pos[o + 3] = p[i].x + right.x * taper; this.pos[o + 4] = p[i].y; this.pos[o + 5] = p[i].z + right.z * taper;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
