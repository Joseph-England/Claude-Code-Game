// GPU particles (DESIGN §4 "Particles", showcase #5). Three instanced draw calls:
//   - Snowfall: fully procedural in the vertex shader — each flake is a seed in a box that wraps
//     around the camera horizontally and drifts with the wind field (gusts, headwind, turbulence).
//     Vertically it lives in terrain-following coordinates: its height above a smoothed copy of
//     the ground falls slowly and wraps, so wind-blown snow travels along the slope and settles
//     onto it instead of flying out of it (user playtest, Session 7; DECISIONS #86). No CPU work
//     per flake; density (drawn count) follows the story (light early, blizzard, then clear).
//   - Spindrift: snow blown about near the summit, placed where the wind would move it: grains
//     skittering low along exposed snow and thin plumes streaming off the lee edges, both in gusts
//     that sweep downwind (DECISIONS #93); also procedural (age from time and seed).
//   - Pool: CPU-emitted, GPU-integrated one-shots in a ring buffer: slide spray, landing puffs,
//     and warm embers rising from cairns (HDR bright, so they bloom; no breath puffs: DECISIONS #94).
// All alpha-tested/dithered with depth write, so the fog pass treats them like geometry.
import * as THREE from 'three';

const QUAD = [-1, -1, 1, -1, 1, 1, -1, 1];
function quadGeometry(count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('corner', new THREE.Float32BufferAttribute(QUAD, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, size, data] of attrs) g.setAttribute(name, new THREE.InstancedBufferAttribute(data ?? new Float32Array(count * size), size));
  g.instanceCount = count;
  return g;
}

const COMMON = /* glsl */`
  uniform float uTime;
  uniform vec3 uWind;
  attribute vec2 corner;
  varying vec2 vCorner;
  varying float vAlpha;
  vec3 billboard(vec3 p, float size, vec3 stretch) {
    // View-aligned quad, optionally stretched along a world direction (motion streaks).
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    return p + (right * corner.x + up * corner.y) * size + stretch * corner.y;
  }
`;
const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uDither;
  varying vec2 vCorner;
  varying float vAlpha;
  varying vec3 vTint;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float r = dot(vCorner, vCorner);
    float a = vAlpha * smoothstep(1.0, 0.35, r);
    if (a < mix(0.5, ign(gl_FragCoord.xy), uDither)) discard;
    gl_FragColor = vec4(uColor * vTint, 1.0);
  }
`;

const SNOW_VERT = /* glsl */`
  ${COMMON}
  attribute vec4 seed;
  uniform float uBox, uSize, uStreak, uLayer, uGroundSize, uFall;
  uniform sampler2D tGround; // smoothed terrain height (8 m cells)
  uniform vec2 uGroundOrigin;
  varying vec3 vTint;
  float groundAt(vec2 xz) { return texture2D(tGround, (xz - uGroundOrigin) / uGroundSize).r; }
  void main() {
    float t = uTime * (0.7 + 0.6 * seed.w), fall = uFall * (1.0 + 0.7 * seed.w);
    vec2 xz = seed.xz * uBox + uWind.xz * t + 0.35 * vec2(sin(t * 1.3 + seed.x * 40.0), cos(t * 1.1 + seed.z * 40.0));
    vec3 cam = cameraPosition;
    xz = mod(xz - cam.xz + uBox * 0.5, uBox) - uBox * 0.5 + cam.xz;
    // Height above the (smoothed) ground: falls at its own rate and wraps in a layer uLayer deep
    // that starts a little under the surface, so flakes settle into the snow.
    float rel = mod(seed.y * uLayer - fall * t, uLayer) - 1.5;
    float g = groundAt(xz);
    vec3 p = vec3(xz.x, g + rel, xz.y);
    float edge = length(p.xz - cam.xz) / (uBox * 0.5);
    vAlpha = smoothstep(1.0, 0.7, edge) * smoothstep(2.0, 5.0, length(p - cam)) * smoothstep(uLayer - 1.5, uLayer - 6.0, rel); // no giant flakes at the lens
    // Streaks follow the flake's real motion: the wind, up or down with the slope under it, falling.
    vec2 gr = vec2(groundAt(xz + vec2(4.0, 0.0)) - groundAt(xz - vec2(4.0, 0.0)), groundAt(xz + vec2(0.0, 4.0)) - groundAt(xz - vec2(0.0, 4.0))) / 8.0;
    vec3 vel = vec3(uWind.x, dot(gr, uWind.xz) - fall, uWind.z);
    vec3 world = billboard(p, uSize * (0.7 + 0.6 * seed.w), vel * uStreak * 0.03);
    vCorner = corner;
    vTint = vec3(1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const DRIFT_VERT = /* glsl */`
  ${COMMON}
  attribute vec4 seed;    // emitter xyz, phase
  attribute float kind;   // 0: grains skittering along the surface; 1: a plume off a lee edge
  uniform float uStrength;
  uniform vec3 uDir;      // the summit wind (m/s)
  varying vec3 vTint;
  // Real blowing snow comes in gusts that sweep downwind, not a steady stream: a travelling pulse,
  // sampled at the moment a grain is lifted so it lives out its flight once airborne.
  float gustAt(vec2 xz, float t) {
    vec2 w = normalize(uDir.xz);
    float g = 0.5 + 0.5 * sin(t * 0.8 - dot(xz, w) * 0.11 + 1.7 * sin(t * 0.23 + dot(xz, vec2(-w.y, w.x)) * 0.05));
    return smoothstep(0.3, 0.85, g);
  }
  void main() {
    float h = fract(seed.w * 91.7), h2 = fract(seed.w * 37.3);
    float plume = kind;
    float life = mix(0.9 + 0.6 * h2, 2.2 + 1.3 * h2, plume);
    float age = fract(uTime / life + seed.w * 7.31);
    float t = age * life;
    float g = gustAt(seed.xz, uTime - t);
    vec3 dir = normalize(vec3(uDir.x, 0.0, uDir.z));
    vec3 side = vec3(-dir.z, 0.0, dir.x);
    float speed = length(uDir) * mix(0.55 + 0.25 * h, 0.8 + 0.4 * h, plume) * (0.6 + 0.6 * g);
    vec3 p = seed.xyz + dir * speed * t;
    // Saltation: grains hop a hand's height along the snow. Off an edge: the eddy lifts the
    // stream a little, then it sinks and spreads as it goes, widening downwind.
    float hop = 0.12 * abs(sin(t * (7.0 + 5.0 * h) + h * 20.0)) * (1.0 - age);
    float lift = 0.7 * t - 0.3 * t * t;
    p.y += mix(hop - 0.15, lift, plume);
    float spread = mix(0.12, 0.2 + 0.7 * age, plume);
    p += spread * (side * sin(t * 2.3 + h * 30.0) + vec3(0.0, 0.4 * plume, 0.0) * cos(t * 1.9 + h * 17.0));
    vAlpha = uStrength * g * smoothstep(0.0, 0.12, age) * smoothstep(1.0, 0.45, age) * mix(0.55, 0.7, plume)
           * smoothstep(2.0, 6.0, length(p - cameraPosition)); // never across the lens
    vCorner = corner;
    vTint = vec3(1.0);
    float size = mix(0.02 + 0.014 * h, 0.03 + 0.07 * age, plume);
    gl_Position = projectionMatrix * viewMatrix * vec4(billboard(p, size, dir * (0.08 + 0.2 * h) * (0.5 + 0.5 * g)), 1.0);
  }
`;

const POOL_VERT = /* glsl */`
  ${COMMON}
  attribute vec4 aStart; // x y z t0
  attribute vec4 aVel;   // vx vy vz life
  attribute vec4 aKind;  // size, growth, gravity, kind (0 snow, 1 breath, 2 ember)
  uniform vec3 uEmber, uLight;
  varying vec3 vTint;
  void main() {
    float age = uTime - aStart.w, life = aVel.w;
    float u = age / life;
    vec3 p = aStart.xyz + aVel.xyz * age * (1.0 - 0.35 * min(u, 1.0)) + vec3(0.0, -7.5 * aKind.z * age * age, 0.0);
    if (aKind.w > 1.5) p += 0.25 * vec3(sin(age * 3.0 + aStart.x), 0.0, cos(age * 2.6 + aStart.z));
    vAlpha = (u < 0.0 || u > 1.0) ? 0.0 : smoothstep(1.0, 0.4, u) * min(1.0, age * 12.0);
    if (aKind.w > 0.5 && aKind.w < 1.5) vAlpha *= 0.55;
    vTint = aKind.w > 1.5 ? uEmber * (1.2 - u) : aKind.w > 0.5 ? uLight * 0.85 : uLight;
    vCorner = corner;
    float size = aKind.x * (1.0 + aKind.y * age);
    gl_Position = projectionMatrix * viewMatrix * vec4(billboard(p, size, vec3(0.0)), 1.0);
  }
`;

function material(vertexShader, uniforms, dither) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader: FRAG, uniforms: { ...uniforms, uColor: { value: new THREE.Color(1, 1, 1) }, uDither: { value: dither } },
  });
}

export class Particles {
  /**
   * crest: [{ p: [x, y, z], kind }] spindrift emitters (kind 0 surface, 1 lee edge); driftWind (m/s). counts: { snow }. ground: { texture, origin: [x, z],
   * size } smoothed terrain heights for the snowfall.
   */
  constructor(scene, { crest = [], driftWind = new THREE.Vector3(6, 0, 0), snow = 12000, pool = 2048, ground = null } = {}) {
    this.time = { value: 0 };
    this.wind = { value: new THREE.Vector3() };
    const shared = { uTime: this.time, uWind: this.wind };

    // Snowfall.
    this.snowMax = snow;
    const seeds = new Float32Array(snow * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.ground = { tGround: { value: ground?.texture ?? null }, uGroundOrigin: { value: new THREE.Vector2(...(ground?.origin ?? [0, 0])) }, uGroundSize: { value: ground?.size ?? 1 } };
    this.snowMat = material(SNOW_VERT, { ...shared, ...this.ground, uBox: { value: 44 }, uSize: { value: 0.035 }, uStreak: { value: 0 }, uLayer: { value: 28 }, uFall: { value: 1.1 } }, 0);
    this.snow = new THREE.Mesh(quadGeometry(snow, [['seed', 4, seeds]]), this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 10;

    // Spindrift (see DRIFT_VERT): emitters { p: [x, y, z], kind } from game.js.
    const per = (c) => (c.kind ? 56 : 40), n = crest.reduce((a, c) => a + per(c), 0);
    const ds = new Float32Array(Math.max(1, n) * 4), kd = new Float32Array(Math.max(1, n));
    let i = 0;
    for (const c of crest) {
      for (let j = 0; j < per(c); j++, i++) {
        const jit = c.kind ? 1.2 : 2.5;
        ds[i * 4] = c.p[0] + (Math.random() - 0.5) * jit; ds[i * 4 + 1] = c.p[1]; ds[i * 4 + 2] = c.p[2] + (Math.random() - 0.5) * jit; ds[i * 4 + 3] = Math.random();
        kd[i] = c.kind;
      }
    }
    this.driftMat = material(DRIFT_VERT, { ...shared, uStrength: { value: 0 }, uDir: { value: driftWind.clone() } }, 1);
    this.drift = new THREE.Mesh(quadGeometry(Math.max(1, n), [['seed', 4, ds], ['kind', 1, kd]]), this.driftMat);
    this.drift.frustumCulled = false;
    this.driftCount = n;

    // Pool.
    this.poolN = pool;
    this.poolGeo = quadGeometry(pool, [['aStart', 4], ['aVel', 4], ['aKind', 4]]);
    for (let i = 0; i < pool; i++) this.poolGeo.attributes.aStart.array[i * 4 + 3] = -1e6;
    this.poolMat = material(POOL_VERT, { ...shared, uEmber: { value: new THREE.Color(9, 3.2, 1.0) }, uLight: { value: new THREE.Color() } }, 1);
    this.pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    this.pool.frustumCulled = false;
    this.next = 0;
    this.dirty = false;

    scene.add(this.snow, this.drift, this.pool);
  }

  /** Emit one pool particle. kind: 0 snow spray, 1 breath, 2 ember. */
  emit(x, y, z, vx, vy, vz, life, size, growth, gravity, kind) {
    const i = this.next, a = this.poolGeo.attributes;
    this.next = (this.next + 1) % this.poolN;
    a.aStart.array.set([x, y, z, this.time.value], i * 4);
    a.aVel.array.set([vx, vy, vz, life], i * 4);
    a.aKind.array.set([size, growth, gravity, kind], i * 4);
    this.dirty = true;
  }

  /**
   * Per frame. o: { time, wind (Vector3 m/s), snowDensity 0..1, streak, fall (m/s), driftStrength, light (Color) }.
   */
  update(o) {
    this.time.value = o.time;
    this.wind.value.copy(o.wind);
    this.snow.geometry.instanceCount = Math.min(this.snowMax, Math.round((this.snowTier ?? this.snowMax) * o.snowDensity));
    this.snow.visible = this.snow.geometry.instanceCount > 0;
    this.snowMat.uniforms.uStreak.value = o.streak ?? 0;
    this.snowMat.uniforms.uFall.value = o.fall ?? 1.1;
    this.snowMat.uniforms.uSize.value = 0.03 + 0.03 * (o.streak ?? 0);
    this.driftMat.uniforms.uStrength.value = o.driftStrength;
    this.drift.visible = o.driftStrength > 0.01 && this.driftCount > 0;
    for (const m of [this.snowMat, this.driftMat]) m.uniforms.uColor.value.copy(o.light);
    this.poolMat.uniforms.uLight.value.copy(o.light);
    if (this.dirty) {
      for (const k of ['aStart', 'aVel', 'aKind']) this.poolGeo.attributes[k].needsUpdate = true;
      this.dirty = false;
    }
  }
}
