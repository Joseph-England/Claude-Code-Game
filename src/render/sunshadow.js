// Terrain self-shadowing by GPU heightfield ray marching (DECISIONS #53): for every 1 m texel of the
// play area, march from the snow surface toward the sun through the height texture and keep the
// closest miss (min of clearance / distance), which gives soft penumbrae that widen with distance
// — long, soft sunset shadows from ridges hundreds of metres away. Recomputed only when the sun
// moves, a quarter of the map per frame, and cross-faded from the previous map. The terrain casts nothing into the shadow maps; the
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
    if (uSunDir.y < -0.08) { gl_FragColor = vec4(0.0); return; } // (well past sunset; above this the march fades it)
    vec2 t0 = vUv * float(uN);
    float h0 = hAt(t0) + 0.4;
    vec2 dirT = normalize(uSunDir.xz) / uCell;       // texels per metre horizontally
    float rise = uSunDir.y / length(uSunDir.xz);     // metres up per metre along
    float vis = 1.0, t = 0.8;
    for (int i = 0; i < 96; i++) {
      vec2 p = t0 + dirT * t;
      if (p.x < 0.0 || p.y < 0.0 || p.x > float(uN) || p.y > float(uN)) break;
      float clear = h0 + rise * t - hAt(p);
      vis = min(vis, 5.0 * clear / t);
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
    // Three targets (user playtest, Session 8: the ending's light changed in steps): `work` is
    // rendered a strip per frame for the newest sun; when it is complete it becomes `cur` and the
    // old `cur` becomes `prev`, and materials cross-fade prev → cur over FADE seconds, so the
    // shadows glide with the sun instead of jumping 0.15° at a time.
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(hf.n, hf.n, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
      rt.scissorTest = true;
      return rt;
    };
    this.rts = [mk(), mk(), mk()]; // prev, cur, work
    this.pass = makePass(FRAG, {
      uHeight: { value: heightTex }, uN: { value: hf.n }, uCell: { value: hf.cell }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    });
    this.origin = new THREE.Vector2(hf.origin - hf.cell / 2, hf.origin - hf.cell / 2);
    this.size = hf.n * hf.cell;
    this.pending = 0; // strips left to render into `work`
    this.last = new THREE.Vector3(9, 9, 9);
    this.strips = 4;
    this.mix = 1; // prev → cur
    this.FADE = 0.5;
  }

  get texture() { return this.rts[1].texture; }
  get prevTexture() { return this.rts[0].texture; }

  /** Call every frame with the current sun direction and the frame time. */
  update(sunDir, force = false, dt = 0) {
    this.mix = Math.min(1, this.mix + dt / this.FADE);
    if (force) {
      this.last.copy(sunDir);
      this.pass.u.uSunDir.value.copy(sunDir);
      for (const rt of this.rts) this.render(rt, 0, rt.width);
      this.pending = 0; this.mix = 1;
      return;
    }
    // Start the next map once the fade has landed and the sun has moved a little (~0.03°).
    if (!this.pending && this.mix >= 1 && this.last.angleTo(sunDir) > 0.0005) {
      this.last.copy(sunDir);
      this.pass.u.uSunDir.value.copy(sunDir);
      this.pending = this.strips;
    }
    if (!this.pending) return;
    const n = this.rts[2].width, h = Math.ceil(n / this.strips), k = this.strips - this.pending;
    this.render(this.rts[2], k * h, h);
    if (--this.pending === 0) {
      const [prev, cur, work] = this.rts;
      this.rts = [cur, work, prev];
      this.mix = 0;
    }
  }

  render(rt, y, h) {
    rt.scissor.set(0, y, rt.width, h);
    this.r.setRenderTarget(rt); // applies the target's scissor
    this.pass.quad.render(this.r);
    this.r.setRenderTarget(null);
  }
}
