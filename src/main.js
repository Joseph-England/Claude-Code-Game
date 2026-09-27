// Phase 2 bootstrap: gray-box test course with the momentum controller and camera.
import * as THREE from 'three';
import { createLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { tuning } from './tuning.js';
import { buildCourse } from './world/course.js';
import { Colliders } from './world/colliders.js';
import { Controller } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { createGraybox } from './render/graybox.js';

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

// Stand-in body until the avatar item lands.
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), new THREE.MeshStandardMaterial({ color: 0xd04040 }));
body.castShadow = true;
scene.add(body);

function spawn(i) {
  const s = course.spawns[i];
  player.teleport(s.pos, s.yaw);
  cam.reset(player.pos, s.yaw);
}
spawn(0);

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
    cmd = input.sample(frameDt);
    cam.look(cmd.lookX, cmd.lookY, frameDt);
  },
  update(dt, step) {
    player.step(dt, step === 0 ? cmd : { ...cmd, jumpPressed: false }, cam.yaw);
  },
  render(alpha, frameDt) {
    for (const e of player.events) if (e.type === 'land') cam.impact(e.impact);
    player.events.length = 0;
    renderPos.lerpVectors(player.prevPos, player.pos, alpha);
    const crouch = THREE.MathUtils.lerp(player.prevCrouch, player.crouch, alpha);
    body.position.set(renderPos.x, renderPos.y + 0.85 - crouch * 0.35, renderPos.z);
    body.scale.y = 1 - crouch * 0.4;
    cam.update(frameDt, renderPos, player, crouch);
    gray.follow(renderPos);
    renderer.render(scene, camera);
  },
}).start();
