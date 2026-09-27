// Physically based sky (DESIGN §4, showcase #1; after Hillaire 2020, "A Scalable and Production
// Ready Sky and Atmosphere Rendering Technique"): Rayleigh + Mie + ozone single scattering with a
// cheap multiple-scattering term.
//   - Transmittance LUT (256×64), computed once on the GPU.
//   - Sky-view LUT (192×108, horizon-weighted latitude mapping, azimuth relative to the sun),
//     recomputed each frame the sun moves: marches each view ray and shadows every sample with the
//     planet itself, so Earth's shadow and the Belt of Venus appear on their own after sunset.
//   - Sky background: a full-screen triangle at the far plane that reads the sky-view LUT and adds
//     the sun disc (limb-darkened) and a hashed star field that fades in at dusk.
// A JS port of the same model gives the sun colour and sky ambient for lighting (no GPU readback).
// An artistic push (uniforms) leans the result toward purple/red/orange (DECISIONS #21).
import * as THREE from 'three';
import { makePass } from './post.js';

// Units: km. Scattering coefficients per km.
export const ATMO = {
  Rg: 6360, Rt: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighH: 8,
  mieS: 3.996e-3, mieE: 4.4e-3, mieH: 1.2, mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3], ozoneC: 25, ozoneW: 15,
  sunIlluminance: 16, // HDR units
  viewAltitude: 2.2, // km above sea level at world y = 0
};

const ATMO_GLSL = /* glsl */`
  const float Rg = ${ATMO.Rg.toFixed(1)}, Rt = ${ATMO.Rt.toFixed(1)};
  const vec3 betaR = vec3(${ATMO.rayleigh.join(', ')});
  const float betaMs = ${ATMO.mieS}, betaMe = ${ATMO.mieE};
  const vec3 betaO = vec3(${ATMO.ozone.join(', ')});
  const float PI = 3.14159265;
  float raySphere(vec3 ro, vec3 rd, float r) { // distance to the far intersection, -1 if none
    float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
    if (d < 0.0) return -1.0;
    return -b + sqrt(d);
  }
  float rayGround(vec3 ro, vec3 rd) { // distance to the near ground hit, -1 if none
    float b = dot(ro, rd), c = dot(ro, ro) - Rg * Rg, d = b * b - c;
    if (d < 0.0 || b > 0.0) return -1.0;
    return -b - sqrt(d);
  }
  void densities(float h, out vec3 scR, out float scM, out vec3 ext) {
    float dR = exp(-h / ${ATMO.rayleighH.toFixed(1)}), dM = exp(-h / ${ATMO.mieH.toFixed(1)});
    float dO = max(0.0, 1.0 - abs(h - ${ATMO.ozoneC.toFixed(1)}) / ${ATMO.ozoneW.toFixed(1)});
    scR = betaR * dR; scM = betaMs * dM;
    ext = scR + betaMe * dM + betaO * dO;
  }
  vec2 transUV(float h, float mu) { return vec2(mu * 0.5 + 0.5, sqrt(clamp(h / (Rt - Rg), 0.0, 1.0))); }
`;

const TRANSMITTANCE_FRAG = /* glsl */`
  varying vec2 vUv;
  ${ATMO_GLSL}
  void main() {
    float mu = vUv.x * 2.0 - 1.0, h = vUv.y * vUv.y * (Rt - Rg);
    vec3 ro = vec3(0.0, Rg + h, 0.0), rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
    float L = raySphere(ro, rd, Rt);
    vec3 od = vec3(0.0);
    const int N = 40;
    for (int i = 0; i < N; i++) {
      float t = (float(i) + 0.5) / float(N) * L;
      vec3 p = ro + rd * t; vec3 sR; float sM; vec3 e;
      densities(length(p) - Rg, sR, sM, e);
      od += e * (L / float(N));
    }
    gl_FragColor = vec4(exp(-od), 1.0);
  }
`;

// Latitude mapping from Hillaire's sky-view LUT (more texels near the horizon).
const SKYVIEW_MAP_GLSL = /* glsl */`
  vec2 skyUV(float viewZenith, float lightViewAngle, float viewH) {
    float vHorizon = sqrt(max(0.0, viewH * viewH - Rg * Rg));
    float beta = acos(clamp(vHorizon / viewH, -1.0, 1.0));
    float zha = PI - beta;
    float v;
    if (viewZenith < zha) { float c = viewZenith / zha; v = (1.0 - sqrt(max(0.0, 1.0 - c))) * 0.5; }
    else { float c = (viewZenith - zha) / beta; v = sqrt(max(0.0, c)) * 0.5 + 0.5; }
    return vec2(sqrt(lightViewAngle / PI), v);
  }
`;

const SKYVIEW_FRAG = /* glsl */`
  uniform sampler2D tTrans;
  uniform float uViewH;      // km from planet centre
  uniform float uSunZenith;  // rad
  uniform float uMS;         // multiple-scattering strength
  varying vec2 vUv;
  ${ATMO_GLSL}
  vec3 transmittance(vec3 p, vec3 dir) {
    float h = length(p); vec3 up = p / h;
    // The planet blocks the sun: soft edge over ~0.4° so Earth's shadow has a penumbra.
    float muH = -sqrt(max(0.0, 1.0 - (Rg / h) * (Rg / h)));
    float mu = dot(up, dir);
    float lit = smoothstep(muH - 0.004, muH + 0.004, mu);
    return texture2D(tTrans, transUV(h - Rg, mu)).rgb * lit;
  }
  void main() {
    float viewH = uViewH;
    float vHorizon = sqrt(max(0.0, viewH * viewH - Rg * Rg));
    float beta = acos(clamp(vHorizon / viewH, -1.0, 1.0));
    float zha = PI - beta;
    float viewZenith;
    if (vUv.y < 0.5) { float c = 1.0 - 2.0 * vUv.y; c = 1.0 - c * c; viewZenith = zha * c; }
    else { float c = vUv.y * 2.0 - 1.0; viewZenith = zha + beta * c * c; }
    float lightView = vUv.x * vUv.x * PI;
    vec3 rd = vec3(cos(lightView) * sin(viewZenith), cos(viewZenith), sin(lightView) * sin(viewZenith));
    vec3 sun = vec3(sin(uSunZenith), cos(uSunZenith), 0.0);
    vec3 ro = vec3(0.0, viewH, 0.0);
    float tMax = raySphere(ro, rd, Rt);
    float tG = rayGround(ro, rd);
    if (tG > 0.0) tMax = tG;
    tMax = min(tMax, 400.0);
    float cosT = dot(rd, sun);
    float phR = 3.0 / (16.0 * PI) * (1.0 + cosT * cosT);
    float g = ${ATMO.mieG.toFixed(2)};
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + cosT * cosT)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
    vec3 L = vec3(0.0), T = vec3(1.0);
    const int N = 32;
    float tPrev = 0.0;
    for (int i = 0; i < N; i++) {
      float f = (float(i) + 0.3) / float(N);
      float t = tMax * f * f; // denser samples near the viewer
      float dt = t - tPrev; tPrev = t;
      vec3 p = ro + rd * t; vec3 sR; float sM; vec3 e;
      densities(length(p) - Rg, sR, sM, e);
      vec3 Ts = transmittance(p, sun);
      // Multiple scattering: an isotropic term fed by the sun's (unshadowed-ish) transmittance.
      vec3 Tms = texture2D(tTrans, transUV(length(p) - Rg, max(dot(normalize(p), sun), -0.1))).rgb;
      vec3 S = (sR * phR + sM * phM) * Ts + (sR + sM) * Tms * uMS / (4.0 * PI);
      vec3 Tstep = exp(-e * dt);
      L += T * S * (1.0 - Tstep) / max(e, vec3(1e-7));
      T *= Tstep;
    }
    gl_FragColor = vec4(L, 1.0);
  }
`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  uniform mat4 uInvViewProj;
  void main() {
    vec4 p = uInvViewProj * vec4(position.xy, 1.0, 1.0);
    vDir = p.xyz / p.w - cameraPosition;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform sampler2D tSky, tTrans;
  uniform vec3 uSunDir, uSunColor;
  uniform float uViewH, uIllum, uStars, uTime;
  uniform vec3 uTintHigh, uTintLow;
  varying vec3 vDir;
  ${ATMO_GLSL}
  ${SKYVIEW_MAP_GLSL}
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  vec3 skyRadiance(vec3 d) {
    float viewZenith = acos(clamp(d.y, -1.0, 1.0));
    vec2 sh = normalize(uSunDir.xz + 1e-6), dh = normalize(d.xz + 1e-6);
    float lightView = acos(clamp(dot(sh, dh), -1.0, 1.0));
    return texture2D(tSky, skyUV(viewZenith, lightView, uViewH)).rgb * uIllum;
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = skyRadiance(d);
    // Artistic push: violet overhead, warmer low (DECISIONS #21).
    c *= mix(uTintLow, uTintHigh, smoothstep(0.0, 0.5, d.y));
    // Sun disc with limb darkening, dimmed by the atmosphere along the view ray.
    float cosA = dot(d, uSunDir);
    float r = acos(clamp(cosA, -1.0, 1.0)) / 0.0065;
    if (r < 1.0 && d.y > -0.02) {
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
      c += uSunColor * 60.0 * limb * smoothstep(1.0, 0.9, r);
    }
    // Stars: a hashed grid on the sphere, twinkling, only where the sky is dark enough.
    if (uStars > 0.0 && d.y > 0.0) {
      vec3 q = d * 260.0, cell = floor(q);
      float h = hash(cell);
      if (h > 0.985) {
        vec3 center = cell + 0.5 + 0.35 * (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5);
        float s = smoothstep(0.35, 0.0, length(q - center));
        float tw = 0.7 + 0.3 * sin(uTime * (2.0 + 5.0 * hash(cell + 7.0)) + h * 60.0);
        float lum = dot(c, vec3(0.3, 0.6, 0.1));
        c += s * tw * uStars * (h - 0.985) * 200.0 * vec3(0.9, 0.92, 1.0) * smoothstep(0.08, 0.0, lum) * smoothstep(0.0, 0.15, d.y);
      }
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

// --- JS port for lighting (sun colour, sky ambient). Coarse, runs a few times per second.
const ext = (h) => {
  const dR = Math.exp(-h / ATMO.rayleighH), dM = Math.exp(-h / ATMO.mieH), dO = Math.max(0, 1 - Math.abs(h - ATMO.ozoneC) / ATMO.ozoneW);
  return ATMO.rayleigh.map((b, i) => b * dR + ATMO.mieE * dM + ATMO.ozone[i] * dO);
};
/** Transmittance from altitude h (km) toward zenith cosine mu; 0 if the planet is in the way. */
export function transmittanceJS(h, mu, steps = 24) {
  const r = ATMO.Rg + h;
  const muH = -Math.sqrt(Math.max(0, 1 - (ATMO.Rg / r) ** 2));
  const lit = Math.min(1, Math.max(0, (mu - (muH - 0.004)) / 0.008));
  if (lit <= 0) return [0, 0, 0];
  const b = r * mu, c = r * r - ATMO.Rt * ATMO.Rt;
  const L = -b + Math.sqrt(Math.max(0, b * b - c));
  const od = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = ((i + 0.5) / steps) * L;
    const x = Math.sqrt(1 - mu * mu) * t, y = r + mu * t;
    const e = ext(Math.hypot(x, y) - ATMO.Rg);
    for (let k = 0; k < 3; k++) od[k] += e[k] * (L / steps);
  }
  return od.map((o) => Math.exp(-o) * lit);
}

export class Atmosphere {
  constructor(renderer, scene) {
    this.r = renderer;
    const rtOpts = { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
    this.transRT = new THREE.WebGLRenderTarget(256, 64, rtOpts);
    this.skyRT = new THREE.WebGLRenderTarget(192, 108, rtOpts);
    const trans = makePass(TRANSMITTANCE_FRAG);
    renderer.setRenderTarget(this.transRT);
    trans.quad.render(renderer);
    renderer.setRenderTarget(null);
    this.skyPass = makePass(SKYVIEW_FRAG, {
      tTrans: { value: this.transRT.texture }, uViewH: { value: ATMO.Rg + ATMO.viewAltitude },
      uSunZenith: { value: 1.3 }, uMS: { value: 0.6 },
    });

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color(); // HDR illuminance at the viewer (linear)
    this.ambientSky = new THREE.Color();
    this.ambientGround = new THREE.Color();
    this.skyUniforms = {
      tSky: { value: this.skyRT.texture }, tTrans: { value: this.transRT.texture },
      uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor },
      uViewH: { value: ATMO.Rg + ATMO.viewAltitude }, uIllum: { value: ATMO.sunIlluminance },
      uStars: { value: 0 }, uTime: { value: 0 }, uInvViewProj: { value: new THREE.Matrix4() },
      uTintHigh: { value: new THREE.Vector3(1, 1, 1) }, uTintLow: { value: new THREE.Vector3(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, depthWrite: false, depthTest: false });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.skyMesh = new THREE.Mesh(tri, mat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.onBeforeRender = (r, s, cam) => {
      this.skyUniforms.uInvViewProj.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    };
    scene.add(this.skyMesh);
    this._lastSun = new THREE.Vector3(9, 9, 9);
  }

  /**
   * Set the sun from elevation/azimuth (radians; azimuth 0 = -z, + toward -x). Recomputes the
   * sky-view LUT and the lighting colours when the sun has moved.
   */
  setSun(elevation, azimuth, time) {
    const ce = Math.cos(elevation);
    this.sunDir.set(-Math.sin(azimuth) * ce, Math.sin(elevation), -Math.cos(azimuth) * ce);
    this.skyUniforms.uTime.value = time;
    this.skyUniforms.uStars.value = THREE.MathUtils.smoothstep(-elevation, -0.005, 0.07);
    if (this._lastSun.distanceToSquared(this.sunDir) < 1e-8) return;
    this._lastSun.copy(this.sunDir);
    const zen = Math.acos(THREE.MathUtils.clamp(this.sunDir.y, -1, 1));
    this.skyPass.u.uSunZenith.value = zen;
    this.r.setRenderTarget(this.skyRT);
    this.skyPass.quad.render(this.r);
    this.r.setRenderTarget(null);

    // Lighting: direct sun colour, and a sky ambient pushed toward violet in shade (DESIGN §4).
    const T = transmittanceJS(ATMO.viewAltitude, this.sunDir.y);
    const I = ATMO.sunIlluminance;
    this.sunColor.setRGB(T[0] * I, T[1] * I, T[2] * I);
    // Sky irradiance ~ Rayleigh sky lit by the sun at a higher slant (the sky above still sees it).
    const Tz = transmittanceJS(ATMO.viewAltitude + 3, Math.max(this.sunDir.y, -0.02) + 0.05);
    const day = THREE.MathUtils.smoothstep(this.sunDir.y, -0.12, 0.05);
    const k = 0.09 * I * (0.25 + 0.75 * day);
    this.ambientSky.setRGB((0.32 * Tz[0] + 0.05) * k, (0.34 * Tz[1] + 0.03) * k, (0.62 * Tz[2] + 0.1) * k);
    this.ambientGround.copy(this.sunColor).multiplyScalar(0.12 * Math.max(0, this.sunDir.y) + 0.004).add(this.ambientSky.clone().multiplyScalar(0.35));
  }
}
