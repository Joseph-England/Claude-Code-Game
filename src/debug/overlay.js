// Debug overlay (F3): FPS, speed, state, surface, grounded, slope. Updated at 10 Hz.
import { SURFACE_NAMES } from '../world/surfaces.js';

export class DebugOverlay {
  constructor() {
    this.el = document.createElement('pre');
    this.el.id = 'debug';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.frames = 0;
    this.acc = 0;
    this.fps = 0;
    this.worst = 0;
  }

  toggle() { this.el.hidden = !this.el.hidden; }

  update(dt, ctl, cam, steps, extra = '') {
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.1) return;
    this.fps = this.frames / this.acc;
    const worstMs = this.worst * 1000;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
    if (this.el.hidden) return;
    const v = ctl.vel, h = Math.hypot(v.x, v.z), s = v.length();
    const p = ctl.pos;
    this.el.textContent =
      `FPS      ${this.fps.toFixed(0).padStart(4)}   worst ${worstMs.toFixed(1)} ms   steps ${steps}\n` +
      `speed    ${s.toFixed(2).padStart(6)} m/s  ${(s * 3.6).toFixed(0).padStart(3)} km/h\n` +
      `horiz    ${h.toFixed(2).padStart(6)} m/s   vert ${v.y.toFixed(2)} m/s\n` +
      `state    ${ctl.state.padEnd(8)} grounded ${ctl.grounded ? 'yes' : 'no '}\n` +
      `surface  ${(ctl.grounded ? SURFACE_NAMES[ctl.groundSurface] : '—').padEnd(8)} slope ${(ctl.slopeAngle * 57.2958).toFixed(1)}°\n` +
      `height   ${(ctl.heightAboveGround ?? 0).toFixed(2)} m above terrain\n` +
      `pos      ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `camera   fov ${cam.fov.toFixed(1)}°  dist ${cam.dist.toFixed(2)} m  lift ${(cam.lift * 57.3).toFixed(1)}°` +
      (extra ? `\n${extra}` : '');
  }
}
