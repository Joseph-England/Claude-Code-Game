// Placeholder avatar (Phase 2): capsule body, a nose that shows facing, and physically motivated
// lean — forward/back from acceleration, sideways into carves (tan θ = a_lat / g).
// Replaced by the procedural figure + scarf in Phase 4.
import * as THREE from 'three';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const clamp = (x, m) => Math.max(-m, Math.min(m, x));

export class Avatar {
  constructor(scene, tuning) {
    this.t = tuning;
    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.root.add(this.lean);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4660, roughness: 0.7 });
    const scarf = new THREE.MeshStandardMaterial({ color: 0xc8302c, roughness: 0.6 });
    const r = tuning.body.radius;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(r, tuning.body.height - 2 * r, 6, 14), mat);
    this.body.position.y = tuning.body.height / 2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.16, 14), scarf);
    band.position.y = tuning.body.height * 0.78;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.3), scarf);
    nose.position.set(0, tuning.body.height * 0.86, -r - 0.08);
    this.pose = new THREE.Group(); // scaled for crouch
    this.pose.add(this.body, band, nose);
    this.lean.add(this.pose);
    for (const m of [this.body, band, nose]) m.castShadow = true;
    scene.add(this.root);
    this.side = 0;
    this.fwd = 0;
  }

  update(ctl, pos, alpha, dt) {
    const g = this.t.gravity;
    this.root.position.copy(pos);
    this.root.rotation.y = lerpAngle(ctl.prevFacing, ctl.facing, alpha);
    const latAcc = THREE.MathUtils.lerp(ctl.prevLean.y, ctl.lean.y, alpha);
    const fwdAcc = THREE.MathUtils.lerp(ctl.prevLean.x, ctl.lean.x, alpha);
    const grounded = ctl.grounded;
    // Lean into the turn (right turn → lean right), forward when accelerating.
    const sideWant = grounded ? clamp(Math.atan2(latAcc, g), 0.6) : 0;
    const fwdWant = grounded ? clamp(Math.atan2(fwdAcc, g) * 0.8, 0.35) : 0;
    const k = 1 - Math.exp(-12 * dt);
    this.side += (sideWant - this.side) * k;
    this.fwd += (fwdWant - this.fwd) * k;
    this.lean.rotation.set(-this.fwd, 0, -this.side, 'YXZ');
    // Crouch for slides; sit squashes further; stumble wobbles.
    const crouch = THREE.MathUtils.lerp(ctl.prevCrouch, ctl.crouch, alpha);
    let sy = 1 - crouch * 0.42;
    if (ctl.state === 'sit') sy = 0.45;
    this.pose.scale.set(1 + crouch * 0.08, sy, 1 + crouch * 0.08);
    if (ctl.state === 'stumble') this.lean.rotation.x += Math.sin(ctl.time * 40) * 0.12;
  }
}
