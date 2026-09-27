// Phase 1 skeleton: a procedural snowy slope under a sunset gradient sky.
// Replaced piece by piece in later phases (see docs/PROGRESS.md).
import * as THREE from 'three';
import { createLoop } from './core/loop.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0xc98aa0);
scene.fog = new THREE.FogExp2(fogColor, 0.0022);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);

// --- Sky: gradient dome, warm at the horizon toward the sun, violet overhead.
const sunDir = new THREE.Vector3(-0.6, 0.12, -0.8).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSunDir: { value: sunDir } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // keep at far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.1, 1.0);
        float sunAmt = max(dot(d, uSunDir), 0.0);
        vec3 zenith = vec3(0.16, 0.10, 0.32);
        vec3 horizon = vec3(0.95, 0.45, 0.42);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
        col += vec3(1.0, 0.55, 0.25) * pow(sunAmt, 8.0) * 0.8;
        col += vec3(1.0, 0.85, 0.6) * pow(sunAmt, 900.0) * 20.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
scene.add(sky);

// --- Terrain: a small procedural slope (placeholder for the Phase 3 mountain).
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function height(x, z) {
  let h = 0, amp = 1, freq = 0.004;
  for (let i = 0; i < 6; i++) {
    h += (1 - Math.abs(valueNoise(x * freq, z * freq) * 2 - 1)) * amp; // ridged
    amp *= 0.5;
    freq *= 2.1;
  }
  return h * 70 + Math.max(0, -z) * 0.35; // rises away from the camera
}

const size = 1200, segs = 256;
const terrainGeo = new THREE.PlaneGeometry(size, size, segs, segs);
terrainGeo.rotateX(-Math.PI / 2);
const pos = terrainGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  pos.setY(i, height(pos.getX(i), pos.getZ(i)));
}
terrainGeo.computeVertexNormals();
const terrain = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
);
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

// --- Lighting: low warm sun + violet sky fill (the snow's shadows go purple).
const sun = new THREE.DirectionalLight(0xffa070, 3.2);
sun.position.copy(sunDir).multiplyScalar(400);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, far: 1200 });
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x8a70d0, 0x402850, 1.1));

// --- Loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let time = 0;
createLoop({
  update(dt) { time += dt; },
  render() {
  const t = time * 0.03;
  const r = 260;
  const cx = Math.sin(t) * r, cz = Math.cos(t) * r + 120;
  camera.position.set(cx, height(cx, cz) + 40, cz);
  camera.lookAt(0, height(0, -250) + 20, -250);
  renderer.render(scene, camera);
  },
}).start();
