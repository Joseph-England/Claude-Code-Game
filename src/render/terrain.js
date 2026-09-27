// Chunked terrain renderer (DECISIONS #10): the heightfield lives in a float texture that the vertex
// shader reads, so every LOD shares one data source (and Phase 4's snow trails can displace it).
// 16×16 chunks of 64 m; three instanced grids (1, 2, 4 m spacing) with skirts that hide LOD cracks.
// Each frame, chunks are frustum-culled on the CPU and sorted into the three instanced meshes:
// the whole terrain is 3 draw calls (plus 3 for the shadow pass).
import * as THREE from 'three';

export const CHUNK = 64;
const LODS = [{ step: 1, dist: 170 }, { step: 2, dist: 420 }, { step: 4, dist: Infinity }];
const SKIRT = [2.5, 5, 10];

// Linear-space tints per surface id (packed, powder, ice, rock).
export const SURFACE_TINTS = [[0.8, 0.83, 0.88], [0.96, 0.96, 1.0], [0.42, 0.66, 0.92], [0.36, 0.32, 0.3]];

/** A CHUNK×CHUNK grid with `seg` segments per side plus a skirt ring (aSkirt = 1). */
function chunkGeometry(seg) {
  const step = CHUNK / seg, row = seg + 1;
  const pos = [], skirt = [], idx = [];
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) { pos.push(i * step, 0, j * step); skirt.push(0); }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Skirt: walk the border, duplicate each vertex as a lowered copy, stitch a strip.
  const border = [];
  for (let i = 0; i < seg; i++) border.push(i);
  for (let j = 0; j < seg; j++) border.push(j * row + seg);
  for (let i = seg; i > 0; i--) border.push(seg * row + i);
  for (let j = seg; j > 0; j--) border.push(j * row);
  const base = pos.length / 3;
  for (const v of border) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(1); }
  for (let k = 0; k < border.length; k++) {
    const a = border[k], b = border[(k + 1) % border.length], a2 = base + k, b2 = base + ((k + 1) % border.length);
    idx.push(a, b, a2, b, b2, a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0), 3));
  g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
  g.setIndex(idx);
  return g;
}

const HEIGHT_GLSL = /* glsl */`
  uniform highp sampler2D uHeight;
  uniform vec2 uOrigin;   // world xz of texel (0,0)
  uniform float uCell;
  uniform float uStep;    // this LOD's vertex spacing (m)
  uniform float uSkirt;
  uniform int uN;
  attribute float aSkirt;
  varying vec2 vWorldXZ;
  float hAt(vec2 xz) {
    ivec2 t = clamp(ivec2(floor((xz - uOrigin) / uCell + 0.5)), ivec2(0), ivec2(uN - 1));
    return texelFetch(uHeight, t, 0).r;
  }
`;
const DISPLACE_GLSL = /* glsl */`
  vec2 wxz = (instanceMatrix * vec4(position, 1.0)).xz;
  vWorldXZ = wxz;
  transformed.y = hAt(wxz) - aSkirt * uSkirt;
`;
const NORMAL_GLSL = /* glsl */`
  {
    vec2 wxz0 = (instanceMatrix * vec4(position, 1.0)).xz;
    float e = uStep;
    float hx = hAt(wxz0 + vec2(e, 0.0)) - hAt(wxz0 - vec2(e, 0.0));
    float hz = hAt(wxz0 + vec2(0.0, e)) - hAt(wxz0 - vec2(0.0, e));
    objectNormal = normalize(vec3(-hx, 2.0 * e, -hz));
  }
`;

function patchVertex(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${HEIGHT_GLSL}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${NORMAL_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${DISPLACE_GLSL}`);
}

export class TerrainRenderer {
  /** mountain: buildMountain() result (heightfield + surfaces). */
  /** opts.lit(material, patch, key): world-lighting setup (materials.js), else plain. */
  constructor(scene, mountain, opts = {}) {
    const hf = mountain.heightfield, n = hf.n;
    this.hf = hf;
    this.heightTex = new THREE.DataTexture(hf.heights, n, n, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
    // Splat map: one-hot surface weights, bilinear filtered → soft blends between surfaces.
    const splat = new Uint8Array(n * n * 4);
    for (let k = 0; k < n * n; k++) splat[k * 4 + hf.surfaces[k]] = 255;
    this.splatTex = new THREE.DataTexture(splat, n, n, THREE.RGBAFormat);
    this.splatTex.magFilter = this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;

    const common = {
      uHeight: { value: this.heightTex }, uOrigin: { value: new THREE.Vector2(hf.origin, hf.origin) },
      uCell: { value: hf.cell }, uN: { value: n },
    };
    const tints = SURFACE_TINTS.map((c) => new THREE.Vector3(...c));
    this.chunksPerSide = Math.floor((hf.size) / CHUNK);
    this.meshes = LODS.map((lod, l) => {
      const uniforms = { ...common, uStep: { value: lod.step }, uSkirt: { value: SKIRT[l] } };
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
      const patch = (shader) => {
        patchVertex(shader, uniforms);
        shader.uniforms.uSplat = { value: this.splatTex };
        shader.uniforms.uTints = { value: tints };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D uSplat; uniform vec3 uTints[4]; uniform vec2 uOrigin; uniform float uCell; uniform int uN;
            varying vec2 vWorldXZ;`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec2 suv = ((vWorldXZ - uOrigin) / uCell + 0.5) / float(uN);
            vec4 w = texture2D(uSplat, suv);
            vec3 tint = (uTints[0] * w.r + uTints[1] * w.g + uTints[2] * w.b + uTints[3] * w.a) / max(w.r + w.g + w.b + w.a, 1e-3);
            // Faint 4 m grid for speed and scale readability (gray-box aid, fades with distance).
            vec2 gq = abs(fract(vWorldXZ / 4.0 - 0.5) - 0.5) / fwidth(vWorldXZ / 4.0);
            float grid = 1.0 - min(min(gq.x, gq.y), 1.0);
            tint *= 1.0 - 0.07 * grid;
            diffuseColor.rgb *= tint;`);
      };
      if (opts.lit) opts.lit(mat, patch, `terrain${l}`); else mat.onBeforeCompile = patch;
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (shader) => {
        patchVertex(shader, uniforms);
        shader.vertexShader = shader.vertexShader.replace(NORMAL_GLSL, '');
      };
      const count = this.chunksPerSide ** 2;
      const mesh = new THREE.InstancedMesh(chunkGeometry(CHUNK / lod.step), mat, count);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.castShadow = false; // terrain self-shadowing is ray marched (sunshadow.js)
      mesh.receiveShadow = true;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    });

    // Per-chunk height bounds for culling.
    const cps = this.chunksPerSide;
    this.bounds = [];
    for (let cj = 0; cj < cps; cj++) {
      for (let ci = 0; ci < cps; ci++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = cj * CHUNK; j <= (cj + 1) * CHUNK; j++) {
          for (let i = ci * CHUNK; i <= (ci + 1) * CHUNK; i++) {
            const h = hf.heights[j * n + i];
            if (h < lo) lo = h;
            if (h > hi) hi = h;
          }
        }
        const x0 = hf.origin + ci * CHUNK, z0 = hf.origin + cj * CHUNK;
        this.bounds.push(new THREE.Box3(new THREE.Vector3(x0, lo - SKIRT[2], z0), new THREE.Vector3(x0 + CHUNK, hi, z0 + CHUNK)));
      }
    }
    this.frustum = new THREE.Frustum();
    this.projView = new THREE.Matrix4();
    this.m = new THREE.Matrix4();
    this.center = new THREE.Vector3();
    this.stats = { chunks: [0, 0, 0], triangles: 0 };
  }

  /** Cull and assign LODs for this camera. */
  update(camera) {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const counts = [0, 0, 0];
    const cam = camera.position;
    for (let k = 0; k < this.bounds.length; k++) {
      const b = this.bounds[k];
      if (!this.frustum.intersectsBox(b)) continue;
      b.getCenter(this.center);
      const dist = b.distanceToPoint(cam);
      let l = 0;
      while (dist > LODS[l].dist) l++;
      this.m.makeTranslation(b.min.x, 0, b.min.z);
      this.meshes[l].setMatrixAt(counts[l]++, this.m);
    }
    let tris = 0;
    this.meshes.forEach((mesh, l) => {
      mesh.count = counts[l];
      mesh.instanceMatrix.needsUpdate = true;
      tris += counts[l] * (mesh.geometry.index.count / 3);
    });
    this.stats.chunks = counts;
    this.stats.triangles = tris;
  }
}

/** Distant ranges (render only): a coarse static mesh, far below the play area inside it. */
export function createBackdrop(scene, mountain) {
  const { backdrop, backdropN: bn, backdropSize: size } = mountain;
  const g = new THREE.PlaneGeometry(size, size, bn - 1, bn - 1);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) p.setY(k, backdrop[k]);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdfe4f0, roughness: 1 }));
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}
