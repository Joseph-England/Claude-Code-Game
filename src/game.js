// The game: loads the mountain in a worker, builds props and colliders, and runs the flow
// (title → playing → ending → credits → title), the controller, camera, level state, story,
// narrator, audio and the Phase 4 renderer.
import * as THREE from 'three';
import { createLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { tuning } from './tuning.js';
import { loadMountain } from './world/mountain.js';
import { buildProps } from './world/props.js';
import { Colliders } from './world/colliders.js';
import { LevelState } from './world/levelstate.js';
import { Story } from './story/story.js';
import { Narrator } from './story/narrator.js';
import { Audio } from './audio/audio.js';
import { Controller } from './player/controller.js';
import { ThirdPersonCamera } from './player/camera.js';
import { Avatar } from './player/avatar.js';
import { TerrainRenderer, createBackdrop } from './render/terrain.js';
import { createLights } from './render/lights.js';
import { Pipeline } from './render/post.js';
import { Atmosphere } from './render/atmosphere.js';
import { SunShadow } from './render/sunshadow.js';
import { SNOW_DIRECT } from './render/snow.js';
import { Trails } from './render/trails.js';
import { FogPass } from './render/fog.js';
import { Particles } from './render/particles.js';
import { startupTier, Quality, GpuTimer } from './render/quality.js';
import { glitter } from './render/snow.js';
import { SURFACE } from './world/surfaces.js';
import { litMaterial, world as worldU } from './render/materials.js';
import { sunElevation, SUN_AZIMUTH, snowDensity, grade } from './render/arc.js';
import { DebugOverlay } from './debug/overlay.js';
import { createPanel } from './debug/panel.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pipeline = new Pipeline(renderer);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(tuning.camera.fovMin, 1, 0.1, 9000);

const titleEl = $('title'), statusEl = $('status');
const t0 = performance.now();
const mountain = await loadMountain((f, label) => { statusEl.textContent = `${label} … ${Math.round(f * 100)}%`; });
const loadMs = performance.now() - t0;

const props = buildProps(mountain);
scene.add(props.group);
const colliders = new Colliders(props.boxes, props.meshes);
const world = { heightfield: mountain.heightfield, colliders, cairns: props.cairns.map((c) => [c.x, c.y, c.z]) };
const level = new LevelState(mountain, props.cairns, colliders, tuning);
const story = new Story(mountain.route, props.cairns);
const qStart = startupTier();
const lights = createLights(scene, camera, { cascades: qStart.tier.cascades, size: qStart.tier.shadowSize });
const snowLit = (mat, patch, key) => litMaterial(mat, { csm: lights.csm, patch, key, direct: SNOW_DIRECT });
const trails = new Trails(renderer, qStart.tier.trail);
const terrain = new TerrainRenderer(scene, mountain, { lit: snowLit, trails });
createBackdrop(scene, mountain, snowLit);
const atmosphere = new Atmosphere(renderer, scene);
const sunShadow = new SunShadow(renderer, terrain.heightTex, mountain.heightfield);
worldU.tSky.value = atmosphere.skyRT.texture;
worldU.uSunDir.value = atmosphere.sunDir;
worldU.uTintHigh = atmosphere.skyUniforms.uTintHigh;
worldU.uTintLow = atmosphere.skyUniforms.uTintLow;
worldU.tSunVis.value = sunShadow.texture;
worldU.uSunVisOrigin.value.copy(sunShadow.origin);
worldU.uSunVisSize.value = sunShadow.size;
const fog = new FogPass(); // after the tint swap above: it copies the world uniform references
pipeline.fog = fog;
fog.u.uSunColor.value = atmosphere.sunColor;

// Spindrift emitters along the ridge crest and the summit.
const crest = [];
for (const k of [4, 8]) {
  const sec = mountain.route.sections[k];
  for (let ls = 10; ls < sec.len - 4; ls += 3) {
    const p = mountain.route.at(sec.s0 + ls);
    crest.push([p.x, mountain.heightfield.heightAt(p.x, p.z) + 0.3, p.z]);
  }
}
const particles = new Particles(scene, { crest, snow: 30000 });
const fx = { sprayAcc: 0, breathT: 1, emberAcc: 0, wind: new THREE.Vector3(), light: new THREE.Color() };
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

const input = new Input(canvas, tuning.input);
const player = new Controller(world, tuning);
const cam = new ThirdPersonCamera(camera, world, tuning);
const avatar = new Avatar(scene, tuning);
avatar.onFoot = (x, z) => { if (onSnow()) trails.foot(x, z); audio.footstep(player.groundSurface, player.speed); };
const onSnow = () => player.grounded && (player.groundSurface === SURFACE.POWDER || player.groundSurface === SURFACE.PACKED) && player.heightAboveGround < 0.1;
// Every other standard material (props, backdrop, avatar) gets the world lighting.
scene.traverse((o) => {
  if (!o.isMesh || !o.material?.isMeshStandardMaterial) return;
  o.receiveShadow = true;
  if (!o.material.userData.lit)   litMaterial(o.material, { csm: lights.csm, key: `lit-${o.material.flatShading}-${o.material.side}` });
});
atmosphere.setSun(sunElevation(0), SUN_AZIMUTH, 0);
sunShadow.update(atmosphere.sunDir, true);
const overlay = new DebugOverlay();
const panel = createPanel(tuning);

// --- HUD: toast, narrator, gust hint, prompt, controls, fade.
const toast = $('toast'), fade = $('fade'), windEl = $('wind'), promptEl = $('prompt'), controlsEl = $('controls');
const creditsEl = $('credits');
let toastTimer = 0;
function showToast(text, secs = 1.6) { toast.textContent = text; toast.style.opacity = 1; toastTimer = secs; }
const audio = new Audio();
const narrator = new Narrator($('line'), $('weight-vignette'), (l) => audio.bell(l.voice));

function spawnAt(index, announce = true) {
  level.checkpoint = index;
  const sp = level.spawnPoint(index);
  player.teleport(sp.pos, sp.yaw);
  cam.reset(player.pos, sp.yaw);
  avatar.reset();
  trails.cut();
  if (announce) showToast(props.cairns[index].name);
}
// Dev teleport: ?spawn=N or keys 1–9 go to the start of section N-1 (its checkpoint if it has one).
function spawnSection(k) {
  const sec = mountain.route.sections[k];
  if (!sec) return;
  const i = props.cairns.findIndex((c) => c.section === k && c.checkpoint);
  const s = i >= 0 ? props.cairns[i].s : sec.s0 + 2;
  level.progress = Math.max(level.progress, s);
  if (i >= 0) { spawnAt(i); return; }
  level.checkpoint = Math.max(0, props.cairns.findLastIndex((c) => c.checkpoint && c.s <= s));
  const p = mountain.route.at(s);
  player.teleport([p.x, mountain.heightfield.heightAt(p.x, p.z), p.z], p.yaw);
  cam.reset(player.pos, p.yaw);
  showToast(sec.name);
}

// --- Flow: title → playing (the opening: lying in the snow until the first input) → ending →
// credits → title. The title sits over the live scene; the run resets when it comes back round.
const flow = { mode: 'title', t: 0, wake: null, controlsT: 0, stuckShown: -99 };
function newRun() {
  level.reset();
  story.reset();
  narrator.clear();
  summitTime = null;
  stuckT = 0; lastProgress = 0;
  spawnAt(0, false);
  avatar.wake = 0;
  flow.wake = null;
  flow.firstCheckpoint = true;
}
function startPlaying() {
  if (flow.mode !== 'title') return;
  flow.mode = 'playing';
  flow.t = 0;
  titleEl.classList.add('gone');
  audio.start();
  canvas.requestPointerLock?.();
}
function startEnding() {
  flow.mode = 'ending';
  flow.t = 0;
  controlsEl.style.opacity = 0;
  promptEl.style.opacity = 0;
  document.exitPointerLock?.();
}
function startCredits() {
  flow.mode = 'credits';
  flow.t = 0;
  narrator.clear();
  creditsEl.classList.add('show');
}
function backToTitle() {
  creditsEl.classList.remove('show');
  newRun();
  flow.mode = 'title';
  flow.t = 0;
  titleEl.classList.remove('gone');
}
titleEl.addEventListener('click', startPlaying);
creditsEl.addEventListener('click', (e) => { if (flow.mode === 'credits' && flow.t > 8 && e.target.tagName !== 'A') backToTitle(); });
addEventListener('keydown', (e) => { if (flow.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) startPlaying(); });

let summitTime = null;
let stuckT = 0, lastProgress = 0;
newRun();
// Dev: ?spawn=N skips the title and the opening and starts at section N.
const spawnParam = Number(new URLSearchParams(location.search).get('spawn'));
titleEl.classList.add('ready');
statusEl.textContent = 'click to begin';
if (spawnParam > 0) { startPlaying(); avatar.wake = 1; flow.wake = 1; spawnSection(spawnParam); }

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


function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  pipeline.setSize(w, h, Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const gpuTimer = new GpuTimer(renderer);
const quality = new Quality(qStart, pipeline, (t) => {
  terrain.setLod(t.lod);
  particles.snowTier = t.snow;
  glitter.value = t.glitter;
  trails.resize(t.trail);
  pipeline.setBloomMips(t.bloom);
  lights.setMapSize(t.shadowSize);
});

let cmd = null;
let avatarSink = 0;
const renderPos = new THREE.Vector3();

// Title: a low camera beside the figure lying in the snow, looking up the valley toward the summit,
// drifting very slowly.
const _look = new THREE.Vector3();
function titleCamera(t) {
  const p = player.pos, top = mountain.route.at(mountain.route.length);
  const yaw = Math.atan2(top.x - p.x, top.z - p.z) + 0.35 + 0.05 * Math.sin(t * 0.07);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  camera.position.set(p.x - fx * 5.5 - fz * 1.8, 0, p.z - fz * 5.5 + fx * 1.8);
  camera.position.y = Math.max(p.y, mountain.heightfield.heightAt(camera.position.x, camera.position.z)) + 1.5 + 0.1 * Math.sin(t * 0.11);
  _look.set(p.x + fx * 30, p.y + 7, p.z + fz * 30);
  camera.lookAt(_look);
  camera.fov = 55;
  camera.updateProjectionMatrix();
}

// Audio state from the player, the level and the flow (DESIGN §5).
const _right = new THREE.Vector3();
function updateAudio(dt) {
  const sec = mountain.route.sections[level.section], ls = level.s - sec.s0;
  const hollow = sec.name === 'The Descent' ? smooth(ls, 40, 56) * (1 - smooth(ls, 86, 100)) : 0;
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const g = level.wind, gl = Math.hypot(g.x, g.z) || 1;
  const since = summitTime === null ? 0 : level.time - summitTime;
  const title = flow.mode === 'title';
  audio.update(dt, {
    alt: THREE.MathUtils.clamp((player.pos.y + 10) / 140, 0, 1),
    speed: player.speed, airSpeed: player.speed + 6 * g.gust,
    sliding: player.state === 'slide', grounded: player.grounded, surface: player.groundSurface,
    sprinting: player.speed > 6.5, powder: player.groundSurface === SURFACE.POWDER, sitting: player.state === 'sit',
    gust: g.gust, gustSide: (g.x * _right.x + g.z * _right.z) / gl, whiteout: g.whiteout, shelter: hollow,
    calm: flow.mode === 'ending' ? smooth(since, 4, 30) : 0,
    mood: title ? 0 : sec.name === 'The Descent' && ls > 70 ? 9 : level.section,
    musicDuck: title ? 0.7 : flow.mode === 'credits' ? 0.6 : 1,
  });
}

// Grade, exposure, speed effects and the alpenglow, all from the route and the sun.
const smooth = THREE.MathUtils.smoothstep;
function updateLook(dt) {
  const g = pipeline.grade, [sat, temp, contrast] = grade(mountain.route, level.s);
  g.uSat.value = sat; g.uTemp.value = temp; g.uContrast.value = contrast;
  const sunY = atmosphere.sunDir.y;
  g.uExposure.value = 0.62 * (1 + 2.2 * smooth(-sunY, -0.03, 0.09));
  g.uSpeed.value += (smooth(player.speed, 14, 30) - g.uSpeed.value) * Math.min(1, dt * 4);
  g.uTime.value = level.time;
  const glow = smooth(-sunY, -0.035, 0.01) * (1 - smooth(-sunY, 0.05, 0.12));
  worldU.uGlow.value.setRGB(1.0, 0.32, 0.45).multiplyScalar(2.2 * glow);
  worldU.uGlowDir.value.set(atmosphere.sunDir.x, 0, atmosphere.sunDir.z).normalize().setY(0.05).normalize();
  worldU.uGlowH.value = THREE.MathUtils.lerp(-300, 900, smooth(-sunY, -0.03, 0.09));
}

function updateParticles(dt) {
  const t = level.time, v = player.vel, sp = player.speed;
  // Slide spray.
  if (player.state === 'slide' && onSnow() && sp > 4) {
    fx.sprayAcc += sp * dt * 3;
    for (; fx.sprayAcc >= 1; fx.sprayAcc--) {
      particles.emit(renderPos.x + rnd(0.3), renderPos.y + 0.05, renderPos.z + rnd(0.3), -v.x * 0.15 + rnd(2), 1.2 + Math.random() * 2.2, -v.z * 0.15 + rnd(2), 0.5 + Math.random() * 0.5, 0.05, 1, 0.6, 0);
    }
  }
  // Breath: faster when sprinting.
  if ((fx.breathT -= dt) <= 0) {
    fx.breathT = player.speed > 6 ? 0.9 : 2.4;
    avatar.head.getWorldPosition(fx.wind);
    const f = [-Math.sin(player.facing), -Math.cos(player.facing)];
    for (let i = 0; i < 4; i++) particles.emit(fx.wind.x + f[0] * 0.15, fx.wind.y + 0.1, fx.wind.z + f[1] * 0.15, v.x * 0.8 + f[0] * 0.4 + rnd(0.1), 0.15, v.z * 0.8 + f[1] * 0.4 + rnd(0.1), 1.4, 0.035, 0.35, -0.01, 1);
  }
  // Cairn embers.
  fx.emberAcc += dt * 5;
  for (; fx.emberAcc >= 1; fx.emberAcc--) {
    for (const c of props.cairns) {
      if ((c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 > 90 ** 2) continue;
      if (!c.checkpoint && Math.random() < 0.5) continue;
      const a = Math.random() * Math.PI * 2;
      particles.emit(c.x + Math.cos(a) * 0.5, c.y + 0.4 + Math.random() * 0.8, c.z + Math.sin(a) * 0.5, rnd(0.1), 0.35 + Math.random() * 0.4, rnd(0.1), 2.5 + Math.random(), 0.022, 0, 0, 2);
    }
  }
  // Weather: breeze + gusts + the whiteout's blizzard along the route.
  const wo = level.wind.whiteout, here = mountain.route.at(level.s);
  fx.wind.set(1.2 + level.wind.x * 0.9 - here.dx * 11 * wo, 0, 0.6 + level.wind.z * 0.9 - here.dz * 11 * wo);
  const gustDir = level.wind.gust > 0.02 ? level.wind : null;
  fx.light.copy(atmosphere.ambientSky).multiplyScalar(0.8).add(new THREE.Color().copy(atmosphere.sunColor).multiplyScalar(0.05));
  const k = level.section;
  particles.update({
    time: t, wind: gustDir ? fx.wind.clone().add(new THREE.Vector3(gustDir.x, 0, gustDir.z)) : fx.wind,
    snowDensity: Math.max(snowDensity(mountain.route, level.s), wo), streak: wo,
    driftStrength: k === 4 || k === 8 ? 0.35 + 0.65 * level.wind.gust : 0, light: fx.light,
  });
}

// Dev/test handle (tools/smoke.mjs reads it).
window.__game = { renderer, pipeline, level, player, trails, quality, gpuTimer, audio, flow, narrator, extra: () => ({ tier: quality.tier.name, scale: quality.scale, bench: quality.benchResult }), get calls() { return renderer.info.render.calls; }, get tris() { return renderer.info.render.triangles; } };

createLoop({
  beginFrame(frameDt) {
    const playing = flow.mode === 'playing';
    flow.t += frameDt;
    if (playing) {
      for (let k = 0; k <= 8; k++) if (input.wasPressed(`Digit${k + 1}`)) { avatar.wake = 1; flow.wake = 1; spawnSection(k); }
      if (input.wasPressed('KeyR') && flow.wake >= 1) startRespawn();
      if (input.wasPressed('KeyE')) story.signal('stone');
    }
    if (input.wasPressed('F3') || input.wasPressed('Backquote')) overlay.toggle();
    if (input.wasPressed('F4')) panel.toggle();
    if (input.wasPressed('F2')) showToast(`quality: ${quality.cycle()}${quality.tier.cascades !== lights.csm.cascades ? ' (shadow cascades after reload)' : ''}`, 2.5);
    if (toastTimer > 0 && (toastTimer -= frameDt) <= 0) toast.style.opacity = 0;
    narrator.weight = 1 - 0.45 * level.progressFraction;
    narrator.update(frameDt, story.noteAt(player));
    cmd = input.sample(frameDt);
    if (!playing) cmd = { ...cmd, moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false, sprintHeld: false };
    if (flow.mode !== 'ending') cam.look(cmd.lookX, cmd.lookY, frameDt);
    // The opening: lying in the snow until the first input, then getting up (~2.6 s).
    if (playing && flow.wake === null && (cmd.moveX || cmd.moveY || cmd.jumpPressed)) { flow.wake = 0; story.signal('input'); narrator.hurry(); }
    if (flow.wake !== null && flow.wake < 1) {
      flow.wake = Math.min(1, flow.wake + frameDt / 2.6);
      avatar.wake = flow.wake;
      if (flow.wake >= 1) { flow.controlsT = 0; controlsEl.style.opacity = 1; }
    }
    if (flow.wake === null || flow.wake < 1) cmd = { ...cmd, moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false };
    if (controlsEl.style.opacity === '1' && (flow.controlsT += frameDt) > 16) controlsEl.style.opacity = 0;
    if (flow.mode === 'ending' && flow.t > 8) { fade.style.transition = 'opacity 3s'; fade.style.opacity = 1; }
    if (flow.mode === 'ending' && flow.t > 11.5) startCredits();
    if (flow.mode === 'credits' && flow.t > 40) backToTitle();
    if (flow.mode === 'title' && fade.style.opacity === '1') { fade.style.transition = 'opacity 2.5s'; fade.style.opacity = 0; }
  },
  update(dt, step) {
    if (flow.mode === 'title' || flow.mode === 'credits') return;
    const w = level.wind;
    player.vel.x += w.x * dt;
    player.vel.z += w.z * dt;
    player.step(dt, step === 0 ? cmd : { ...cmd, jumpPressed: false }, cam.yaw);
    if (player.events.some((e) => e.type === 'jump')) story.signal('jump');
    level.step(dt, player);
    story.step(dt, level, player);
    for (const l of story.out) narrator.push(l);
    story.out.length = 0;
    for (const e of level.events) {
      if (e.type === 'oob') { if (!respawn) story.respawned(mountain.route.sectionIndexAt(props.cairns[level.checkpoint].s)); startRespawn(); }
      else if (e.type === 'checkpoint') {
        if (flow.firstCheckpoint) showToast('a cairn · if you fall, you come back here', 3.5);
        flow.firstCheckpoint = false;
        audio.bell('O');
        for (let i = 0; i < 60; i++) particles.emit(e.cairn.x + rnd(0.5), e.cairn.y + 0.8 + rnd(0.5), e.cairn.z + rnd(0.5), rnd(1.5), 1 + Math.random() * 2, rnd(1.5), 2 + Math.random(), 0.03, 0, 0.05, 2);
      }
      else if (e.type === 'summit') { summitTime = e.time; startEnding(); }
    }
    level.events.length = 0;
    // Safety net: stuck without progress for a while (in a hollow, or fighting a slope) → remind
    // once that R returns to the last cairn. Never at the top or in the ending.
    const moving = player.speed > 1.5;
    stuckT = level.progress > lastProgress + 1 || level.wind.gust > 0 || moving ? 0 : stuckT + dt;
    if (level.progress > lastProgress + 1) lastProgress = level.progress;
    if (flow.mode === 'playing' && flow.wake >= 1 && level.section < 8 && stuckT > 20 && level.time - flow.stuckShown > 90) {
      showToast('R returns you to the last cairn', 4);
      flow.stuckShown = level.time;
    }
  },
  render(alpha, frameDt, steps) {
    if (flow.mode === 'credits') { updateAudio(frameDt); return; } // the credits are opaque
    gpuTimer.begin();
    for (const e of player.events) {
      if (e.type === 'jump') audio.breath(1, e.slide ? 0.25 : 0.4);
      if (e.type !== 'land') continue;
      audio.land(player.groundSurface, e.impact);
      cam.impact(e.impact);
      if (e.impact > 4 && onSnow()) {
        for (let i = 0; i < 12 + e.impact * 2; i++) {
          const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * e.impact * 0.3;
          particles.emit(player.pos.x, player.pos.y + 0.05, player.pos.z, Math.cos(a) * v, 0.8 + Math.random() * 1.5, Math.sin(a) * v, 0.5 + Math.random() * 0.5, 0.06, 1.2, 0.5, 0);
        }
      }
    }
    player.events.length = 0;
    updateRespawn(frameDt);
    renderPos.lerpVectors(player.prevPos, player.pos, alpha);
    // Deformable snow: the path (a groove; deeper when sliding) and footprints from the gait.
    const snow = onSnow(), sliding = player.state === 'slide';
    trails.update(renderPos, snow ? (sliding ? { radius: 0.45, depth: 1 } : { radius: 0.24, depth: 0.6 }) : null);
    const sink = snow && player.groundSurface === SURFACE.POWDER ? (sliding ? 0.3 : 0.18) : snow ? (sliding ? 0.06 : 0.035) : 0;
    avatarSink += (sink - avatarSink) * Math.min(1, frameDt * 8);
    renderPos.y -= avatarSink;
    const crouch = THREE.MathUtils.lerp(player.prevCrouch, player.crouch, alpha);
    // Scarf wind: a steady breeze across the slope plus the level's gusts and headwind.
    avatar.wind.set(1.5 + level.wind.x * 0.6, 0, 0.8 + level.wind.z * 0.6);
    avatar.update(player, renderPos, alpha, frameDt);
    if (flow.mode === 'title') titleCamera(flow.t);
    else cam.update(frameDt, renderPos, player, crouch);
    // Whiteout: the fog pass closes in to ~16 m and drains to a lavender white lit by the sky.
    const wo = level.wind.whiteout;
    fog.u.uWhiteout.value = wo;
    fog.u.uWhiteColor.value.copy(atmosphere.ambientSky).multiplyScalar(0.55).addScalar(0.25 * atmosphere.sunColor.g / 16 + 0.08);
    windEl.style.opacity = level.wind.warn || level.wind.gust > 0.2 ? 1 : 0;
    const sinceSummit = summitTime === null ? -1 : level.time - summitTime;
    atmosphere.setSun(sunElevation(level.progressFraction, sinceSummit), SUN_AZIMUTH, level.time);
    updateParticles(frameDt);
    updateAudio(frameDt);
    updateLook(frameDt);
    lights.update(atmosphere.sunDir, atmosphere.sunColor);
    sunShadow.update(atmosphere.sunDir);
    worldU.uBounce.value.copy(atmosphere.ambientGround);
    terrain.update(camera);
    pipeline.render(scene, camera);
    gpuTimer.end();
    quality.update(frameDt, gpuTimer.ms);
    const sec = mountain.route.sections[level.section];
    overlay.update(frameDt, player, cam, steps,
      `section  ${level.section} ${sec.name}   s ${level.s.toFixed(0)} d ${level.d.toFixed(1)}\n` +
      `progress ${(level.progressFraction * 100).toFixed(1)}%   cairn ${level.checkpoint}   t ${level.time.toFixed(0)} s${summitTime ? ' (summit)' : ''}\n` +
      `quality  ${quality.tier.name}${quality.bench ? ' (benchmarking)' : ''}  scale ${quality.scale.toFixed(2)}  gpu ${gpuTimer.ms?.toFixed(1) ?? 'n/a'} ms  cascades ${lights.csm.cascades}\n` +
      `terrain  LOD ${terrain.stats.chunks.join('/')}  ${(terrain.stats.triangles / 1000).toFixed(0)}k tris   calls ${renderer.info.render.calls}   load ${(loadMs / 1000).toFixed(1)} s`);
  },
}).start();
