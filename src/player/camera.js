// Third-person orbit camera (DESIGN §2 Camera, DECISIONS #19): mouse/stick orbit, soft auto-follow
// behind velocity at speed, critically damped vertical follow (no bumps), terrain + collider
// collision and speed FOV. The horizon always stays level (no roll: user playtest, DECISIONS #79).
// Runs once per rendered frame.
import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _target = new THREE.Vector3();

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export class ThirdPersonCamera {
  constructor(camera, world, tuning) {
    this.camera = camera;
    this.world = world;
    this.t = tuning.camera;
    this.yaw = 0;
    this.pitch = this.t.pitch;
    this.dist = this.t.distance;
    this.lookIdle = 0;
    this.fov = this.t.fovMin;
    this.y = 0; // smoothed target height
    this.yVel = 0;
    this.lift = 0; // extra pitch to clear terrain behind the player
    this.vyS = 0; // low-passed vertical velocity of the player (lead term)
  }

  reset(pos, yaw) {
    this.yaw = yaw;
    this.pitch = this.t.pitch;
    this.dist = this.t.distance;
    this.y = pos.y + this.t.height;
    this.yVel = 0;
    this.vyS = 0;
  }

  /** Apply look input (radians) at the start of a frame. */
  look(dx, dy, dt) {
    if (dx !== 0 || dy !== 0) this.lookIdle = 0;
    else this.lookIdle += dt;
    this.yaw = wrap(this.yaw - dx);
    this.pitch = Math.min(this.t.maxPitch, Math.max(this.t.minPitch, this.pitch + dy));
  }

  /** Landing impacts nudge the vertical spring down a little. */
  impact(speed) {
    this.yVel -= Math.min(speed, 14) * 0.12;
  }

  /**
   * @param dt frame time
   * @param pos interpolated player feet position
   * @param ctl the Controller (velocity, crouch, grounded, lean)
   */
  update(dt, pos, ctl, crouch) {
    const t = this.t, v = ctl.vel;
    const hSpeed = Math.hypot(v.x, v.z);

    // Auto-follow: after a short pause in look input, swing behind the direction of travel.
    if (this.lookIdle > t.followDelay) {
      const k = smooth(t.followSpeed * 0.5, t.followSpeed * 1.5, hSpeed);
      if (k > 0) {
        const heading = Math.atan2(-v.x, -v.z);
        this.yaw = wrap(this.yaw + wrap(heading - this.yaw) * damp(t.followRate * k, dt));
        if (ctl.grounded) {
          const velPitch = Math.atan2(-v.y, Math.max(hSpeed, 0.1)); // > 0 going downhill
          const want = t.pitch + t.slopePitch * velPitch;
          this.pitch += (want - this.pitch) * damp(t.followRate * k * 0.6, dt);
        }
      }
    }

    // Look-at target: exact horizontally, critically damped vertically. The spring target leads by
    // the low-passed vertical velocity, so a steady descent has no lag while bumps are filtered.
    const w = t.verticalLag;
    this.vyS += (v.y - this.vyS) * damp(t.verticalLead, dt);
    const lead = Math.max(-t.maxLead, Math.min(t.maxLead, this.vyS / w));
    const want = pos.y + THREE.MathUtils.lerp(t.height, t.slideHeight, crouch) + lead;
    let change = this.y - want;
    const tmp = (this.yVel + w * change) * dt;
    const e = Math.exp(-w * dt);
    this.yVel = (this.yVel - w * tmp) * e;
    change = (change + tmp) * e;
    if (Math.abs(change) > t.maxVerticalLag) change = Math.sign(change) * t.maxVerticalLag;
    this.y = want + change;
    // Never let the lag drop the target into the body (or the ground under it).
    const minY = pos.y + t.minTargetHeight;
    if (this.y < minY) { this.y = minY; this.yVel = Math.max(this.yVel, 0); }
    _target.set(pos.x, this.y, pos.z);

    // Terrain avoidance, first choice: lift the boom (pitch up) just enough to clear the terrain
    // behind the player. The required angle varies continuously with the terrain, so the view
    // glides over rises instead of snapping in.
    const hf = this.world.heightfield;
    const N = 20;
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw), reach = t.distance * Math.cos(this.pitch);
    let req = -Infinity;
    for (let i = 1; i <= N; i++) {
      const r = (i / N) * reach;
      const hNeed = hf.heightAt(_target.x + hx * r, _target.z + hz * r) + t.clearance - _target.y;
      req = Math.max(req, Math.atan2(hNeed, r));
    }
    const liftWant = Math.max(0, req - this.pitch);
    // Rise fast but not instantly (a hard max() passes terrain kinks straight into the view);
    // the final floor clamp below still keeps the lens out of the ground.
    this.lift += (liftWant - this.lift) * damp(liftWant > this.lift ? t.liftRate : t.liftRelax, dt);
    const pitch = Math.min(t.maxPitch, this.pitch + this.lift);

    // Boom direction (behind and above); fallback pull-in against terrain and colliders.
    const cp = Math.cos(pitch);
    _dir.set(hx * cp, Math.sin(pitch), hz * cp);
    let allowed = t.distance;
    for (let i = 1; i <= N; i++) {
      const d = (i / N) * t.distance;
      _p.copy(_target).addScaledVector(_dir, d);
      if (_p.y < hf.heightAt(_p.x, _p.z) + t.clearance) { allowed = ((i - 1) / N) * t.distance; break; }
    }
    if (this.world.colliders) {
      const hit = this.world.colliders.raycast(_target, _dir, t.distance + t.clearance);
      if (hit - t.clearance < allowed) allowed = hit - t.clearance;
    }
    allowed = Math.max(t.minDistance, allowed);
    if (allowed < this.dist) this.dist = allowed;
    else this.dist += (allowed - this.dist) * damp(t.pullOutRate, dt);

    const cam = this.camera;
    cam.position.copy(_target).addScaledVector(_dir, this.dist);
    const floor = hf.heightAt(cam.position.x, cam.position.z) + t.clearance;
    if (cam.position.y < floor) cam.position.y = floor;

    // Speed FOV.
    const speed = v.length();
    const fovWant = THREE.MathUtils.lerp(t.fovMin, t.fovMax, smooth(t.fovSpeedMin, t.fovSpeedMax, speed));
    this.fov += (fovWant - this.fov) * damp(t.fovRate, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    cam.lookAt(_target);
  }
}
