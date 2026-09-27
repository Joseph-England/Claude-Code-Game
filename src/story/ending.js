// The ending (DESIGN §1 "Ending"): reaching the top takes control away gently. The figure walks to
// the sit spot and sits, turning its back on the sunset to face the far ranges; the camera lifts
// and pulls back toward the setting sun to show range after range, then swings slowly round behind
// the figure to the east, where the last light stays on the peaks above Earth's shadow. The last
// lines play on a fixed timeline under the sun's own (sunElevation: under the horizon ~40 s after
// arrival), then the screen fades to the credits. Times are seconds since arrival.
import * as THREE from 'three';

const smooth = THREE.MathUtils.smootherstep;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// [time, line id] — the narrator queues them, so they never overlap.
const LINES = [[1.5, 26], [11, 27], [26, 29], [38, 30]];
export const ENDING_FADE = 47; // start fading to black
export const ENDING_END = 52; // credits

export class Ending {
  constructor({ route, heightfield, story, audio }) {
    this.route = route;
    this.hf = heightfield;
    this.story = story;
    this.audio = audio;
    const sec = route.sections.at(-1);
    const p = route.at(sec.s0 + (sec.sit ?? sec.len - 6));
    this.spot = new THREE.Vector3(p.x, heightfield.heightAt(p.x, p.z), p.z);
    this.said = new Set();
    this.seated = false;
    this.from = null; // the third-person camera pose at hand-over
    this._p = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  /** Autopilot for one fixed step: returns { cmd, camYaw } that walks to the spot, then sits. */
  drive(player) {
    const dx = this.spot.x - player.pos.x, dz = this.spot.z - player.pos.z, dist = Math.hypot(dx, dz);
    const idle = { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false, sprintHeld: false };
    if (!this.seated && (dist > 0.45 || player.speed > 0.3)) {
      return { cmd: { ...idle, moveY: Math.min(1, dist / 1.5) * (dist > 0.45 ? 1 : 0) }, camYaw: Math.atan2(-dx, -dz) };
    }
    if (!this.seated) { this.seated = true; player.state = 'sit'; player.vel.set(0, 0, 0); }
    return { cmd: idle, camYaw: 0 };
  }

  /** Per frame: lines, the figure's slow turn to face away from the sun, the music's resolve. */
  update(t, player, sunDir) {
    for (const [at, id] of LINES) {
      if (t >= at && !this.said.has(id)) {
        this.said.add(id);
        this.story.say(id);
        if (id === 27) this.story.say(28);
        if (id === 30) this.audio.music?.resolve();
      }
    }
    if (this.seated) {
      // Turn to face the far ranges opposite the sun (the alpenglow side).
      const want = Math.atan2(sunDir.x, sunDir.z); // facing yaw of the anti-sun direction
      player.prevFacing = player.facing;
      player.facing = lerpAngle(player.facing, want, 0.012);
    }
    if (this.audio.music) this.audio.music.level = 1 - 0.8 * smooth(t, ENDING_FADE - 2, ENDING_END);
  }

  /** Camera for the ending, blended in from the gameplay camera over 3 s once seated. */
  camera(camera, t, sunDir) {
    if (!this.from) this.from = { pos: camera.position.clone(), q: camera.quaternion.clone(), t };
    const head = this._p.copy(this.spot); head.y += 0.8;
    const sx = sunDir.x, sz = sunDir.z, sl = Math.hypot(sx, sz) || 1;
    const toSun = [sx / sl, sz / sl];
    // A: behind the figure, rising and pulling back, looking toward the setting sun over the ranges.
    // B: swinging round (~160°) to look east past the figure at the peaks still lit.
    const a = smooth(t, 4, 17), b = smooth(t, 18, 38);
    const ang = Math.PI * 0.9 * b;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dir = [toSun[0] * c - toSun[1] * s, toSun[0] * s + toSun[1] * c]; // look direction
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(5, 15, a), 6.5, b);
    const h = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.4, 7, a), 1.6, b);
    const pos = new THREE.Vector3(head.x - dir[0] * dist, head.y + h, head.z - dir[1] * dist);
    pos.y = Math.max(pos.y, this.hf.heightAt(pos.x, pos.z) + 1.2);
    const lookH = THREE.MathUtils.lerp(THREE.MathUtils.lerp(2, 9, a), 14, b);
    this._look.set(head.x + dir[0] * 80, head.y + lookH, head.z + dir[1] * 80);
    this._m.lookAt(pos, this._look, THREE.Object3D.DEFAULT_UP);
    this._q.setFromRotationMatrix(this._m);
    const k = smooth(t, this.from.t, this.from.t + 3);
    camera.position.lerpVectors(this.from.pos, pos, k);
    camera.quaternion.slerpQuaternions(this.from.q, this._q, k);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 52, 0.02);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}
