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
import { Story } from '../src/story/story.js';
import { ENDING_END } from '../src/story/ending.js';

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
  const story = new Story(route, props.cairns);
  return { level, player, story };
}

/** The bot: steer at a look-ahead point on the route. */
class Bot {
  constructor(level, player) {
    this.level = level; this.p = player;
    this.jumpHold = 0; this.prevLs = -1;
  }

  command() {
    const { level, p } = this;
    const sec = route.sections[level.section], ls = level.s - sec.s0, bot = sec.bot ?? {};
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const ahead = Math.min(22, 5 + 0.45 * speed);
    const sT = Math.min(route.length, level.s + ahead);
    const tgt = route.at(sT);
    let off = 0;
    // Story cairns: walk past close enough to read the note (a player keeps the stones on the left).
    const note = props.cairns.find((c) => !c.checkpoint && c.section === level.section && sT > c.s - 10 && sT < c.s + 3);
    if (note) off = -2.5;
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

    // Stuck recovery, as a player would try it: hop, then sidestep, then back off 25 m and come
    // again (sliding where the hints say) — the answer to a momentum gate. Back-off is 35 m.
    const blocked = p.grounded && speed < 1 && c.moveY > 0.5;
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
  const { level, player, story } = makeRun();
  const bot = new Bot(level, player);
  story.signal('input');
  const startS = from ? route.sections[from].s0 + 2 : props.cairns[0].s;
  level.checkpoint = Math.max(0, props.cairns.findLastIndex((c) => c.checkpoint && c.s <= startS + 20));
  level.progress = startS;
  if (from) { const p = route.at(startS); player.teleport([p.x, mountain.heightfield.heightAt(p.x, p.z), p.z], p.yaw); }
  else { const sp = level.spawnPoint(0); player.teleport(sp.pos, sp.yaw); }
  const secs = route.sections.map(() => ({ enter: null, respawns: 0, reasons: [], maxSpeed: 0 }));
  let lastProgress = level.progress, stallT = 0, t = 0, summit = null;
  const beats = [];
  lineTimes.length = 0;
  while (t < maxTime) {
    const { c, camYaw } = bot.command();
    player.vel.x += level.wind.x * DT;
    player.vel.z += level.wind.z * DT;
    player.step(DT, c, camYaw);
    if (player.events.some((e) => e.type === 'jump')) story.signal('jump');
    player.events.length = 0;
    level.step(DT, player);
    if (story.stoneReady) story.signal('stone');
    story.step(DT, level, player);
    for (const l of story.out) { beats.push(l.id); lineTimes.push([t, l]); }
    story.out.length = 0;
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
        story.respawned(route.sectionIndexAt(props.cairns[level.checkpoint].s));
      } else if (e.type === 'summit') summit = t;
    }
    level.events.length = 0;
    if (args.trace && Math.round(t / DT) % 12 === 0 && level.s > Number(args.trace)) console.log(`    t ${t.toFixed(1)} s ${level.s.toFixed(1)} d ${level.d.toFixed(2)} y ${player.pos.y.toFixed(2)} v ${player.vel.toArray().map((v) => v.toFixed(1))} ${player.state} g${+player.grounded} cmd ${JSON.stringify(c)}`);
    if (summit !== null && t > summit + 2) break; // walk on a little so the summit beats fire
    if (level.progress > lastProgress + 0.5) { lastProgress = level.progress; stallT = 0; } else stallT += DT;
    if (stallT > 25) {
      return { ok: false, t, secs, why: `stalled at s=${level.s.toFixed(1)} (${route.sections[level.section].name} +${(level.s - route.sections[level.section].s0).toFixed(1)}), d=${level.d.toFixed(1)}, pos ${player.pos.toArray().map((v) => v.toFixed(1)).join(',')}, state ${player.state}`, beats };
    }
    if (secs.reduce((a, s) => a + s.respawns, 0) > 12) return { ok: false, t, secs, why: 'too many respawns', beats };
  }
  return { ok: summit !== null, t: summit ?? t, secs, why: summit === null ? 'timeout' : '', beats };
}

const lineTimes = [];
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
  // Plus ~5 s standing at each of the three whiteout notes to read them.
  const retry = { 3: 0.6, 4: 0.8, 7: 1.2 };
  let est = run.t * 1.35 + 7 * 6 + 3 * 5;
  for (const k in retry) est += (run.secs[k].dur ?? 0) * retry[k];
  console.log(`\nBot reached the summit in ${fmtT(run.t)} (${run.t.toFixed(1)} s).`);
  console.log(`Estimated first-time playthrough: ${fmtT(est)} (target ≈ 5–6 min).`);
  // Every line fires except the scripted ending (the game runs it) and the two that depend on
  // struggling (slow in the powder, a retry in the chutes), which a clean run never triggers.
  const optional = new Set(['ending', 'slow', 'retry']);
  const allBeats = mountain.route.sections.flatMap((s) => (s.beats ?? []).filter((b) => !optional.has(b.when)).map((b) => b.id));
  const missed = allBeats.filter((id) => !run.beats.includes(id));
  console.log(`Story lines fired: ${allBeats.length - missed.length}/${allBeats.length} (+ ${run.beats.filter((id) => !allBeats.includes(id)).length} conditional)${missed.length ? ` (missed ${missed.join(', ')})` : ''}; order ${run.beats.join(' ')}`);
  if (missed.length) failures.push(`story lines never fired: ${missed.join(', ')}`);
  if (from === 0 && (est < 240 || est > 390)) failures.push(`first-time estimate ${fmtT(est)} outside 4:00–6:30`);
  // Title to credits: + the opening (lying, getting up: ~8 s) + the ending (ENDING_END).
  console.log(`Estimated title to credits: ${fmtT(est + 8 + ENDING_END)} (opening ~8 s, ending ${ENDING_END} s).`);
  // Line pacing at a first-time player's pace (trigger times scaled by estimate / bot time): replay
  // the narrator's timing model (src/story/narrator.js) and report how late each line appears
  // after its trigger. Notes are held while the player stands and reads (~5 s, included in `est`).
  const T = { W: [1.4, 1.6], Y: [0.8, 1.0], O: [0.9, 1.2] };
  let free = 0, prev = null, worst = [0, null];
  const rows = [];
  const pace = est / run.t;
  for (const [bt, l] of lineTimes) {
    // The bot gets up at once; a player lies there a few seconds, then the get-up takes 2.6 s.
    const at = l.id === 1 ? 0 : l.id === 2 ? 4 : 6.6 + bt * pace;
    const gap = prev ? (l.after === prev.id ? 0.3 : 1.2) : 0;
    const start = Math.max(at, free + gap), [fi, fo] = T[l.voice];
    const hold = Math.max(l.voice === 'O' ? 4.5 : 2.6, 2.2 + 0.055 * l.text.length);
    free = start + fi + hold + fo;
    prev = l;
    const late = start - at;
    // Answers (`after`) and the stone line wait for their predecessor by design.
    if (late > worst[0] && !l.after && l.when !== 'stone') worst = [late, l.id];
    rows.push(`${l.id}@${fmtT(at)}${late > 0.5 ? `+${late.toFixed(1)}` : ''}`);
  }
  console.log(`Line timing (first-time pace ×${pace.toFixed(2)}; +n = seconds late in the queue): ${rows.join(' ')}`);
  console.log(`Latest line: ${worst[1] ?? '-'} (${worst[0].toFixed(1)} s after its trigger).`);
  if (worst[0] > 6) failures.push(`line ${worst[1]} waits ${worst[0].toFixed(1)} s in the queue (lines too crowded)`);
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
  const foot = route.sections.findIndex((x) => x.name === 'The Foot');
  const g = {
    'Foot bank, walking the rock edge': gateTest(foot, 120, null, false, 134, 6),
    'Foot bank, slide from the top of the slope': gateTest(foot, 82, null, true, 134),
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
