// Regular-grid heightfield with per-sample surface ids and smooth vertex normals.
// Collision is analytic: bicubic height with its exact normal (DECISIONS #7, #30).

const WX = new Float64Array(4), DX = new Float64Array(4), WZ = new Float64Array(4), DZ = new Float64Array(4);
function catmull(t, w, d) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = (-t3 + 2 * t2 - t) / 2; w[1] = (3 * t3 - 5 * t2 + 2) / 2;
  w[2] = (-3 * t3 + 4 * t2 + t) / 2; w[3] = (t3 - t2) / 2;
  d[0] = (-3 * t2 + 4 * t - 1) / 2; d[1] = (9 * t2 - 10 * t) / 2;
  d[2] = (-9 * t2 + 8 * t + 1) / 2; d[3] = (3 * t2 - 2 * t) / 2;
}

export class Heightfield {
  /** size: world extent (m), cell: sample spacing (m); centred on the origin. */
  constructor(size, cell) {
    this.size = size;
    this.cell = cell;
    this.n = Math.round(size / cell) + 1;
    this.origin = -size / 2;
    const count = this.n * this.n;
    this.heights = new Float32Array(count);
    this.surfaces = new Uint8Array(count);
    this.normals = new Float32Array(count * 3);
  }

  /** Fill from world-space functions h(x,z) and surface(x,z). */
  fill(heightFn, surfaceFn) {
    const { n, cell, origin } = this;
    for (let j = 0; j < n; j++) {
      const z = origin + j * cell;
      for (let i = 0; i < n; i++) {
        const x = origin + i * cell;
        this.heights[j * n + i] = heightFn(x, z);
        this.surfaces[j * n + i] = surfaceFn(x, z);
      }
    }
    this.computeNormals();
    return this;
  }

  computeNormals() {
    const { n, cell, heights: H, normals: N } = this;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const hl = H[j * n + Math.max(i - 1, 0)], hr = H[j * n + Math.min(i + 1, n - 1)];
        const hd = H[Math.max(j - 1, 0) * n + i], hu = H[Math.min(j + 1, n - 1) * n + i];
        const dx = (hr - hl) / (cell * (Math.min(i + 1, n - 1) - Math.max(i - 1, 0)));
        const dz = (hu - hd) / (cell * (Math.min(j + 1, n - 1) - Math.max(j - 1, 0)));
        const inv = 1 / Math.hypot(dx, 1, dz);
        const k = (j * n + i) * 3;
        N[k] = -dx * inv; N[k + 1] = inv; N[k + 2] = -dz * inv;
      }
    }
  }

  /**
   * Catmull-Rom bicubic height and its exact gradient, so collision height and normal describe
   * the same smooth (C1) surface: moving along the normal's tangent plane never drifts off it,
   * and crest launches depend only on real curvature. Returns height; writes the normal to `out`.
   */
  sample(x, z, out) {
    const { n, cell, origin, heights: H } = this;
    const fx = Math.min(Math.max((x - origin) / cell, 0), n - 1.000001);
    const fz = Math.min(Math.max((z - origin) / cell, 0), n - 1.000001);
    const i = Math.floor(fx), j = Math.floor(fz);
    catmull(fx - i, WX, DX);
    catmull(fz - j, WZ, DZ);
    let h = 0, gx = 0, gz = 0;
    for (let b = 0; b < 4; b++) {
      const row = Math.min(Math.max(j + b - 1, 0), n - 1) * n;
      let rh = 0, rd = 0;
      for (let a = 0; a < 4; a++) {
        const v = H[row + Math.min(Math.max(i + a - 1, 0), n - 1)];
        rh += WX[a] * v;
        rd += DX[a] * v;
      }
      h += WZ[b] * rh;
      gx += WZ[b] * rd;
      gz += DZ[b] * rh;
    }
    if (out) {
      gx /= cell; gz /= cell;
      const inv = 1 / Math.hypot(gx, 1, gz);
      out.set(-gx * inv, inv, -gz * inv);
    }
    return h;
  }

  heightAt(x, z) {
    return this.sample(x, z, null);
  }

  normalAt(x, z, out) {
    this.sample(x, z, out);
    return out;
  }

  surfaceAt(x, z) {
    const { n, cell, origin } = this;
    const i = Math.min(Math.max(Math.round((x - origin) / cell), 0), n - 1);
    const j = Math.min(Math.max(Math.round((z - origin) / cell), 0), n - 1);
    return this.surfaces[j * n + i];
  }
}
