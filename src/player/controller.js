// Kinematic momentum controller (DESIGN §2, DECISIONS #5). Pure logic, no DOM: runs in Node
// for tools/check-movement.mjs. States: run, slide (slipping on ground too steep to stand on),
// sled (riding the sled, DECISIONS #83), air, stumble, sit.
// (Wall-kick removed in Phase 5, DECISIONS #60; the boot-slide as a move went with the sled.)
import * as THREE from 'three';
import { SURFACE } from '../world/surfaces.js';

const UP = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _seg = new THREE.Line3();
const _push = new THREE.Vector3();

/** Rotate v about axis (unit) by angle (Rodrigues). */
function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  _a.crossVectors(axis, v);
  const k = axis.dot(v) * (1 - c);
  return v.multiplyScalar(c).addScaledVector(_a, s).addScaledVector(axis, k);
}

/** Reduce the length of v by `amount` without reversing it. */
function reduceSpeed(v, amount) {
  const s = v.length();
  if (s <= amount) v.set(0, 0, 0);
  else v.multiplyScalar(1 - amount / s);
}

export class Controller {
  /** world: { heightfield, colliders?, cairns? }, tuning: src/tuning.js object */
  constructor(world, tuning) {
    this.world = world;
    this.t = tuning;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = 'air';
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundSurface = 0;
    this.slopeAngle = 0;
    this.facing = 0; // yaw, 0 = facing -z
    this.prevFacing = 0;
    this.lean = new THREE.Vector2(); // x: forward accel, y: lateral accel (smoothed, m/s²)
    this.prevLean = new THREE.Vector2();
    this.crouch = 0; // 0 standing … 1 crouched (smoothed)
    this.prevCrouch = 0;
    this.timers = { coyote: 0, buffer: 0, groundLock: 0, stumble: 0, idle: 0 };
    this.jumping = false;
    this.events = []; // { type: 'land'|'jump'|'stumble', ... } drained by the game each frame
    this.time = 0;
    this.topSpeed = tuning.run.speed;
    this.sled = false; // riding the sled
  }

  /** Sit on the sled (the game places the body on it first). */
  mountSled(yaw) {
    this.sled = true;
    this.vel.set(0, 0, 0);
    this.facing = this.prevFacing = yaw;
    this.state = this.grounded ? 'sled' : 'air';
  }

  dismountSled() {
    this.sled = false;
    if (this.state === 'sled') this.state = 'run';
  }

  teleport(p, yaw = this.facing) {
    this.pos.set(p[0], p[1], p[2]);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.facing = this.prevFacing = yaw;
    this.state = 'run';
    this.grounded = true;
    this.sled = false;
    this.groundNormal.copy(UP);
    for (const k in this.timers) this.timers[k] = 0;
  }

  get speed() { return this.vel.length(); }
  get surfaceParams() { return this.t.surfaces[this.groundSurface]; }

  /**
   * One fixed step. cmd: { moveX, moveY, jumpPressed, jumpHeld, slideHeld, sprintHeld }, camYaw: radians.
   */
  step(dt, cmd, camYaw) {
    const t = this.t, T = this.timers, v = this.vel;
    this.time += dt;
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
    this.prevLean.copy(this.lean);
    this.prevCrouch = this.crouch;
    for (const k in T) if (k !== 'idle') T[k] = Math.max(0, T[k] - dt);
    if (cmd.jumpPressed) T.buffer = t.jump.buffer;

    // Wish direction from input, relative to the camera (forward = -z at yaw 0).
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    const wish = _d.set(cmd.moveX * cy - cmd.moveY * sy, 0, -cmd.moveX * sy - cmd.moveY * cy);
    const wishMag = Math.min(1, wish.length());
    if (wishMag > 1e-4) wish.divideScalar(wish.length());

    this._chooseState(dt, cmd, wishMag);
    this._tryJump(cmd);
    const velBefore = _b.copy(v);

    if (this.grounded) this._groundForces(dt, cmd, wish, wishMag);
    else this._airForces(dt, cmd, wish, wishMag);

    this._move(dt);
    this._updatePresentation(dt, velBefore, wish, wishMag);
  }

  _chooseState(dt, cmd, wishMag) {
    const T = this.timers;
    if (!this.grounded) { this.state = 'air'; return; }
    if (this.sled) { this.state = 'sled'; return; }
    const surf = this.surfaceParams;
    const steep = this.slopeAngle > surf.maxWalk * D2R;
    if (T.stumble > 0) { this.state = 'stumble'; return; }
    if (cmd.slideHeld || steep) { this.state = 'slide'; T.idle = 0; return; }
    // No automatic rest-sit any more (user playtest: the sit was awkward; DECISIONS #75). 'sit'
    // stays a state the game can set, and it holds while nothing is pressed.
    if (this.state === 'sit' && wishMag < 0.01 && !cmd.jumpPressed) return;
    this.state = 'run';
  }

  /** Ground jump (with coyote time and input buffer). Slide-jumps are lower and keep all speed. */
  _tryJump(cmd) {
    const t = this.t, T = this.timers, v = this.vel;
    if (T.buffer <= 0 || this.sled) return;
    const onGround = this.grounded && this.state !== 'stumble';
    const coyote = !this.grounded && T.coyote > 0 && !this.jumping;
    if (!onGround && !coyote) return;
    const n = this.groundNormal;
    const fromSlide = this.state === 'slide' || cmd.slideHeld;
    const vn = v.dot(n);
    if (vn < 0) v.addScaledVector(n, -vn);
    if (coyote && v.y < 0) v.y = 0;
    // Push is a blend of straight up and the surface normal, so jumps always leave the slope.
    _a.copy(UP).lerp(n, t.jump.normalBlend).normalize();
    v.addScaledVector(_a, fromSlide ? t.jump.slideSpeed : t.jump.speed);
    this.state = 'air';
    this.grounded = false;
    this.jumping = true;
    this.jumpFromSlide = fromSlide;
    T.buffer = 0;
    T.coyote = 0;
    T.groundLock = t.jump.groundLock;
    this.events.push({ type: 'jump', slide: fromSlide });
  }

  _groundForces(dt, cmd, wish, wishMag) {
    const t = this.t, v = this.vel, n = this.groundNormal, surf = this.surfaceParams;
    const G = t.gravity, state = this.state;
    if (state === 'sit') { v.set(0, 0, 0); return; }
    if (state === 'sled') { this._sledForces(dt, cmd); return; }

    // 1. Gravity along the slope, scaled per state.
    const gScale = state === 'run' ? t.run.gravityScale : t.slide.gravityScale;
    _a.set(0, -G, 0).addScaledVector(n, G * n.y); // g − (g·n)n
    v.addScaledVector(_a, gScale * dt);

    // Steering direction: input projected onto the ground plane.
    let hasWish = wishMag > 0.01 && state !== 'stumble';
    if (hasWish) {
      wish.addScaledVector(n, -wish.dot(n));
      if (wish.lengthSq() < 1e-6) hasWish = false;
      else wish.normalize();
    }

    let friction = 0; // deceleration magnitude (m/s²)
    if (state === 'run') {
      if (hasWish) {
        const speed = v.length();
        const ctrl = surf.control;
        const cosA = speed > 1e-3 ? v.dot(wish) / speed : 1;
        if (speed > 0.5 && cosA < Math.cos(t.run.skidAngle * D2R)) {
          friction = t.run.skidBrake * surf.grip; // input against motion: skid to a stop
        } else {
          if (speed > 0.5) this._turnToward(v, wish, n, Math.min(t.run.maxTurnRate, (t.run.turnAccel * ctrl) / speed), dt);
          else if (speed > 1e-3) v.copy(wish).multiplyScalar(speed); // pivot freely when nearly still
          // Walk by default, sprint while held (no stamina: DECISIONS #47).
          this.topSpeed = cmd.sprintHeld ? t.run.sprintSpeed : t.run.speed;
          const f = Math.max(1 - v.dot(wish) / (this.topSpeed * wishMag), -t.run.overspeedBrake);
          v.addScaledVector(wish, t.run.accel * ctrl * f * dt);
        }
      } else {
        friction = t.run.brake * surf.grip;
      }
    } else if (state === 'slide') {
      friction = surf.friction * G;
      const speed = v.length();
      if (hasWish && speed > 0.2) {
        this._turnToward(v, wish, n, Math.min(t.slide.maxTurnRate, (t.slide.turnAccel * surf.control) / speed), dt);
      }
    } else if (state === 'stumble') {
      friction = t.run.brake * surf.grip;
    }

    // 2. Coulomb friction scaled by the normal load, then drag.
    if (friction > 0) reduceSpeed(v, friction * n.y * dt);
    const s = v.length();
    if (s > 0) reduceSpeed(v, (surf.drag * s * s + surf.linDrag * s) * dt);
  }

  /**
   * The sled: gravity along the slope, runner friction by surface (+ heels dragging on S), drag;
   * A/D turn the velocity about the ground normal; W paddles off when nearly still.
   */
  _sledForces(dt, cmd) {
    const t = this.t, sl = t.sled, v = this.vel, n = this.groundNormal, G = t.gravity;
    _a.set(0, -G, 0).addScaledVector(n, G * n.y);
    v.addScaledVector(_a, dt);
    const speed = v.length();
    if (speed > 0.3 && Math.abs(cmd.moveX) > 0.01) {
      const rate = Math.min(sl.maxTurnRate, (sl.turnAccel * Math.abs(cmd.moveX)) / Math.max(speed, 3));
      rotateAbout(v, n, -Math.sign(cmd.moveX) * rate * dt);
      this._turnRate = -Math.sign(cmd.moveX) * rate;
    }
    if (cmd.moveY > 0.3 && speed < sl.pushMax) {
      _push.set(-Math.sin(this.facing), 0, -Math.cos(this.facing)); // (_b holds the velocity before this step)
      _push.addScaledVector(n, -_push.dot(n)).normalize();
      v.addScaledVector(_push, sl.push * dt);
    }
    const mu = (sl.friction[this.groundSurface] ?? 0.05) + (cmd.moveY < -0.3 ? sl.brake : 0);
    reduceSpeed(v, mu * G * n.y * dt);
    const s = v.length();
    if (s > 0) reduceSpeed(v, sl.drag * s * s * dt);
  }

  /** Rotate v toward dir within the plane with normal n, limited to rate·dt. */
  _turnToward(v, dir, n, rate, dt) {
    _n.crossVectors(v, dir);
    const angle = Math.atan2(_n.dot(n), v.dot(dir));
    const step = Math.max(-rate * dt, Math.min(rate * dt, angle));
    rotateAbout(v, n, step);
    this._turnRate = step / dt;
  }

  _airForces(dt, cmd, wish, wishMag) {
    const t = this.t, v = this.vel;
    if (this.jumping && (v.y <= 0 || !cmd.jumpHeld)) {
      if (v.y <= 0) this.jumping = false;
    }
    let gMul = 1;
    if (v.y > 0 && this.jumping && !cmd.jumpHeld) gMul = t.air.lowJumpGravity;
    else if (v.y < 0) gMul = t.air.fallGravity;
    v.y -= t.gravity * gMul * dt;

    if (wishMag > 0.01 && !this.sled) {
      const before = Math.hypot(v.x, v.z);
      v.x += wish.x * wishMag * t.run.accel * t.air.control * dt;
      v.z += wish.z * wishMag * t.run.accel * t.air.control * dt;
      const after = Math.hypot(v.x, v.z), cap = Math.max(before, this.topSpeed);
      if (after > cap) { v.x *= cap / after; v.z *= cap / after; }
    }
    const s = v.length();
    if (s > 0) reduceSpeed(v, t.air.drag * s * s * dt);
  }

  _move(dt) {
    const t = this.t, v = this.vel, T = this.timers, hf = this.world.heightfield;
    const wasGrounded = this.grounded;
    const r = t.body.radius;
    const height = THREE.MathUtils.lerp(t.body.height, t.body.slideHeight, this.crouch);
    let impact = 0;
    let floor = null;

    // Sub-step so a fast body never moves more than ~0.25 m between collider checks.
    const sub = Math.max(1, Math.ceil((v.length() * dt) / 0.25));
    const colliders = this.world.colliders;
    for (let i = 0; i < sub; i++) {
      this.pos.addScaledVector(v, dt / sub);
      if (!colliders) continue;
      _seg.start.set(this.pos.x, this.pos.y + r, this.pos.z);
      _seg.end.set(this.pos.x, this.pos.y + Math.max(r, height - r), this.pos.z);
      const contacts = [];
      if (!colliders.collideCapsule(_seg, r, contacts)) continue;
      this.pos.set(_seg.start.x, _seg.start.y - r, _seg.start.z);
      for (const c of contacts) {
        const vn = v.dot(c.normal);
        if (c.normal.y > t.body.floorNormalY) {
          if (!wasGrounded) impact = Math.max(impact, -vn);
          floor = c;
        }
        if (vn < 0) v.addScaledVector(c.normal, -vn);
      }
    }

    // Heightfield ground.
    const nH = _n;
    const h = hf.sample(this.pos.x, this.pos.z, nH);
    const gap = this.pos.y - h;
    let onHF = false;
    if (gap <= 0) onHF = true;
    // Never snap down through a collider floor resolved this step (a box top a little above terrain).
    else if (!floor && wasGrounded && T.groundLock <= 0 && this.state !== 'air') {
      // Stay glued over a crest only if gravity can bend the path as fast as the ground falls away.
      const slide = this.state === 'slide' || this.state === 'stumble' || this.state === 'sled';
      const stick = slide ? t.slide.stick : t.run.stick;
      const snap = slide ? t.slide.snapDistance : t.run.snapDistance;
      if (gap < snap && v.dot(nH) <= t.gravity * nH.y * dt * stick + 1e-4) onHF = true;
    }
    if (onHF) {
      this.pos.y = h;
      const vn = v.dot(nH);
      if (!wasGrounded) {
        // Landing: keep the tangential part, bleed the normal part (DESIGN §2 Landing).
        impact = Math.max(impact, -vn);
        if (vn < 0) v.addScaledVector(nH, -vn);
      } else if (vn !== 0) {
        // Continuous contact: redirect along the new plane; keep speed for gentle bends.
        const sp = v.length();
        v.addScaledVector(nH, -vn);
        if (vn > 0 || -vn < 0.3 * sp) v.setLength(sp);
      }
    }

    const useFloor = floor && (!onHF || this.pos.y > h + 0.01);
    this.grounded = onHF || !!floor;
    if (this.grounded) {
      if (useFloor) { this.groundNormal.copy(floor.normal); this.groundSurface = floor.surface; }
      else { this.groundNormal.copy(nH); this.groundSurface = hf.surfaceAt(this.pos.x, this.pos.z); }
      this.slopeAngle = Math.acos(Math.min(1, this.groundNormal.y));
      T.coyote = t.jump.coyote;
      this.jumping = false;
      this.jumpFromSlide = false;
      if (!wasGrounded) {
        this.events.push({ type: 'land', impact });
        if (impact > t.landing.stumbleImpact && !this.sled) {
          T.stumble = t.landing.stumbleTime;
          this.events.push({ type: 'stumble', impact });
        }
        if (this.state === 'air') this.state = this.sled ? 'sled' : 'run';
      }
    } else if (wasGrounded) {
      this.state = 'air';
    }
    this.heightAboveGround = this.pos.y - h;
  }

  _updatePresentation(dt, velBefore, wish, wishMag) {
    // Facing follows horizontal velocity (or input when nearly still).
    const hx = this.vel.x, hz = this.vel.z;
    let target = null;
    if (hx * hx + hz * hz > 0.25) target = Math.atan2(-hx, -hz);
    else if (wishMag > 0.01 && this.state !== 'sit' && !this.sled) target = Math.atan2(-wish.x, -wish.z);
    if (target !== null) {
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxStep = 14 * dt;
      this.facing += Math.max(-maxStep, Math.min(maxStep, d));
    }
    // Lean from acceleration in the facing frame (smoothed).
    const ax = (this.vel.x - velBefore.x) / dt, az = (this.vel.z - velBefore.z) / dt;
    const fx = -Math.sin(this.facing), fz = -Math.cos(this.facing);
    const fwd = ax * fx + az * fz, lat = ax * -fz + az * fx;
    const k = 1 - Math.exp(-10 * dt);
    this.lean.x += (fwd - this.lean.x) * k;
    this.lean.y += (lat - this.lean.y) * k;
    const crouched = this.sled || this.state === 'slide' || this.state === 'sit' || this.state === 'stumble' || (this.state === 'air' && this.jumpFromSlide);
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * (1 - Math.exp(-14 * dt));
  }
}
