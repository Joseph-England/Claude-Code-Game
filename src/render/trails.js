// Deformable snow (DESIGN §4, showcase #3): a toroidal ring-buffer render target covering a
// WINDOW × WINDOW metre square that follows the player. Each frame one full-screen pass ping-pongs
// the buffer: texels that just scrolled in are cleared to fresh snow, everything else is kept, and
// the player's path (a capsule from the last position) and footprints are stamped in. The terrain
// vertex shader sinks powder (and a little crust) along it; the fragment shader bends normals by
// its gradient at the target's full resolution, so footprints read even between vertices.
import * as THREE from 'three';
import { makePass } from './post.js';

export const WINDOW = 128;

const FRAG = /* glsl */`
  uniform sampler2D tPrev;
  uniform vec2 uCenter, uPrevCenter, uA, uB;
  uniform float uW, uRadius, uDepth;
  uniform vec3 uFoot[4]; // x, z, depth
  varying vec2 vUv;
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * t);
  }
  void main() {
    vec2 base = vUv * uW;
    vec2 p = base + uW * floor((uCenter - base) / uW + 0.5);  // this texel's world xz now
    vec2 q = abs(p - uPrevCenter);
    float v = (q.x < uW * 0.5 && q.y < uW * 0.5) ? texture2D(tPrev, vUv).r : 0.0;
    if (uDepth > 0.0) v = max(v, uDepth * smoothstep(uRadius, uRadius * 0.4, segDist(p, uA, uB)));
    for (int i = 0; i < 4; i++) {
      if (uFoot[i].z > 0.0) v = max(v, uFoot[i].z * smoothstep(0.16, 0.07, length(p - uFoot[i].xy)));
    }
    gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
  }
`;

// Terrain hooks: vertex displacement and fragment normal bend (uses gW from the snow shader).
export const TRAIL_PARS = /* glsl */`
  uniform sampler2D tTrail;
  uniform vec2 uTrailCenter;
  uniform float uTrailW, uTrailTexel;
  float trailAt(vec2 xz) {
    vec2 d = abs(xz - uTrailCenter);
    if (d.x > uTrailW * 0.5 - 2.0 || d.y > uTrailW * 0.5 - 2.0) return 0.0;
    return texture2D(tTrail, fract(xz / uTrailW)).r;
  }
`;
export const TRAIL_SINK = /* glsl */`
  float trailSink(vec2 xz, vec4 w) { return trailAt(xz) * (0.3 * w.y + 0.06 * w.x); }
`;
export const TRAIL_NORMAL = /* glsl */`
  {
    float e = uTrailTexel;
    float k = (0.3 * gW.y + 0.06 * gW.x) * gDetailFade * 2.5;
    if (k > 0.0) {
      vec2 xz = vWorldPos.xz;
      float c = trailAt(xz);
      float dx = trailAt(xz + vec2(e, 0.0)) - trailAt(xz - vec2(e, 0.0));
      float dz = trailAt(xz + vec2(0.0, e)) - trailAt(xz - vec2(0.0, e));
      vec3 nW = inverseTransformDirection(normal, viewMatrix);
      nW = normalize(nW + vec3(dx, 0.0, dz) * k / (2.0 * e));
      normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      diffuseColor.rgb *= 1.0 - 0.12 * c * (gW.y + gW.x); // packed-down snow is a little greyer
    }
  }
`;

export class Trails {
  constructor(renderer, size = 512) {
    this.r = renderer;
    const opts = { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false };
    this.rts = [new THREE.WebGLRenderTarget(size, size, opts), new THREE.WebGLRenderTarget(size, size, opts)];
    this.i = 0;
    this.pass = makePass(FRAG, {
      tPrev: { value: null }, uCenter: { value: new THREE.Vector2() }, uPrevCenter: { value: new THREE.Vector2(1e6, 1e6) },
      uA: { value: new THREE.Vector2() }, uB: { value: new THREE.Vector2() }, uW: { value: WINDOW },
      uRadius: { value: 0.3 }, uDepth: { value: 0 }, uFoot: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    });
    this.uniforms = {
      tTrail: { value: this.rts[0].texture }, uTrailCenter: { value: new THREE.Vector2(1e6, 1e6) },
      uTrailW: { value: WINDOW }, uTrailTexel: { value: WINDOW / size },
    };
    this.last = null;
    this.feet = [];
    for (const rt of this.rts) { renderer.setRenderTarget(rt); renderer.clear(); }
    renderer.setRenderTarget(null);
  }

  /** Change the buffer resolution (quality tier); the trail so far is dropped. */
  resize(size) {
    if (size === this.rts[0].width) return;
    for (const rt of this.rts) { rt.setSize(size, size); this.r.setRenderTarget(rt); this.r.clear(); }
    this.r.setRenderTarget(null);
    this.uniforms.uTrailTexel.value = WINDOW / size;
  }

  /** Queue a footprint (world x, z). */
  foot(x, z, depth = 1) { if (this.feet.length < 4) this.feet.push([x, z, depth]); }

  /** pos: player feet (Vector3); stamp: { radius, depth } or null when not touching snow. */
  update(pos, stamp) {
    const texel = WINDOW / this.rts[0].width;
    const u = this.pass.u;
    u.uPrevCenter.value.copy(u.uCenter.value);
    u.uCenter.value.set(Math.round(pos.x / texel) * texel, Math.round(pos.z / texel) * texel);
    if (stamp && this.last) {
      u.uA.value.set(this.last.x, this.last.z);
      u.uB.value.set(pos.x, pos.z);
      u.uRadius.value = stamp.radius;
      u.uDepth.value = stamp.depth;
    } else u.uDepth.value = 0;
    this.last = stamp ? { x: pos.x, z: pos.z } : null;
    u.uFoot.value.forEach((f, k) => f.set(...(this.feet[k] ?? [0, 0, 0])));
    this.feet.length = 0;
    const src = this.rts[this.i], dst = this.rts[1 - this.i];
    u.tPrev.value = src.texture;
    this.r.setRenderTarget(dst);
    this.pass.quad.render(this.r);
    this.r.setRenderTarget(null);
    this.i = 1 - this.i;
    this.uniforms.tTrail.value = dst.texture;
    this.uniforms.uTrailCenter.value.copy(u.uCenter.value);
  }

  /** Forget the path (teleport/respawn) so no groove is drawn across the jump. */
  cut() { this.last = null; }
}
