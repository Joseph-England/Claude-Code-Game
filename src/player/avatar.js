// Procedural avatar (DESIGN §4 "Character", showcase #4): an abstract figure built from capsules in
// a joint hierarchy, animated entirely in code — a gait cycle driven by distance travelled (walk →
// sprint), a boot-ski crouch for slides, a tuck in the air, a real sitting pose for rests, a
// stumble wobble — plus a verlet-simulated red scarf that trails in the wind and the motion.
// Lean is deliberately small (user playtest, DECISIONS #50): a few degrees into turns while
// running, more only while carving a slide.
import * as THREE from 'three';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const THIGH = 0.46, SHIN = 0.46, TORSO = 0.52;

// Pose parameters that blend smoothly between states (the gait adds on top).
const POSES = {
  stand: { hip: 0, thigh: 0, knee: 0.08, torso: 0.04, armOut: 0.12, arm: 0.05, elbow: 0.25, head: 0 },
  run: { hip: 0, thigh: 0, knee: 0.1, torso: 0.12, armOut: 0.1, arm: 0, elbow: 0.9, head: -0.05 },
  slide: { hip: 0, thigh: 1.0, knee: 1.75, torso: 0.45, armOut: 0.85, arm: 0.35, elbow: 0.5, head: -0.3 },
  air: { hip: 0, thigh: 0.55, knee: 1.0, torso: 0.2, armOut: 0.55, arm: 0.5, elbow: 0.6, head: -0.1 },
  sit: { hip: 0, thigh: 2.3, knee: 2.3, torso: 0.35, armOut: 0.18, arm: 1.05, elbow: 0.95, head: 0.1 },
};
const KEYS = Object.keys(POSES.stand);

function capsule(r, len, mat, parent, y) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.y = y;
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Avatar {
  constructor(scene, tuning) {
    this.t = tuning;
    const jacket = new THREE.MeshStandardMaterial({ color: 0x2c3854, roughness: 0.75 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x1f2433, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8c2b0, roughness: 0.6 });
    const hat = new THREE.MeshStandardMaterial({ color: 0x3b4a6b, roughness: 0.9 });
    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.root.add(this.lean);
    this.hips = new THREE.Group();
    this.lean.add(this.hips);
    // Torso pivots at the hips; chest, head and shoulders hang off it.
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    capsule(0.17, TORSO - 0.1, jacket, this.torso, TORSO / 2 + 0.02).scale.set(1, 1, 0.8);
    this.neck = new THREE.Group();
    this.neck.position.y = TORSO + 0.06;
    this.torso.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin);
    headM.position.y = 0.14;
    headM.castShadow = true;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hat);
    cap.position.y = 0.155;
    cap.castShadow = true;
    this.head.add(headM, cap);
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, TORSO - 0.04, 0);
      this.torso.add(shoulder);
      capsule(0.055, 0.22, jacket, shoulder, -0.14);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      capsule(0.05, 0.2, jacket, elbow, -0.13);
      return { shoulder, elbow, side };
    });
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0, 0);
      this.hips.add(hip);
      capsule(0.075, THIGH - 0.12, trousers, hip, -THIGH / 2);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      capsule(0.065, SHIN - 0.1, trousers, knee, -SHIN / 2);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), trousers);
      boot.position.set(0, -SHIN + 0.02, -0.04);
      boot.castShadow = true;
      knee.add(boot);
      return { hip, knee, side };
    });
    scene.add(this.root);

    this.pose = { ...POSES.stand };
    this.phase = 0;
    this.gait = 0; // 0 still … 1 full sprint stride
    this.side = 0;
    this.fwd = 0;
    this.breath = 0;
    this.scarf = new Scarf(scene);
    this._neckW = new THREE.Vector3();
    this._rightW = new THREE.Vector3();
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
    const kp = state === 'sit' ? 1 - Math.exp(-4 * dt) : 1 - Math.exp(-12 * dt);
    for (const key of KEYS) this.pose[key] += (target[key] - this.pose[key]) * kp;
    const P = this.pose;

    // Gait: phase advances with distance; stride grows with speed (walk 5 → sprint 9 m/s).
    const running = state === 'run' && ctl.grounded;
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
        this.onFoot(pos.x + fz * -leg.side * 0.12 + fx * 0.3 * amp, pos.z - fx * -leg.side * 0.12 + fz * 0.3 * amp);
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
      drop = Math.max(drop, THIGH * Math.cos(t1) + SHIN * Math.cos(t2) + 0.04);
    }
    this.breath += dt * (1.3 + this.gait * 1.5);
    const bob = Math.sin(this.breath * 2) * 0.006;
    this.hips.position.y = state === 'air' ? THIGH + SHIN - 0.1 : drop + bob;

    this.torso.rotation.x = -(P.torso + this.gait * 0.12) + Math.sin(this.breath * 2) * 0.012;
    this.torso.rotation.y = Math.sin(ph) * 0.12 * amp;
    this.head.rotation.x = -P.head * 0.6 + this.gait * 0.1;
    for (const arm of this.arms) {
      const p = ph + (arm.side > 0 ? 0 : Math.PI);
      arm.shoulder.rotation.x = P.arm + Math.sin(p) * amp * 0.9;
      arm.shoulder.rotation.z = arm.side * P.armOut;
      arm.elbow.rotation.x = P.elbow + Math.max(0, Math.sin(p)) * amp * 0.4;
    }

    // Lean: small into turns (tan θ = a_lat/g, scaled), a little forward with acceleration.
    const latAcc = THREE.MathUtils.lerp(ctl.prevLean.y, ctl.lean.y, alpha);
    const fwdAcc = THREE.MathUtils.lerp(ctl.prevLean.x, ctl.lean.x, alpha);
    const sliding = state === 'slide';
    const maxSide = sliding ? a.leanSlide : a.leanRun;
    const sideWant = ctl.grounded && hs > 2 ? clamp(Math.atan2(latAcc, g) * a.leanScale, -maxSide, maxSide) : 0;
    const fwdWant = ctl.grounded ? clamp(Math.atan2(fwdAcc, g) * 0.3, -0.12, 0.12) : 0;
    const kl = 1 - Math.exp(-6 * dt);
    this.side += (sideWant - this.side) * kl;
    this.fwd += (fwdWant - this.fwd) * kl;
    this.lean.rotation.set(-this.fwd, 0, -this.side, 'YXZ');
    if (state === 'stumble') this.lean.rotation.x += Math.sin(ctl.time * 40) * 0.12;

    // Scarf: anchored at the neck, width across the shoulders.
    this.root.updateMatrixWorld(true);
    this.neck.getWorldPosition(this._neckW);
    this._rightW.set(Math.cos(this.root.rotation.y), 0, -Math.sin(this.root.rotation.y));
    this.scarf.update(dt, this._neckW, this._rightW, this.wind, this.root.position);
  }
}

// Verlet ribbon: N points hanging from the neck, gravity + wind + drag, distance constraints, a
// body sphere to keep it off the torso. Rendered as a double-sided triangle strip.
class Scarf {
  constructor(scene, n = 10, seg = 0.085) {
    this.n = n;
    this.seg = seg;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.q = Array.from({ length: n }, () => new THREE.Vector3());
    this.needsReset = true;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8231f, roughness: 0.7, side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // A short wrap around the neck.
    this.band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 14), this.mesh.material);
    this.band.rotation.x = Math.PI / 2;
    this.band.castShadow = true;
    scene.add(this.band);
    this.time = 0;
  }

  update(dt, anchor, right, wind, body) {
    const { p, q, n, seg } = this;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    if (this.needsReset || p[0].distanceToSquared(anchor) > 4) {
      for (let i = 0; i < n; i++) { p[i].copy(anchor).y -= i * seg; q[i].copy(p[i]); }
      this.needsReset = false;
    }
    this.band.position.copy(anchor).y -= 0.02;
    const flutter = Math.sin(this.time * 11) * 0.6 + Math.sin(this.time * 17.3) * 0.4;
    const tmp = new THREE.Vector3();
    for (let i = 1; i < n; i++) {
      tmp.copy(p[i]).sub(q[i]).multiplyScalar(0.96); // velocity with drag
      q[i].copy(p[i]);
      p[i].add(tmp);
      p[i].y -= 9.8 * dt * dt;
      // Wind, a flutter across the body, and a small push behind (forward = (right.z, −right.x)).
      p[i].x += (wind.x + right.x * flutter * 0.8 - right.z * 1.5) * dt * dt * (i / n);
      p[i].z += (wind.z + right.z * flutter * 0.8 + right.x * 1.5) * dt * dt * (i / n);
    }
    p[0].copy(anchor);
    q[0].copy(anchor);
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        tmp.subVectors(p[i], p[i - 1]);
        const d = tmp.length() || 1e-6;
        p[i].addScaledVector(tmp, (seg - d) / d);
      }
      for (let i = 1; i < n; i++) {
        // Keep off the upper body: a sphere around the chest.
        tmp.set(body.x, anchor.y - 0.3, body.z);
        const dx = p[i].x - tmp.x, dy = p[i].y - tmp.y, dz = p[i].z - tmp.z, r = Math.hypot(dx, dy, dz);
        if (r < 0.24) p[i].set(tmp.x + (dx / r) * 0.24, tmp.y + (dy / r) * 0.24, tmp.z + (dz / r) * 0.24);
      }
    }
    const w = 0.06;
    for (let i = 0; i < n; i++) {
      const o = i * 6, taper = w * (1 - 0.3 * (i / n));
      this.pos[o] = p[i].x - right.x * taper; this.pos[o + 1] = p[i].y; this.pos[o + 2] = p[i].z - right.z * taper;
      this.pos[o + 3] = p[i].x + right.x * taper; this.pos[o + 4] = p[i].y; this.pos[o + 5] = p[i].z + right.z * taper;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
