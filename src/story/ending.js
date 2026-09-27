// The ending (DESIGN §1 "Ending"): reaching the top takes control away gently. The figure walks to
// the viewpoint and stands there looking at the sunset (standing, not sitting: user playtest,
// DECISIONS #75); the camera lifts and pulls back toward the setting sun to show range after range,
// then swings slowly round behind the figure to the east — the figure turns with it, in a few
// steps — where the last light stays on the peaks above Earth's shadow. The last
// lines play on a fixed timeline under the sun's own (sunElevation: under the horizon ~40 s after
// arrival), then the screen fades to the credits. Times are seconds since arrival.
import * as THREE from 'three';

const smooth = THREE.MathUtils.smootherstep;

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
    const p = route.at(sec.s0 + (sec.view ?? sec.len - 6));
    this.spot = new THREE.Vector3(p.x, heightfield.heightAt(p.x, p.z), p.z);
    this.said = new Set();
    this.arrived = false;
    this.lastT = 0;
    this.from = null; // the third-person camera pose at hand-over
    this._p = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  /** Autopilot for one fixed step: returns { cmd, camYaw } that walks to the spot and stops there. */
  drive(player) {
    const dx = this.spot.x - player.pos.x, dz = this.spot.z - player.pos.z, dist = Math.hypot(dx, dz);
    const idle = { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false, sprintHeld: false };
    if (!this.arrived && (dist > 0.45 || player.speed > 0.3)) {
      // Slowing to a stroll over the last few metres.
      return { cmd: { ...idle, moveY: Math.min(1, dist / 4) * (dist > 0.45 ? 1 : 0) }, camYaw: Math.atan2(-dx, -dz) };
    }
    this.arrived = true;
    return { cmd: idle, camYaw: 0 };
  }

  /** Per frame: lines, where the figure looks, the music's resolve. */
  update(t, player, sunDir, avatar) {
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    for (const [at, id] of LINES) {
      if (t >= at && !this.said.has(id)) {
        this.said.add(id);
        this.story.say(id);
        if (id === 27) this.story.say(28);
        if (id === 30) this.audio.music?.resolve();
      }
    }
    if (this.arrived) {
      // Face the sunset; when the camera swings round, turn (at a walking pace, so the feet step)
      // to the far ranges on the other side, where the alpenglow is.
      const want = t < 23 ? Math.atan2(-sunDir.x, -sunDir.z) : Math.atan2(sunDir.x, sunDir.z);
      const d = Math.atan2(Math.sin(want - player.facing), Math.cos(want - player.facing));
      player.prevFacing = player.facing;
      player.facing += Math.max(-1.4 * dt, Math.min(1.4 * dt, d));
    }
    // Head lifts a little to take it in.
    if (avatar) avatar.admire += ((this.arrived ? 1 : 0) - avatar.admire) * Math.min(1, dt * 0.8);
    if (this.audio.music) this.audio.music.level = 1 - 0.8 * smooth(t, ENDING_FADE - 2, ENDING_END);
  }

  /** Camera for the ending, blended in from the gameplay camera over 3 s. */
  camera(camera, t, sunDir) {
    if (!this.from) this.from = { pos: camera.position.clone(), q: camera.quaternion.clone(), t };
    const head = this._p.copy(this.spot); head.y += 1.3; // standing figure's shoulders
    const sx = sunDir.x, sz = sunDir.z, sl = Math.hypot(sx, sz) || 1;
    const toSun = [sx / sl, sz / sl];
    // A: behind the figure, rising and pulling back, looking toward the setting sun over the ranges.
    // B: swinging round (~160°) to look east past the figure at the peaks still lit.
    const a = smooth(t, 4, 17), b = smooth(t, 18, 38);
    const ang = Math.PI * 0.9 * b;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dir = [toSun[0] * c - toSun[1] * s, toSun[0] * s + toSun[1] * c]; // look direction
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(5, 15, a), 6.5, b);
    const h = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.9, 6.5, a), 1.1, b);
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
