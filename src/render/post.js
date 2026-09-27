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

const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tHDR;
  uniform float uExposure;
  varying vec2 vUv;
  ${TONEMAP_GLSL}
  void main() {
    vec3 c = texture2D(tHDR, vUv).rgb * uExposure;
    c = agx(c);
    vec3 s = toSRGB(c);
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
    this.composite = makePass(COMPOSITE_FRAG, { tHDR: { value: null }, uExposure: { value: 0.62 } });
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
    this.onResize?.(w, h);
  }

  render(scene, camera) {
    const r = this.r;
    r.info.reset();
    r.setRenderTarget(this.hdr);
    r.render(scene, camera);
    let src = this.hdr;
    if (this.fog) { this.fog.render(r, this.hdr, this.hdr2, camera); src = this.hdr2; }
    if (this.beforeComposite) src = this.beforeComposite(src, camera) ?? src;
    this.composite.u.tHDR.value = src.texture;
    r.setRenderTarget(this.fxaaOn ? this.ldr : null);
    this.composite.quad.render(r);
    if (this.fxaaOn) {
      this.fxaa.u.tDiffuse.value = this.ldr.texture;
      r.setRenderTarget(null);
      this.fxaa.quad.render(r);
    }
  }
}
