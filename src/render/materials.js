// Shared lighting for every lit material (terrain, props, avatar): cascaded shadow maps from the
// sun (props/avatar), the terrain's ray-marched sun visibility, and sky ambient sampled from the
// sky-view LUT in the direction of the normal (DESIGN §4 "Lighting"), all injected into three's
// standard material through onBeforeCompile. `world` holds uniforms shared by reference.
import * as THREE from 'three';
import { ATMO_GLSL, SKYVIEW_MAP_GLSL, ATMO } from './atmosphere.js';

export const world = {
  tSky: { value: null }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uViewH: { value: ATMO.Rg + ATMO.viewAltitude },
  uIllum: { value: ATMO.sunIlluminance }, uTintHigh: { value: new THREE.Vector3(1, 1, 1) }, uTintLow: { value: new THREE.Vector3(1, 1, 1) },
  tSunVis: { value: null }, uSunVisOrigin: { value: new THREE.Vector2() }, uSunVisSize: { value: 1024 },
  uAmbient: { value: 1 }, uBounce: { value: new THREE.Color() }, uTime: { value: 0 },
  // Alpenglow: after sunset the high peaks keep a red-violet light (DESIGN §1, title).
  uGlow: { value: new THREE.Color() }, uGlowDir: { value: new THREE.Vector3(1, 0, 0) }, uGlowH: { value: 0 },
  // The nearest storm lantern (world/beacons.js): a warm point light on everything around it.
  uLampPos: { value: new THREE.Vector3(0, -1e4, 0) }, uLampColor: { value: new THREE.Color(0, 0, 0) },
};

export const WORLD_PARS = /* glsl */`
  uniform sampler2D tSky, tSunVis;
  uniform vec3 uSunDir, uTintHigh, uTintLow, uBounce, uGlow, uGlowDir, uLampPos, uLampColor;
  uniform float uViewH, uIllum, uSunVisSize, uAmbient, uTime, uGlowH;
  uniform vec2 uSunVisOrigin;
  varying vec3 vWorldPos;
  float gSunVis;
  ${ATMO_GLSL}
  ${SKYVIEW_MAP_GLSL}
  vec3 skyRad(vec3 d) {
    d.y = max(d.y, 0.02); d = normalize(d);
    float vz = acos(d.y);
    vec2 sh = normalize(uSunDir.xz + 1e-6), dh = normalize(d.xz + 1e-6);
    float lv = acos(clamp(dot(sh, dh), -1.0, 1.0));
    return texture2D(tSky, skyUV(vz, lv, uViewH)).rgb * uIllum * mix(uTintLow, uTintHigh, smoothstep(0.0, 0.5, d.y));
  }
  // Irradiance from the sky dome for a surface normal: the zenith and the normal's direction,
  // weighted by how much sky the normal sees, plus light bounced off the snow below.
  vec3 skyIrradiance(vec3 n) {
    vec3 z = skyRad(vec3(0.0, 1.0, 0.0)), s = skyRad(n + vec3(0.0, 0.25, 0.0));
    float up = n.y * 0.5 + 0.5;
    return PI * (mix(s, z, 0.4) * up) * uAmbient + uBounce * (1.0 - up);
  }
  vec3 alpenglow(vec3 n, vec3 p) {
    return uGlow * smoothstep(uGlowH - 60.0, uGlowH + 60.0, p.y) * max(dot(n, uGlowDir), 0.0);
  }
  vec3 lampLight(vec3 n, vec3 p) {
    vec3 L = uLampPos - p;
    float d2 = dot(L, L);
    return uLampColor * max(dot(n, L * inversesqrt(d2 + 1e-4)), 0.0) / (d2 + 0.6) * (1.0 - smoothstep(49.0, 196.0, d2));
  }
  float sunVisAt(vec3 p) {
    vec2 uv = (p.xz - uSunVisOrigin) / uSunVisSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0; // backdrop: unshadowed
    return texture2D(tSunVis, uv).r;
  }
`;

const VERT_PARS = 'varying vec3 vWorldPos;\n';
const VERT_WORLD = /* glsl */`
  {
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    vWorldPos = (modelMatrix * wp).xyz;
  }
`;

// Direct light goes through a wrapper so the terrain's sun visibility applies to every material.
const DIRECT_WRAP = /* glsl */`
  void RE_Direct_Vis(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
    IncidentLight d = directLight;
    d.color *= gSunVis;
    RE_Direct_Physical(d, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
  #undef RE_Direct
  #define RE_Direct RE_Direct_Vis
`;

/**
 * Patch a MeshStandardMaterial for world lighting. opts.csm: the CSM instance; opts.patch(shader):
 * an extra patch (terrain height/snow) run after the lighting patch; opts.direct: GLSL replacing
 * DIRECT_WRAP (a custom BRDF); opts.key: program cache key.
 */
export function litMaterial(mat, { csm, patch, direct, key = 'lit' } = {}) {
  mat.userData.lit = true;
  if (csm) csm.setupMaterial(mat);
  const csmHook = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    csmHook?.call(mat, shader, r);
    Object.assign(shader.uniforms, world);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${direct ?? DIRECT_WRAP}`)
      .replace('#include <lights_fragment_begin>', `gSunVis = sunVisAt(vWorldPos);\n#include <lights_fragment_begin>`)
      .replace('#include <lights_fragment_end>', `irradiance += skyIrradiance(inverseTransformDirection(normal, viewMatrix)) + alpenglow(inverseTransformDirection(normal, viewMatrix), vWorldPos) + lampLight(inverseTransformDirection(normal, viewMatrix), vWorldPos);\n#include <lights_fragment_end>`);
    patch?.(shader);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
