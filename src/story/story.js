// Story triggers (pure logic, no DOM; the Node playthrough runs it too). Every inner-voice line in
// level.js is armed over a stretch of the route and fires once, either on entering its stretch or
// when its condition is met there (DESIGN §1). Fired lines go to `out`; the narrator shows them.
export class Story {
  constructor(route, cairns) {
    this.route = route;
    this.cairns = cairns;
    this.lines = [];
    route.sections.forEach((sec, k) => {
      for (const b of sec.beats ?? []) {
        const until = b.when ? sec.s0 + (b.until ?? sec.len) : sec.s0 + b.at + 20;
        const note = b.when === 'cairn' ? cairns.filter((c) => c.section === k && !c.checkpoint)[b.cairn] : null;
        this.lines.push({ ...b, s0: sec.s0 + b.at, s1: until, section: k, note });
      }
    });
    this.byId = new Map(this.lines.map((l) => [l.id, l]));
    this.out = [];
    this.reset();
  }

  reset() {
    for (const l of this.lines) l.fired = false;
    this.signals = new Set();
    this.retried = new Set(); // sections with a respawn in them
    this.sectionT = 0;
    this.lastSection = -1;
    this.stoneReady = false; // near the last whiteout cairn after its note: "leave a stone"
    this.out.length = 0;
  }

  /** One-off signals from the game: 'input', 'jump', 'stone'. */
  signal(name) { this.signals.add(name); }
  /** A respawn happened while the checkpoint was in section k. */
  respawned(k) { this.retried.add(k); }

  fire(l) {
    if (l.fired) return;
    l.fired = true;
    this.out.push(l);
    for (const f of this.lines) if (f.after === l.id && !f.fired) this.fire(f);
  }

  /** Fire a scripted line (the ending) by id. */
  say(id) { const l = this.byId.get(id); if (l) this.fire(l); }

  /** The note cairn the player is standing at, if its line is armed or showing; else null. */
  noteAt(ctl) {
    for (const l of this.lines) {
      if (l.when !== 'cairn' || !l.note) continue;
      if ((l.note.x - ctl.pos.x) ** 2 + (l.note.z - ctl.pos.z) ** 2 < 4.5 ** 2) return l;
    }
    return null;
  }

  step(dt, level, ctl) {
    const s = level.s;
    if (level.section !== this.lastSection) { this.lastSection = level.section; this.sectionT = 0; }
    this.sectionT += dt;
    const here = this.noteAt(ctl);
    for (const l of this.lines) {
      if (l.fired || l.after || l.when === 'ending' || l.when === 'stone') continue;
      if (s < l.s0 || s > l.s1) continue;
      let ok = false;
      switch (l.when) {
        case undefined: ok = true; break;
        case 'input': ok = this.signals.has('input'); break;
        case 'jump': ok = this.signals.has('jump'); break;
        // Slow through the powder: still in it well after an easy pace would have left.
        case 'slow': ok = level.section === l.section && this.sectionT > 30; break;
        case 'fast': ok = ctl.speed > 10.5; break;
        case 'afoot': ok = !level.sled?.riding; break;
        case 'cairn': ok = here === l; break;
      }
      // A few conditional lines belong to everyone's run: they fire at the end of their stretch anyway.
      if (ok || (l.fallback && s > l.s1 - 2)) this.fire(l);
    }
    // After reading the last note of a section you can leave a stone on that cairn.
    const stone = this.lines.find((l) => l.when === 'stone' && !l.fired);
    const lastNote = stone && this.lines.filter((l) => l.when === 'cairn' && l.section === stone.section).at(-1);
    // Within a few steps of that cairn (a little wider than reading range, so it isn't missed).
    this.stoneReady = !!(stone && lastNote?.fired && (lastNote.note.x - ctl.pos.x) ** 2 + (lastNote.note.z - ctl.pos.z) ** 2 < 7 ** 2);
    if (this.stoneReady && this.signals.has('stone')) { this.fire(stone); this.stoneCairn = lastNote.note; }
    this.signals.delete('jump');
    this.signals.delete('stone');
  }
}
