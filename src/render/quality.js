// Quality tiers (DESIGN §6, DECISIONS #25, #59): Low / Medium / High, auto-picked by a 2 s warm-up
// benchmark on first play (GPU time from EXT_disjoint_timer_query when available, frame time
// otherwise), overridable with ?quality= or F6 (remembered). Low/Medium run dynamic resolution to
// hold 60 fps. Everything except the cascade count changes live; cascades are fixed at startup
// (they are compiled into every lit material) and follow the stored tier from the next load.
export const TIERS = {
  low: { name: 'low', scale: 0.6, dynamic: true, cascades: 1, shadowSize: 1024, lod: [110, 300], snow: 4000, bloom: 4, trail: 256, glitter: 0 },
  medium: { name: 'medium', scale: 0.8, dynamic: true, cascades: 2, shadowSize: 1024, lod: [170, 420], snow: 12000, bloom: 5, trail: 512, glitter: 1 },
  high: { name: 'high', scale: 1.0, dynamic: false, cascades: 3, shadowSize: 2048, lod: [240, 600], snow: 30000, bloom: 6, trail: 1024, glitter: 1 },
};
const ORDER = ['low', 'medium', 'high'];
const KEY = 'alpenglow.quality';

function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }
function store(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode: session only */ } }

/** Tier at startup: URL override, then the remembered tier, else Medium with a benchmark. */
export function startupTier() {
  const q = new URLSearchParams(location.search).get('quality');
  if (TIERS[q]) return { tier: TIERS[q], benchmark: false };
  const s = stored();
  if (TIERS[s]) return { tier: TIERS[s], benchmark: false };
  return { tier: TIERS.medium, benchmark: true };
}

export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.ms = null;
  }
  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

export class Quality {
  /** apply(tier): pushes a tier's live settings into the renderer. */
  constructor({ tier, benchmark }, pipeline, apply) {
    this.tier = tier;
    this.pipeline = pipeline;
    this.apply = apply;
    this.bench = benchmark ? { t: 0, frames: [], gpu: [] } : null;
    this.scale = tier.scale;
    this.avg = 16.7;
    this.adjustT = 0;
    this.goodT = 0;
    apply(tier);
    pipeline.setScale(this.scale);
  }

  set(name, remember = true) {
    this.tier = TIERS[name];
    this.scale = this.tier.scale;
    this.apply(this.tier);
    this.pipeline.setScale(this.scale);
    if (remember) store(name);
  }

  cycle() {
    const next = ORDER[(ORDER.indexOf(this.tier.name) + 1) % ORDER.length];
    this.set(next);
    return next;
  }

  /** Per frame, with the frame time (s) and the last GPU time (ms or null). */
  update(dt, gpuMs) {
    const ms = dt * 1000;
    if (this.bench) {
      const b = this.bench;
      b.t += dt;
      if (b.t > 0.5) { b.frames.push(ms); if (gpuMs) b.gpu.push(gpuMs); }
      if (b.t > 2.5) {
        const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
        const f = med(b.frames), g = b.gpu.length > 10 ? med(b.gpu) : null;
        const pick = (g ?? f) > 24 ? 'low' : g !== null && g < 7 ? 'high' : 'medium';
        this.benchResult = { frameMs: f, gpuMs: g, pick };
        this.bench = null;
        this.set(pick);
      }
      return;
    }
    if (!this.tier.dynamic) return;
    // Dynamic resolution: GPU time when we have it (vsync hides headroom from frame time).
    const cost = gpuMs ?? ms;
    this.avg += (cost - this.avg) * Math.min(1, dt * 3);
    this.adjustT += dt;
    if (this.adjustT < 0.5) return;
    this.adjustT = 0;
    const budget = gpuMs !== null ? 14 : 17.5;
    if (this.avg > budget + 2 && this.scale > 0.5) this.scale = Math.max(0.5, this.scale - 0.05);
    else if (this.avg < budget - 3 && this.scale < this.tier.scale) this.scale = Math.min(this.tier.scale, this.scale + 0.025);
    this.pipeline.setScale(this.scale);
  }
}
