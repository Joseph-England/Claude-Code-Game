// Snow shading (DESIGN §4 "Snow", showcase #3), patched into the terrain's (and backdrop's)
// standard material:
//   - surface blending from the splat map (snow, glassy blue ice, stratified rock), or from slope
//     on the distant ranges; snow and deep powder look the same (no packed snow, DECISIONS #80);
//   - triplanar procedural detail normals (analytic value-noise gradients): soft undulation on
//     snow, near-smooth ice, broken rock — faded with distance;
//   - direct light: wrap diffuse + a blue subsurface tint at the terminator (soft snow edges),
//     GGX specular, and view-dependent glitter from hashed micro-facets that only sparkle in sun;
//   - ice reflects the sky (Fresnel) from the sky-view LUT.
// The violet shadows come from the sky ambient (materials.js) — pure white albedo does the rest.

/** Glitter on/off (quality tier), shared by reference. */
export const glitter = { value: 1 };

export const SNOW_PARS = /* glsl */`
  uniform sampler2D uSplat;
  uniform vec2 uSplatOrigin; uniform float uSplatSize;
  uniform float uGlitter;
  vec4 gW;          // surface weights: snow, powder, ice, rock
  float gDetailFade;
  float sHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 sHash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  vec3 noised(vec2 x) { // value noise and its gradient
    vec2 i = floor(x), f = fract(x);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = sHash12(i), b = sHash12(i + vec2(1.0, 0.0)), c = sHash12(i + vec2(0.0, 1.0)), d = sHash12(i + vec2(1.0, 1.0));
    return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
  }
  vec2 fbmGrad(vec2 p, float freq) {
    vec2 g = noised(p * freq).yz * freq;
    g += 0.5 * noised(p * freq * 2.13 + 7.1).yz * freq * 2.13;
    return g;
  }
  // Triplanar bump: the gradient of a height field projected on the three axis planes.
  vec3 triBump(vec3 n, vec3 p, float freq, float amp) {
    vec3 b = pow(abs(n), vec3(4.0)); b /= dot(b, vec3(1.0));
    vec2 gx = fbmGrad(p.zy, freq), gy = fbmGrad(p.xz, freq), gz = fbmGrad(p.xy, freq);
    vec3 off = b.x * vec3(0.0, gx.y, gx.x) + b.y * vec3(gy.x, 0.0, gy.y) + b.z * vec3(gz.x, gz.y, 0.0);
    return normalize(n - amp * off);
  }
`;

// Albedo, roughness and detail normals (fragment main, after the base chunks).
export const SNOW_COLOR = /* glsl */`
  {
    #ifdef SNOW_SPLAT
      // Domain-warp the lookup by ±0.7 m so texel staircases turn into wobbly natural edges.
      vec2 wp2 = vWorldPos.xz + vec2(vWorldPos.y * 0.37, -vWorldPos.y * 0.29);
      vec2 warp = vec2(noised(wp2 * 0.55).x, noised(wp2 * 0.55 + 31.7).x) - 0.5;
      vec2 suv = (vWorldPos.xz + warp * 1.4 - uSplatOrigin) / uSplatSize;
      gW = texture2D(uSplat, suv);
      gW /= max(dot(gW, vec4(1.0)), 1e-3);
      // Break up the 1 m splat texels: push each weight through a noisy threshold so rock and ice
      // edges are organic instead of bilinear staircases.
      float en = noised(vWorldPos.xz * 0.9 + vWorldPos.y * 0.6).x + 0.5 * noised(vWorldPos.xz * 2.7 - vWorldPos.y).x - 0.75;
      vec4 sharp = smoothstep(vec4(0.3), vec4(0.7), gW + en * 0.45);
      gW = sharp / max(dot(sharp, vec4(1.0)), 1e-3);
    #else
      gW = vec4(0.0, 1.0, 0.0, 0.0);
    #endif
    gDetailFade = exp(-length(vWorldPos - cameraPosition) / 70.0);
    // Rock (DECISIONS #90): grey-brown, banded by thin strata that dip a little, lighter and
    // darker layers, a faint warm iron stain here and there (snow on its ledges: SNOW_NORMAL).
    float layer = vWorldPos.y * 1.3 + dot(vWorldPos.xz, vec2(0.05, -0.03)) + 1.2 * noised(vWorldPos.xz * 0.08).x;
    float strata = 0.82 + 0.16 * sin(layer * 2.1) * sin(layer * 0.73 + 1.3) + 0.12 * noised(vec2(layer * 3.0, dot(vWorldPos.xz, vec2(0.3, 0.2)))).x;
    vec3 rock = mix(vec3(0.23, 0.215, 0.205), vec3(0.3, 0.22, 0.16), 0.35 * smoothstep(0.55, 0.9, noised(vWorldPos.xz * 0.05 + 11.0).x)) * strata;
    vec3 alb = (gW.x + gW.y) * vec3(0.97, 0.98, 1.0) + gW.z * vec3(0.5, 0.72, 0.95) + gW.w * rock;
    diffuseColor.rgb = alb;
  }
`;

export const SNOW_ROUGHNESS = /* glsl */`
  roughnessFactor = dot(gW, vec4(0.85, 0.85, 0.08, 0.8));
`;

export const SNOW_NORMAL = /* glsl */`
  {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    #ifndef SNOW_SPLAT
      // Distant ranges (DECISIONS #88): snow above a wavering snowline except on faces too steep
      // to hold it; below it scree and rock, and dark conifer forest on the gentler valley floors
      // and lower slopes — the contrast that makes a range read as mountains.
      float steep = smoothstep(0.74, 0.56, nW.y);
      float snowline = 170.0 + 140.0 * noised(vWorldPos.xz * 0.0011).x + 60.0 * noised(vWorldPos.xz * 0.004).x;
      // Faces too steep for a snowfield still hold snow in couloirs streaking down the fall line
      // and on the ledges of dipping strata (noise stretched vertically / banded in height).
      vec2 fall = normalize(nW.xz + 1e-4);
      float across = dot(vWorldPos.xz, vec2(-fall.y, fall.x));
      float couloir = smoothstep(0.62, 0.8, noised(vec2(across * 0.018, vWorldPos.y * 0.0035)).x + 0.25 * noised(vec2(across * 0.07, vWorldPos.y * 0.01)).x);
      float ledge = smoothstep(0.72, 0.9, noised(vec2(across * 0.006, (vWorldPos.y + dot(vWorldPos.xz, vec2(0.04, 0.02))) * 0.03)).x);
      float faceSnow = max(couloir, ledge * 0.6) * steep * smoothstep(-60.0, 120.0, vWorldPos.y);
      float cover = max(smoothstep(snowline - 90.0, snowline + 40.0, vWorldPos.y + 90.0 * (nW.y - 0.8)) * (1.0 - steep), faceSnow);
      float forest = (1.0 - smoothstep(-110.0, 40.0, vWorldPos.y + 60.0 * noised(vWorldPos.xz * 0.006).x)) * smoothstep(0.55, 0.8, nW.y);
      vec3 rockC = vec3(0.2, 0.18, 0.17) * (0.8 + 0.35 * noised(vec2(vWorldPos.y * 0.05, dot(vWorldPos.xz, vec2(0.003, 0.002)))).x);
      vec3 lowC = mix(rockC, vec3(0.045, 0.07, 0.055), forest);
      gW = vec4(0.0, cover, 0.0, 1.0 - cover);
      diffuseColor.rgb = mix(lowC, vec3(0.97, 0.98, 1.0), cover);
      roughnessFactor = mix(0.85, 0.85, cover);
    #endif
    vec3 n = triBump(nW, vWorldPos, 0.35, gDetailFade * (0.18 * (gW.x + gW.y) + 0.02 * gW.z));
    // Broken rock: a coarse and a fine octave, gentle (a strong single octave read as spots).
    n = triBump(n, vWorldPos, 0.8, (0.3 + 0.7 * gDetailFade) * 0.14 * gW.w);
    n = triBump(n, vWorldPos, 3.3, gDetailFade * 0.07 * gW.w);
    // Snow lies on the rock wherever it is flat enough to hold it.
    float dust = gW.w * smoothstep(0.8, 0.94, n.y + 0.08 * noised(vWorldPos.xz * 1.7).x);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.96, 1.0), dust * 0.9);
    normal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
  }
`;

// Direct light: wrap diffuse + subsurface tint + GGX + glitter; terrain sun visibility applied.
export const SNOW_DIRECT = /* glsl */`
  void RE_Direct_Snow(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
    vec3 L = directLight.direction, N = geometryNormal, V = geometryViewDir;
    vec3 irr = directLight.color * gSunVis;
    float nl = dot(N, L);
    float snow = gW.x + gW.y + gW.z * 0.5;
    float wrap = 0.35 * snow;
    float diff = clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0);
    // Subsurface: light that entered nearby leaks out blue where the surface turns from the sun.
    float term = clamp(1.0 - abs(nl - 0.05) * 3.0, 0.0, 1.0);
    vec3 sss = vec3(0.3, 0.55, 1.0) * term * 0.35 * snow;
    reflectedLight.directDiffuse += irr * (diff * material.diffuseColor + sss * material.diffuseColor) * RECIPROCAL_PI;
    float nlc = clamp(nl, 0.0, 1.0);
    reflectedLight.directSpecular += irr * nlc * BRDF_GGX(L, V, N, material) * (0.35 + 0.65 * gW.z);
    // Glitter: 6 cm cells, each a tilted micro-facet; a few catch the sun exactly.
    if (uGlitter > 0.0 && nl > 0.0) {
      vec3 wp = vWorldPos * 16.0, cell = floor(wp);
      vec3 h3 = sHash33(cell);
      vec3 mfW = normalize(inverseTransformDirection(N, viewMatrix) + (h3 - 0.5) * 1.1);
      vec3 mf = normalize((viewMatrix * vec4(mfW, 0.0)).xyz);
      vec3 H = normalize(L + V);
      float g = smoothstep(0.9975, 0.9995, dot(mf, H)) * step(0.55, fract(h3.x * 7.13 + h3.y));
      float fade = clamp(1.0 - length(vWorldPos - cameraPosition) / 45.0, 0.0, 1.0);
      reflectedLight.directSpecular += irr * g * fade * uGlitter * 9.0 * (gW.y + gW.x);
    }
  }
  #undef RE_Direct
  #define RE_Direct RE_Direct_Snow
`;

// Sky reflection on ice (Fresnel), added with the ambient.
export const SNOW_INDIRECT = /* glsl */`
  {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    vec3 vW = normalize(cameraPosition - vWorldPos);
    float f = 0.02 + 0.98 * pow(1.0 - clamp(dot(nW, vW), 0.0, 1.0), 5.0);
    reflectedLight.indirectSpecular += skyRad(reflect(-vW, nW)) * f * gW.z * 0.9;
  }
`;

/** Fragment patch for the snow material (after the world-lighting patch). */
export function snowFragment(shader, { splat = null, origin = null, size = 1 } = {}) {
  if (splat) {
    shader.fragmentShader = `#define SNOW_SPLAT\n${shader.fragmentShader}`;
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uSplatOrigin = { value: origin };
    shader.uniforms.uSplatSize = { value: size };
  }
  shader.uniforms.uGlitter = glitter;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>\n${SNOW_COLOR}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${SNOW_ROUGHNESS}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SNOW_NORMAL}`)
    .replace('#include <lights_fragment_end>', `${SNOW_INDIRECT}\n#include <lights_fragment_end>`);
  // SNOW_PARS goes right after the world pars (it uses vWorldPos).
  shader.fragmentShader = shader.fragmentShader.replace('float gSunVis;', `float gSunVis;\n${SNOW_PARS}`);
}
