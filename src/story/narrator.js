// Narrator: shows the inner-voice lines (DESIGN §1, DECISIONS #14/#49). One line at a time from a
// queue; each fades in, holds for its reading time and fades out; nothing ever blocks input.
// The Weight seeps in slowly at screen centre and shrinks and fades over the climb; You speak
// plainly in the lower third; notes from Others stay up while you stand at their cairn.
const TIMING = {
  W: { fadeIn: 1.4, fadeOut: 1.6 },
  Y: { fadeIn: 0.8, fadeOut: 1.0 },
  O: { fadeIn: 0.9, fadeOut: 1.2 },
};

export class Narrator {
  /** el: the line element; vignette: the Weight's vignette; onShow(line): e.g. the bell cue. */
  constructor(el, vignette, onShow = () => {}) {
    this.el = el;
    this.vig = vignette;
    this.onShow = onShow;
    this.queue = [];
    this.cur = null;
    this.gap = 0;
    this.weight = 1; // 1 at the start → ~0.55 at the summit (set by the game from progress)
  }

  get idle() { return !this.cur && !this.queue.length; }

  /**
   * Queue a line. A note (Others) is a thing in your hands, not a thought: it goes to the front of
   * the queue and a line still showing lets go quickly, so a note never waits behind the last
   * section's line (user playtest, Session 7; DECISIONS #85).
   */
  push(line, opts = {}) {
    if (line.voice !== 'O') { this.queue.push({ line, ...opts }); return; }
    this.queue.unshift({ line, ...opts });
    const c = this.cur;
    if (c && c.line.voice !== 'O') {
      if (c.phase === 'hold') { c.phase = 'out'; c.t = 0; c.quick = true; this.el.style.setProperty('--fade-out', '0.35s'); this.el.classList.remove('show'); this.vig.style.opacity = 0; }
      else c.quick = true;
    }
  }

  /** Let the current line go early (e.g. the player got up while "stay down" was showing). */
  hurry() { if (this.cur?.phase === 'hold') { this.cur.hold = Math.min(this.cur.hold, this.cur.t + 0.2); this.cur.release = true; } }

  clear() {
    this.queue.length = 0;
    this.cur = null;
    this.gap = 0;
    this.el.className = '';
    this.vig.style.opacity = 0;
  }

  /** noteHere: the note line whose cairn the player is standing at (keeps a note up). */
  update(dt, noteHere = null) {
    if (this.cur) {
      const c = this.cur, tm = TIMING[c.line.voice];
      c.t += dt;
      const staying = c.line.voice === 'O' && noteHere === c.line && c.t < 30 && !c.release;
      if (c.phase === 'hold' && c.t >= c.hold && !staying) {
        c.phase = 'out';
        c.t = 0;
        this.el.classList.remove('show');
        this.vig.style.opacity = 0;
      } else if (c.phase === 'out' && c.t >= (c.quick ? Math.min(0.35, tm.fadeOut) : tm.fadeOut)) {
        this.cur = null;
        this.el.className = '';
        // Answers come quickly; unrelated lines leave room to breathe; a note comes at once.
        this.gap = this.queue[0]?.line.voice === 'O' ? 0.1 : this.queue[0]?.line.after === c.line.id ? 0.3 : 1.2;
      }
      return;
    }
    if ((this.gap -= dt) > 0 || !this.queue.length) return;
    const q = this.queue.shift(), l = q.line, tm = TIMING[l.voice];
    const read = 2.2 + 0.055 * l.text.length;
    this.cur = { ...q, t: 0, phase: 'hold', hold: tm.fadeIn + (q.hold ?? Math.max(l.voice === 'O' ? 4.5 : 2.6, read)) };
    this.el.textContent = l.text;
    this.el.className = `voice-${l.voice}`;
    this.el.style.setProperty('--fade-in', `${tm.fadeIn}s`);
    this.el.style.setProperty('--fade-out', `${tm.fadeOut}s`);
    if (l.voice === 'W') {
      this.el.style.setProperty('--weight', this.weight.toFixed(3));
      this.vig.style.transitionDuration = `${tm.fadeIn}s`;
      this.vig.style.opacity = 0.35 + 0.65 * this.weight;
    }
    void this.el.offsetWidth; // restart the transition
    this.el.classList.add('show');
    this.onShow(l);
  }
}
