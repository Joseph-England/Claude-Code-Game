// Render pipeline (DECISIONS #20, #51): the scene renders into a half-float HDR target with a depth
// texture; a chain of full-screen passes then does atmosphere (fog/aerial perspective, reads
// depth), mip-chain bloom, colour grade + tonemap + vignette/grain/speed effects, and FXAA to the
// canvas. Own passes on FullScreenQuad instead of EffectComposer: fewer targets, one place to see
// the whole chain. `scale` is the render scale (quality tier + dynamic resolution).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function makePass(fragmentShader, uniforms = {}, defines = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false,
  });
  return { material, quad: new FullScreenQuad(material), u: material.uniforms };
}

const hdrTarget = (w, h, depth) => {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); rt.depthTexture.format = THREE.DepthFormat; }
  return rt;
};

// AgX (Sobotka), minimal polynomial fit (Benjamin Wrensch), with a gentle "punchy" look.
const TONEMAP_GLSL = /* glsl */`
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    c = m * max(c, 0.0);
    c = clamp(log2(max(c, 1e-10)), -12.47393, 4.026069);
    c = (c + 12.47393) / 16.500999;
    c = agxContrast(c);
    // punchy look: a touch more saturation and contrast
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = pow(max(c, 0.0), vec3(1.25));
    c = l + 1.2 * (c - l);
    c = mi * c;
    return clamp(pow(max(c, 0.0), vec3(2.2)), 0.0, 1.0); // back to linear
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
`;

// Bloom (Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare"): 13-tap
// downsample (Karis-averaged on the first mip so glitter can't flicker), 9-tap tent upsample.
const DOWN_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uKaris;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  float w(vec3 c) { return uKaris > 0.5 ? 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))) : 1.0; }
  void main() {
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = w(g0) * 0.5, w1 = w(g1) * 0.125, w2 = w(g2) * 0.125, w3 = w(g3) * 0.125, w4 = w(g4) * 0.125;
    vec3 o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    gl_FragColor = vec4(max(o, 0.0), 1.0);
  }
`;
const UP_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 c = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
           + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
    gl_FragColor = vec4(c / 16.0, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tHDR, tBloom;
  uniform float uExposure, uBloom, uSat, uTemp, uContrast, uVignette, uGrain, uTime, uSpeed;
  uniform vec3 uLift, uGain;
  varying vec2 vUv;
  ${TONEMAP_GLSL}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 hdrAt(vec2 uv) { return mix(texture2D(tHDR, uv).rgb, texture2D(tBloom, uv).rgb, uBloom); }
  void main() {
    vec2 fromC = vUv - 0.5;
    vec3 c;
    if (uSpeed > 0.001) {
      // Speed: radial streaks (a short blur toward the centre) and chromatic aberration at the rim.
      float r2 = dot(fromC, fromC);
      vec2 dir = fromC * uSpeed * 0.06 * r2 * 4.0;
      c = vec3(0.0);
      for (int i = 0; i < 5; i++) c += hdrAt(vUv - dir * float(i) * 0.25);
      c /= 5.0;
      vec2 ca = fromC * uSpeed * 0.006 * r2 * 4.0;
      c.r = mix(c.r, hdrAt(vUv + ca).r, 0.7);
      c.b = mix(c.b, hdrAt(vUv - ca).b, 0.7);
    } else c = hdrAt(vUv);
    c *= uExposure;
    // Grade (linear, pre-tonemap): white balance, saturation, lift/gain.
    c *= vec3(1.0 + 0.12 * uTemp, 1.0, 1.0 - 0.12 * uTemp);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(l + uSat * (c - l), 0.0);
    c = c * uGain + uLift * 0.02;
    c = agx(c);
    // Contrast around mid-grey (display-referred linear).
    c = clamp(0.18 * pow(c / 0.18, vec3(uContrast)), 0.0, 1.0);
    vec3 s = toSRGB(c);
    // Vignette and grain (display space).
    float v = smoothstep(0.85, 0.25, length(fromC * vec2(1.0, 0.8)));
    s *= mix(1.0, v, uVignette);
    s += (hash(vUv * 1000.0 + fract(uTime) * 91.0) - 0.5) * uGrain * (1.0 - s * 0.6);
    gl_FragColor = vec4(s, dot(s, vec3(0.299, 0.587, 0.114))); // luma in alpha for FXAA
  }
`;

export class Pipeline {
  constructor(renderer) {
    this.r = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    renderer.info.autoReset = false; // count every pass of a frame (debug overlay)
    this.scale = 1;
    this.size = new THREE.Vector2(1, 1);
    this.hdr = hdrTarget(1, 1, true);
    this.hdr2 = hdrTarget(1, 1, false);
    this.fog = null; // FogPass
    this.ldr = new THREE.WebGLRenderTarget(1, 1, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    this.composite = makePass(COMPOSITE_FRAG, {
      tHDR: { value: null }, tBloom: { value: null }, uExposure: { value: 0.62 }, uBloom: { value: 0.05 },
      uSat: { value: 1 }, uTemp: { value: 0 }, uContrast: { value: 1 }, uLift: { value: new THREE.Vector3() },
      uGain: { value: new THREE.Vector3(1, 1, 1) }, uVignette: { value: 0.35 }, uGrain: { value: 0.03 },
      uTime: { value: 0 }, uSpeed: { value: 0 },
    });
    this.grade = this.composite.u;
    this.down = makePass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.up = makePass(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up.material.blending = THREE.AdditiveBlending;
    this.up.material.transparent = true;
    this.bloomMips = 5;
    this.mips = [];
    this.fxaa = makePass(FXAAShader.fragmentShader, THREE.UniformsUtils.clone(FXAAShader.uniforms));
    this.fxaaOn = true;
  }

  setSize(w, h, pixelRatio = 1) {
    this.cssW = w; this.cssH = h; this.pixelRatio = pixelRatio;
    this.r.setPixelRatio(pixelRatio);
    this.r.setSize(w, h, false);
    this._resizeTargets();
  }

  setScale(s) {
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this._resizeTargets();
  }

  _resizeTargets() {
    const w = Math.max(1, Math.round(this.cssW * this.pixelRatio * this.scale));
    const h = Math.max(1, Math.round(this.cssH * this.pixelRatio * this.scale));
    this.size.set(w, h);
    this.hdr.setSize(w, h);
    this.hdr2.setSize(w, h);
    this.ldr.setSize(w, h);
    this.fxaa.u.resolution.value.set(1 / w, 1 / h);
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < this.bloomMips; i++) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false }));
    }
    this.onResize?.(w, h);
  }

  setBloomMips(n) { if (n !== this.bloomMips) { this.bloomMips = n; this._resizeTargets(); } }

  _bloom(src) {
    const r = this.r, d = this.down, u = this.up;
    let prev = src;
    this.mips.forEach((m, i) => {
      d.u.tSrc.value = prev.texture;
      d.u.uTexel.value.set(1 / prev.width, 1 / prev.height);
      d.u.uKaris.value = i === 0 ? 1 : 0;
      r.setRenderTarget(m);
      d.quad.render(r);
      prev = m;
    });
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const small = this.mips[i];
      u.u.tSrc.value = small.texture;
      u.u.uTexel.value.set(1 / small.width, 1 / small.height);
      r.setRenderTarget(this.mips[i - 1]);
      u.quad.render(r);
    }
    r.autoClear = true;
  }

  render(scene, camera) {
    const r = this.r;
    r.info.reset();
    r.setRenderTarget(this.hdr);
    r.render(scene, camera);
    let src = this.hdr;
    if (this.fog) { this.fog.render(r, this.hdr, this.hdr2, camera); src = this.hdr2; }
    if (this.beforeComposite) src = this.beforeComposite(src, camera) ?? src;
    this._bloom(src);
    this.composite.u.tHDR.value = src.texture;
    this.composite.u.tBloom.value = this.mips[0].texture;
    r.setRenderTarget(this.fxaaOn ? this.ldr : null);
    this.composite.quad.render(r);
    if (this.fxaaOn) {
      this.fxaa.u.tDiffuse.value = this.ldr.texture;
      r.setRenderTarget(null);
      this.fxaa.quad.render(r);
    }
  }
}
