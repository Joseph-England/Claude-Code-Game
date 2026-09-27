// Level runtime (pure logic, no DOM; the Node playthrough uses it too): route progress, section
// tracking, cairn checkpoints + respawn points, out-of-bounds detection, wind (ridge gusts,
// whiteout headwind) and the summit. Story lines are armed and fired by the narrator (story.js).
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

    // Progress only counts while standing near the route bed (no credit for falling past it).
    if (onRoute && ctl.grounded && Math.abs(this.d) < (route.profileAt(this.s).w + 6) && this.s > this.progress && this.s < this.progress + 30) {
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
