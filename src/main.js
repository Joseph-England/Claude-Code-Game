// Phase 2 bootstrap: gray-box test course.
import * as THREE from 'three';
import { createLoop } from './core/loop.js';
import { buildCourse } from './world/course.js';
import { createGraybox } from './render/graybox.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
const course = buildCourse();
const gray = createGraybox(renderer, scene, course);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let time = 0;
createLoop({
  update(dt) { time += dt; },
  render() {
    const a = time * 0.05;
    camera.position.set(Math.sin(a) * 90, 60, Math.cos(a) * 90);
    camera.lookAt(0, 0, 0);
    gray.follow(new THREE.Vector3());
    renderer.render(scene, camera);
  },
}).start();
