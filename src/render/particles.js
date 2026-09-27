// GPU particles (DESIGN §4 "Particles", showcase #5). Three instanced draw calls:
//   - Snowfall: fully procedural in the vertex shader — each flake is a seed in a box that wraps
//     around the camera and drifts with the wind field (gusts, headwind, turbulence). No CPU work
//     per flake; density (drawn count) follows the story (light early, blizzard, then clear).
//   - Spindrift: snow blown off the ridge crest and summit, emitted from points sampled along the
//     crest, carried by the gusts; also procedural (age from time and seed).
//   - Pool: CPU-emitted, GPU-integrated one-shots in a ring buffer: slide spray, landing puffs,
//     breath, and warm embers rising from cairns (HDR bright, so they bloom).
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
  uniform float uBox, uSize, uStreak;
  varying vec3 vTint;
  void main() {
    vec3 p = seed.xyz * uBox;
    float t = uTime * (0.7 + 0.6 * seed.w);
    vec3 drift = vec3(uWind.x, -1.1 - 0.8 * seed.w, uWind.z) * t;
    drift += 0.35 * vec3(sin(t * 1.3 + seed.x * 40.0), 0.0, cos(t * 1.1 + seed.z * 40.0));
    p += drift;
    vec3 cam = cameraPosition;
    p = mod(p - cam + uBox * 0.5, uBox) - uBox * 0.5 + cam;
    float edge = length(p - cam) / (uBox * 0.5);
    vAlpha = smoothstep(1.0, 0.7, edge) * smoothstep(2.0, 5.0, edge * uBox * 0.5); // no giant flakes at the lens
    vec3 vel = vec3(uWind.x, -1.5, uWind.z);
    vec3 world = billboard(p, uSize * (0.7 + 0.6 * seed.w), vel * uStreak * 0.03);
    vCorner = corner;
    vTint = vec3(1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const DRIFT_VERT = /* glsl */`
  ${COMMON}
  attribute vec4 seed;    // emitter xyz, phase
  uniform float uStrength;
  varying vec3 vTint;
  void main() {
    float life = 1.6 + seed.w * 1.4;
    float age = fract(uTime / life + seed.w * 7.31);
    float h = fract(seed.w * 91.7);
    vec3 dir = normalize(uWind + vec3(0.0, 0.001, 0.0));
    float speed = 3.0 + 6.0 * h;
    vec3 p = seed.xyz + dir * speed * age * (0.6 + 0.8 * uStrength) + vec3(0.0, 1.8 * age - 0.9 * age * age + h * 0.3, 0.0);
    p += 0.4 * vec3(sin(age * 9.0 + h * 30.0), 0.0, cos(age * 7.0 + h * 20.0));
    vAlpha = uStrength * smoothstep(0.0, 0.15, age) * smoothstep(1.0, 0.5, age) * 0.9;
    vCorner = corner;
    vTint = vec3(1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(billboard(p, 0.05 + 0.25 * age, vec3(0.0)), 1.0);
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
  /** crest: [[x, y, z], …] spindrift emitters. counts: { snow }. */
  constructor(scene, { crest = [], snow = 12000, pool = 2048 } = {}) {
    this.time = { value: 0 };
    this.wind = { value: new THREE.Vector3() };
    const shared = { uTime: this.time, uWind: this.wind };

    // Snowfall.
    this.snowMax = snow;
    const seeds = new Float32Array(snow * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.snowMat = material(SNOW_VERT, { ...shared, uBox: { value: 44 }, uSize: { value: 0.035 }, uStreak: { value: 0 } }, 0);
    this.snow = new THREE.Mesh(quadGeometry(snow, [['seed', 4, seeds]]), this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 10;

    // Spindrift.
    const per = 12, n = crest.length * per;
    const ds = new Float32Array(Math.max(1, n) * 4);
    crest.forEach((c, k) => {
      for (let j = 0; j < per; j++) {
        const o = (k * per + j) * 4;
        ds[o] = c[0] + (Math.random() - 0.5) * 3; ds[o + 1] = c[1] + 0.2; ds[o + 2] = c[2] + (Math.random() - 0.5) * 3; ds[o + 3] = Math.random();
      }
    });
    this.driftMat = material(DRIFT_VERT, { ...shared, uStrength: { value: 0 } }, 1);
    this.drift = new THREE.Mesh(quadGeometry(Math.max(1, n), [['seed', 4, ds]]), this.driftMat);
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
   * Per frame. o: { time, wind (Vector3 m/s), snowDensity 0..1, streak, driftStrength, light (Color) }.
   */
  update(o) {
    this.time.value = o.time;
    this.wind.value.copy(o.wind);
    this.snow.geometry.instanceCount = Math.min(this.snowMax, Math.round((this.snowTier ?? this.snowMax) * o.snowDensity));
    this.snow.visible = this.snow.geometry.instanceCount > 0;
    this.snowMat.uniforms.uStreak.value = o.streak ?? 0;
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
