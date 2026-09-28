// Dev lab: the avatar alone on a snow plane, driven by a simulated controller, for close-up
// inspection (fit of the parts, poses, gait frames). Open /tools/lab/avatar.html; window.lab:
//   lab.sim({ speed, slope, state, seconds, facing, yawRate, wake, seated, reach, surface })
//   lab.view(azimuthDeg, elevationDeg, dist, targetY)  lab.grid(cols, rows) → multi-view contact sheet
import * as THREE from 'three';
import { Avatar } from '../../src/player/avatar.js';
import { tuning } from '../../src/tuning.js';

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a93a6);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a6470, 1.6));
const sun = new THREE.DirectionalLight(0xfff0dd, 2.4);
sun.position.set(3, 6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(sun);
let slope = 0;
const hf = { heightAt: (x, z) => -z * slope };
const groundGeo = new THREE.PlaneGeometry(40, 40, 40, 40).rotateX(-Math.PI / 2);
const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 0.95 }));
ground.receiveShadow = true;
scene.add(ground);
const gridHelper = new THREE.GridHelper(40, 80, 0x9aa6bb, 0xc4ccda);
gridHelper.position.y = 0.002;
scene.add(gridHelper);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 100);
const av = new Avatar(scene, tuning);
let pos = new THREE.Vector3();
let ctl;

function sim({ speed = 0, slope: sl = 0, state = 'run', seconds = 2, facing = 0, yawRate = 0, wake = 1, seated = 0, reach = 0, surface = 0, grounded = true, stopAfter = 0 } = {}) {
  slope = sl;
  const p = groundGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hf.heightAt(p.getX(i), p.getZ(i)));
  p.needsUpdate = true; groundGeo.computeVertexNormals();
  gridHelper.visible = sl === 0;
  const n = new THREE.Vector3(0, 1, sl).normalize();
  ctl = {
    world: { heightfield: hf }, state, grounded, groundSurface: surface, groundNormal: n, heightAboveGround: 0,
    vel: new THREE.Vector3(), facing, prevFacing: facing, lean: new THREE.Vector2(), prevLean: new THREE.Vector2(), time: 0, jumpFromSlide: false,
  };
  pos.set(0, 0, 0);
  av.wake = wake; av.seated = seated; av.reach = reach; av.reset();
  const dt = 1 / 60, N = Math.round(seconds * 60);
  for (let f = 0; f < N; f++) {
    const sp = stopAfter && f * dt > stopAfter ? Math.max(0, speed - (f * dt - stopAfter) * 20) : speed;
    ctl.vel.set(-Math.sin(ctl.facing) * sp, 0, -Math.cos(ctl.facing) * sp);
    ctl.prevFacing = ctl.facing; ctl.facing += yawRate * dt; ctl.time += dt;
    pos.x += ctl.vel.x * dt; pos.z += ctl.vel.z * dt; pos.y = hf.heightAt(pos.x, pos.z);
    av.update(ctl, pos, 1, dt);
  }
  return { phase: av.phase, pelvis: av.pelvis, pos: pos.toArray() };
}
/** Advance the current sim by n frames (for gait sheets). */
function step(n = 1) {
  const dt = 1 / 60;
  for (let f = 0; f < n; f++) {
    ctl.prevFacing = ctl.facing; ctl.time += dt;
    pos.x += ctl.vel.x * dt; pos.z += ctl.vel.z * dt; pos.y = hf.heightAt(pos.x, pos.z);
    av.update(ctl, pos, 1, dt);
  }
}
let view = { az: 30, el: 10, dist: 3.2, ty: 0.95 };
function place() {
  const e = (view.el * Math.PI) / 180;
  const t = new THREE.Vector3(pos.x, pos.y + view.ty, pos.z);
  // az 0 = in front of the figure (it faces −z at facing 0)
  const fx = -Math.sin(ctl.facing), fz = -Math.cos(ctl.facing);
  const dir = new THREE.Vector3(fx, 0, fz).applyAxisAngle(new THREE.Vector3(0, 1, 0), (view.az * Math.PI) / 180);
  camera.position.copy(t).addScaledVector(dir, view.dist * Math.cos(e)).add(new THREE.Vector3(0, view.dist * Math.sin(e), 0));
  camera.lookAt(t);
  sun.position.copy(t).add(new THREE.Vector3(3, 6, 2)); sun.target.position.copy(t); sun.target.updateMatrixWorld();
}
function render() { place(); renderer.render(scene, camera); }
function setView(az, el = 10, dist = 3.2, ty = 0.95) { view = { az, el, dist, ty }; render(); }
/** Contact sheet: views = [[az, el, dist, ty], …] or frames of the gait (stepFrames between). */
function sheet({ views = [[0, 8], [90, 8], [180, 8], [270, 8]], cols = 4, stepFrames = 0, size = 360 } = {}) {
  const rows = Math.ceil(views.length / cols), c = document.createElement('canvas');
  c.width = cols * size; c.height = rows * Math.round(size * 1.25);
  const g = c.getContext('2d');
  renderer.setSize(size, Math.round(size * 1.25)); camera.aspect = 0.8; camera.updateProjectionMatrix();
  views.forEach((v, i) => {
    if (i && stepFrames) step(stepFrames);
    view = { az: v[0], el: v[1] ?? 8, dist: v[2] ?? 3.2, ty: v[3] ?? 0.95 };
    render();
    g.drawImage(renderer.domElement, (i % cols) * size, Math.floor(i / cols) * Math.round(size * 1.25));
    g.fillStyle = '#000'; g.font = '14px monospace'; g.fillText(v[4] ?? `${v[0]}°`, (i % cols) * size + 6, Math.floor(i / cols) * Math.round(size * 1.25) + 16);
  });
  renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
  return c.toDataURL('image/png');
}
sim();
render();
window.lab = { sim, step, view: setView, render, sheet, av, ctl: () => ctl, bind: (c) => { ctl = c; pos = c.pos; } };
window.labReady = true;
