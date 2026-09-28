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
//   cairns        [localS, d] checkpoints; [localS, d, 'note'] = a story cairn that is not a checkpoint
//   climb         { from, to, line: [[localS, d]…], w }: a rock line up a snow face (DECISIONS #48)
//   beats         inner-voice lines (final, DESIGN §1): { at, id, voice, text, when?, until?, after?, cairn? }
//                 fire on entering [at, at + 20] unless `when` names a condition, which is then
//                 armed from `at` to `until` (default: section end): input, jump, slow, fast,
//                 afoot (off the sled), cairn (reading note `cairn` of the section), stone, ending (scripted).
//                 `after: id` queues the line straight after that one; `fallback` fires a conditional
//                 line at the end of its stretch if its condition never came.
//   storm, horns  the gap's storm (storm.js) and the horns either side of it (terrain-gen.js)
//   oob           out-of-bounds rule: fall below routeH - below, above routeH + above, |d| > side
//   bot           hints for the automated playthrough: slide ranges, jumps, lateral line, rock edges
import { SURFACE } from './surfaces.js';

const { SNOW, POWDER, ICE, ROCK } = SURFACE;

export const START = { x: -265, z: 235, yaw: 0 }; // yaw 0 = heading -z (north)

export const SECTIONS = [
  {
    name: 'Opening', len: 40, turn: 0,
    knots: [[0, 0], [40, 0]],
    profile: { type: 'trail', w: 7, shoulder: 18 },
    surface: SNOW,
    cairns: [[10, -4]],
    beats: [
      { at: 0, id: 1, voice: 'W', text: 'stay down. it\'s easier.' },
      { at: 0, id: 2, voice: 'Y', text: 'Get up.', when: 'input' },
      // Point out the first cairn so it can't be missed (user playtest, Session 12; DECISIONS #97).
      { at: 0, id: 31, voice: 'Y', text: 'A cairn. Someone marked the way.', after: 2 },
    ],
    oob: { below: 12, side: 60 },
  },
  {
    name: 'The Foot', len: 160, turn: -38,
    // Rolling hills → a gentle 12° slope down to a lone boulder → the climb out. (The momentum
    // bank went with the boot-slide, DECISIONS #83: this is a walk.)
    knots: [[0, 0], [20, 2.5], [40, 0.8], [60, 6], [75, 11], [118, 1.5], [160, 12]],
    profile: { type: 'trail', w: 8, shoulder: 22 },
    surface: SNOW,
    props: [{ type: 'boulder', at: 122, d: 9, r: 2.6 }],
    beats: [
      { at: 8, id: 4, voice: 'Y', text: 'One thing. Then the next.', when: 'jump', until: 110, fallback: true },
    ],
    oob: { below: 12, side: 60 },
  },
  {
    name: 'Powder Fields', len: 120, turn: -52,
    knots: [[0, 12], [120, 34]],
    profile: { type: 'basin', w: 26, shoulder: 26 },
    surface: POWDER,
    // Deep snow the whole way across (no packed trail any more, DECISIONS #80): slower going.
    beats: [
      { at: 2, id: 5, voice: 'W', text: 'everything takes more than it should.' },
      // …and the sled, as the chutes come into view (before you reach it, never while riding).
      { at: 104, id: 32, voice: 'Y', text: 'Someone left a sled by that cairn.' },
    ],
    oob: { below: 12, side: 70 },
  },
  {
    name: 'Ice Chutes', len: 260, turn: -6,
    // Ridden on the sled that waits by the cairn (DECISIONS #83): chute 1 (high walls, the run-out
    // rises), a snow rise the speed carries you over, chute 2, the kicker and the 8.5 m crevasse —
    // the lip launches the sled on a fixed arc (`launch`), so a rider always clears it — a
    // downslope landing, and a rise into deep snow where the sled stops and you step off.
    knots: [[0, 34], [12, 34], [90, 15], [104, 15], [122, 21], [132, 21], [188, 5], [194, 4.5, 1], [199.5, 5.8, 1], [208, 3, 1], [232, -4], [260, 8]],
    gaps: [[199.5, 8.5, 14]],
    profile: { type: 'pipe', w: 3, r: 7, depth: 6, shoulder: 16 },
    profiles: [[0, 12, { type: 'trail', w: 8, shoulder: 18 }], [186, 260, { type: 'trail', w: 11, shoulder: 18 }]],
    surface: ICE,
    paint: [[0, 12, SNOW], [92, 132, SNOW], [186, 199.5, SNOW], [207.5, 238, SNOW], [238, 260, POWDER]],
    cairns: [[6, -6]],
    sled: { at: 11, d: 0 }, // where the sled waits (and returns to on a respawn before the end)
    launch: { at: 198.8, speed: 12.5, pitch: 0.26 }, // kicker lip: min speed (m/s) and pitch (rad)
    sledEnd: 232, // past here, the rider steps off once the sled has slowed
    beats: [
      // No words while you ride (user playtest, Session 8): the one line waits until you're off it.
      { at: 232, id: 8, voice: 'Y', text: 'Oh. I forgot what that felt like.', when: 'afoot', until: 300 },
    ],
    oob: { below: 7, side: 16 },
    bot: { sled: true },
  },
  {
    name: 'Cornice Ridge', len: 140, turn: 80,
    // Steps of climbing crest along a narrow snow catwalk, with rock outcrops before each step as
    // outcrops. No ice (DECISIONS #81) and no gusts any more (user playtest, DECISIONS #92): a walk
    // along a narrow crest with the drop on both sides.
    knots: [[0, 8], [12, 10], [34, 20, 1], [46, 20, 1], [70, 30, 1], [82, 30, 1], [104, 40, 1], [116, 40, 1], [128, 46, 1], [140, 46, 1]],
    profile: { type: 'ridge', w: 2.4, drop: 48, shoulder: 40 },
    profiles: [[0, 12, { type: 'trail', w: 9, shoulder: 18 }]],
    surface: SNOW,
    paint: [[26, 34, ROCK], [60, 70, ROCK], [94, 104, ROCK], [118, 124, ROCK]],
    cairns: [[8, -4]],
    beats: [], // no words on the ridge (DECISIONS #94)
    oob: { below: 5, side: 30 },
  },
  {
    name: 'The Descent', len: 130, turn: 36,
    // The ridge runs out. The only way on is down: a long packed slope into a sheltered hollow
    // (slide it, and the speed carries you part of the way up the far side), then the path climbs
    // out. Replaces the collapsing bridge and ice cave (user playtest, DECISIONS #61): going down
    // to get back up, not falling.
    knots: [[0, 46], [10, 46], [52, 24], [66, 22], [78, 23], [130, 49]],
    profile: { type: 'trail', w: 5, shoulder: 20 },
    profiles: [[52, 82, { type: 'basin', w: 12, shoulder: 22 }]],
    surface: SNOW,
    paint: [[56, 78, POWDER, -99, -5], [56, 78, POWDER, 5, 99]],
    cairns: [[70, -5]],
    beats: [
    ],
    oob: { below: 12, side: 40 },
  },
  {
    name: 'Whiteout', len: 165, turn: 70,
    // A col between two rock horns (DECISIONS #77): the wind is funnelled through the gap and
    // tears snow off the flanks, so the storm sits here and nowhere else — seen from the climb out
    // of the hollow, walked into, and still blowing behind you when you come out (storm.js).
    knots: [[0, 49], [165, 66]],
    profile: { type: 'col', w: 14 },
    // Rock peaks either side of the col: [localS, d, rise above the path] (terrain-gen, #89).
    horns: { peaks: [[45, -72, 36], [118, -62, 32], [178, -78, 24], [8, 76, 26], [80, 82, 40], [150, 70, 28]] },
    surface: POWDER,
    cairns: [[36, -4, 'note'], [86, -4, 'note'], [138, -4, 'note']], // A, B, C (spread out: user playtest) — "keep the stones on your left"
    storm: true,
    beats: [
      { at: 0, id: 18, voice: 'O', text: 'I stopped here too. It passed.', when: 'cairn', cairn: 0 },
      { at: 0, id: 19, voice: 'O', text: 'Keep the stones on your left. Rest if you need to.', when: 'cairn', cairn: 1 },
      { at: 0, id: 20, voice: 'O', text: 'You don\'t have to do this alone. I didn\'t.', when: 'cairn', cairn: 2 },
      { at: 0, id: 21, voice: 'Y', text: 'I\'ll leave one too. For whoever\'s next.', when: 'stone' },
    ],
    oob: { below: 10, side: 34 },
  },
  {
    name: 'Summit Push', len: 150, turn: 45,
    // The last climb is a walk (user playtest, DECISIONS #78): the storm thins behind you onto a
    // broad snow shoulder, which narrows into the summit ridge — a steady 20–25° pull with the sky
    // opening on both sides and the low sun ahead. No tricks at the end: just walking, slower as
    // it steepens, harder breathing, the view growing, the top coming into sight.
    knots: [[0, 62], [18, 64], [55, 78], [95, 97], [125, 109.5], [143, 114.5], [150, 116.5]],
    profile: { type: 'trail', w: 8, shoulder: 20 },
    profiles: [[52, 150, { type: 'ridge', w: 4, drop: 34, shoulder: 34, natural: true }]],
    surface: SNOW,
    cairns: [[6, -4]],
    beats: [
      { at: 66, id: 24, voice: 'W', text: 'you\'re so tired.' },
      { at: 66, id: 25, voice: 'Y', text: 'I\'m tired. I\'m still going.', after: 24 },
    ],
    oob: { below: 12, side: 40 },
  },
  {
    name: 'Summit', len: 26, turn: 0,
    knots: [[0, 116.5], [13, 121.5], [26, 118]], // a pointed top at 13 m
    profile: { type: 'summit', w: 3.5, drop: 60, shoulder: 40 }, // a narrow top on the pyramid (DECISIONS #89)
    surface: SNOW,
    cairns: [[16, -1.8, 'note']],
    beats: [
      { at: 0, id: 26, voice: 'Y', text: 'I thought there\'d be something up here.', when: 'ending' },
      { at: 0, id: 27, voice: 'W', text: 'there\'s always another one.', when: 'ending' },
      { at: 0, id: 28, voice: 'Y', text: 'Yeah. There is.', when: 'ending' },
      { at: 0, id: 29, voice: 'Y', text: 'The light stays on the peaks after the sun goes. I never noticed that.', when: 'ending' },
      { at: 0, id: 30, voice: 'Y', text: 'I\'m still here.', when: 'ending' },
    ],
    summit: 10, // end trigger (local s): the ending takes over and walks you to the viewpoint
    view: 13, // the very top
    oob: { below: 10, side: 40 },
  },
];
