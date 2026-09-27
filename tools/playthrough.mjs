// Automated playthrough (Phase 3): a route-following bot plays the whole level headlessly on the
// real terrain, colliders, controller and level state at the fixed 120 Hz step, and reports
// per-section times, respawns and the summit time, plus a first-time-player estimate.
// Also checks every cairn respawn and sweeps the corridor for soft-locks.
// Usage: npm run playthrough [-- --verbose] [-- --from=K]   (exit 1 on failure)
import { generateMountain } from '../src/world/mountain.js';
import { buildProps } from '../src/world/props.js';
import { Colliders } from '../src/world/colliders.js';
import { LevelState } from '../src/world/levelstate.js';
import { Controller } from '../src/player/controller.js';
import { tuning } from '../src/tuning.js';
import { FIXED_DT } from '../src/core/loop.js';
import * as THREE from 'three';
import { SURFACE } from '../src/world/surfaces.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const DT = FIXED_DT;
const t0 = Date.now();
const mountain = generateMountain();
const genMs = Date.now() - t0;
const props = buildProps(mountain);
const colliders = new Colliders(props.boxes, props.meshes);
const world = { heightfield: mountain.heightfield, colliders, cairns: props.cairns.map((c) => [c.x, c.y, c.z]) };
const { route } = mountain;
const failures = [];

function makeRun() {
  const level = new LevelState(mountain, props.cairns, colliders, tuning);
  const player = new Controller(world, tuning);
  return { level, player };
}

/** The bot: steer at a look-ahead point on the route (or the section's packed trail). */
class Bot {
  constructor(level, player) {
    this.level = level; this.p = player;
    this.jumpHold = 0; this.prevLs = -1; this.kickDir = -1; this.inKick = false; this.kickTick = 0; this.lastKickTick = -99;
  }

  command() {
    const { level, p } = this;
    const sec = route.sections[level.section], ls = level.s - sec.s0, bot = sec.bot ?? {};
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const ahead = Math.min(22, 5 + 0.45 * speed);
    const sT = Math.min(route.length, level.s + ahead);
    const tgt = route.at(sT);
    let off = 0;
    if (bot.line === 'trail') off = route.trailOffset(sT) ?? 0;
    // Rock line up a snow face: short look-ahead so the zig-zag isn't cut across the snow.
    const climb = sec.climb && ls > sec.climb.from - 4 && ls < sec.climb.to;
    if (climb) {
      const sC = level.s + 2.2;
      const q = route.at(sC), o = route.climbOffset(sC);
      const cx = q.x + q.rx * o - p.pos.x, cz = q.z + q.rz * o - p.pos.z;
      var climbYaw = Math.atan2(-cx, -cz);
    }
    const tx = tgt.x + tgt.rx * off - p.pos.x, tz = tgt.z + tgt.rz * off - p.pos.z;
    let camYaw = Math.atan2(-tx, -tz);
    // Too slow for a momentum bank: take the rock edge instead.
    if (bot.edge && ls > bot.edge[0] && ls < bot.edge[1] && speed < 6.5 && !(bot.slide ?? []).some(([a, b]) => ls >= a && ls < b && speed > 7)) {
      const e = route.at(Math.min(level.s + 4, sec.s0 + bot.edge[1] + 2));
      camYaw = Math.atan2(-(e.x + e.rx * bot.edge[2] - p.pos.x), -(e.z + e.rz * bot.edge[2] - p.pos.z));
    }
    if (climb) camYaw = climbYaw;
    const c = { moveX: 0, moveY: 1, jumpPressed: false, jumpHeld: false, slideHeld: false, sprintHeld: true };
    // Ridge: wait out gusts on rock (the shelter), as a player would after the first one.
    if (bot.gustWait && p.grounded && p.groundSurface === SURFACE.ROCK && (level.wind.warn || level.wind.gust > 0.05)) c.moveY = 0;
    // Slide where the hint says so, but only while it is worth it (moving, or the bed drops ahead).
    const falling = route.heightAt(level.s + 6) < route.heightAt(level.s) - 0.4;
    for (const [a, b] of bot.slide ?? []) if (ls >= a && ls < b && (speed > 4 || falling)) c.slideHeld = true;
    for (const j of bot.jump ?? []) if (this.prevLs < j && ls >= j && this.prevLs >= 0) { c.jumpPressed = true; this.jumpHold = 0.35; }

    // Chimneys (as the Phase 2 check climbs them): enter through the doorway, step back against
    // the panel, jump, then kick between panel and step face until above the step, then top out.
    const kickAt = (bot.kick ?? []).find((a) => ls > a - 9 && ls < a + 0.5);
    if (kickAt !== undefined) {
      c.sprintHeld = false; // nobody sprints inside a chimney
      const slot = sec.slots.find((sl) => sl.at === kickAt);
      const prof = route.profileAt(sec.s0 + kickAt - 1);
      const here = route.at(level.s);
      const top = route.heightAt(sec.s0 + kickAt + 2.5);
      const gapStart = kickAt - slot.gap; // panel's front face
      const lat = level.d;
      const climbing = this.inKick && (!p.grounded || !this.jumped || this.kickTick - this.jumpTick < 6);
      if (!climbing && p.grounded && ls < gapStart + 0.9) {
        // Approach: walk through the doorway into the gap.
        this.inKick = false;
        const doorD = slot.door * (prof.w - 1.1);
        const g = route.at(sec.s0 + gapStart + 1.6);
        camYaw = Math.atan2(-(g.x + g.rx * doorD - p.pos.x), -(g.z + g.rz * doorD - p.pos.z));
        c.moveY = 0.8;
      } else if (!climbing && p.grounded && (Math.abs(lat) > 1.2 || speed > 0.6)) {
        // Align: move to the middle of the gap.
        this.inKick = false;
        camYaw = here.yaw;
        c.moveX = Math.abs(lat) > 1.2 ? Math.max(-1, Math.min(1, -0.6 * lat)) : 0;
        c.moveY = 0;
      } else if (!climbing && p.grounded) {
        // Start a climb: step back to the panel, then jump.
        this.inKick = true; this.jumped = false; this.kickTick = 0; this.kickDir = -1; this.lastKickTick = -99;
      }
      if (this.inKick) {
        camYaw = here.yaw;
        this.kickTick++;
        c.jumpHeld = true;
        const above = p.pos.y > top + 0.2;
        // Above the step: head for it — unless still flying back toward the panel, in which case
        // one more kick off the panel carries us over.
        c.moveY = above && this.kickDir > 0 ? 1 : this.kickDir;
        const latVel = p.vel.x * here.rx + p.vel.z * here.rz;
        c.moveX = Math.max(-1, Math.min(1, -0.8 * lat - 0.5 * latVel));
        if (!this.jumped && p.grounded && (ls < gapStart + 1.0 || this.kickTick > 60)) { c.jumpPressed = true; this.jumped = true; this.jumpTick = this.kickTick; }
        if (!p.grounded && p.timers.wall > 0 && p.vel.y < 3 && this.kickTick - this.lastKickTick > 6 && (!above || this.kickDir < 0)) {
          c.jumpPressed = true; this.kickDir = -this.kickDir; this.lastKickTick = this.kickTick;
        }
        if (p.grounded && this.jumped && this.kickTick - this.jumpTick >= 6) this.inKick = false;
      }
    } else this.inKick = false;

    // Stuck recovery, as a player would try it: hop, then sidestep, then back off 25 m and come
    // again (sliding where the hints say) — the answer to a momentum gate. Back-off is 35 m.
    const blocked = p.grounded && speed < 1 && !this.inKick && c.moveY > 0.5;
    this.blockedT = blocked ? (this.blockedT ?? 0) + DT : 0;
    if (this.recover) {
      const r = this.recover;
      r.t += DT;
      if (r.kind === 'hop') { c.jumpPressed = r.t < DT * 1.5; c.jumpHeld = true; }
      else if (r.kind === 'side') { c.moveX = r.dir; c.moveY = 0.3; }
      else if (r.kind === 'back') {
        const b = route.at(Math.max(0, r.from - 35));
        camYaw = Math.atan2(-(b.x - p.pos.x), -(b.z - p.pos.z));
        c.slideHeld = false; c.moveX = 0; c.moveY = 1;
        if (level.s < r.from - 32) r.t = 99;
      }
      if (r.t > (r.kind === 'back' ? 12 : 1.2)) this.recover = null;
    } else if (this.blockedT > 1) {
      // Backing off only helps if there is a slope behind to build speed on.
      const kinds = route.heightAt(level.s - 35) > route.heightAt(level.s) + 2 ? ['hop', 'side', 'back'] : ['hop', 'side'];
      this.recoverCount = (this.recoverCount ?? 0) + 1;
      this.recover = { kind: kinds[(this.recoverCount - 1) % kinds.length], t: 0, dir: this.recoverCount % 2 ? 1 : -1, from: level.s };
      this.blockedT = 0;
    }
    if (this.jumpHold > 0) { c.jumpHeld = true; this.jumpHold -= DT; }
    this.prevLs = ls;
    return { c, camYaw };
  }
}

function playthrough({ from = 0, maxTime = 900, verbose = false } = {}) {
  const { level, player } = makeRun();
  const bot = new Bot(level, player);
  const startS = from ? route.sections[from].s0 + 2 : props.cairns[0].s;
  level.checkpoint = Math.max(0, props.cairns.findLastIndex((c) => c.checkpoint && c.s <= startS + 20));
  level.progress = startS;
  if (from) { const p = route.at(startS); player.teleport([p.x, mountain.heightfield.heightAt(p.x, p.z), p.z], p.yaw); }
  else { const sp = level.spawnPoint(0); player.teleport(sp.pos, sp.yaw); }
  const secs = route.sections.map(() => ({ enter: null, respawns: 0, reasons: [], maxSpeed: 0 }));
  let lastProgress = level.progress, stallT = 0, t = 0, summit = null;
  const beats = [];
  while (t < maxTime) {
    const { c, camYaw } = bot.command();
    player.vel.x += level.wind.x * DT;
    player.vel.z += level.wind.z * DT;
    player.step(DT, c, camYaw);
    player.events.length = 0;
    level.step(DT, player);
    t += DT;
    const k = level.section;
    if (secs[k].enter === null) { secs[k].enter = t; if (verbose) console.log(`  ${t.toFixed(1)} s  enter ${route.sections[k].name}`); }
    secs[k].maxSpeed = Math.max(secs[k].maxSpeed, player.speed);
    let respawned = false;
    for (const e of level.events) {
      if (e.type === 'oob' && !respawned) {
        respawned = true;
        const kk = route.sectionIndexAt(level.progress);
        secs[kk].respawns++;
        secs[kk].reasons.push(`${e.reason}@${(level.s - route.sections[kk].s0).toFixed(0)}`);
        if (verbose) console.log(`  ${t.toFixed(1)} s  OOB (${e.reason}) at s=${level.s.toFixed(1)} d=${level.d.toFixed(1)} y=${player.pos.y.toFixed(1)} → cairn ${level.checkpoint}`);
        t += 1.0; // fade out + in
        const s2 = level.spawnPoint();
        player.teleport(s2.pos, s2.yaw);
        bot.inKick = false;
      } else if (e.type === 'summit') summit = t;
      else if (e.type === 'beat') beats.push(e.beat.id);
      else if (e.type === 'collapse' && verbose) console.log(`  ${t.toFixed(1)} s  bridge collapses`);
    }
    level.events.length = 0;
    if (args.trace && Math.round(t / DT) % 12 === 0 && level.s > Number(args.trace)) console.log(`    t ${t.toFixed(1)} s ${level.s.toFixed(1)} d ${level.d.toFixed(2)} y ${player.pos.y.toFixed(2)} v ${player.vel.toArray().map((v) => v.toFixed(1))} ${player.state} g${+player.grounded} wall ${player.timers.wall.toFixed(2)} cmd ${JSON.stringify(c)}`);
    if (summit !== null && t > summit + 2) break; // walk on a little so the summit beats fire
    if (level.progress > lastProgress + 0.5) { lastProgress = level.progress; stallT = 0; } else stallT += DT;
    if (stallT > 25) {
      return { ok: false, t, secs, why: `stalled at s=${level.s.toFixed(1)} (${route.sections[level.section].name} +${(level.s - route.sections[level.section].s0).toFixed(1)}), d=${level.d.toFixed(1)}, pos ${player.pos.toArray().map((v) => v.toFixed(1)).join(',')}, state ${player.state}`, beats };
    }
    if (secs.reduce((a, s) => a + s.respawns, 0) > 12) return { ok: false, t, secs, why: 'too many respawns', beats };
  }
  return { ok: summit !== null, t: summit ?? t, secs, why: summit === null ? 'timeout' : '', beats };
}

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const from = Number(args.from ?? 0);
const run = playthrough({ from, verbose: !!args.verbose });
const checkpoints = props.cairns.filter((c) => c.checkpoint);
console.log(`\nterrain generated in ${(genMs / 1000).toFixed(1)} s; route ${route.length.toFixed(0)} m; ${props.cairns.length} cairns (${checkpoints.length} checkpoints)\n`);
console.log('| # | Section | Bot time | Respawns | Max speed |');
console.log('|---|---|---|---|---|');
run.secs.forEach((s, k) => {
  if (s.enter === null) return;
  const next = run.secs.slice(k + 1).find((x) => x.enter !== null);
  const dur = (next ? next.enter : run.t) - s.enter;
  s.dur = dur;
  console.log(`| ${k} | ${route.sections[k].name} | ${dur.toFixed(1)} s | ${s.respawns}${s.reasons.length ? ` (${s.reasons.join(', ')})` : ''} | ${s.maxSpeed.toFixed(1)} m/s |`);
});
if (!run.ok) failures.push(`playthrough failed: ${run.why}`);
else {
  // First-time estimate: a new player is slower than the bot's lines (×1.35), hesitates at each
  // new mechanic (~6 s in sections 1–7) and retries each hard section about once (cairn → failure point).
  // Checkpoints are sparse (DECISIONS #48), so a retry replays most of its section: chutes and
  // cave about half a retry, the ridge most of one, the couloir (slide-backs) more than one.
  const retry = { 3: 0.6, 4: 0.8, 5: 0.5, 7: 1.2 };
  let est = run.t * 1.35 + 7 * 6;
  for (const k in retry) est += (run.secs[k].dur ?? 0) * retry[k];
  console.log(`\nBot reached the summit in ${fmtT(run.t)} (${run.t.toFixed(1)} s).`);
  console.log(`Estimated first-time playthrough: ${fmtT(est)} (target ≈ 5–6 min).`);
  const allBeats = mountain.route.sections.flatMap((s) => (s.beats ?? []).map((b) => b.id));
  const missed = allBeats.filter((id) => !run.beats.includes(id));
  console.log(`Story trigger volumes entered: ${run.beats.length}/${allBeats.length}${missed.length ? ` (missed ${missed.join(', ')})` : ''}`);
  if (missed.length) failures.push(`story triggers never entered: ${missed.join(', ')}`);
  if (from === 0 && (est < 240 || est > 390)) failures.push(`first-time estimate ${fmtT(est)} outside 4:00–6:30`);
}

// Every cairn respawn: the player lands on solid ground, in bounds, and stays put.
if (!args.quick) {
  let bad = 0;
  props.cairns.forEach((c, i) => {
    if (!c.checkpoint) return;
    const { level, player } = makeRun();
    level.progress = c.s; level.checkpoint = i;
    const sp = level.spawnPoint(i);
    player.teleport(sp.pos, sp.yaw);
    let oob = false;
    for (let k = 0; k < 240; k++) {
      player.step(DT, { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, slideHeld: false }, 0);
      level.step(DT, player);
      if (level.events.some((e) => e.type === 'oob')) oob = true;
      level.events.length = 0;
    }
    const drift = Math.hypot(player.pos.x - sp.pos[0], player.pos.z - sp.pos[2]);
    if (oob || !player.grounded || drift > 1) { bad++; failures.push(`respawn at cairn ${i} (${c.name}) unstable: oob=${oob} grounded=${player.grounded} drift=${drift.toFixed(2)}`); }
  });
  console.log(`\nCairn respawns checked: ${checkpoints.length - bad}/${checkpoints.length} stable.`);
}

// Momentum gates: from a standstill, the recovery a player would find must work.
//   The Foot bank: back up onto the flat, run at it, jump at its foot.
//   Summit Push bank: walk back to the dip's rim, slide in.
function gateTest(k, startLs, jumpAtLs, slide, passLs, line = 0) {
  const { level, player } = makeRun();
  const sec = route.sections[k];
  const sp = route.at(sec.s0 + startLs);
  level.progress = sec.s0 + startLs;
  player.teleport([sp.x, mountain.heightfield.heightAt(sp.x, sp.z), sp.z], sp.yaw);
  for (let i = 0; i < 12 / DT; i++) {
    level.step(DT, player);
    level.events.length = 0;
    const ls = level.s - sec.s0, tgt = route.at(level.s + 6);
    const cmdNow = { moveX: 0, moveY: 1, sprintHeld: !slide, jumpPressed: jumpAtLs !== null && Math.abs(ls - jumpAtLs) < 0.1, jumpHeld: true, slideHeld: slide && ls > 14 };
    const tx = tgt.x + tgt.rx * line, tz = tgt.z + tgt.rz * line;
    player.step(DT, cmdNow, Math.atan2(-(tx - player.pos.x), -(tz - player.pos.z)));
    if (ls > passLs && player.grounded) return true;
    if (args.gatetrace && i % 24 === 0) console.log(`   g ${(i * DT).toFixed(1)} ls ${ls.toFixed(1)} d ${level.d.toFixed(1)} y ${player.pos.y.toFixed(2)} v ${player.speed.toFixed(1)} ${player.state} surf ${player.groundSurface} slope ${(player.slopeAngle * 57.3).toFixed(0)}`);
  }
  return false;
}
{
  const foot = route.sections.findIndex((x) => x.name === 'The Foot'), push = route.sections.findIndex((x) => x.name === 'Summit Push');
  const g = {
    'Foot bank, walking the rock edge': gateTest(foot, 120, null, false, 134, 6),
    'Foot bank, slide from the top of the slope': gateTest(foot, 82, null, true, 134),
    'Summit Push bank, walking the rock edge': gateTest(push, 26, null, false, 40, 4.5),
    'Summit Push bank, slide from the rim': gateTest(push, 12, null, true, 40),
  };
  console.log(`Momentum gates from rest: ${Object.entries(g).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join('; ')}`);
  for (const [k, v] of Object.entries(g)) if (!v) failures.push(`gate: ${k} fails`);
}

// Soft-lock sweep: drop the player at points across the corridor (bed, edges, shoulders) and let
// the bot play for 35 s. Each drop must either gain 12 m of route progress or be caught by the
// out-of-bounds check (which respawns at a cairn). Anything else is a potential soft-lock.
if (!args.quick) {
  const stuck = [];
  let drops = 0;
  const only = args.drop ? args.drop.split(',').map(Number) : null;
  for (let s = only ? only[0] : 10; s < route.length - 10; s += only ? 1e9 : 20) {
    const prof = route.profileAt(s), p = route.at(s);
    for (const d of only ? [only[1]] : [-(prof.w + 12), -prof.w, 0, prof.w, prof.w + 12]) {
      const x = p.x + p.rx * d, z = p.z + p.rz * d;
      const y = mountain.heightfield.heightAt(x, z);
      const seg = new THREE.Line3(new THREE.Vector3(x, y + 0.4, z), new THREE.Vector3(x, y + 1.4, z));
      if (colliders.collideCapsule(seg, 0.35, [])) continue; // inside a prop: not a reachable spot
      const { level, player } = makeRun();
      level.progress = s; level.s = s;
      level.checkpoint = Math.max(0, props.cairns.findLastIndex((c) => c.checkpoint && c.s <= s));
      player.teleport([x, mountain.heightfield.heightAt(x, z) + 0.05, z], p.yaw);
      const bot = new Bot(level, player);
      let ok = false, oob = false;
      for (let i = 0; i < 35 / DT && !ok; i++) {
        const { c, camYaw } = bot.command();
        player.vel.x += level.wind.x * DT; player.vel.z += level.wind.z * DT;
        player.step(DT, c, camYaw);
        player.events.length = 0;
        level.step(DT, player);
        if (level.events.some((e) => e.type === 'oob')) oob = true;
        level.events.length = 0;
        if (oob || level.progress > s + 12 || level.finished) ok = true;
        if (only && i % 30 === 0) console.log(`  t ${(i * DT).toFixed(1)} s ${level.s.toFixed(1)} d ${level.d.toFixed(1)} y ${player.pos.y.toFixed(1)} v ${player.speed.toFixed(1)} ${player.state} rec ${bot.recover?.kind ?? '-'} slide ${c.slideHeld}`);
      }
      drops++;
      if (!ok) stuck.push(`${route.section(s).name} +${(s - route.section(s).s0).toFixed(0)} d=${d.toFixed(0)} → stuck at s=${level.s.toFixed(0)} d=${level.d.toFixed(1)} (${player.state})`);
    }
  }
  console.log(`Soft-lock sweep: ${drops - stuck.length}/${drops} drops recovered.${stuck.length ? ` Not recovered by the bot (review):\n  ${stuck.join('\n  ')}` : ''}`);
  // The sweep bot is simple (no path-finding), so a few misses are bot limits, listed for review in
  // PROGRESS.md; more than that means the level regressed.
  if (stuck.length > 3) failures.push(`${stuck.length} drops the bot could not recover from (> 3)`);
}

console.log(failures.length ? `\nFAILED:\n- ${failures.join('\n- ')}` : '\nRoute completable; all checks passed.');
process.exitCode = failures.length ? 1 : 0;
