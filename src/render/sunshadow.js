// Terrain self-shadowing by GPU heightfield ray marching (DECISIONS #53): for every 1 m texel of the
// play area, march from the snow surface toward the sun through the height texture and keep the
// closest miss (min of clearance / distance), which gives soft penumbrae that widen with distance
// — long, soft sunset shadows from ridges hundreds of metres away. Recomputed only when the sun
// moves, a quarter of the map per frame. The terrain casts nothing into the shadow maps; the
// cascades carry only props and the avatar.
import * as THREE from 'three';
import { makePass } from './post.js';

const FRAG = /* glsl */`
  uniform highp sampler2D uHeight;
  uniform int uN;
  uniform float uCell;
  uniform vec3 uSunDir;
  varying vec2 vUv;
  float hAt(vec2 t) { // t in texels, bilinear from four fetches (float textures may not filter)
    vec2 f = fract(t - 0.5), b = floor(t - 0.5);
    ivec2 i = ivec2(b);
    ivec2 m = ivec2(uN - 1);
    float a = texelFetch(uHeight, clamp(i, ivec2(0), m), 0).r;
    float c = texelFetch(uHeight, clamp(i + ivec2(1, 0), ivec2(0), m), 0).r;
    float d = texelFetch(uHeight, clamp(i + ivec2(0, 1), ivec2(0), m), 0).r;
    float e = texelFetch(uHeight, clamp(i + ivec2(1, 1), ivec2(0), m), 0).r;
    return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
  }
  void main() {
    if (uSunDir.y < -0.02) { gl_FragColor = vec4(0.0); return; }
    vec2 t0 = vUv * float(uN);
    float h0 = hAt(t0) + 0.4;
    vec2 dirT = normalize(uSunDir.xz) / uCell;       // texels per metre horizontally
    float rise = uSunDir.y / length(uSunDir.xz);     // metres up per metre along
    float vis = 1.0, t = 0.8;
    for (int i = 0; i < 96; i++) {
      vec2 p = t0 + dirT * t;
      if (p.x < 0.0 || p.y < 0.0 || p.x > float(uN) || p.y > float(uN)) break;
      float clear = h0 + rise * t - hAt(p);
      vis = min(vis, 12.0 * clear / t);
      if (vis < 0.0) break;
      t *= 1.07; t += 0.4;
      if (t > 900.0) break;
    }
    vis = clamp(vis, 0.0, 1.0);
    gl_FragColor = vec4(vis * vis * (3.0 - 2.0 * vis), 0.0, 0.0, 1.0);
  }
`;

export class SunShadow {
  constructor(renderer, heightTex, hf) {
    this.r = renderer;
    this.rt = new THREE.WebGLRenderTarget(hf.n, hf.n, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
    this.rt.scissorTest = true;
    this.pass = makePass(FRAG, {
      uHeight: { value: heightTex }, uN: { value: hf.n }, uCell: { value: hf.cell }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    });
    this.texture = this.rt.texture;
    this.origin = new THREE.Vector2(hf.origin - hf.cell / 2, hf.origin - hf.cell / 2);
    this.size = hf.n * hf.cell;
    this.pending = 0; // strips left to render for the current sun
    this.last = new THREE.Vector3(9, 9, 9);
    this.strips = 4;
  }

  /** Call every frame with the current sun direction; renders one strip when work is pending. */
  update(sunDir, force = false) {
    if (force || this.last.angleTo(sunDir) > 0.0025) { // ~0.15°
      this.last.copy(sunDir);
      this.pass.u.uSunDir.value.copy(sunDir);
      this.pending = force ? -1 : this.strips;
    }
    if (!this.pending) return;
    const n = this.rt.width;
    const r = this.r;
    if (this.pending < 0) { this.rt.scissor.set(0, 0, n, n); this.pending = 0; }
    else {
      const k = this.strips - this.pending, h = Math.ceil(n / this.strips);
      this.rt.scissor.set(0, k * h, n, h);
      this.pending--;
    }
    r.setRenderTarget(this.rt); // applies the target's scissor
    this.pass.quad.render(r);
    r.setRenderTarget(null);
  }
}
