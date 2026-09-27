// Atmosphere post pass (DESIGN §4 "Fog", showcase #1/#5): reconstructs each pixel's world position
// from the depth texture and applies, in one place for everything on screen:
//   - aerial perspective: per-channel extinction (Rayleigh-weighted, pushed for scale) with
//     in-scattered light taken from the sky-view LUT toward the horizon in that direction, so
//     haze turns gold toward the sun and violet away from it;
//   - exponential height fog (analytic integral along the ray) pooling in the valleys, with a
//     forward-scattering glow around the sun;
//   - the gap's storm (DECISIONS #77): blowing snow in a chain of soft vertical cylinders along the
//     col (world/storm.js). Each view ray's optical depth through them is integrated analytically
//     (density 1 − r²/R² along a line is a cubic), thinned above the col and streamed with the
//     wind by a little noise — so the storm is a place: a white wall in the gap as you approach,
//     a ~16 m whiteout inside, and still there behind you when you come out.
import * as THREE from 'three';
import { makePass } from './post.js';
import { WORLD_PARS, world } from './materials.js';

const STORM_N = 12;
const FRAG = /* glsl */`
  #define STORM_N ${STORM_N}
  #include <packing>
  uniform sampler2D tHDR, tDepth;
  uniform float uNear, uFar, uAerial, uFogDensity, uFogHeight, uFogBase, uStormR, uStormTop; // uTime: WORLD_PARS
  uniform vec4 uStorm[STORM_N]; // x, z, density (1/m at the centre), base height
  uniform vec3 uStormFlow;
  uniform mat4 uInvProj, uCamWorld;
  uniform vec3 uCamPos, uSunColor, uWhiteColor;
  varying vec2 vUv;
  ${WORLD_PARS.replace('varying vec3 vWorldPos;', '')}
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Optical depth of the storm along ro + rd·t, t in [0, D].
  float stormDepth(vec3 ro, vec3 rd, float D) {
    float tau = 0.0, R2 = uStormR * uStormR, a = dot(rd.xz, rd.xz);
    for (int i = 0; i < STORM_N; i++) {
      vec4 c = uStorm[i];
      if (c.z <= 0.0) continue;
      vec2 o = ro.xz - c.xy;
      float b = dot(o, rd.xz), cc = dot(o, o), t0 = 0.0, t1 = D;
      if (a < 1e-5) { if (cc >= R2) continue; }
      else {
        float disc = b * b - a * (cc - R2);
        if (disc <= 0.0) continue;
        float sq = sqrt(disc);
        t0 = max((-b - sq) / a, 0.0); t1 = min((-b + sq) / a, D);
        if (t1 <= t0) continue;
      }
      float F1 = t1 - (a * t1 * t1 * t1 / 3.0 + b * t1 * t1 + cc * t1) / R2;
      float F0 = t0 - (a * t0 * t0 * t0 / 3.0 + b * t0 * t0 + cc * t0) / R2;
      vec3 pm = ro + rd * (0.5 * (t0 + t1));
      float hfac = 1.0 - smoothstep(c.w + uStormTop * 0.5, c.w + uStormTop * 1.5, pm.y);
      float nz = vnoise(pm * vec3(0.05, 0.09, 0.05) - uStormFlow * uTime * 0.05);
      tau += c.z * (F1 - F0) * hfac * (0.35 + 1.6 * nz * nz); // gusty, uneven streams
    }
    return tau;
  }
  void main() {
    vec3 col = texture2D(tHDR, vUv).rgb;
    float depth = texture2D(tDepth, vUv).r;
    vec4 rv = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rayV = rv.xyz / rv.w;
    vec3 rd = normalize((uCamWorld * vec4(rayV, 0.0)).xyz);
    // Blowing snow is lit: sky white, plus the low sun shining through it (strongly forward).
    float muS = max(dot(rd, uSunDir), 0.0);
    vec3 stormCol = uWhiteColor + uSunColor * 0.02 * (0.3 + 2.0 * pow(muS, 5.0)) * smoothstep(-0.02, 0.1, uSunDir.y);
    if (depth >= 1.0) {
      gl_FragColor = vec4(mix(col, stormCol, 1.0 - exp(-stormDepth(uCamPos, rd, 1500.0))), 1.0);
      return;
    }
    float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
    float d = length(rayV * (viewZ / rayV.z));
    // Aerial perspective.
    vec3 ext = (betaR * 0.76 + vec3(betaMe * 0.2)) * 1e-3 * uAerial; // per metre at ~2 km
    vec3 T = exp(-ext * d);
    // As the sun sets the valleys fall into shadow first: haze and fog seen below the horizon take
    // the dimmer sky colour from higher up instead of the glowing horizon band, so the sunset glow
    // stays in the sky (user playtest: it seemed to rise out of the valleys).
    float sunLit = smoothstep(0.0, 0.14, uSunDir.y);
    float down = clamp(-rd.y * 3.0, 0.0, 0.45) * (1.0 - 0.7 * sunLit);
    vec3 horizon = skyRad(vec3(rd.x, max(rd.y, 0.0) * 0.5 + 0.03 + down, rd.z));
    col = col * T + horizon * (1.0 - T);
    // Height fog.
    float b = 1.0 / uFogHeight;
    float oy = uCamPos.y - uFogBase;
    float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float fogAmt = uFogDensity * exp(-oy * b) * (1.0 - exp(-d * ry * b)) / (ry * b);
    fogAmt = 1.0 - exp(-max(fogAmt, 0.0));
    float mu = max(dot(rd, uSunDir), 0.0);
    vec3 fogCol = mix(skyRad(vec3(rd.x, 0.4, rd.z)) * 0.7, skyRad(vec3(rd.x, 0.05, rd.z)) * 0.9, sunLit)
                + uSunColor * 0.06 * pow(mu, 12.0) * sunLit;
    col = mix(col, fogCol, fogAmt);
    // The storm in the gap.
    col = mix(col, stormCol, 1.0 - exp(-stormDepth(uCamPos, rd, d)));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class FogPass {
  constructor() {
    this.p = makePass(FRAG, {
      ...world,
      tHDR: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uAerial: { value: 5 }, uFogDensity: { value: 0.004 }, uFogHeight: { value: 35 }, uFogBase: { value: -10 },
      uSunColor: { value: new THREE.Color() }, uTime: { value: 0 },
      uStorm: { value: Array.from({ length: STORM_N }, () => new THREE.Vector4()) }, uStormR: { value: 34 }, uStormTop: { value: 34 },
      uStormFlow: { value: new THREE.Vector3() },
      uWhiteColor: { value: new THREE.Color(0.8, 0.8, 0.86) },
    });
    this.u = this.p.u;
  }

  /**
   * The storm (world/storm.js): cylinders [[x, z, strength, base]…], radius, top, the density at
   * the heart of the gap (1/m), and the wind's direction down the gap.
   */
  setStorm(cyl, R, top, density, flow) {
    const u = this.u;
    u.uStormR.value = R; u.uStormTop.value = top; u.uStormFlow.value.copy(flow);
    u.uStorm.value.forEach((v, i) => { const c = cyl[i]; if (c) v.set(c[0], c[1], (c[2] * density), c[3]); else v.set(0, 0, 0, 0); });
  }

  render(r, src, dst, camera) {
    const u = this.u;
    u.tHDR.value = src.texture;
    u.tDepth.value = src.depthTexture;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    r.setRenderTarget(dst);
    this.p.quad.render(r);
  }
}
