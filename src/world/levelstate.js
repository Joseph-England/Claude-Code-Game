// Level runtime (pure logic, no DOM; the Node playthrough uses it too): route progress, section
// tracking, cairn checkpoints + respawn points, out-of-bounds detection, wind (ridge gusts,
// whiteout headwind), the sled (where it rests, mounting, the kicker's launch, stepping off) and
// the summit. Story lines are armed and fired by the narrator (story.js).
import { SURFACE } from './surfaces.js';
import { stormCylinders, stormAt, stormNear, STORM_HEAD } from './storm.js';

export class LevelState {
  /** mountain: buildMountain() result with props.cairns; colliders: world colliders; tuning. */
  constructor(mountain, cairns, colliders, tuning) {
    this.m = mountain;
    this.route = mountain.route;
    this.cairns = cairns;
    this.colliders = colliders;
    this.tuning = tuning;
    this.events = [];
    this.storm = stormCylinders(this.route);
    // The sled (DECISIONS #83): where it waits, where the rider steps off, the kicker's launch.
    const k = this.route.sections.findIndex((x) => x.sled);
    if (k >= 0) {
      const sec = this.route.sections[k], p = this.route.place(k, sec.sled.at, sec.sled.d);
      this.sledSection = k;
      this.sledHome = { x: p.x, z: p.z, yaw: p.yaw, s: p.s };
      this.sledEnd = sec.s0 + sec.sledEnd;
      this.launch = { ...sec.launch, s: sec.s0 + sec.launch.at };
    }
    this.reset();
  }

  reset() {
    this.progress = 0; // furthest arc length reached on the route (m)
    this.s = 0;
    this.d = 0;
    this.section = 0;
    this.checkpoint = 0;
    this.time = 0;
    this.finished = false;
    this.wind = { x: 0, z: 0, gust: 0, warn: false, whiteout: 0, stormNear: 0 };
    this.gustClock = 0;
    this.prevS = 0;
    this.slowT = 0;
    this.sled = this.sledHome ? { ...this.sledHome, riding: false, done: false } : null;
  }

  /** On a respawn: the sled goes back to the cairn unless it was ridden to the end already. */
  resetSled() {
    if (!this.sled) return;
    this.sled.riding = false;
    if (!this.sled.done) Object.assign(this.sled, this.sledHome);
  }

  /** The resting sled is within reach (and you are on your feet). */
  sledNear(ctl) {
    const b = this.sled;
    return !!b && !b.riding && !ctl.sled && ctl.grounded && (b.x - ctl.pos.x) ** 2 + (b.z - ctl.pos.z) ** 2 < 2.4 ** 2;
  }

  /** Sit on the sled: the body moves onto it, facing the way it points. */
  mount(ctl) {
    const b = this.sled, hf = this.m.heightfield;
    ctl.teleport([b.x, hf.heightAt(b.x, b.z), b.z], b.yaw);
    ctl.mountSled(b.yaw);
    b.riding = true;
    this.launched = false;
    this.events.push({ type: 'mount' });
  }

  /** Step off: the sled stays where it stopped, just to your left. */
  dismount(ctl) {
    const b = this.sled;
    if (!b?.riding) return;
    const yaw = ctl.facing;
    b.x = ctl.pos.x - Math.cos(yaw) * 0.75; b.z = ctl.pos.z + Math.sin(yaw) * 0.75; b.yaw = yaw;
    b.riding = false;
    if (this.s > this.sledEnd - 20) b.done = true;
    ctl.dismountSled();
    this.events.push({ type: 'dismount' });
  }

  get progressFraction() { return this.progress / this.route.length; }

  /** Where to put the player when respawning at the current checkpoint: { pos:[x,y,z], yaw }. */
  spawnPoint(index = this.checkpoint) {
    const c = this.cairns[index];
    const p = this.route.at(c.s + 2.5);
    const hf = this.m.heightfield;
    return { pos: [p.x, hf.heightAt(p.x, p.z), p.z], yaw: p.yaw };
  }

  /**
   * Advance one fixed step. ctl: Controller. Returns the wind acceleration to add to the player's
   * velocity this step (m/s², horizontal) in this.wind.
   */
  step(dt, ctl) {
    this.time += dt;
    const { route } = this;
    const pr = this.m.project(ctl.pos.x, ctl.pos.z);
    const onRoute = pr.s >= 0;
    if (onRoute) {
      this.s = pr.s;
      this.d = pr.d;
      this.section = route.sectionIndexAt(pr.s);
    }
    const sec = route.sections[this.section], ls = this.s - sec.s0;
    const Hbase = route.heightAt(this.s, true);

    // The sled: the kicker's lip throws a rider (heading down the route with some speed) on a
    // fixed arc that clears the crevasse — the heightfield's lip, with the gap cut right after it,
    // could bounce a sled straight up (user playtest). Past the end, the rider steps off once slow.
    if (ctl.sled && this.sled?.riding) {
      const L = this.launch;
      // Taken once per ride, in the last 3 m before the lip, on the snow or just off it (a sled
      // at speed leaves the kicker's convex top a little early).
      if (L && !this.launched && this.s >= L.s - 3 && this.s <= L.s + 0.7 && (ctl.grounded || ctl.heightAboveGround < 0.6) && Math.abs(this.d) < 8) {
        const p = route.at(L.s), hv = Math.hypot(ctl.vel.x, ctl.vel.z);
        const along = (ctl.vel.x * p.dx + ctl.vel.z * p.dz) / (hv || 1);
        if (hv > 4 && along > 0.8) {
          const sp = Math.max(hv, L.speed), c = Math.cos(L.pitch), si = Math.sin(L.pitch);
          ctl.vel.set(p.dx * sp * c, sp * si, p.dz * sp * c);
          ctl.grounded = false; ctl.state = 'air'; ctl.timers.groundLock = 0.2;
          this.launched = true;
          this.events.push({ type: 'launch' });
        }
      }
      this.slowT = ctl.grounded && ctl.speed < 1.2 ? this.slowT + dt : 0;
      if ((this.s > this.sledEnd && this.slowT > 0.4) || this.s > this.sledEnd + 40 || this.section > this.sledSection) this.dismount(ctl);
    }
    this.prevS = this.s;

    // Progress only counts while standing near the route bed (no credit for falling past it).
    // Up to 30 m ahead near the bed; standing right on the bed catches up from further (a slide
    // along a shoulder can carry you >30 m ahead before you rejoin the path).
    const bedW = route.profileAt(this.s).w, ahead = this.s - this.progress;
    if (onRoute && ctl.grounded && ahead > 0 && ((Math.abs(this.d) < bedW + 6 && ahead < 30) || (Math.abs(this.d) < bedW && ahead < 120))) {
      this.progress = this.s;
    }

    // Checkpoints: touching (within 4.5 m of) a cairn further along than the current one.
    for (let i = this.checkpoint + 1; i < this.cairns.length; i++) {
      const c = this.cairns[i];
      if (!c.checkpoint) continue;
      if ((c.x - ctl.pos.x) ** 2 + (c.z - ctl.pos.z) ** 2 < 4.5 ** 2 && Math.abs(c.y - ctl.pos.y) < 4) {
        this.checkpoint = i;
        this.events.push({ type: 'checkpoint', index: i, cairn: c });
      }
    }

    // Wind.
    const w = this.wind;
    w.x = w.z = 0; w.gust = 0; w.warn = false;
    // The gap's storm: where you are in it, how near it is, and its wind down the gap into your face.
    w.whiteout = stormAt(this.storm, ctl.pos.x, ctl.pos.z);
    w.stormNear = stormNear(this.storm, ctl.pos.x, ctl.pos.z);
    const head = STORM_HEAD * Math.max(w.whiteout, 0.2 * w.stormNear); // it builds on the approach
    if (onRoute && head > 0) {
      const p = route.at(this.s);
      w.x -= p.dx * head; w.z -= p.dz * head;
    }
    if (sec.wind && ls >= sec.wind.from && ls <= sec.wind.to && onRoute) {
      const p = route.at(this.s);
      const wd = sec.wind;
      if (wd.gust) {
        this.gustClock += dt;
        const phase = this.gustClock % wd.period, start = wd.period - wd.dur;
        w.warn = phase > start - wd.warn && phase < start;
        if (phase >= start) {
          const u = (phase - start) / wd.dur;
          w.gust = Math.sin(Math.PI * u) ** 2;
          const scale = ctl.grounded && ctl.groundSurface === SURFACE.ROCK ? wd.rockScale : 1;
          w.x = p.rx * wd.gust * w.gust * scale;
          w.z = p.rz * wd.gust * w.gust * scale;
        }
      }
    } else {
      this.gustClock = 0;
    }

    // Out of bounds: fell below the route or strayed sideways.
    const o = sec.oob;
    if (o && onRoute) {
      const below = ctl.pos.y < Hbase - o.below;
      const side = Math.abs(this.d) > o.side;
      if (below || side) this.events.push({ type: 'oob', reason: below ? 'fell' : 'strayed' });
    } else if (!onRoute) {
      this.events.push({ type: 'oob', reason: 'lost' });
    }

    // Summit.
    if (!this.finished && sec.summit !== undefined && ls >= sec.summit - 3 && Math.abs(this.d) < 8) {
      this.finished = true;
      this.events.push({ type: 'summit', time: this.time });
    }
  }
}
