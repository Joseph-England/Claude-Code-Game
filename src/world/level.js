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

export const START = { x: -340, z: 365, yaw: 0 }; // yaw 0 = heading -z (north)

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
    name: 'The Foot', len: 240, turn: -38,
    // Rolling hills → a gentle 12° slope with a lone boulder at its foot (first slide) → a 1.9 m
    // bank too steep to walk (40°) that you crest with the slide's speed → climb.
    knots: [[0, 0], [30, 2.5], [55, 0.5], [85, 6], [108, 5], [132, 12], [178, 2], [196, 2, 1], [198.2, 3.9, 1], [240, 16]],
    profile: { type: 'trail', w: 8, shoulder: 22 },
    surface: PACKED,
    cairns: [[134, -5]],
    props: [{ type: 'boulder', at: 186, d: 9, r: 2.6 }],
    beats: [
      { at: 20, id: 4, voice: 'Y', text: 'One thing. Then the next thing.', note: 'Phase 5: on first jump' },
      { at: 140, id: 5, voice: 'W', text: 'downhill is always easy.', note: 'Phase 5: on first downhill slide' },
    ],
    oob: { below: 12, side: 60 },
    bot: { slide: [[134, 197]] },
  },
  {
    name: 'Powder Fields', len: 200, turn: -52,
    knots: [[0, 16], [200, 50]],
    profile: { type: 'basin', w: 26, shoulder: 26 },
    surface: POWDER,
    // A packed trail meanders up the basin (brighter; the fast line). trail(s) gives its offset.
    trail: { amp: 9, wave: 90, w: 1.6 },
    cairns: [[6, -6]],
    beats: [
      { at: 8, id: 6, voice: 'W', text: 'everything takes more than it should.' },
      { at: 40, id: 7, voice: 'Y', text: 'There\'s a way through. I just have to find it again. Every time.', note: 'Phase 5: first time on packed trail' },
      { at: 110, id: 8, voice: 'W', text: 'everyone else makes this look easy.', note: 'Phase 5: only if slow' },
    ],
    oob: { below: 12, side: 70 },
    bot: { line: 'trail' },
  },
  {
    name: 'Ice Chutes', len: 260, turn: -6,
    // Chute 1 (safe: high walls, run-out rises), a packed rise, chute 2, kicker, 7 m crevasse,
    // downslope landing, and a rise the speed carries you up.
    knots: [[0, 50], [12, 50], [90, 31], [104, 31], [122, 37], [132, 37], [188, 21], [194, 20.5, 1], [199.5, 21.8, 1], [206.5, 19, 1], [232, 12], [260, 24]],
    gaps: [[199.5, 7, 14]],
    profile: { type: 'pipe', w: 3, r: 7, depth: 6, shoulder: 16 },
    profiles: [[0, 12, { type: 'trail', w: 8, shoulder: 18 }], [186, 260, { type: 'trail', w: 11, shoulder: 18 }]],
    surface: ICE,
    paint: [[0, 12, PACKED], [92, 132, PACKED], [206, 260, PACKED]],
    cairns: [[6, -6], [126, -2]],
    beats: [
      { at: 40, id: 9, voice: 'Y', text: 'Oh — I forgot what that felt like.', note: 'Phase 5: first time above sprint speed' },
      { at: 212, id: 10, voice: 'W', text: 'don\'t get used to it.', note: 'Phase 5: only after a failed launch' },
      { at: 245, id: 11, voice: 'Y', text: 'Speed doesn\'t last. But it carries.' },
    ],
    oob: { below: 7, side: 50 },
    bot: { slide: [[12, 199]], jump: [198.5] },
  },
  {
    name: 'Cornice Ridge', len: 220, turn: 80,
    knots: [[0, 24], [16, 26], [200, 78], [220, 80]],
    profile: { type: 'ridge', w: 3, drop: 48, shoulder: 40 },
    profiles: [[0, 12, { type: 'trail', w: 9, shoulder: 18 }]],
    surface: PACKED,
    paint: [[62, 76, ROCK], [128, 142, ROCK], [180, 190, ROCK]],
    cairns: [[8, -4]],
    // Gusts push toward +d (right of travel). Rock halves them. Telegraphed 0.8 s ahead.
    wind: { from: 30, to: 205, gust: 7, period: 5.5, dur: 1.3, warn: 0.8, rockScale: 0.35 },
    beats: [
      { at: 14, id: 12, voice: 'W', text: 'look how far there is to fall.' },
      { at: 60, id: 13, voice: 'W', text: 'you\'re too much. you\'ve always been too much.', note: 'Phase 5: on first strong gust' },
      { at: 72, id: 14, voice: 'Y', text: 'That\'s the wind. It always sounds like me.' },
      { at: 200, id: 15, voice: 'Y', text: 'The light\'s changing.' },
    ],
    oob: { below: 5, side: 30 },
  },
  {
    name: 'The Collapse', len: 160, turn: 36,
    // A snow bridge spans a slot in the ridge; it gives way under you and you fall 16 m into an ice
    // cave. A short sealed slot teaches the wall-kick (2.6 m step); the exit is a 7 m kick chimney
    // up into daylight, then a ramp out.
    knots: [[0, 64], [60, 66, 1], [60.3, 68.6, 1], [112, 69.5], [124, 70, 1], [124.3, 77, 1], [160, 86]],
    profile: { type: 'cave', w: 4.5, wall: 20, shoulder: 30, sharp: true },
    profiles: [[124, 160, { type: 'trail', w: 5, shoulder: 16 }]],
    surface: PACKED,
    paint: [[0, 124, ICE, -99, -3.5], [0, 124, ICE, 3.5, 99]],
    cairns: [[30, 0], [96, 0]],
    bridge: { from: -2, to: 24, w: 3.2, top: 80, collapseAt: 8 },
    slots: [
      { from: 52, to: 60, gap: 3.5, wall: 7, surface: ICE }, // teaching slot, step 2.6 m at 60
      { from: 114, to: 124, gap: 3.5, wall: 12, surface: ICE }, // exit chimney, step 7 m at 124
    ],
    roof: { from: 22, to: 112 },
    beats: [
      { at: 8, id: 16, voice: 'W', text: 'there it is. you were doing so well.' },
      { at: 22, id: 17, voice: 'W', text: 'back at the bottom. like always.' },
      { at: 104, id: 18, voice: 'Y', text: 'I know this place. I\'ve climbed out of it before.' },
      { at: 140, id: 19, voice: 'Y', text: 'Falling isn\'t starting over. My legs remember the way.' },
    ],
    oob: { below: 8, above: 13, side: 14, aboveRange: [26, 118] },
    bot: { kick: [[50, 60], [112, 124]] },
    wallKick: true, // wall-kicks are enabled from here on (DESIGN §2)
  },
  {
    name: 'Whiteout', len: 180, turn: 70,
    knots: [[0, 86], [180, 106]],
    profile: { type: 'plateau', w: 20, bank: 8, shoulder: 30 },
    surface: POWDER,
    trail: { amp: 3, wave: 70, w: 1.4 },
    cairns: [[42, -4], [96, -4], [150, -4]], // A, B, C — "keep the stones on your left"
    wind: { from: 6, to: 176, head: 2.2 },
    whiteout: [10, 172],
    beats: [
      { at: 10, id: 20, voice: 'W', text: 'no one can see you in here.' },
      { at: 42, id: 21, voice: 'O', text: 'I stopped here too. It passed.', note: 'Phase 5: cairn A note' },
      { at: 60, id: 22, voice: 'Y', text: 'I\'m not the first one lost up here.' },
      { at: 96, id: 23, voice: 'O', text: 'Keep the stones on your left. Rest if you need to.', note: 'Phase 5: cairn B note' },
      { at: 150, id: 24, voice: 'O', text: 'You don\'t have to do this alone. I didn\'t.', note: 'Phase 5: cairn C note' },
      { at: 160, id: 25, voice: 'Y', text: 'I\'ll leave one too. For whoever\'s next.', note: 'Phase 5: add-a-stone beat' },
    ],
    oob: { below: 10, side: 34 },
    bot: { line: 'trail' },
  },
  {
    name: 'Summit Push', len: 160, turn: 45,
    // Storm clears. Slide into a dip and ride its speed up a 45° bank, climb rock steps, one
    // wall-kick slot, then the last snow slope.
    knots: [[0, 106], [14, 106], [30, 99], [36, 99, 1], [40, 103.2, 1], [48, 103.2], [78, 127], [84, 127], [92, 127, 1], [92.3, 131.4, 1], [140, 148], [160, 149]],
    profile: { type: 'trail', w: 6, shoulder: 18 },
    profiles: [[80, 96, { type: 'cave', w: 4.5, wall: 9, shoulder: 16 }]],
    surface: PACKED,
    paint: [[44, 92.3, ROCK]],
    cairns: [[8, -4], [80, -3]],
    slots: [{ from: 84, to: 92, gap: 3.5, wall: 8, surface: ROCK }],
    beats: [
      { at: 4, id: 26, voice: 'W', text: 'it\'ll be dark soon.' },
      { at: 8, id: 27, voice: 'Y', text: 'I know.' },
      { at: 70, id: 28, voice: 'W', text: 'you\'re so tired.' },
      { at: 76, id: 29, voice: 'Y', text: 'I\'m tired. I\'m still going.' },
    ],
    oob: { below: 12, side: 40 },
    bot: { slide: [[14, 44]], kick: [[82, 92]] },
  },
  {
    name: 'Summit', len: 26, turn: 0,
    knots: [[0, 149], [26, 150]],
    profile: { type: 'summit', w: 11, drop: 60, shoulder: 40 },
    surface: PACKED,
    cairns: [[20, 0]],
    beats: [
      { at: 8, id: 30, voice: 'Y', text: 'I thought there\'d be something up here.' },
      { at: 18, id: 31, voice: 'W', text: 'there\'s always another one.', note: 'Phase 5: camera reveals ranges' },
      { at: 20, id: 32, voice: 'Y', text: 'Yeah. There is.' },
    ],
    summit: 20, // end trigger (local s)
    oob: { below: 10, side: 40 },
  },
];
