// Procedural avatar (DESIGN §4 "Character", showcase #4): a small climber built in code from
// lathed and rounded shapes in a joint hierarchy, animated entirely in code.
//
// The figure (DECISIONS #82): a quilted down jacket (baffles in the lathe profile) with the hood
// rolled at the collar, a red knitted neck gaiter pulled up to the chin (it replaces the cloth
// scarf, which never behaved: user playtest), a beanie with a pompom and goggles pushed up on it,
// mittens, trousers with gaiters over leather boots on real ankles, and a pack with a lid, a
// front pocket, a foam mat strapped underneath, an ice axe on the back and shoulder straps over
// the chest.
//
// The walk (DECISIONS #74, #82): each foot is planted for its stance and stays where it landed
// while two-bone IK bends the leg over it; the foot itself rolls heel to toe — it strikes with the
// toes up, lies flat on the snow (following the slope under it), then peels up about the ball of
// the foot before it lifts and swings through with the toes pointing down, then up again. The
// pelvis shifts over the standing foot, drops a little on the swinging side and turns with the
// stride; the shoulders turn against it, the arms swing with the opposite foot, and the head stays
// level and looking ahead. Plus: a crouch for slipping on steep ground, a tuck in the air, a seat
// on the sled, a sitting pose (the get-up), lying in the snow, a reach to leave a stone, a stumble
// wobble. Standing still is still (DECISIONS #64). Lean is deliberately small (DECISIONS #50).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;
export const THIGH = 0.44, SHIN = 0.44, TORSO = 0.55;
export const ANKLE_H = 0.085; // ankle joint above the sole
const LEG = THIGH + SHIN - 0.01; // working leg length for the gait
const BALL = [0.13, ANKLE_H]; // ball of the foot relative to the ankle: [forward, down]
const HEEL = [0.06, ANKLE_H]; // heel contact relative to the ankle: [back, down]
export const SEAT_H = 0.34; // hips above the snow when sitting on the sled
const UPPER = 0.285, FORE = 0.275; // shoulder → elbow, elbow → centre of the mitten
const POLE = 1.08; // grip → tip
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _S = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// Pose parameters that blend smoothly between states (the gait adds on top). ankle: foot pitch
// relative to the shin (+ = toes up).
const POSES = {
  stand: { thigh: 0, knee: 0.04, torso: 0.03, armOut: 0.11, arm: 0.04, elbow: 0.22, head: 0, reach: 0, ankle: 0 },
  run: { thigh: 0, knee: 0.1, torso: 0.1, armOut: 0.11, arm: 0, elbow: 0.8, head: -0.05, reach: 0, ankle: 0 },
  slide: { thigh: 1.0, knee: 1.75, torso: 0.45, armOut: 0.85, arm: 0.35, elbow: 0.5, head: -0.3, reach: 0, ankle: 0.6 },
  air: { thigh: 0.55, knee: 1.0, torso: 0.2, armOut: 0.45, arm: 0.5, elbow: 0.6, head: -0.1, reach: 0, ankle: 0.2 },
  sit: { thigh: 2.2, knee: 2.3, torso: 0.3, armOut: 0.18, arm: 1.0, elbow: 0.95, head: 0.12, reach: 0, ankle: 0.3 },
  lie: { thigh: 0.9, knee: 1.4, torso: 0, armOut: 0.35, arm: 0.1, elbow: 0.2, head: -0.15, reach: 0, ankle: 0.1 },
  stone: { thigh: 1.2, knee: 2.0, torso: 0.7, armOut: 0.08, arm: 0.9, elbow: 0.3, head: -0.4, reach: 1, ankle: 0.5 },
  // On the sled: legs out in front, heels on the front bar, hands on the rope.
  sled: { thigh: 1.42, knee: 0.55, torso: -0.08, armOut: 0.3, arm: 0.95, elbow: 0.7, head: 0.08, reach: 0, ankle: -0.1 },
};
const KEYS = Object.keys(POSES.stand);

/**
 * Ankle position [forward, up] for a foot whose flat-sole reference point P sits on the ground at
 * (pf, pu) on a slope of angle sl (+ = rising ahead), rolled by rot: > 0 toes up, pivoting on the
 * heel; < 0 heel up, pivoting on the ball of the foot.
 */
function ankleAt(pf, pu, sl, rot) {
  const c = Math.cos(sl), s = Math.sin(sl), rotate = (f, u, a) => [f * Math.cos(a) - u * Math.sin(a), f * Math.sin(a) + u * Math.cos(a)];
  if (rot === 0) { const [f, u] = rotate(0, ANKLE_H, sl); return [pf + f, pu + u]; }
  const [cf, cu] = rot < 0 ? [BALL[0], 0] : [-HEEL[0], 0]; // pivot along the sole from P
  const px = pf + cf * c - cu * s, pz = pu + cf * s + cu * c;
  const [f, u] = rotate(-cf, ANKLE_H, sl + rot);
  return [px + f, pz + u];
}

/** A lathed profile [[r, y]…] around the y axis. */
const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), seg);
/** Profile with down-jacket baffles: r(y) plus a bulge every `pitch` metres between y0 and y1. */
function quilted(prof, y0, y1, pitch, bulge, n = 48) {
  const pts = [], ys = prof.map((p) => p[1]);
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const [r0, a] = prof[i - 1], [r1, b] = prof[i]; return r0 + ((r1 - r0) * (y - a)) / (b - a || 1); }
    return prof.at(-1)[0];
  };
  for (let i = 0; i <= n; i++) {
    const y = ys[0] + ((ys.at(-1) - ys[0]) * i) / n;
    const q = y > y0 && y < y1 ? bulge * Math.pow(Math.sin((Math.PI * (y - y0)) / pitch), 2) : 0;
    pts.push([rAt(y) + q, y]);
  }
  return pts;
}

/** Collects geometry per material for one joint and merges it into one mesh per material. */
class Part {
  constructor(group) { this.group = group; this.byMat = new Map(); }
  add(mat, geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    geo.applyMatrix4(m);
    if (geo.index) geo = geo.toNonIndexed(); // merge everything as plain triangles
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(geo);
    return this;
  }
  build() {
    for (const [mat, geos] of this.byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }
}

export class Avatar {
  constructor(scene, tuning) {
    this.t = tuning;
    const M = (color, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const mat = {
      jacket: M(0x2f6490, 0.66), jacketDark: M(0x1f4462, 0.75), trousers: M(0x2c2f3a, 0.85), gaiter: M(0x17181d, 0.7),
      skin: M(0xdcb49a, 0.6), knit: M(0xb52a22, 0.95), wool: M(0xd9cfb6, 0.95), boot: M(0x5a3b28, 0.62), sole: M(0x1b1714, 0.9),
      mitten: M(0x34373f, 0.85), pack: M(0x6a5f3a, 0.82), strap: M(0x24262a, 0.75), mat: M(0xc9a23a, 0.9),
      metal: M(0x9aa3ad, 0.3, { metalness: 0.8 }), lens: M(0xe0892c, 0.12, { metalness: 0.6 }), dark: M(0x15161a, 0.5),
    };
    this.mat = mat;
    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.root.add(this.lean);
    // hips: pelvis and everything above it (sways, drops and turns with the stride);
    // legBase: the legs' root at the same point, kept square so planted feet stay planted.
    this.hips = new THREE.Group();
    this.legBase = new THREE.Group();
    this.lean.add(this.hips, this.legBase);

    // Pelvis: the seat of the trousers.
    new Part(this.hips).add(mat.trousers, new THREE.SphereGeometry(0.165, 18, 12), { p: [0, -0.03, 0.005], s: [1, 0.72, 0.76] }).build();

    // Torso: quilted jacket, hem, rolled hood, neck gaiter, pack, straps, ice axe.
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const T = new Part(this.torso);
    const body = quilted([[0.172, -0.1], [0.178, -0.05], [0.168, 0.08], [0.176, 0.2], [0.19, 0.32], [0.19, 0.42], [0.175, 0.47], [0.13, 0.515], [0.08, 0.545], [0, 0.552]], 0.0, 0.46, 0.092, 0.007);
    T.add(mat.jacket, lathe(body, 24), { s: [0.96, 1, 0.74] });
    T.add(mat.jacketDark, new THREE.TorusGeometry(0.168, 0.018, 6, 24), { p: [0, -0.06, 0], r: [Math.PI / 2, 0, 0], s: [0.97, 0.74, 1] }); // hem band
    T.add(mat.jacketDark, new THREE.TorusGeometry(0.078, 0.034, 8, 16, Math.PI * 1.2), { p: [0, 0.52, 0.035], r: [Math.PI / 2, 0, -Math.PI * 0.1], s: [1.25, 1, 1] }); // hood, rolled at the back of the collar
    // Neck gaiter: a ribbed knit tube bunched on the collar, pulled up under the chin.
    const rib = [];
    for (let i = 0; i <= 14; i++) { const y = 0.5 + i * 0.011; rib.push([0.086 - 0.018 * smooth(0.5, 0.62, y) + 0.004 * Math.cos(i * 1.9) + 0.012 * (1 - smooth(0.5, 0.54, y)), y]); }
    rib.push([0.058, 0.66]);
    T.add(mat.knit, lathe(rib, 18), { s: [1, 1, 0.95] });
    // Pack: body, lid, front pocket, foam mat underneath with two straps, ice axe head-down.
    T.add(mat.pack, new RoundedBoxGeometry(0.3, 0.42, 0.17, 3, 0.06), { p: [0, 0.29, 0.22] });
    T.add(mat.pack, new RoundedBoxGeometry(0.29, 0.08, 0.2, 2, 0.035), { p: [0, 0.525, 0.215], r: [-0.1, 0, 0] });
    T.add(mat.pack, new RoundedBoxGeometry(0.2, 0.17, 0.05, 2, 0.02), { p: [0, 0.2, 0.315] });
    T.add(mat.strap, new THREE.BoxGeometry(0.02, 0.36, 0.012), { p: [-0.09, 0.3, 0.31] });
    T.add(mat.strap, new THREE.BoxGeometry(0.02, 0.36, 0.012), { p: [0.09, 0.3, 0.31] });
    T.add(mat.mat, new THREE.CylinderGeometry(0.06, 0.06, 0.34, 14), { p: [0, 0.055, 0.235], r: [0, 0, Math.PI / 2] });
    for (const x of [-0.1, 0.1]) T.add(mat.strap, new THREE.TorusGeometry(0.064, 0.008, 5, 14), { p: [x, 0.055, 0.235], r: [0, Math.PI / 2, 0] });
    T.add(mat.metal, new THREE.CylinderGeometry(0.011, 0.013, 0.5, 6), { p: [0.075, 0.3, 0.325], r: [0, 0, 0.12] });
    T.add(mat.metal, new THREE.BoxGeometry(0.18, 0.026, 0.018), { p: [0.1, 0.07, 0.325], r: [0, 0, 0.12] });
    T.add(mat.dark, new THREE.SphereGeometry(0.018, 6, 4), { p: [0.046, 0.54, 0.325] });
    // Shoulder straps: tubes over the shoulder and down the chest, and a sternum strap.
    for (const side of [-1, 1]) {
      const pts = [[0.1, 0.46, 0.2], [0.11, 0.53, 0.07], [0.115, 0.5, -0.075], [0.11, 0.38, -0.142], [0.115, 0.22, -0.135], [0.14, 0.1, -0.115], [0.16, 0.04, -0.06]]
        .map(([x, y, z]) => new THREE.Vector3(side * x, y, z));
      T.add(mat.strap, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.016, 5, false), { s: [1, 1, 1] });
    }
    T.add(mat.strap, new THREE.BoxGeometry(0.24, 0.018, 0.01), { p: [0, 0.34, -0.146] });
    T.build();

    // Head: face, nose, beanie with cuff and pompom, goggles pushed up on it.
    this.neck = new THREE.Group();
    this.neck.position.y = TORSO + 0.01;
    this.torso.add(this.neck);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const H = new Part(this.head);
    H.add(mat.skin, new THREE.SphereGeometry(0.105, 18, 14), { p: [0, 0.13, 0], s: [0.92, 1.05, 1] });
    H.add(mat.skin, new THREE.SphereGeometry(0.02, 8, 6), { p: [0, 0.115, -0.1], s: [0.9, 1, 1.1] });
    for (const x of [-0.034, 0.034]) H.add(mat.dark, new THREE.SphereGeometry(0.009, 6, 4), { p: [x, 0.14, -0.093] });
    H.add(mat.wool, lathe([[0.112, 0.12], [0.114, 0.17], [0.104, 0.215], [0.078, 0.252], [0.04, 0.27], [0, 0.275]], 18));
    H.add(mat.wool, new THREE.TorusGeometry(0.111, 0.021, 6, 18), { p: [0, 0.13, 0], r: [Math.PI / 2, 0, 0] });
    H.add(mat.knit, new THREE.SphereGeometry(0.042, 10, 8), { p: [0, 0.295, 0.01] });
    H.add(mat.dark, new THREE.TorusGeometry(0.117, 0.008, 4, 20), { p: [0, 0.178, 0], r: [Math.PI / 2 - 0.12, 0, 0] });
    H.add(mat.lens, new RoundedBoxGeometry(0.15, 0.048, 0.03, 2, 0.014), { p: [0, 0.19, -0.1], r: [-0.45, 0, 0] });
    H.build();

    // Arms: puffy upper arm and forearm (quilted), cuff, mitten with a thumb.
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.205, TORSO - 0.1, 0);
      this.torso.add(shoulder);
      const S = new Part(shoulder);
      S.add(mat.jacket, new THREE.SphereGeometry(0.07, 12, 10));
      S.add(mat.jacket, lathe(quilted([[0.054, -0.29], [0.056, -0.15], [0.062, -0.02], [0.045, 0.04]], -0.28, 0, 0.07, 0.004, 24), 14));
      S.build();
      const elbow = new THREE.Group();
      elbow.position.y = -0.285;
      shoulder.add(elbow);
      const E = new Part(elbow);
      E.add(mat.jacket, new THREE.SphereGeometry(0.052, 10, 8));
      E.add(mat.jacket, lathe(quilted([[0.046, -0.22], [0.05, -0.1], [0.052, 0]], -0.2, 0, 0.066, 0.003, 18), 14));
      E.add(mat.jacketDark, new THREE.CylinderGeometry(0.049, 0.049, 0.035, 12), { p: [0, -0.215, 0] });
      E.add(mat.mitten, new THREE.SphereGeometry(0.052, 10, 8), { p: [0, -0.275, -0.004], s: [0.78, 1.15, 1] });
      E.add(mat.mitten, new THREE.CapsuleGeometry(0.018, 0.04, 3, 6), { p: [-side * 0.02, -0.255, -0.035], r: [0.5, 0, -side * 0.5] });
      E.build();
      return { shoulder, elbow, side };
    });

    // Legs: thigh, knee, shin with a gaiter, and an ankle joint carrying the boot.
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.095, 0, 0);
      hip.rotation.order = 'ZYX'; // pitch in the leg's own plane first, then a little roll
      this.legBase.add(hip);
      new Part(hip).add(mat.trousers, lathe([[0.066, -THIGH - 0.01], [0.074, -0.3], [0.086, -0.12], [0.088, 0.0], [0.07, 0.04]], 14)).build();
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      const K = new Part(knee);
      K.add(mat.trousers, new THREE.SphereGeometry(0.066, 10, 8));
      K.add(mat.trousers, lathe([[0.056, -0.24], [0.06, -0.12], [0.064, 0]], 14));
      K.add(mat.gaiter, lathe([[0.062, -SHIN + 0.02], [0.068, -SHIN + 0.1], [0.066, -0.21], [0.062, -0.19]], 14));
      K.build();
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      const A = new Part(ankle);
      A.add(mat.boot, lathe([[0.058, -0.06], [0.061, 0.0], [0.063, 0.055], [0.06, 0.06]], 14));
      A.add(mat.boot, new THREE.CapsuleGeometry(0.046, 0.13, 4, 10), { p: [0, -0.038, -0.075], r: [Math.PI / 2, 0, 0], s: [1.18, 1, 0.92] });
      A.add(mat.boot, new THREE.SphereGeometry(0.052, 10, 8), { p: [0, -0.035, 0.035] });
      A.add(mat.sole, new RoundedBoxGeometry(0.108, 0.03, 0.3, 2, 0.012), { p: [0, -ANKLE_H + 0.015, -0.055] });
      A.add(mat.strap, new THREE.BoxGeometry(0.1, 0.012, 0.03), { p: [0, 0.01, -0.052], r: [0.4, 0, 0] }); // laces
      A.build();
      return { hip, knee, ankle, side };
    });
    // Trekking poles: grip, shaft, basket, tip. Each is placed in world space every frame, from the
    // mitten to where its tip is planted.
    this.poles = [-1, 1].map((side) => {
      const g = new THREE.Group(); // origin at the grip, the shaft down −y
      new Part(g)
        .add(mat.dark, new THREE.CylinderGeometry(0.017, 0.015, 0.13, 8), { p: [0, -0.03, 0] })
        .add(mat.metal, new THREE.CylinderGeometry(0.008, 0.0065, POLE - 0.09, 6), { p: [0, -0.09 - (POLE - 0.09) / 2, 0] })
        .add(mat.dark, new THREE.TorusGeometry(0.034, 0.005, 4, 12), { p: [0, -POLE + 0.08, 0], r: [Math.PI / 2, 0, 0] })
        .add(mat.metal, new THREE.ConeGeometry(0.006, 0.03, 5), { p: [0, -POLE + 0.015, 0], r: [Math.PI, 0, 0] })
        .build();
      scene.add(g);
      return { g, side, tip: new THREE.Vector3(), grip: new THREE.Vector3() };
    });
    scene.add(this.root);

    this.pose = { ...POSES.lie };
    this.phase = 0; // gait cycle 0…1 (left foot strikes at 0, right at 0.5)
    this.gait = 0; // 0 still … 1 moving
    this.ikW = 0; // 0 posed legs … 1 feet planted by IK
    this.prevYaw = 0;
    this.side = 0;
    this.fwd = 0;
    this.wake = 1; // 0 lying in the snow … 1 up (the opening sets 0 and animates it)
    this.reach = 0; // leaving a stone: 0 … 1 … 0 (driven by the game)
    this.admire = 0; // the ending: 0 … 1 lifts the head a little to the view
    this.seated = 0; // on the sled: 0 … 1 (driven by the game)
  }

  reset() { this.pelvis = undefined; }

  update(ctl, pos, alpha, dt) {
    const g = this.t.gravity, a = this.t.avatar;
    this.root.position.copy(pos);
    this.root.rotation.y = lerpAngle(ctl.prevFacing, ctl.facing, alpha);
    const state = ctl.state;
    const hs = Math.hypot(ctl.vel.x, ctl.vel.z);
    const k = 1 - Math.exp(-10 * dt);
    const seated = this.seated;

    // Target pose for the state, blended.
    let target = POSES.stand;
    if (seated > 0.5) target = POSES.sled;
    else if (state === 'slide' || state === 'stumble') target = POSES.slide;
    else if (state === 'air') target = ctl.jumpFromSlide ? POSES.slide : POSES.air;
    else if (state === 'sit') target = POSES.sit;
    else if (hs > 0.4) target = POSES.run;
    // Opening: lying → sitting → standing as `wake` goes 0 → 1.
    const up = smooth(0, 0.55, this.wake), stand = smooth(0.45, 1, this.wake);
    const P = this.pose;
    const kp = state === 'sit' || this.wake < 1 ? 1 - Math.exp(-4 * dt) : 1 - Math.exp(-12 * dt);
    for (const key of KEYS) {
      let want = target[key];
      if (this.wake < 1) want = lerp(lerp(POSES.lie[key], POSES.sit[key], up), target[key], stand);
      if (this.reach > 0) want = lerp(want, POSES.stone[key], this.reach);
      P[key] += (want - P[key]) * (this.wake < 1 ? 1 : kp);
    }

    // --- Legs. Cadence and stance share follow speed (brisk walk → sprint), feet lift higher in
    // powder, and turning on the spot is done in small steps.
    const yaw = this.root.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const hf = ctl.world?.heightfield;
    const onFoot = state === 'run' && ctl.grounded && this.wake >= 1 && seated < 0.01;
    this.ikW += ((onFoot ? 1 - this.reach : 0) - this.ikW) * (onFoot ? k : 1 - Math.exp(-18 * dt));
    let yawRate = Math.atan2(Math.sin(yaw - this.prevYaw), Math.cos(yaw - this.prevYaw)) / Math.max(dt, 1e-4);
    this.prevYaw = yaw;
    if (!onFoot) yawRate = 0;
    const run = smooth(5.5, 9, hs), moveW = onFoot ? smooth(0.15, 1, hs) : 0;
    const turnW = onFoot ? smooth(0.3, 1.2, Math.abs(yawRate)) * (1 - moveW) : 0;
    const powder = ctl.groundSurface === 1;
    const cadence = 1.9 + 0.32 * hs - (powder ? 0.2 : 0); // steps per second
    // Stance share of the cycle, chosen so a planted foot travels ±0.3–0.42 m about the hip: long
    // stances when slow (a walk), short ones with a flight phase when fast (a jog, a run).
    const reachFwd = lerp(0.3, 0.42, smooth(1, 9, hs));
    const duty = clamp((reachFwd * cadence) / Math.max(hs, 0.1), 0.22, 0.62);
    if (onFoot) this.phase = (this.phase + dt * (moveW * cadence * 0.5 + turnW * 1.1)) % 1;
    this.gait += (moveW - this.gait) * k;
    const A = moveW * (duty * hs) / cadence + turnW * 0.07; // planted-point travel either side of the hip
    const lift = moveW * (0.07 + 0.08 * run + (powder ? 0.1 : 0)) + turnW * 0.05;
    const n = ctl.groundNormal, uphill = clamp(-(n.x * fx + n.z * fz) / Math.max(n.y, 0.3), -0.6, 1);
    const g0 = hf ? hf.heightAt(pos.x, pos.z) : 0, onCollider = (ctl.heightAboveGround ?? 0) > 0.05;
    const peelMax = lerp(0.55, 0.8, run);
    // Going downhill the hips ride steadily lower (where the next heel strike will need them),
    // instead of dropping at every step.
    const ride = Math.min(LEG + ANKLE_H, ANKLE_H + Math.sqrt(LEG ** 2 - Math.min(A, 0.6) ** 2) + Math.min(0, uphill * A));
    let pelvis = ride - moveW * (0.02 + 0.04 * run) * (0.5 + 0.5 * Math.cos(4 * Math.PI * (this.phase - duty / 2)));
    // Ground under the foot's track (height relative to the hips' ground point, and slope along
    // the facing direction) at forward offset f.
    const track = (f, side) => {
      if (!hf || onCollider) return [uphill * f, Math.atan(uphill)];
      const x = pos.x + fx * f + rx * side * 0.1, z = pos.z + fz * f + rz * side * 0.1;
      const h = (dx) => hf.heightAt(x + fx * dx, z + fz * dx);
      return [clamp(h(0) - g0, -0.5, 0.5), Math.atan2(h(0.12) - h(-0.12), 0.24)];
    };
    const strike0 = 0.26 * moveW, peel0 = peelMax * moveW;
    for (const leg of this.legs) {
      const u = (this.phase + (leg.side > 0 ? 0.5 : 0)) % 1;
      // Per foot: the ankle's forward offset from the hip (af) and height (au), and the foot's
      // pitch (+ = toes up). A planted foot keeps its contact point P fixed on the snow while the
      // body passes over it: it strikes with the toes up (pivoting on the heel), lies flat on the
      // slope, then peels up about the ball of the foot, which carries the ankle up and forward.
      let af, au, pitch;
      if (u < duty) {
        const e = u / duty, pf = A * (1 - 2 * e);
        const strike = strike0 * Math.pow(1 - smooth(0, 0.22, e), 2);
        const peel = A > 0.01 ? peel0 * Math.pow(Math.max(0, (-pf / A - 0.25) / 0.75), 2) : 0;
        const [gh, sl] = track(pf, leg.side), rot = peel > 0 ? -peel : strike;
        [af, au] = ankleAt(pf, gh, sl, rot);
        pitch = sl + rot;
      } else {
        // Swing: from where toe-off left the ankle to where the next heel strike needs it, lifted
        // clear; the toes point down after toe-off, then come up to strike.
        const e = (u - duty) / (1 - duty), se = e * e * (3 - 2 * e);
        const [g0h, s0] = track(-A, leg.side), [g1h, s1] = track(A, leg.side);
        const [f0, u0] = ankleAt(-A, g0h, s0, -peel0), [f1, u1] = ankleAt(A, g1h, s1, strike0);
        af = lerp(f0, f1, se);
        const [gm] = track(af, leg.side);
        au = Math.max(lerp(u0, u1, se), gm + ANKLE_H) + lift * Math.sin(Math.PI * e);
        pitch = lerp(s0 - peel0, s1 + strike0, smooth(0.25, 1, e));
      }
      // Heel strike: the foot comes down at the start of its stance.
      if (onFoot && leg.prevU !== undefined && u < leg.prevU && (moveW > 0.3 || turnW > 0.3) && this.onFoot) {
        this.onFoot(pos.x + fx * A + rx * leg.side * 0.1, pos.z + fz * A + rz * leg.side * 0.1, ctl, leg.side, moveW < 0.3);
      }
      leg.prevU = u;
      leg.sx = af; leg.ay = au; leg.pitch = pitch; leg.stance = u < duty;
      // Only a planted foot holds the hips down; a swinging one just folds its knee.
      if (u < duty || moveW < 0.05) pelvis = Math.min(pelvis, au + Math.sqrt(Math.max(0, LEG ** 2 - af * af)));
    }
    // Drops at once (a planted foot must stay reachable), rises smoothly.
    this.pelvis = this.pelvis === undefined || pelvis < this.pelvis ? pelvis : this.pelvis + (pelvis - this.pelvis) * (1 - Math.exp(-25 * dt));

    // Pelvis motion with the stride: it shifts over the standing foot, drops on the swinging side
    // and turns so the forward leg's hip leads (less shift and more turn as the pace rises).
    const cyc = 2 * Math.PI * this.phase, walk = moveW * (1 - 0.6 * run);
    const sway = -0.026 * walk * Math.sin(cyc);
    const hipRoll = -0.05 * walk * Math.sin(cyc);
    const hipYaw = -(0.07 + 0.06 * run) * moveW * Math.cos(cyc) * this.ikW;
    // Lying: the hips tip back and rest on the snow.
    const tilt = 1.45 * (1 - up);
    let poseDrop = 0;
    const lean = -this.fwd;
    for (const leg of this.legs) {
      // Two-bone IK in the leg's plane: thigh angle from the hip toward the ankle plus the knee's
      // share; the knee bends forward. A little roll keeps the foot under its own track while the
      // pelvis sways over it.
      const down = this.pelvis - leg.ay;
      const D = clamp(Math.hypot(leg.sx, down), 0.2, THIGH + SHIN - 0.002);
      const bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
      const thigh = Math.atan2(leg.sx, down) + Math.acos(clamp((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
      leg.hip.rotation.x = lerp(P.thigh, thigh, this.ikW);
      leg.knee.rotation.x = lerp(-P.knee, -bend, this.ikW);
      leg.hip.rotation.z = Math.asin(clamp((leg.side * 0.005 - sway) / D, -0.2, 0.2)) * this.ikW;
      // The foot's world pitch minus everything above it in the chain.
      const chain = lean + tilt + leg.hip.rotation.x + leg.knee.rotation.x;
      leg.ankle.rotation.x = lerp(P.ankle, leg.pitch - chain, this.ikW);
      poseDrop = Math.max(poseDrop, THIGH * Math.cos(P.thigh) + SHIN * Math.cos(P.thigh - P.knee) + ANKLE_H);
    }
    this.hips.rotation.set(tilt, hipYaw, hipRoll);
    this.legBase.rotation.set(tilt, 0, 0);
    let hipsPose = state === 'air' && seated < 0.5 ? THIGH + SHIN - 0.1 : lerp(0.13, poseDrop, up);
    hipsPose = lerp(hipsPose, SEAT_H, seated);
    const hy = lerp(hipsPose, this.pelvis, this.ikW);
    this.hips.position.set(sway * this.ikW, hy, 0);
    this.legBase.position.set(sway * this.ikW, hy, 0);

    // Upper body: leans into a climb (and a little back going down), more when sprinting; the
    // spine keeps the shoulders level over the rolling pelvis and turns them against it; the
    // arms swing with the opposite foot; the head stays level and looks where you're going.
    const [L, Rl] = this.legs;
    const climb = clamp(uphill, -0.4, 0.9) * 0.32 * this.ikW * (0.4 + 0.6 * moveW);
    this.torso.rotation.set(-(P.torso + (0.02 + 0.12 * run) * this.gait + climb), -1.9 * hipYaw, -0.8 * hipRoll);
    this.head.rotation.set(-P.head * 0.6 + 0.06 * run + climb * 0.7 + 0.16 * this.admire, 0.9 * hipYaw, -0.2 * hipRoll);
    for (const arm of this.arms) {
      const opp = arm.side > 0 ? L : Rl;
      const swing = (opp.sx / 0.55) * (0.5 + 0.35 * run) * this.ikW;
      const reach = arm.side > 0 ? P.reach : 0; // the right hand places the stone
      arm.shoulder.rotation.set(P.arm + swing + reach * 0.5, 0, arm.side * (P.armOut + 0.04 * this.gait * Math.max(0, -swing)));
      arm.elbow.rotation.x = P.elbow + (0.3 + 0.6 * run) * this.gait * this.ikW + Math.max(0, swing) * 0.4 - reach * 0.2;
    }

    // Lean: small into turns (tan θ = a_lat/g, scaled), a little forward with acceleration.
    const latAcc = lerp(ctl.prevLean.y, ctl.lean.y, alpha);
    const fwdAcc = lerp(ctl.prevLean.x, ctl.lean.x, alpha);
    const carving = state === 'slide' || seated > 0.5;
    const maxSide = carving ? a.leanSlide : a.leanRun;
    const sideWant = ctl.grounded && hs > 2 ? clamp(Math.atan2(latAcc, g) * a.leanScale, -maxSide, maxSide) : 0;
    const fwdWant = ctl.grounded && hs > 1 && seated < 0.5 ? clamp(Math.atan2(fwdAcc, g) * 0.3, -0.12, 0.12) : 0;
    const kl = 1 - Math.exp(-6 * dt);
    this.side += (sideWant - this.side) * kl;
    this.fwd += (fwdWant - this.fwd) * kl;
    this.lean.rotation.set(-this.fwd, 0, -this.side, 'YXZ');
    if (state === 'stumble') this.lean.rotation.x += Math.sin(ctl.time * 40) * 0.12;

    // --- Poles. Walking, each pole is planted with the opposite foot (left pole, right foot),
    // outside the track, leaning back, and pushed as the body passes; the arm reaches its
    // grip by two-bone IK (the grip is the point a pole's length from the tip nearest the hand's
    // swing), so the arms are driven by the poles. Otherwise the poles hang from the mittens,
    // trailing a little; lying in the snow they lie beside you and are picked up as you get up.
    this.root.updateMatrixWorld(true);
    const hand = _w, fwdW = _b.set(fx, 0, fz), rightW = _n.set(rx, 0, rz);
    const lying = 1 - smooth(0.45, 0.85, this.wake);
    for (const pole of this.poles) {
      const arm = this.arms[pole.side < 0 ? 0 : 1], leg = this.legs[pole.side < 0 ? 1 : 0];
      arm.elbow.localToWorld(hand.set(0, -FORE, 0));
      let swingW = 0;
      if (this.ikW > 0.01) {
        const u = leg.prevU ?? 0;
        let tf, lift = 0;
        // The shaft leans back: the tip plants about under the hips and ends up well behind them.
        if (u < duty) tf = A * (1 - 2 * (u / duty)) - 0.28;
        else {
          const e = (u - duty) / (1 - duty);
          tf = -A - 0.28 + 2 * A * e * e * (3 - 2 * e);
          lift = 0.2 * Math.sin(Math.PI * e) * moveW;
          swingW = Math.pow(Math.sin(Math.PI * e), 0.7) * moveW; // mid-swing the pole just hangs from the hand
        }
        const tx = pos.x + fx * tf + rx * pole.side * 0.33, tz = pos.z + fz * tf + rz * pole.side * 0.33;
        pole.tip.set(tx, (hf && !onCollider ? hf.heightAt(tx, tz) : pos.y + uphill * tf) + lift, tz);
        pole.grip.subVectors(hand, pole.tip).normalize().multiplyScalar(POLE).add(pole.tip).lerp(hand, swingW);
        this.solveArm(arm, pole.grip, this.ikW, fwdW, rightW);
        arm.elbow.localToWorld(hand.set(0, -FORE, 0));
      }
      // The shaft: toward the planted tip when walking (never through the snow), hanging when not.
      _v.copy(DOWN).addScaledVector(fwdW, -0.35).addScaledVector(rightW, pole.side * 0.08).normalize();
      if (this.ikW > 0.01) {
        _x.subVectors(pole.tip, hand).normalize();
        const gy = hf && !onCollider ? hf.heightAt(hand.x + _x.x * POLE, hand.z + _x.z * POLE) : pole.tip.y;
        const minY = (gy + 0.02 - hand.y) / POLE;
        if (_x.y < minY && minY > -1) { const k = Math.sqrt(Math.max(0, 1 - minY * minY) / Math.max(1e-6, _x.x * _x.x + _x.z * _x.z)); _x.set(_x.x * k, minY, _x.z * k); }
        _v.lerp(_x, this.ikW).normalize();
      }
      let grip = hand;
      if (lying > 0) {
        // Beside the body in the snow, parallel to it.
        _y.set(pos.x + rx * pole.side * 0.62 + fx * 0.35, 0, pos.z + rz * pole.side * 0.62 + fz * 0.35);
        _y.y = (hf ? hf.heightAt(_y.x, _y.z) : pos.y) + 0.03;
        _z.copy(fwdW).multiplyScalar(-1).addScaledVector(DOWN, 0.02).normalize();
        grip = _S.lerpVectors(hand, _y, lying);
        _v.lerp(_z, lying).normalize();
      }
      pole.g.position.copy(grip);
      pole.g.quaternion.setFromUnitVectors(DOWN, _v);
    }
  }

  /**
   * Two-bone IK for an arm (shoulder → elbow → mitten) to a world target, blended over the posed
   * arm by w. The elbow points back and out; the forearm bends about the elbow's x axis.
   */
  solveArm(arm, target, w, fwdW, rightW) {
    const S = arm.shoulder.getWorldPosition(_S);
    const toT = _x.subVectors(target, S);
    const d = clamp(toT.length(), 0.15, UPPER + FORE - 0.002);
    toT.normalize();
    const a1 = Math.acos(clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1));
    const bend = Math.PI - Math.acos(clamp((UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE), -1, 1));
    const hint = _y.copy(fwdW).multiplyScalar(-1).addScaledVector(rightW, arm.side * 0.8).addScaledVector(DOWN, 0.3);
    const nrm = _z.crossVectors(toT, hint).normalize();
    const upper = hint.copy(toT).applyAxisAngle(nrm, a1); // (reuses _y)
    // The forearm bends toward the target, perpendicular to the upper arm.
    const elbow = _v.copy(S).addScaledVector(upper, UPPER);
    const fore = _S.copy(S).addScaledVector(toT, d).sub(elbow).normalize();
    const bdir = fore.addScaledVector(upper, -fore.dot(upper));
    if (bdir.lengthSq() < 1e-6) bdir.copy(nrm).cross(upper);
    bdir.normalize();
    // Shoulder basis in world space: −y along the upper arm, −z toward the bend.
    const yW = _y.copy(upper).negate(), zW = _v.copy(bdir).negate(), xW = _z.crossVectors(yW, zW);
    _m.makeBasis(xW, yW, zW);
    _q.setFromRotationMatrix(_m);
    arm.shoulder.parent.getWorldQuaternion(_qp);
    _q.premultiply(_qp.invert());
    arm.shoulder.quaternion.slerp(_q, w);
    arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, bend, w);
    arm.shoulder.updateMatrixWorld(true);
  }
}
