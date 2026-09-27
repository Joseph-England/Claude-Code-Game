// Regular-grid heightfield with per-sample surface ids and smooth vertex normals.
// Collision is analytic: bilinear height + bilinearly blended vertex normals (DECISIONS #7).

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

  _cellCoords(x, z) {
    const { n, cell, origin } = this;
    let fx = (x - origin) / cell, fz = (z - origin) / cell;
    fx = Math.min(Math.max(fx, 0), n - 1.000001);
    fz = Math.min(Math.max(fz, 0), n - 1.000001);
    const i = Math.floor(fx), j = Math.floor(fz);
    return [i, j, fx - i, fz - j];
  }

  heightAt(x, z) {
    const [i, j, u, v] = this._cellCoords(x, z);
    const n = this.n, H = this.heights, k = j * n + i;
    const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Smooth normal (bilinear blend of vertex normals) written into `out` (a Vector3). */
  normalAt(x, z, out) {
    const [i, j, u, v] = this._cellCoords(x, z);
    const n = this.n, N = this.normals;
    const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    const ks = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
    let nx = 0, ny = 0, nz = 0;
    for (let q = 0; q < 4; q++) {
      const k = ks[q] * 3;
      nx += N[k] * w[q]; ny += N[k + 1] * w[q]; nz += N[k + 2] * w[q];
    }
    const inv = 1 / Math.hypot(nx, ny, nz);
    return out.set(nx * inv, ny * inv, nz * inv);
  }

  surfaceAt(x, z) {
    const { n, cell, origin } = this;
    const i = Math.min(Math.max(Math.round((x - origin) / cell), 0), n - 1);
    const j = Math.min(Math.max(Math.round((z - origin) / cell), 0), n - 1);
    return this.surfaces[j * n + i];
  }
}
