// Atmosphere post pass (DESIGN §4 "Fog", showcase #1/#5): reconstructs each pixel's world position
// from the depth texture and applies, in one place for everything on screen:
//   - aerial perspective: per-channel extinction (Rayleigh-weighted, pushed for scale) with
//     in-scattered light taken from the sky-view LUT toward the horizon in that direction, so
//     haze turns gold toward the sun and violet away from it;
//   - exponential height fog (analytic integral along the ray) pooling in the valleys, with a
//     forward-scattering glow around the sun;
//   - whiteout: a short, bright, lavender-white distance fog that also swallows the sky.
import * as THREE from 'three';
import { makePass } from './post.js';
import { WORLD_PARS, world } from './materials.js';

const FRAG = /* glsl */`
  #include <packing>
  uniform sampler2D tHDR, tDepth;
  uniform float uNear, uFar, uAerial, uFogDensity, uFogHeight, uFogBase, uWhiteout, uWhiteDist;
  uniform mat4 uInvProj, uCamWorld;
  uniform vec3 uCamPos, uSunColor, uWhiteColor;
  varying vec2 vUv;
  ${WORLD_PARS.replace('varying vec3 vWorldPos;', '')}
  void main() {
    vec3 col = texture2D(tHDR, vUv).rgb;
    float depth = texture2D(tDepth, vUv).r;
    vec4 rv = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rayV = rv.xyz / rv.w;
    vec3 rd = normalize((uCamWorld * vec4(rayV, 0.0)).xyz);
    if (depth >= 1.0) {
      gl_FragColor = vec4(mix(col, uWhiteColor, uWhiteout), 1.0);
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
    // Whiteout.
    float w = uWhiteout * (1.0 - exp(-d / uWhiteDist));
    col = mix(col, uWhiteColor, w);
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
      uSunColor: { value: new THREE.Color() }, uWhiteout: { value: 0 }, uWhiteDist: { value: 16 },
      uWhiteColor: { value: new THREE.Color(0.8, 0.8, 0.86) },
    });
    this.u = this.p.u;
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
