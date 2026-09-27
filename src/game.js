// Phase 3: the mountain. Loads the terrain in a worker, builds props and colliders, and runs the
// controller, camera, level state (checkpoints, triggers, wind, collapse, summit) with flat
// placeholder visuals. Phase 4 replaces the look; Phase 5 the story UI and game flow.
import * as THREE from 'three';
import { createLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { tuning } from './tuning.js';
import { loadMountain } from './world/mountain.js';
import { buildProps } from './world/props.js';
import { Colliders } from './world/colliders.js';
import { LevelState } from './world/levelstate.js';
import { Controller } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { Avatar } from './player/avatar.js';
import { TerrainRenderer, createBackdrop } from './render/terrain.js';
import { createLights } from './render/lights.js';
import { Pipeline } from './render/post.js';
import { DebugOverlay } from './debug/overlay.js';
import { createPanel } from './debug/panel.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pipeline = new Pipeline(renderer);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xa9b8d6), WHITE = new THREE.Color(0xe8ebf0);
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY.clone(), 250, 5200);
const camera = new THREE.PerspectiveCamera(tuning.camera.fovMin, 1, 0.1, 9000);

const loading = $('loading');
const t0 = performance.now();
const mountain = await loadMountain((f, label) => { loading.textContent = `${label} … ${Math.round(f * 100)}%`; });
const loadMs = performance.now() - t0;
loading.hidden = true;

const props = buildProps(mountain);
scene.add(props.group);
const colliders = new Colliders(props.boxes, props.meshes);
const world = { heightfield: mountain.heightfield, colliders, cairns: props.cairns.map((c) => [c.x, c.y, c.z]) };
const level = new LevelState(mountain, props.cairns, colliders, tuning);
const terrain = new TerrainRenderer(scene, mountain);
createBackdrop(scene, mountain);
const lights = createLights(scene);

const input = new Input(canvas, tuning.input);
const player = new Controller(world, tuning);
const cam = new ThirdPersonCamera(camera, world, tuning);
const avatar = new Avatar(scene, tuning);
const overlay = new DebugOverlay();
const panel = createPanel(tuning);

// --- Placeholder HUD: toast, story line, gust hint, fade.
const toast = $('toast'), line = $('line'), weightVig = $('weight-vignette'), fade = $('fade'), windEl = $('wind');
let toastTimer = 0, lineTimer = 0;
const lineQueue = [];
function showToast(text, secs = 1.6) { toast.textContent = text; toast.style.opacity = 1; toastTimer = secs; }
function showLine(b) {
  line.textContent = b.text;
  line.className = `voice-${b.voice}`;
  line.style.opacity = 1;
  weightVig.style.opacity = b.voice === 'W' ? 1 : 0;
  lineTimer = 2.5 + 0.06 * b.text.length;
}

function spawnAt(index, announce = true) {
  level.checkpoint = index;
  const sp = level.spawnPoint(index);
  player.teleport(sp.pos, sp.yaw);
  cam.reset(player.pos, sp.yaw);
  avatar.reset();
  if (announce) showToast(props.cairns[index].name);
}
// Dev teleport: ?spawn=N or keys 1–9 go to the start of section N-1 (its checkpoint if it has one).
function spawnSection(k) {
  const sec = mountain.route.sections[k];
  if (!sec) return;
  const i = props.cairns.findIndex((c) => c.section === k && c.checkpoint);
  // Sections before the target count as done so gating (wall-kick) matches a real run.
  const s = i >= 0 ? props.cairns[i].s : sec.s0 + 2;
  level.progress = Math.max(level.progress, s);
  if (i >= 0) { spawnAt(i); return; }
  level.checkpoint = Math.max(0, props.cairns.findLastIndex((c) => c.checkpoint && c.s <= s));
  const p = mountain.route.at(s);
  player.teleport([p.x, mountain.heightfield.heightAt(p.x, p.z), p.z], p.yaw);
  cam.reset(player.pos, p.yaw);
  showToast(sec.name);
}
const spawnParam = Number(new URLSearchParams(location.search).get('spawn'));
if (spawnParam > 0) spawnSection(spawnParam); else spawnAt(0, false);

// Respawn: fade out, teleport at black, fade in (< 1.5 s total, DECISIONS #13).
let respawn = null;
function startRespawn() { if (!respawn) respawn = { t: 0, moved: false }; }
function updateRespawn(dt) {
  if (!respawn) return;
  respawn.t += dt;
  const OUT = 0.35, HOLD = 0.15, IN = 0.5;
  if (respawn.t < OUT) fade.style.opacity = respawn.t / OUT;
  else if (!respawn.moved) { respawn.moved = true; fade.style.opacity = 1; spawnAt(level.checkpoint, false); }
  else if (respawn.t < OUT + HOLD) fade.style.opacity = 1;
  else if (respawn.t < OUT + HOLD + IN) fade.style.opacity = 1 - (respawn.t - OUT - HOLD) / IN;
  else { fade.style.opacity = 0; respawn = null; }
}

// Bridge collapse animation (render only; the collider is already gone).
let bridgeFall = null;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  pipeline.setSize(w, h, Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let cmd = null;
const renderPos = new THREE.Vector3();
const fogColor = new THREE.Color();
let summitTime = null;
let stuckT = 0, lastProgress = 0;

// Dev/test handle (tools/smoke.mjs reads it).
window.__game = { renderer, pipeline, level, player, get calls() { return renderer.info.render.calls; }, get tris() { return renderer.info.render.triangles; } };

createLoop({
  beginFrame(frameDt) {
    for (let k = 0; k <= 8; k++) if (input.wasPressed(`Digit${k + 1}`)) spawnSection(k);
    if (input.wasPressed('KeyR')) startRespawn();
    if (input.wasPressed('F3') || input.wasPressed('Backquote')) overlay.toggle();
    if (input.wasPressed('F4')) panel.toggle();
    if (toastTimer > 0 && (toastTimer -= frameDt) <= 0) toast.style.opacity = 0;
    if (lineTimer > 0 && (lineTimer -= frameDt) <= 0) { line.style.opacity = 0; weightVig.style.opacity = 0; }
    if (lineTimer <= 0 && lineQueue.length && line.style.opacity !== '1') showLine(lineQueue.shift());
    cmd = input.sample(frameDt);
    cam.look(cmd.lookX, cmd.lookY, frameDt);
  },
  update(dt, step) {
    const w = level.wind;
    player.vel.x += w.x * dt;
    player.vel.z += w.z * dt;
    player.step(dt, step === 0 ? cmd : { ...cmd, jumpPressed: false }, cam.yaw);
    level.step(dt, player);
    for (const e of level.events) {
      if (e.type === 'oob') startRespawn();
      else if (e.type === 'checkpoint') showToast('checkpoint');
      else if (e.type === 'beat') lineQueue.push(e.beat);
      else if (e.type === 'collapse') bridgeFall = { v: 0 };
      else if (e.type === 'summit') { summitTime = e.time; showToast(`summit · ${Math.floor(e.time / 60)}:${String(Math.floor(e.time % 60)).padStart(2, '0')}`, 5); }
    }
    level.events.length = 0;
    // Safety net: stuck without progress for a while (in a hollow, or fighting a slope) → remind
    // that R returns to the last cairn.
    const moving = player.speed > 1.5;
    stuckT = level.progress > lastProgress + 1 || level.wind.gust > 0 ? 0 : stuckT + dt;
    if (level.progress > lastProgress + 1) lastProgress = level.progress;
    if (stuckT > 12 && !moving && toastTimer <= 0) { showToast('R — back to the last cairn', 3); stuckT = 0; }
  },
  render(alpha, frameDt, steps) {
    for (const e of player.events) if (e.type === 'land') cam.impact(e.impact);
    player.events.length = 0;
    updateRespawn(frameDt);
    if (bridgeFall && mountain.bridge) {
      bridgeFall.v += 15 * frameDt;
      const m = mountain.bridge.mesh;
      m.position.y -= bridgeFall.v * frameDt;
      m.rotation.z += 0.3 * frameDt;
      if (m.position.y < mountain.bridge.top - 40) { m.visible = false; bridgeFall = null; }
    }
    renderPos.lerpVectors(player.prevPos, player.pos, alpha);
    const crouch = THREE.MathUtils.lerp(player.prevCrouch, player.crouch, alpha);
    // Scarf wind: a steady breeze across the slope plus the level's gusts and headwind.
    avatar.wind.set(1.5 + level.wind.x * 0.6, 0, 0.8 + level.wind.z * 0.6);
    avatar.update(player, renderPos, alpha, frameDt);
    cam.update(frameDt, renderPos, player, crouch);
    // Whiteout: fog closes in and drains to white.
    const wo = level.wind.whiteout;
    fogColor.copy(SKY).lerp(WHITE, wo);
    scene.fog.color.copy(fogColor);
    scene.background.copy(fogColor);
    scene.fog.near = THREE.MathUtils.lerp(250, 4, wo);
    scene.fog.far = THREE.MathUtils.lerp(5200, 55, wo);
    windEl.style.opacity = level.wind.warn || level.wind.gust > 0.2 ? 1 : 0;
    lights.follow(renderPos);
    terrain.update(camera);
    pipeline.render(scene, camera);
    const sec = mountain.route.sections[level.section];
    overlay.update(frameDt, player, cam, steps,
      `section  ${level.section} ${sec.name}   s ${level.s.toFixed(0)} d ${level.d.toFixed(1)}\n` +
      `progress ${(level.progressFraction * 100).toFixed(1)}%   cairn ${level.checkpoint}   t ${level.time.toFixed(0)} s${summitTime ? ' (summit)' : ''}\n` +
      `terrain  LOD ${terrain.stats.chunks.join('/')}  ${(terrain.stats.triangles / 1000).toFixed(0)}k tris   calls ${renderer.info.render.calls}   load ${(loadMs / 1000).toFixed(1)} s`);
  },
}).start();
