// Level runtime (pure logic, no DOM; the Node playthrough uses it too): route progress, section
// tracking, story trigger volumes, cairn checkpoints + respawn points, out-of-bounds detection,
// the bridge collapse, wind (ridge gusts, whiteout headwind), wall-kick gating and the summit.
import { SURFACE } from './surfaces.js';

export class LevelState {
  /** mountain: buildMountain() result with props.cairns; colliders: world colliders; tuning. */
  constructor(mountain, cairns, colliders, tuning) {
    this.m = mountain;
    this.route = mountain.route;
    this.cairns = cairns;
    this.colliders = colliders;
    this.tuning = tuning;
    this.beats = [];
    this.route.sections.forEach((sec, k) => {
      for (const b of sec.beats ?? []) this.beats.push({ ...b, s: sec.s0 + b.at, section: k, fired: false });
    });
    this.events = [];
    this.reset();
  }

  reset() {
    this.progress = 0; // furthest arc length reached on the route (m)
    this.s = 0;
    this.d = 0;
    this.section = 0;
    this.checkpoint = 0;
    this.time = 0;
    this.collapsed = false;
    this.finished = false;
    this.wind = { x: 0, z: 0, gust: 0, warn: false, whiteout: 0 };
    this.gustClock = 0;
    for (const b of this.beats) b.fired = false;
    if (this.colliders) this.colliders.setGroupEnabled('bridge', true);
    if (this.m.bridge) this.m.bridge.fallen = false;
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

    // Wall-kicks unlock at the cave (DESIGN §2).
    const kickFrom = route.sections.find((x) => x.wallKick)?.s0 ?? 0;
    this.tuning.wallKick.enabled = this.progress >= kickFrom;

    // Checkpoints: touching (within 4.5 m of) a cairn further along than the current one.
    for (let i = this.checkpoint + 1; i < this.cairns.length; i++) {
      const c = this.cairns[i];
      if (!c.checkpoint) continue;
      if ((c.x - ctl.pos.x) ** 2 + (c.z - ctl.pos.z) ** 2 < 4.5 ** 2 && Math.abs(c.y - ctl.pos.y) < 4) {
        this.checkpoint = i;
        this.events.push({ type: 'checkpoint', index: i, cairn: c });
      }
    }

    // Story trigger volumes: a slice of the corridor [s, s + 20] within the bed + 10 m.
    for (const b of this.beats) {
      if (b.fired || !onRoute) continue;
      if (this.s >= b.s && this.s < b.s + 20 && Math.abs(this.d) < route.profileAt(b.s).w + 10) {
        b.fired = true;
        this.events.push({ type: 'beat', beat: b });
      }
    }

    // Bridge collapse.
    const br = this.m.bridge;
    if (br && !this.collapsed && this.s >= br.collapseAt && this.s < br.s1 && ctl.pos.y > br.top - 1.5) {
      this.collapsed = true;
      if (this.colliders) this.colliders.setGroupEnabled('bridge', false);
      this.events.push({ type: 'collapse' });
    }

    // Wind.
    const w = this.wind;
    w.x = w.z = 0; w.gust = 0; w.warn = false;
    w.whiteout = 0;
    if (sec.whiteout) {
      const [a, b] = sec.whiteout;
      w.whiteout = Math.min(1, Math.max(0, Math.min(ls - a, b - ls) / 12));
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
      if (wd.head) { w.x -= p.dx * wd.head * w.whiteout; w.z -= p.dz * wd.head * w.whiteout; }
    } else {
      this.gustClock = 0;
    }

    // Out of bounds: fell below the route, climbed onto the cave roof, or strayed sideways.
    const o = sec.oob;
    if (o && onRoute) {
      const below = ctl.pos.y < Hbase - o.below;
      const above = o.above && ls >= o.aboveRange[0] && ls <= o.aboveRange[1] && ctl.pos.y > Hbase + o.above;
      const side = Math.abs(this.d) > o.side;
      if (below || above || side) this.events.push({ type: 'oob', reason: below ? 'fell' : above ? 'above' : 'strayed' });
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
