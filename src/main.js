// Phase 2 bootstrap: gray-box test course with the momentum controller and camera.
import * as THREE from 'three';
import { createLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { tuning } from './tuning.js';
import { buildCourse } from './world/course.js';
import { Colliders } from './world/colliders.js';
import { Controller } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { Avatar } from './player/avatar.js';
import { createGraybox } from './render/graybox.js';
import { DebugOverlay } from './debug/overlay.js';
import { createPanel } from './debug/panel.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(tuning.camera.fovMin, 1, 0.05, 1000);
const course = buildCourse();
const world = { heightfield: course.heightfield, colliders: new Colliders(course.boxes), cairns: course.cairns };
const gray = createGraybox(renderer, scene, course);

const input = new Input(canvas, tuning.input);
const player = new Controller(world, tuning);
const cam = new ThirdPersonCamera(camera, world, tuning);

const avatar = new Avatar(scene, tuning);
const overlay = new DebugOverlay();
const panel = createPanel(tuning);
const toast = document.getElementById('toast');
let toastTimer = 0;

function spawn(i) {
  const s = course.spawns[i];
  player.teleport(s.pos, s.yaw);
  cam.reset(player.pos, s.yaw);
  if (toast) { toast.textContent = `${i + 1} · ${s.name}`; toast.style.opacity = 1; toastTimer = 1.5; }
}
spawn(Math.min(course.spawns.length - 1, Math.max(0, Number(new URLSearchParams(location.search).get('spawn')) || 0)));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let cmd = null;
const renderPos = new THREE.Vector3();

createLoop({
  beginFrame(frameDt) {
    for (let i = 0; i < course.spawns.length; i++) if (input.wasPressed(`Digit${i + 1}`)) spawn(i);
    if (input.wasPressed('KeyR')) spawn(0);
    if (input.wasPressed('F3') || input.wasPressed('Backquote')) overlay.toggle();
    if (input.wasPressed('F4')) panel.toggle();
    if (toastTimer > 0 && (toastTimer -= frameDt) <= 0) toast.style.opacity = 0;
    cmd = input.sample(frameDt);
    cam.look(cmd.lookX, cmd.lookY, frameDt);
  },
  update(dt, step) {
    player.step(dt, step === 0 ? cmd : { ...cmd, jumpPressed: false }, cam.yaw);
  },
  render(alpha, frameDt, steps) {
    for (const e of player.events) if (e.type === 'land') cam.impact(e.impact);
    player.events.length = 0;
    renderPos.lerpVectors(player.prevPos, player.pos, alpha);
    const crouch = THREE.MathUtils.lerp(player.prevCrouch, player.crouch, alpha);
    avatar.update(player, renderPos, alpha, frameDt);
    cam.update(frameDt, renderPos, player, crouch);
    gray.follow(renderPos);
    renderer.render(scene, camera);
    overlay.update(frameDt, player, cam, steps);
  },
}).start();
