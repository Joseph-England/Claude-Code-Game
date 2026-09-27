// Fixed-timestep game loop (DECISIONS #6).
// Physics always advances in FIXED_DT steps; rendering interpolates between the last two
// physics states with `alpha`, so behaviour is identical at 30, 60 or 240 fps.

export const FIXED_HZ = 120;
export const FIXED_DT = 1 / FIXED_HZ;

/**
 * @param {object} o
 * @param {(dt:number, stepIndex:number) => void} o.update  one fixed physics step
 * @param {(alpha:number, frameDt:number, steps:number) => void} o.render  once per frame
 * @param {() => void} [o.beginFrame]  called once per frame before the physics steps
 * @param {number} [o.maxFrameDt]  clamp for long frames (tab switch, breakpoints)
 */
export function createLoop({ update, render, beginFrame, maxFrameDt = 0.25 }) {
  let acc = 0;
  let last = -1;
  let rafId = 0;

  /** Advance by a real frame time (seconds). Exposed for tests. */
  function advance(frameDt) {
    frameDt = Math.min(Math.max(frameDt, 0), maxFrameDt);
    acc += frameDt;
    beginFrame?.(frameDt);
    let steps = 0;
    // Small epsilon so float drift never loses a step at exact multiples of the frame rate.
    while (acc >= FIXED_DT - 1e-9) {
      update(FIXED_DT, steps++);
      acc -= FIXED_DT;
    }
    if (acc < 0) acc = 0;
    render(acc / FIXED_DT, frameDt, steps);
    return steps;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = last < 0 ? FIXED_DT : t - last;
    last = t;
    advance(dt);
  }

  return {
    advance,
    start() {
      if (!rafId) rafId = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      last = -1;
    },
  };
}
