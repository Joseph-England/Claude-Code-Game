// The route (DESIGN §3): nine sections laid end to end along one centreline. Pure data; route.js
// turns it into a spline, terrain-gen.js carves it, levelstate.js runs its triggers.
//
// Per section:
//   len, turn     centreline length (m) and total heading change (deg, + = left), constant curvature
//   knots         [localS, absolute height] — linear, then smoothed over ~10 m
//                 ([s, h, 1] = hard knot: smoothing never crosses it, so two hard knots make a sharp
//                 step or kicker)
//   gaps          [localS, len, depth] crevasses cut after smoothing
//   profile       cross-section: { type, w (half-width of the walkable bed), ... }; `profiles` can
//                 override it for local ranges [s0, s1, profile]
//   surface       bed surface; `paint` overrides [s0, s1, surface, dMin?, dMax?] (d = signed lateral
//                 offset, + = right of travel)
//   cairns        checkpoints [localS, d]
//   beats         story trigger volumes (placeholder text; Phase 5 finishes): { at, id, text, voice }
//   oob           out-of-bounds rule: fall below routeH - below, above routeH + above, |d| > side
//   bot           hints for the automated playthrough: slide ranges, jumps, lateral line, kicks
import { SURFACE } from './surfaces.js';

const { PACKED, POWDER, ICE, ROCK } = SURFACE;

export const START = { x: -265, z: 235, yaw: 0 }; // yaw 0 = heading -z (north)

export const SECTIONS = [
  {
    name: 'Opening', len: 40, turn: 0,
    knots: [[0, 0], [40, 0]],
    profile: { type: 'trail', w: 7, shoulder: 18 },
    surface: PACKED,
    cairns: [[10, -4]],
    beats: [
      { at: 0, id: 1, voice: 'W', text: 'stay down. it\'s easier.' },
      { at: 3, id: 2, voice: 'Y', text: 'Get up.' },
      { at: 14, id: 3, voice: 'W', text: 'why bother. it\'s the same mountain every day.' },
    ],
    oob: { below: 12, side: 60 },
  },
  {
    name: 'The Foot', len: 160, turn: -38,
    // Rolling hills → a gentle 12° slope with a lone boulder at its foot (first slide) → a 1.9 m
    // bank too steep to walk (40°) that you crest with the slide's speed → climb.
    knots: [[0, 0], [20, 2.5], [40, 0.8], [60, 6], [75, 11], [118, 1.5], [130, 1.5, 1], [132.4, 3.1, 1], [160, 12]],
    profile: { type: 'trail', w: 8, shoulder: 22 },
    surface: PACKED,
    paint: [[128, 134, ROCK, 4.5, 99]], // rock grips to 55°: the walkers' way up the bank
    cairns: [[77, -5]],
    props: [{ type: 'boulder', at: 122, d: 9, r: 2.6 }],
    beats: [
      { at: 16, id: 4, voice: 'Y', text: 'One thing. Then the next thing.', note: 'Phase 5: on first jump' },
      { at: 80, id: 5, voice: 'W', text: 'downhill is always easy.', note: 'Phase 5: on first downhill slide' },
    ],
    oob: { below: 12, side: 60 },
    bot: { slide: [[77, 131]], edge: [118, 134, 6] }, // edge: walk the rock strip when too slow
  },
  {
    name: 'Powder Fields', len: 120, turn: -52,
    knots: [[0, 12], [120, 34]],
    profile: { type: 'basin', w: 26, shoulder: 26 },
    surface: POWDER,
    // A packed trail meanders up the basin (brighter; the fast line). trail(s) gives its offset.
    trail: { amp: 7, wave: 60, w: 1.6 },
    cairns: [[6, -6]],
    beats: [
      { at: 8, id: 6, voice: 'W', text: 'everything takes more than it should.' },
      { at: 30, id: 7, voice: 'Y', text: 'There\'s a way through. I just have to find it again. Every time.', note: 'Phase 5: first time on packed trail' },
      { at: 70, id: 8, voice: 'W', text: 'everyone else makes this look easy.', note: 'Phase 5: only if slow' },
    ],
    oob: { below: 12, side: 70 },
    bot: { line: 'trail' },
  },
  {
    name: 'Ice Chutes', len: 260, turn: -6,
    // Chute 1 (safe: high walls, run-out rises), a packed rise, chute 2, kicker, 7 m crevasse,
    // downslope landing, and a rise the speed carries you up.
    knots: [[0, 34], [12, 34], [90, 15], [104, 15], [122, 21], [132, 21], [188, 5], [194, 4.5, 1], [199.5, 5.8, 1], [206.5, 3, 1], [232, -4], [260, 8]],
    gaps: [[199.5, 7, 14]],
    profile: { type: 'pipe', w: 3, r: 7, depth: 6, shoulder: 16 },
    profiles: [[0, 12, { type: 'trail', w: 8, shoulder: 18 }], [186, 260, { type: 'trail', w: 11, shoulder: 18 }]],
    surface: ICE,
    paint: [[0, 12, PACKED], [92, 132, PACKED], [186, 199.5, PACKED], [206, 260, PACKED]],
    cairns: [[6, -6], [126, -2]],
    beats: [
      { at: 40, id: 9, voice: 'Y', text: 'Oh — I forgot what that felt like.', note: 'Phase 5: first time above sprint speed' },
      { at: 212, id: 10, voice: 'W', text: 'don\'t get used to it.', note: 'Phase 5: only after a failed launch' },
      { at: 245, id: 11, voice: 'Y', text: 'Speed doesn\'t last. But it carries.' },
    ],
    oob: { below: 7, side: 16 },
    bot: { slide: [[12, 199]], jump: [198.5] },
  },
  {
    name: 'Cornice Ridge', len: 140, turn: 80,
    knots: [[0, 8], [12, 10], [120, 44], [130, 46, 1], [140, 46, 1]],
    profile: { type: 'ridge', w: 3, drop: 48, shoulder: 40 },
    profiles: [[0, 12, { type: 'trail', w: 9, shoulder: 18 }]],
    surface: PACKED,
    paint: [[40, 50, ROCK], [80, 90, ROCK], [112, 120, ROCK]],
    cairns: [[8, -4]],
    // Gusts push toward +d (right of travel). Rock halves them. Telegraphed 0.8 s ahead.
    wind: { from: 22, to: 132, gust: 7, period: 5.5, dur: 1.3, warn: 0.8, rockScale: 0.35 },
    beats: [
      { at: 14, id: 12, voice: 'W', text: 'look how far there is to fall.' },
      { at: 40, id: 13, voice: 'W', text: 'you\'re too much. you\'ve always been too much.', note: 'Phase 5: on first strong gust' },
      { at: 50, id: 14, voice: 'Y', text: 'That\'s the wind. It always sounds like me.' },
      { at: 126, id: 15, voice: 'Y', text: 'The light\'s changing.' },
    ],
    oob: { below: 5, side: 30 },
  },
  {
    name: 'The Collapse', len: 110, turn: 36,
    // A snow bridge spans a slot in the ridge; it gives way under you and you fall 16 m into an ice
    // cave. A short sealed chimney teaches the wall-kick (2.2 m step: one kick); the exit is a 7 m kick chimney
    // up into daylight, then a ramp out.
    knots: [[0, 30, 1], [38, 31.2, 1], [38.3, 33.4, 1], [74, 34.5], [80, 35, 1], [80.3, 42, 1], [110, 49]],
    profile: { type: 'cave', w: 4.5, wall: 20, shoulder: 30, sharp: true },
    profiles: [[80, 110, { type: 'trail', w: 5, shoulder: 16 }]],
    surface: PACKED,
    paint: [[0, 80, ICE, -99, -3.5], [0, 80, ICE, 3.5, 99]],
    cairns: [[22, -3], [62, -3]],
    bridge: { from: -2, to: 24, w: 3.2, top: 46, collapseAt: 8 },
    // Chimneys (the Phase 2-verified layout): a back panel 3.5 m before the step face, entered
    // through a doorway at one side; kick between panel and face, top out on the step.
    slots: [
      { at: 38, gap: 3.5, wall: 4.5, door: 1, surface: ICE }, // teaching chimney: 2.2 m step, one kick
      { at: 80, gap: 3.5, wall: 11, door: -1, surface: ICE }, // exit chimney: 7 m step
    ],
    roof: { from: 22, to: 70 },
    beats: [
      { at: 8, id: 16, voice: 'W', text: 'there it is. you were doing so well.' },
      { at: 20, id: 17, voice: 'W', text: 'back at the bottom. like always.' },
      { at: 64, id: 18, voice: 'Y', text: 'I know this place. I\'ve climbed out of it before.' },
      { at: 95, id: 19, voice: 'Y', text: 'Falling isn\'t starting over. My legs remember the way.' },
    ],
    oob: { below: 8, above: 13, side: 14, aboveRange: [26, 75] },
    bot: { kick: [38, 80] },
    wallKick: true, // wall-kicks are enabled from here on (DESIGN §2)
  },
  {
    name: 'Whiteout', len: 110, turn: 70,
    knots: [[0, 49], [110, 62]],
    profile: { type: 'plateau', w: 20, bank: 8, shoulder: 30 },
    surface: POWDER,
    trail: { amp: 3, wave: 70, w: 1.4 },
    cairns: [[26, -4], [58, -4], [92, -4]], // A, B, C — "keep the stones on your left"
    wind: { from: 6, to: 106, head: 2.2 },
    whiteout: [8, 102],
    beats: [
      { at: 8, id: 20, voice: 'W', text: 'no one can see you in here.' },
      { at: 26, id: 21, voice: 'O', text: 'I stopped here too. It passed.', note: 'Phase 5: cairn A note' },
      { at: 38, id: 22, voice: 'Y', text: 'I\'m not the first one lost up here.' },
      { at: 58, id: 23, voice: 'O', text: 'Keep the stones on your left. Rest if you need to.', note: 'Phase 5: cairn B note' },
      { at: 92, id: 24, voice: 'O', text: 'You don\'t have to do this alone. I didn\'t.', note: 'Phase 5: cairn C note' },
      { at: 100, id: 25, voice: 'Y', text: 'I\'ll leave one too. For whoever\'s next.', note: 'Phase 5: add-a-stone beat' },
    ],
    oob: { below: 10, side: 34 },
    bot: { line: 'trail' },
  },
  {
    name: 'Summit Push', len: 140, turn: 45,
    // Storm clears. Slide into a dip and ride its speed up a 45° bank, climb rock steps, one
    // wall-kick slot, then the last snow slope.
    knots: [[0, 62], [12, 62], [28, 55], [34, 55, 1], [38, 59.2, 1], [46, 59.2], [76, 83], [82, 83], [90, 83, 1], [90.3, 87.4, 1], [125, 100], [140, 101]],
    profile: { type: 'trail', w: 6, shoulder: 18 },
    profiles: [[78, 94, { type: 'cave', w: 4.5, wall: 9, shoulder: 16 }]],
    surface: PACKED,
    paint: [[42, 90.3, ROCK], [32, 42, ROCK, 3, 99]], // incl. a rock edge up the bank for walkers
    cairns: [[6, -4], [78, -3]],
    slots: [{ at: 90, gap: 3.5, wall: 7, door: 1, surface: ROCK }],
    beats: [
      { at: 4, id: 26, voice: 'W', text: 'it\'ll be dark soon.' },
      { at: 8, id: 27, voice: 'Y', text: 'I know.' },
      { at: 66, id: 28, voice: 'W', text: 'you\'re so tired.' },
      { at: 72, id: 29, voice: 'Y', text: 'I\'m tired. I\'m still going.' },
    ],
    oob: { below: 12, side: 40 },
    bot: { slide: [[12, 42]], kick: [90], edge: [26, 42, 4.5] },
  },
  {
    name: 'Summit', len: 26, turn: 0,
    knots: [[0, 101], [26, 102]],
    profile: { type: 'summit', w: 11, drop: 60, shoulder: 40 },
    surface: PACKED,
    cairns: [[14, -3]],
    beats: [
      { at: 8, id: 30, voice: 'Y', text: 'I thought there\'d be something up here.' },
      { at: 16, id: 31, voice: 'W', text: 'there\'s always another one.', note: 'Phase 5: camera reveals ranges' },
      { at: 17, id: 32, voice: 'Y', text: 'Yeah. There is.' },
    ],
    summit: 18, // end trigger (local s): the spot where you sit
    oob: { below: 10, side: 40 },
  },
];
