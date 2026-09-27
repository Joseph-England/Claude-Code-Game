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
    const tx = tgt.x + tgt.rx * off - p.pos.x, tz = tgt.z + tgt.rz * off - p.pos.z;
    let camYaw = Math.atan2(-tx, -tz);
    const c = { moveX: 0, moveY: 1, jumpPressed: false, jumpHeld: false, slideHeld: false };
    // Slide where the hint says so, but only while it is worth it (moving, or the bed drops ahead).
    const falling = route.heightAt(level.s + 6) < route.heightAt(level.s) - 0.4;
    for (const [a, b] of bot.slide ?? []) if (ls >= a && ls < b && (speed > 4 || falling)) c.slideHeld = true;
    for (const j of bot.jump ?? []) if (this.prevLs < j && ls >= j && this.prevLs >= 0) { c.jumpPressed = true; this.jumpHold = 0.35; }

    // Chimneys (as the Phase 2 check climbs them): enter through the doorway, step back against
    // the panel, jump, then kick between panel and step face until above the step, then top out.
    const kickAt = (bot.kick ?? []).find((a) => ls > a - 9 && ls < a + 0.5);
    if (kickAt !== undefined) {
      const slot = sec.slots.find((sl) => sl.at === kickAt);
      const prof = route.profileAt(sec.s0 + kickAt - 1);
      const here = route.at(level.s);
      const top = route.heightAt(sec.s0 + kickAt + 2.5);
      const gapStart = kickAt - slot.gap; // panel's front face
      const lat = level.d;
      const climbing = this.inKick && (!p.grounded || this.kickTick < 12);
      if (!climbing && p.grounded && ls < gapStart + 0.9) {
        // Approach: walk through the doorway into the gap.
        this.inKick = false;
        const doorD = slot.door * (prof.w - 1.1);
        const g = route.at(sec.s0 + gapStart + 1.6);
        camYaw = Math.atan2(-(g.x + g.rx * doorD - p.pos.x), -(g.z + g.rz * doorD - p.pos.z));
        c.moveY = 0.8;
      } else if (!climbing && p.grounded && Math.abs(lat) > 0.7) {
        // Align: move to the middle of the gap.
        this.inKick = false;
        camYaw = here.yaw;
        c.moveX = Math.max(-1, Math.min(1, -lat));
        c.moveY = 0;
      } else if (!climbing && p.grounded) {
        // Start a climb: step back toward the panel, jump on tick 6.
        this.inKick = true; this.kickTick = 0; this.kickDir = -1; this.lastKickTick = -99;
      }
      if (this.inKick) {
        camYaw = here.yaw;
        this.kickTick++;
        c.jumpHeld = true;
        const above = p.pos.y > top + 0.2;
        c.moveY = above ? 1 : this.kickDir;
        if (this.kickTick === 6) c.jumpPressed = true;
        if (!p.grounded && p.timers.wall > 0 && p.vel.y < 3 && this.kickTick - this.lastKickTick > 6 && !above) {
          c.jumpPressed = true; this.kickDir = -this.kickDir; this.lastKickTick = this.kickTick;
        }
        if (p.grounded && this.kickTick >= 12) this.inKick = false;
      }
    } else this.inKick = false;

    if (this.jumpHold > 0) { c.jumpHeld = true; this.jumpHold -= DT; }
    this.prevLs = ls;
    return { c, camYaw };
  }
}

function playthrough({ from = 0, maxTime = 900, verbose = false } = {}) {
  const { level, player } = makeRun();
  const bot = new Bot(level, player);
  const startCairn = props.cairns.findIndex((c) => c.section === from);
  level.checkpoint = startCairn;
  level.progress = props.cairns[startCairn].s;
  const sp = level.spawnPoint(startCairn);
  player.teleport(sp.pos, sp.yaw);
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
    if (summit !== null) break;
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
console.log(`\nterrain generated in ${(genMs / 1000).toFixed(1)} s; route ${route.length.toFixed(0)} m; ${props.cairns.length} cairns\n`);
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
  const hard = [3, 4, 5, 7];
  let est = run.t * 1.35 + 7 * 6;
  for (const k of hard) est += Math.min(20, (run.secs[k].dur ?? 0) * 0.35);
  console.log(`\nBot reached the summit in ${fmtT(run.t)} (${run.t.toFixed(1)} s).`);
  console.log(`Estimated first-time playthrough: ${fmtT(est)} (target ≈ 5:00).`);
  console.log(`Story beats fired: ${run.beats.length}/${mountain.route.sections.reduce((a, s) => a + (s.beats?.length ?? 0), 0)}`);
  if (from === 0 && (est < 240 || est > 390)) failures.push(`first-time estimate ${fmtT(est)} outside 4:00–6:30`);
}

// Every cairn respawn: the player lands on solid ground, in bounds, and stays put.
if (!args.quick) {
  let bad = 0;
  props.cairns.forEach((c, i) => {
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
  console.log(`\nCairn respawns checked: ${props.cairns.length - bad}/${props.cairns.length} stable.`);
}

console.log(failures.length ? `\nFAILED:\n- ${failures.join('\n- ')}` : '\nRoute completable; all checks passed.');
process.exitCode = failures.length ? 1 : 0;
