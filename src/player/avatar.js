// Procedural avatar (DESIGN §4 "Character", showcase #4): a small climber built in code from
// lathed and rounded shapes in a joint hierarchy, animated entirely in code.
//
// The figure (DECISIONS #82, #98): a quilted down jacket (baffles in the lathe profile) with the
// hood rolled at the collar, a red knitted neck gaiter pulled up to the chin, a face with eyes,
// brows, nose and ears under a beanie (cuff above the brows, pompom, goggles pushed up with the
// strap lying on the knit), mittens, insulated trousers, gaiters over lofted leather mountain boots
// on real ankles, and a pack with a lid, a front pocket, a foam mat, an ice axe and shoulder straps.
//
// Locomotion (DECISIONS #98): the feet live in world space. A planted foot stays exactly where it
// landed (zero slip, on any slope) while 3D two-bone IK bends the leg over it; it rolls heel to
// toe (heel strike while ahead of the hips, flat, the heel peeling up about the ball once behind),
// and a fast turn on the spot pivots it on the ball. A swinging foot follows a Hermite curve
// relative to the hips that leaves and meets the snow at the snow's speed, to where the body will
// be at touchdown. Walking below ~2 m/s (long stance, no flight, the hips highest over the
// standing foot — an inverted pendulum), running above ~3 m/s (short contact, a flight phase, the
// knees giving mid-stance, a heel kick behind, forward lean, arms bent), cadence and stride from
// human data. Stopping or turning on the spot takes settling steps until the feet are back under
// the hips. Poles: planted with the opposite foot when walking (the arms reach them by IK), carried
// trailing back when running. Plus: a knee dip on landing, a crouch for slipping on steep ground, a
// tuck in the air, a seat on the sled, lying in the snow and getting up over planted feet, turning
// to a cairn and reaching up to leave a stone, a stumble wobble, and a slow breath when standing
// (quicker after running). Lean is deliberately small (DECISIONS #50).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;
export const THIGH = 0.44, SHIN = 0.44, TORSO = 0.55;
export const ANKLE_H = 0.088; // ankle joint above the sole
export const BALL_F = 0.135, HEEL_B = 0.065; // ball of the foot ahead of / heel contact behind the ankle
const LEG = THIGH + SHIN - 0.01; // working leg length for the gait
export const SEAT_H = 0.38; // hips above the snow when sitting on the sled
const UPPER = 0.285, FORE = 0.275; // shoulder → elbow, elbow → centre of the mitten
const POLE = 1.08; // grip → tip
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _S = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0), _qy = new THREE.Quaternion();
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _md = new THREE.Vector3(), _hd = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e = new THREE.Euler();

// Pose parameters that blend smoothly between states (the gait adds on top). ankle: foot pitch
// relative to the shin (+ = toes up).
const POSES = {
  stand: { thigh: 0, knee: 0.04, torso: 0.03, armOut: 0.11, arm: 0.04, elbow: 0.22, head: 0, reach: 0, ankle: 0 },
  run: { thigh: 0, knee: 0.1, torso: 0.03, armOut: 0.11, arm: 0, elbow: 0.4, head: -0.05, reach: 0, ankle: 0 },
  slide: { thigh: 1.0, knee: 1.75, torso: 0.45, armOut: 0.85, arm: 0.35, elbow: 0.5, head: -0.3, reach: 0, ankle: 0.6 },
  air: { thigh: 0.55, knee: 1.0, torso: 0.2, armOut: 0.45, arm: 0.5, elbow: 0.6, head: -0.1, reach: 0, ankle: 0.2 },
  sit: { thigh: 2.2, knee: 2.3, torso: 0.3, armOut: 0.18, arm: 1.0, elbow: 0.95, head: 0.12, reach: 0, ankle: 0.3 },
  lie: { thigh: 0.9, knee: 1.4, torso: 0, armOut: 0.35, arm: 0.1, elbow: 0.2, head: -0.15, reach: 0, ankle: 0.1 },
  stone: { thigh: 1.2, knee: 2.0, torso: 0.7, armOut: 0.08, arm: 0.9, elbow: 0.3, head: -0.4, reach: 1, ankle: 0.5 },
  // On the sled: legs out in front, heels on the front bar, hands on the rope.
  sled: { thigh: 1.42, knee: 0.55, torso: -0.04, armOut: 0.32, arm: 0.72, elbow: 0.4, head: 0.08, reach: 0, ankle: -0.1 },
};
const KEYS = Object.keys(POSES.stand);

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

/**
 * A mountain boot around the ankle joint (origin), toes toward −z, sole at y = −ANKLE_H: an
 * extruded rubber sole with a welt, and a leather upper lofted through four rings from the sole's
 * outline up to a padded collar round the ankle, so the toe box, instep and heel counter read as
 * one shape. Returns { sole, upper, collar }.
 */
function bootGeometry() {
  // Right half of the sole outline [x, forward] from the heel round to the toe; mirrored.
  const half = [[0, -0.083], [0.03, -0.078], [0.043, -0.055], [0.044, -0.02], [0.047, 0.03], [0.053, 0.085], [0.055, 0.12], [0.05, 0.16], [0.037, 0.19], [0.018, 0.206], [0, 0.21]];
  const pts = [...half, ...half.slice(1, -1).reverse().map(([x, f]) => [-x, f])].map(([x, f]) => new THREE.Vector2(x, f));
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  shape.splineThru([...pts.slice(1), pts[0]]);
  const sole = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 2, curveSegments: 5 });
  sole.rotateX(-Math.PI / 2).translate(0, -ANKLE_H + 0.004, 0); // forward (shape y) → −z, depth → up
  // Upper: rings sampled at the same parameter around the outline.
  const N = 40, outline = shape.getSpacedPoints(N).slice(0, N);
  const y0 = -ANKLE_H + 0.026, collarC = [0, 0.05, 0.004], collarR = 0.057;
  const ring = (k, i) => {
    const o = outline[i], f = o.y, x = o.x, ang = Math.atan2(x, f + 0.02); // angle about a point under the instep
    const cx = collarC[0] + Math.sin(ang) * collarR, cz = collarC[2] - Math.cos(ang) * collarR * 0.9;
    const fore = smooth(0.0, 0.12, f); // 0 heel … 1 toe
    if (k === 0) return [x * 0.965, y0, -f * 0.975];
    if (k === 1) return [x * 0.97, y0 + 0.03 + 0.008 * (1 - fore), -f * 0.965]; // bulging sides and toe box
    if (k === 2) { // the top of the toe box / instep, rising steeply at the heel counter
      const t = 0.25 + 0.55 * (1 - fore);
      return [lerp(x * 0.9, cx, t), lerp(y0 + 0.062, collarC[1] - 0.012, t * t), lerp(-f * 0.93, cz, t)];
    }
    return [cx, collarC[1] + 0.008 * Math.cos(ang), cz]; // the collar, a little higher at the back
  };
  const rows = [0, 1, 2, 3], R = 10, verts = [];
  for (let r = 0; r <= R; r++) {
    const v = (r / R) * (rows.length - 1), k = Math.min(rows.length - 2, Math.floor(v)), t = v - k;
    for (let i = 0; i < N; i++) {
      // Catmull-Rom through the rings (clamped at the ends).
      const P = [Math.max(0, k - 1), k, k + 1, Math.min(3, k + 2)].map((kk) => ring(kk, i));
      const c = [0, 1, 2].map((d) => 0.5 * ((2 * P[1][d]) + (-P[0][d] + P[2][d]) * t + (2 * P[0][d] - 5 * P[1][d] + 4 * P[2][d] - P[3][d]) * t * t + (-P[0][d] + 3 * P[1][d] - 3 * P[2][d] + P[3][d]) * t * t * t));
      verts.push(...c);
    }
  }
  const idx = [];
  for (let r = 0; r < R; r++) for (let i = 0; i < N; i++) {
    const a = r * N + i, b = r * N + ((i + 1) % N), c = a + N, d = b + N;
    idx.push(a, b, c, b, d, c);
  }
  const upper = new THREE.BufferGeometry();
  upper.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  upper.setIndex(idx);
  upper.computeVertexNormals();
  // A padded collar ring and a cap over the opening (under the gaiter).
  const collar = new THREE.TorusGeometry(collarR, 0.011, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(collarC[0], collarC[1] + 0.004, collarC[2]);
  return { sole, upper, collar };
}

/**
 * Collects the geometry of one joint (a bone), coloured per part. At the end of the constructor all
 * parts are merged into a single rigidly skinned mesh: one draw call per pass for the whole figure
 * (per-joint meshes cost ~100 draw calls with the shadow cascades).
 */
class Part {
  constructor(bone, sink) { this.bone = bone; this.sink = sink; this.geos = []; }
  add(mat, geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    geo.applyMatrix4(m);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([mat.r, mat.g, mat.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(geo);
    return this;
  }
  build() { this.sink.push(this); }
}

export class Avatar {
  constructor(scene, tuning) {
    this.t = tuning;
    const M = (color) => new THREE.Color(color); // colours, not materials: everything shares one skinned mesh
    const mat = {
      jacket: M(0x2f6490, 0.66), jacketDark: M(0x1f4462, 0.75), trousers: M(0x414a5a, 0.85), gaiter: M(0x191a1f, 0.7),
      skin: M(0xdcb49a, 0.6), knit: M(0xb52a22, 0.95), wool: M(0xd9cfb6, 0.95), boot: M(0x6b4630, 0.62), bootDark: M(0x3a261a), sole: M(0x1b1714, 0.9),
      mitten: M(0x34373f, 0.85), pack: M(0x6a5f3a, 0.82), strap: M(0x24262a, 0.75), mat: M(0xc9a23a, 0.9),
      metal: M(0x9aa3ad, 0.3, { metalness: 0.8 }), lens: M(0xe0892c, 0.12, { metalness: 0.6 }), dark: M(0x15161a, 0.5), brow: M(0x4a3426), hair: M(0x3b2a1e),
    };
    const parts = [];
    this.root = new THREE.Group();
    this.lean = new THREE.Bone();
    this.root.add(this.lean);
    // hips: pelvis and everything above it (sways, drops and turns with the stride);
    // legBase: the legs' root at the same point, kept square so planted feet stay planted.
    this.hips = new THREE.Bone();
    this.legBase = new THREE.Bone();
    this.lean.add(this.hips, this.legBase);

    // Pelvis: the seat of the trousers.
    new Part(this.hips, parts).add(mat.trousers, new THREE.SphereGeometry(0.165, 12, 8), { p: [0, -0.03, 0.005], s: [1, 0.72, 0.76] }).build();

    // Torso: quilted jacket, hem, rolled hood, neck gaiter, pack, straps, ice axe.
    this.torso = new THREE.Bone();
    this.hips.add(this.torso);
    const T = new Part(this.torso, parts);
    const body = quilted([[0.172, -0.1], [0.178, -0.05], [0.168, 0.08], [0.176, 0.2], [0.19, 0.32], [0.19, 0.42], [0.175, 0.47], [0.13, 0.515], [0.08, 0.545], [0, 0.552]], 0.0, 0.46, 0.092, 0.007, 34);
    T.add(mat.jacket, lathe(body, 16), { s: [0.96, 1, 0.74] });
    T.add(mat.jacketDark, new THREE.TorusGeometry(0.168, 0.018, 4, 16), { p: [0, -0.06, 0], r: [Math.PI / 2, 0, 0], s: [0.97, 0.74, 1] }); // hem band
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
    this.neck = new THREE.Bone();
    this.neck.position.y = TORSO + 0.01;
    this.torso.add(this.neck);
    this.head = new THREE.Bone();
    this.neck.add(this.head);
    const H = new Part(this.head, parts);
    // Face: a slightly long head with a jaw, nose, brows and eyes under the beanie's cuff, ears
    // tucked under the cuff's edge.
    H.add(mat.skin, new THREE.SphereGeometry(0.1, 16, 12), { p: [0, 0.135, 0.004], s: [0.93, 1.07, 1] });
    H.add(mat.skin, new THREE.SphereGeometry(0.062, 12, 8), { p: [0, 0.096, -0.02], s: [1.1, 0.85, 0.92] }); // jaw and cheeks
    H.add(mat.skin, new THREE.SphereGeometry(0.0145, 8, 6), { p: [0, 0.124, -0.098], s: [0.8, 1.15, 1.1] }); // nose
    for (const x of [-0.033, 0.033]) {
      H.add(mat.dark, new THREE.SphereGeometry(0.0085, 8, 6), { p: [x, 0.142, -0.089] }); // eyes
      H.add(mat.brow, new THREE.CapsuleGeometry(0.005, 0.022, 2, 4), { p: [x, 0.1555, -0.091], r: [0, 0, Math.PI / 2 - Math.sign(x) * 0.12] });
      H.add(mat.skin, new THREE.SphereGeometry(0.022, 8, 6), { p: [Math.sign(x) * 0.093, 0.135, 0.01], s: [0.5, 1, 0.8] }); // ears
    }
    // Hair at the back of the head, below the beanie.
    H.add(mat.hair, new THREE.SphereGeometry(0.102, 14, 8, 0.45, Math.PI - 0.9, 0.8, 0.85), { p: [0, 0.137, 0.006], s: [0.95, 1.07, 1.02] });
    // Beanie: the crown, a thick folded cuff just above the brows, a pompom; goggles pushed up on
    // it with the strap lying on the knit (its radius follows the crown at that height).
    const crown = [[0.107, 0.168], [0.11, 0.2], [0.103, 0.24], [0.083, 0.275], [0.05, 0.296], [0, 0.302]];
    H.add(mat.wool, lathe(crown, 20));
    H.add(mat.wool, new THREE.TorusGeometry(0.106, 0.018, 8, 22), { p: [0, 0.186, 0.003], r: [Math.PI / 2, 0, 0], s: [1, 1.06, 1.2] });
    H.add(mat.knit, new THREE.SphereGeometry(0.038, 10, 8), { p: [0, 0.322, 0.008] });
    H.add(mat.dark, new THREE.TorusGeometry(0.1105, 0.0065, 4, 24), { p: [0, 0.222, 0.003], r: [Math.PI / 2 - 0.1, 0, 0] });
    H.add(mat.dark, new RoundedBoxGeometry(0.156, 0.054, 0.034, 2, 0.015), { p: [0, 0.226, -0.1], r: [-0.3, 0, 0] });
    H.add(mat.lens, new RoundedBoxGeometry(0.14, 0.04, 0.012, 2, 0.006), { p: [0, 0.229, -0.117], r: [-0.3, 0, 0] });
    H.build();

    // Arms: puffy upper arm and forearm (quilted), cuff, mitten with a thumb.
    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Bone();
      shoulder.position.set(side * 0.205, TORSO - 0.1, 0);
      this.torso.add(shoulder);
      const S = new Part(shoulder, parts);
      S.add(mat.jacket, new THREE.SphereGeometry(0.07, 8, 6));
      S.add(mat.jacket, lathe(quilted([[0.054, -0.29], [0.056, -0.15], [0.062, -0.02], [0.045, 0.04]], -0.28, 0, 0.07, 0.004, 16), 10));
      S.build();
      const elbow = new THREE.Bone();
      elbow.position.y = -0.285;
      shoulder.add(elbow);
      const E = new Part(elbow, parts);
      E.add(mat.jacket, new THREE.SphereGeometry(0.052, 8, 6));
      E.add(mat.jacket, lathe(quilted([[0.046, -0.22], [0.05, -0.1], [0.052, 0]], -0.2, 0, 0.066, 0.003, 12), 10));
      E.add(mat.jacketDark, new THREE.CylinderGeometry(0.049, 0.049, 0.035, 12), { p: [0, -0.215, 0] });
      E.add(mat.mitten, new THREE.SphereGeometry(0.052, 8, 6), { p: [0, -0.275, -0.004], s: [0.78, 1.15, 1] });
      E.add(mat.mitten, new THREE.CapsuleGeometry(0.018, 0.04, 3, 6), { p: [-side * 0.02, -0.255, -0.035], r: [0.5, 0, -side * 0.5] });
      E.build();
      return { shoulder, elbow, side };
    });

    // Legs: thigh, knee, shin with a gaiter, and an ankle joint carrying the boot.
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Bone();
      hip.position.set(side * 0.095, 0, 0);
      hip.rotation.order = 'ZYX'; // pitch in the leg's own plane first, then a little roll
      this.legBase.add(hip);
      // Insulated trousers: full thigh, a knee, a tapering shin into the gaiter.
      new Part(hip, parts).add(mat.trousers, lathe([[0.066, -THIGH - 0.01], [0.072, -0.36], [0.084, -0.22], [0.093, -0.08], [0.092, 0.0], [0.075, 0.045]], 12)).build();
      const knee = new THREE.Bone();
      knee.position.y = -THIGH;
      hip.add(knee);
      const K = new Part(knee, parts);
      K.add(mat.trousers, new THREE.SphereGeometry(0.069, 10, 8), { s: [1, 1, 1.04] });
      K.add(mat.trousers, lathe([[0.058, -0.25], [0.063, -0.14], [0.066, -0.04], [0.068, 0]], 12));
      // Gaiter over the boot's collar, cinched below the knee, a strap under the instep's edge.
      K.add(mat.gaiter, lathe([[0.066, -SHIN + 0.035], [0.072, -SHIN + 0.075], [0.07, -0.25], [0.066, -0.2], [0.064, -0.19]], 12));
      K.add(mat.gaiter, new THREE.TorusGeometry(0.066, 0.008, 5, 14), { p: [0, -0.198, 0], r: [Math.PI / 2, 0, 0] });
      K.build();
      const ankle = new THREE.Bone();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      const A = new Part(ankle, parts), B = bootGeometry();
      A.add(mat.sole, B.sole);
      A.add(mat.boot, B.upper);
      A.add(mat.bootDark, B.collar);
      // Laces across the instep (the line from the toe box's top to the collar's front, lifted onto
      // the upper's curve).
      for (let i = 0; i < 4; i++) { const t = 0.2 + i * 0.2, y = lerp(0.0024, 0.058, t) + 0.0115 * Math.sin(Math.PI * t) + 0.004, z = lerp(-0.158, -0.047, t) - 0.006 * Math.sin(Math.PI * t); A.add(mat.strap, new THREE.BoxGeometry(0.05 - i * 0.004, 0.005, 0.011), { p: [0, y, z], r: [-0.47, 0, 0] }); }
      A.build();
      return { hip, knee, ankle, side };
    });
    // Trekking poles: grip, shaft, basket, tip. Each is placed in world space every frame, from the
    // mitten to where its tip is planted.
    this.poles = [-1, 1].map((side) => {
      const g = new THREE.Bone(); // origin at the grip, the shaft down −y
      new Part(g, parts)
        .add(mat.dark, new THREE.CylinderGeometry(0.017, 0.015, 0.13, 8), { p: [0, -0.03, 0] })
        .add(mat.metal, new THREE.CylinderGeometry(0.008, 0.0065, POLE - 0.09, 6), { p: [0, -0.09 - (POLE - 0.09) / 2, 0] })
        .add(mat.dark, new THREE.TorusGeometry(0.034, 0.005, 4, 12), { p: [0, -POLE + 0.08, 0], r: [Math.PI / 2, 0, 0] })
        .add(mat.metal, new THREE.ConeGeometry(0.006, 0.03, 5), { p: [0, -POLE + 0.015, 0], r: [Math.PI, 0, 0] })
        .build();
      this.root.add(g);
      return { g, side, tip: new THREE.Vector3(), grip: new THREE.Vector3() };
    });
    scene.add(this.root);
    // One skinned mesh: each part rigidly bound to its joint, in the rest pose.
    this.root.updateMatrixWorld(true);
    const bones = [], index = new Map(), geos = [];
    this.root.traverse((o) => { if (o.isBone) { index.set(o, bones.length); bones.push(o); } });
    for (const part of parts) {
      for (const g of part.geos) {
        g.applyMatrix4(part.bone.matrixWorld);
        const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = index.get(part.bone); sw[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        geos.push(g);
      }
    }
    this.mesh = new THREE.SkinnedMesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(bones));
    this._inv = new THREE.Matrix4();

    this.pose = { ...POSES.lie };
    this.phase = 0; // gait cycle 0…1 (left foot strikes at 0, right at 0.5)
    this.gait = 0; // 0 still … 1 moving
    this.ikW = 0; // 0 posed legs … 1 feet planted by IK
    this.side = 0;
    this.fwd = 0;
    this.wake = 1; // 0 lying in the snow … 1 up (the opening sets 0 and animates it)
    this.reach = 0; // leaving a stone: 0 … 1 … 0 (driven by the game)
    this.reachTarget = null; // …and where the stone goes (world), if known
    this.admire = 0; // the ending: 0 … 1 lifts the head a little to the view
    this.seated = 0; // on the sled: 0 … 1 (driven by the game)
    this.tilt = new THREE.Quaternion(); // the sled's pitch and roll under you (identity on foot)
    // Feet in world space: planted where they land, swinging between (see update()).
    const V = () => new THREE.Vector3();
    this.feet = this.legs.map(() => ({ plant: V(), pos: V(), lift: V(), target: V(), rel0: V(), ankle: V(), q: new THREE.Quaternion(), planted: false, init: false, yaw: 0 }));
    for (const pole of this.poles) Object.assign(pole, { plant: V(), from: V(), planted: false });
    this._g = { hf: null, onCollider: false, n: V(), x: 0, y: 0, z: 0, sx: 0, sz: 0 };
    this.landX = 0; this.landV = 0;
  }

  reset() { this.pelvisY = undefined; for (const f of this.feet) f.init = false; this.poleTips = null; }

  /** Ground height and normal at (x, z): the heightfield, or a plane through the player's feet. */
  ground(x, z, n) {
    const G = this._g;
    if (G.hf && !G.onCollider) {
      if (G.hf.sample) return G.hf.sample(x, z, n);
      const h = G.hf.heightAt(x, z);
      if (n) n.set(G.hf.heightAt(x - 0.1, z) - G.hf.heightAt(x + 0.1, z), 0.2, G.hf.heightAt(x, z - 0.1) - G.hf.heightAt(x, z + 0.1)).normalize();
      return h;
    }
    if (n) n.copy(G.n);
    return G.y + ((x - G.x) * G.sx + (z - G.z) * G.sz);
  }

  /**
   * World pose of a foot whose sole reference point (under the ankle when flat) is at P, pointing
   * along `dir` (horizontal) on ground with normal n, rolled by rot: > 0 toes up about the heel,
   * < 0 heel up about the ball. Writes foot.ankle and foot.q.
   */
  footPose(foot, P, dir, n, rot) {
    const F = _x.copy(dir).addScaledVector(n, -dir.dot(n)).normalize(), U = _y.copy(n), Rt = _z.crossVectors(F, U).normalize();
    const c = Math.cos(rot), s = Math.sin(rot);
    // Rolled axes.
    const F2 = _v.copy(F).multiplyScalar(c).addScaledVector(U, s), U2 = _w.copy(U).multiplyScalar(c).addScaledVector(F, -s);
    if (rot > 0) foot.ankle.copy(P).addScaledVector(F, -HEEL_B).addScaledVector(F2, HEEL_B).addScaledVector(U2, ANKLE_H);
    else if (rot < 0) foot.ankle.copy(P).addScaledVector(F, BALL_F).addScaledVector(F2, -BALL_F).addScaledVector(U2, ANKLE_H);
    else foot.ankle.copy(P).addScaledVector(U, ANKLE_H);
    // Bone axes: x right, y up, z back (toes toward −z).
    _m.makeBasis(Rt, U2, _S.copy(F2).negate());
    foot.q.setFromRotationMatrix(_m);
  }

  update(ctl, pos, alpha, dt) {
    dt = Math.min(dt, 0.1);
    const g = this.t.gravity, a = this.t.avatar;
    this.root.position.copy(pos);
    const yaw = lerpAngle(ctl.prevFacing, ctl.facing, alpha);
    this.root.quaternion.copy(this.tilt).multiply(_qy.setFromAxisAngle(UP, yaw));
    const state = ctl.state, seated = this.seated;
    const hs = Math.hypot(ctl.vel.x, ctl.vel.z);
    const k = 1 - Math.exp(-10 * dt);
    this.time = (this.time ?? 0) + dt;

    // --- Pose parameters for the state, blended (the legs' IK and the gait add on top).
    let target = POSES.stand;
    if (seated > 0.5) target = POSES.sled;
    else if (state === 'slide' || state === 'stumble') target = POSES.slide;
    else if (state === 'air') target = ctl.jumpFromSlide ? POSES.slide : POSES.air;
    else if (state === 'sit') target = POSES.sit;
    else if (hs > 0.4) target = POSES.run;
    // Opening: lying → sitting (posed) → standing up over planted feet (IK) as `wake` goes 0 → 1.
    const up = smooth(0, 0.5, this.wake), stand = smooth(0.45, 1, this.wake);
    const P = this.pose;
    const kp = state === 'sit' || this.wake < 1 ? 1 - Math.exp(-4 * dt) : 1 - Math.exp(-12 * dt);
    for (const key of KEYS) {
      let want = target[key];
      if (this.wake < 1) want = lerp(lerp(POSES.lie[key], POSES.sit[key], up), target[key], stand);
      P[key] += (want - P[key]) * (this.wake < 1 ? 1 : kp);
    }

    // --- Ground and frame.
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const fwdW = _fw.set(fx, 0, fz), rightW = _rt.set(rx, 0, rz);
    const hf = ctl.world?.heightfield, n0 = ctl.groundNormal;
    const G = this._g;
    G.hf = hf; G.onCollider = (ctl.heightAboveGround ?? 0) > 0.05; G.n.copy(n0); G.x = pos.x; G.y = pos.y; G.z = pos.z;
    G.sx = -n0.x / Math.max(n0.y, 0.3); G.sz = -n0.z / Math.max(n0.y, 0.3);
    const uphill = clamp(-(n0.x * fx + n0.z * fz) / Math.max(n0.y, 0.3), -0.7, 1);

    // --- Landing: the knees take it (a critically damped dip, deeper for harder landings).
    if (ctl.grounded && !this.wasGrounded && (this.prevVy ?? 0) < -2.5 && seated < 0.5) this.landV = Math.max(-4, (this.landV ?? 0) + this.prevVy * 0.38);
    this.wasGrounded = ctl.grounded; this.prevVy = ctl.vel.y;
    { const w = 12; const acc = -w * w * this.landX - 2 * w * this.landV; this.landV += acc * dt; this.landX += this.landV * dt; }

    // --- Which mode the legs are in: planted by IK (on foot, or standing up in the opening), or posed.
    const rising = this.wake > 0.4 && this.wake < 1;
    const onFoot = state === 'run' && ctl.grounded && this.wake >= 1 && seated < 0.01;
    const legIK = onFoot || rising;
    const ikWant = onFoot ? 1 : rising ? smooth(0.4, 0.5, this.wake) : 0;
    this.ikW += (ikWant - this.ikW) * (ikWant > this.ikW ? 1 - Math.exp(-14 * dt) : 1 - Math.exp(-20 * dt));
    if (legIK && (!this.wasIK || !this.feet[0].init)) this.plantFromPose(pos, fwdW, rightW); // landing / getting up: feet where they are
    this.wasIK = legIK;

    // --- Gait. Walk below ~2 m/s (long stance, no flight, straight-ish knees, the hips highest over
    // the standing foot), run above ~3 m/s (short stance, a flight phase, knees that give, the hips
    // lowest mid-stance); both cadence and stride grow with speed as they do in people.
    const v = onFoot ? hs : 0, powder = ctl.groundSurface === 1;
    const wRun = smooth(2.0, 3.2, v);
    this.wRun = wRun;
    const moveW = onFoot ? smooth(0.12, 0.7, v) : 0;
    // (On a slope, up or down, people take shorter, quicker steps at the same speed.)
    const cad0 = (lerp(1.15 + 0.5 * Math.min(v, 2.6), 2.4 + 0.14 * v, wRun) - (powder ? 0.15 : 0)) * (1 + 0.9 * Math.min(0.6, Math.abs(uphill))), cadence = Math.min(4.3, cad0); // steps/s
    const duty = lerp(0.63 - 0.02 * Math.min(v, 2.6), 0.42 - 0.025 * v, wRun); // stance share of a stride (contact 0.25 s jogging … 0.12 s sprinting)
    const stepW = lerp(0.105, 0.07, wRun); // feet either side of the line of travel
    const moveDir = _md.set(ctl.vel.x, 0, ctl.vel.z);
    if (hs > 0.3) moveDir.divideScalar(hs); else moveDir.copy(fwdW);
    // Settle: standing still with a foot out of place (a stop, a turn on the spot) takes a step.
    let need = 0, worst = -1, worstErr = 0, allDown = true;
    if (legIK && !rising) {
      for (const [i, f] of this.feet.entries()) {
        if (!f.planted) { need = 1; allDown = false; continue; }
        const side = i ? 1 : -1;
        const ex = f.plant.x - (pos.x + rx * side * stepW), ez = f.plant.z - (pos.z + rz * side * stepW);
        const yawErr = Math.abs(Math.atan2(Math.sin(f.yaw - yaw), Math.cos(f.yaw - yaw)));
        const err = Math.max(Math.hypot(ex, ez) / 0.14, yawErr / 0.35);
        if (err > 1) need = 1;
        if (err > worstErr) { worstErr = err; worst = i; }
      }
      // From standing, the foot most out of place steps at once (both are down, so jumping the
      // cycle to that foot's toe-off changes nothing visible).
      if (need && allDown && this.idle && moveW < 0.05) this.phase = ((duty - (worst ? 0.5 : 0) + 1.001) % 1);
    }
    const drive = Math.max(moveW, need), cadEff = Math.max(cadence, need > moveW ? 2.3 : 0);
    const rate = 0.5 * cadEff * drive; // strides per second
    if (legIK && !rising) this.phase = (this.phase + dt * rate) % 1;
    this.idle = legIK && drive < 0.001;
    this.gait += (moveW - this.gait) * k;
    const tLand = (u) => Math.min(0.6, (1 - u) / Math.max(rate, 0.4));
    // The foot lands a little ahead of the hips and leaves well behind them (more so running).
    const halfStance = moveW * (2 * v * duty / Math.max(cadEff, 0.1)) * lerp(0.46, 0.36, wRun);
    const peelMax = lerp(0.5, 0.75, wRun) * moveW, strikeMax = lerp(0.24, 0.08, wRun) * moveW;
    const lift = lerp(0.085, 0.2 + 0.25 * smooth(3, 9, v), wRun) * drive + (powder ? 0.08 : 0) * moveW; // running: the heel kicks up behind

    for (const [i, f] of this.feet.entries()) {
      const leg = this.legs[i], side = leg.side;
      if (!legIK) { f.planted = false; continue; }
      if (rising) {
        // Standing up: feet flat on the snow in front of the hips, drawn in as the hips come over them.
        const d = 0.42 * (1 - stand);
        _S.set(pos.x + fx * d + rx * side * 0.12, 0, pos.z + fz * d + rz * side * 0.12);
        _S.y = this.ground(_S.x, _S.z, _n);
        f.plant.copy(_S); f.yaw = yaw; f.planted = true; f.init = true;
        this.footPose(f, f.plant, fwdW, _n, 0);
        f.rot = 0;
        continue;
      }
      const u = (this.phase + (side > 0 ? 0.5 : 0)) % 1, stance = u < duty;
      if (stance && !f.planted) { // touchdown: the foot lands where the swing was taking it
        f.plant.copy(f.pos); f.plant.y = this.ground(f.plant.x, f.plant.z); f.yaw = f.curYaw ?? yaw; f.planted = true; f.touch = (f.touch ?? 0) + 1;
        if (this.onFoot && drive > 0.3) this.onFoot(f.plant.x, f.plant.z, ctl, side, moveW < 0.3);
      } else if (!stance && f.planted) { // toe-off
        f.planted = false; f.lift.copy(f.plant); f.liftYaw = f.yaw; f.liftRot = f.rot ?? 0; f.rel0.set(f.plant.x - pos.x, 0, f.plant.z - pos.z);
      }
      let rot;
      if (f.planted) {
        // Planted: fixed on the snow. Heel strike (toes up) while the foot is ahead of the hips,
        // flat, then the heel peels up about the ball as the body passes over and beyond it.
        const e = u / duty, rel = (f.plant.x - pos.x) * fx + (f.plant.z - pos.z) * fz;
        const strike = strikeMax * Math.pow(1 - smooth(0, 0.2, e), 2) * smooth(0, 0.15, rel);
        const peel = peelMax * Math.pow(smooth(0.45, 1, e), 1.6) * smooth(-0.05, -0.3, rel);
        rot = peel > 0.001 ? -peel : strike;
        // A quick turn on the spot pivots the planted foot (on its ball) rather than twisting the leg.
        const twist = Math.atan2(Math.sin(yaw - f.yaw), Math.cos(yaw - f.yaw));
        if (Math.abs(twist) > 0.6) {
          const turn = twist - Math.sign(twist) * 0.6, bx = -Math.sin(f.yaw) * BALL_F, bz = -Math.cos(f.yaw) * BALL_F;
          f.yaw += turn;
          f.plant.x += bx + Math.sin(f.yaw) * BALL_F; f.plant.z += bz + Math.cos(f.yaw) * BALL_F; // (the ball stays put)
        }
        f.pos.copy(f.plant);
        this.ground(f.pos.x, f.pos.z, _n);
        this.footPose(f, f.plant, _S.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw)), _n, rot);
        f.curYaw = f.yaw;
      } else {
        // Swing: from toe-off to the predicted next strike, lifted clear (a heel kick at speed),
        // the toes pointing down after toe-off and coming up to strike.
        // Horizontal path relative to the hips (a Hermite curve): it leaves the snow with the snow's
        // speed (still in the world, so moving back relative to the body), swings through, and
        // meets the snow again at the snow's speed — no skid at toe-off or strike.
        const e = (u - duty) / (1 - duty), se = e * e * (3 - 2 * e);
        const tl = tLand(u), Tsw = (1 - duty) / Math.max(rate, 0.4);
        const p1x = moveDir.x * halfStance + rx * side * stepW, p1z = moveDir.z * halfStance + rz * side * stepW;
        f.target.set(pos.x + ctl.vel.x * tl + p1x, 0, pos.z + ctl.vel.z * tl + p1z);
        const h00 = 2 * e * e * e - 3 * e * e + 1, h10 = e * e * e - 2 * e * e + e, h01 = -2 * e * e * e + 3 * e * e, h11 = e * e * e - e * e;
        const m0x = -0.55 * ctl.vel.x * Tsw, m0z = -0.55 * ctl.vel.z * Tsw, m1x = 0.55 * m0x, m1z = 0.55 * m0z;
        f.pos.set(pos.x + h00 * f.rel0.x + h10 * m0x + h01 * p1x + h11 * m1x, 0, pos.z + h00 * f.rel0.z + h10 * m0z + h01 * p1z + h11 * m1z);
        const T = f.target;
        const gy = this.ground(f.pos.x, f.pos.z, _n);
        const baseY = Math.max(gy, lerp(f.lift.y, this.ground(T.x, T.z), se));
        f.pos.y = baseY + lift * Math.pow(Math.sin(Math.PI * Math.pow(e, lerp(0.8, 0.55, wRun))), 1.2);
        rot = lerp(f.liftRot ?? 0, strikeMax, smooth(0.35, 0.95, e)) - wRun * 0.3 * moveW * Math.sin(Math.PI * e);
        f.curYaw = lerpAngle(f.liftYaw ?? yaw, yaw, smooth(0.1, 0.8, e));
        _n.lerp(UP, 0.5 * smooth(0, 0.3, e) * (1 - smooth(0.7, 1, e))).normalize(); // (the snow's tilt at toe-off and strike)
        this.footPose(f, f.pos, _S.set(-Math.sin(f.curYaw), 0, -Math.cos(f.curYaw)), _n, rot);
      }
      f.rot = rot;
      leg.stance = f.planted; leg.pitch = rot; // (the gait check reads these)
    }

    // --- Hips. Their height: as high as the legs allow over the planted feet (a walk's inverted
    // pendulum), on a spring curve when running (lowest mid-stance, highest in flight), down into
    // a landing, a squat to leave a stone, and up out of the snow in the opening.
    const cyc = 2 * Math.PI * this.phase, walkW = moveW * (1 - wRun);
    const sway = -0.024 * walkW * Math.sin(cyc) - 0.008 * moveW * wRun * Math.sin(cyc);
    const hipRoll = -0.05 * walkW * Math.sin(cyc) - 0.02 * moveW * wRun * Math.sin(cyc);
    const hipYaw = -(0.06 + 0.07 * wRun) * moveW * Math.cos(cyc);
    const standH = ANKLE_H + LEG * 0.992;
    const psi = (((2 * this.phase - duty) % 1) + 1) % 1;
    const runH = ANKLE_H + 0.83 - 0.025 * smooth(5, 9, v) + lerp(0.03, 0.07, smooth(3, 9, v)) * (1 - Math.cos(2 * Math.PI * psi)) / 2;
    let hipY = pos.y + lerp(standH, lerp(standH, runH, wRun), moveW);
    if (rising) hipY = pos.y + lerp(0.13, standH, stand * stand * (3 - 2 * stand));
    hipY -= 0.03 * this.reach; // (a slight give in the knees as the arm reaches up)
    for (const [i, f] of this.feet.entries()) {
      if (!legIK || !f.planted) continue;
      const side = i ? 1 : -1;
      const hx = pos.x + rx * (sway + side * 0.095), hz = pos.z + rz * (sway + side * 0.095);
      const dh = Math.hypot(f.ankle.x - hx, f.ankle.z - hz);
      hipY = Math.min(hipY, f.ankle.y + Math.sqrt(Math.max(0.01, (LEG - 0.004) ** 2 - dh * dh)));
    }
    hipY += this.landX;
    if (this.pelvisY === undefined || !legIK) this.pelvisY = hipY;
    else this.pelvisY = hipY < this.pelvisY ? hipY : this.pelvisY + (hipY - this.pelvisY) * (1 - Math.exp(-20 * dt)); // down at once (planted feet must reach), up smoothly
    this.pelvis = this.pelvisY - pos.y;

    // Lying: the hips tip back and rest on the snow; posed heights for sitting/air/sled.
    const tilt = 1.45 * (1 - up);
    let poseDrop = 0;
    for (const leg of this.legs) poseDrop = Math.max(poseDrop, THIGH * Math.cos(P.thigh) + SHIN * Math.cos(P.thigh - P.knee) + ANKLE_H);
    // (Lying and sitting in the snow the hips rest on it; standing up is the IK's.)
    let hipsPose = this.wake < 1 ? 0.13 : state === 'air' && seated < 0.5 ? THIGH + SHIN - 0.1 : poseDrop;
    hipsPose = lerp(hipsPose, SEAT_H, seated);
    const hy = lerp(hipsPose, this.pelvis, this.ikW);
    this.hips.rotation.set(tilt, hipYaw * this.ikW, hipRoll * this.ikW);
    this.legBase.rotation.set(tilt, 0, 0);
    this.hips.position.set(sway * this.ikW, hy, 0);
    this.legBase.position.set(sway * this.ikW, hy, 0);

    // --- Lean: small into turns (tan θ = a_lat/g, scaled), a little forward with acceleration.
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

    // --- Legs: two-bone IK in 3D from each hip to its ankle, the knee toward the foot's direction
    // (a touch outward), the foot set to its planted/swinging orientation; blended over the pose.
    this.root.updateMatrixWorld(true);
    for (const [i, leg] of this.legs.entries()) {
      const f = this.feet[i];
      _qp.setFromEuler(_e.set(P.thigh, 0, 0)); leg.hip.quaternion.copy(_qp);
      leg.knee.rotation.set(-P.knee, 0, 0);
      leg.ankle.rotation.set(P.ankle, 0, 0);
      if (this.ikW > 0.001 && f.init) {
        leg.hip.updateMatrixWorld(true);
        const H = leg.hip.getWorldPosition(_S);
        const d = _v.subVectors(f.ankle, H), D = clamp(d.length(), 0.25, THIGH + SHIN - 0.002);
        d.normalize();
        const bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
        const a1 = Math.acos(clamp((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
        // Knee direction: the foot's facing blended with the body's, slightly out.
        const kd = _w.set(-Math.sin(f.curYaw ?? yaw), 0, -Math.cos(f.curYaw ?? yaw)).add(fwdW).addScaledVector(rightW, leg.side * 0.12);
        const kp2 = kd.addScaledVector(d, -kd.dot(d)).normalize(); // ⟂ to hip→ankle
        const thighDir = _x.copy(d).multiplyScalar(Math.cos(a1)).addScaledVector(kp2, Math.sin(a1)).normalize();
        const zW = _z.copy(kp2).addScaledVector(thighDir, -kp2.dot(thighDir)).normalize().negate(); // bone +z: back, away from the knee's front
        const yW = _y.copy(thighDir).negate(), xW = _e2.crossVectors(yW, zW).normalize();
        _m.makeBasis(xW, yW, zW);
        _q.setFromRotationMatrix(_m);
        leg.hip.parent.getWorldQuaternion(_qp);
        _q.premultiply(_qp.invert());
        leg.hip.quaternion.slerp(_q, this.ikW);
        leg.knee.rotation.x = lerp(-P.knee, -bend, this.ikW);
        leg.hip.updateMatrixWorld(true);
        leg.knee.getWorldQuaternion(_qp);
        _q.copy(_qp).invert().multiply(f.q);
        _qp.setFromEuler(_e.set(P.ankle, 0, 0));
        leg.ankle.quaternion.copy(_qp).slerp(_q, this.ikW);
      }
    }

    // --- Upper body. Upright walking, leaning into a run (more at speed) and into a climb; the
    // shoulders turn against the pelvis; the head stays level and looks where you're going; the
    // chest rises and falls with breathing, quicker after running.
    this.exert = (this.exert ?? 0) + (smooth(2, 9, v) - (this.exert ?? 0)) * dt * (v > 2 ? 0.25 : 0.08);
    this.breath = ((this.breath ?? 0) + dt / lerp(4.2, 1.7, this.exert)) % 1;
    const br = Math.sin(2 * Math.PI * this.breath) * lerp(0.006, 0.014, this.exert) * (1 - 0.7 * this.gait);
    const climb = clamp(uphill, -0.4, 0.9) * 0.3 * this.ikW * (0.4 + 0.6 * moveW);
    const risingLean = rising ? 0.75 * Math.sin(Math.PI * stand) : 0;
    const torsoPitch = P.torso + (0.02 + 0.09 * wRun + 0.06 * smooth(5, 9, v)) * this.gait + climb + risingLean + 0.12 * this.reach - this.landX * 1.5;
    this.torso.rotation.set(-torsoPitch - br, -1.6 * hipYaw * this.ikW, -0.8 * hipRoll * this.ikW);
    this.head.rotation.set(-P.head * 0.6 + torsoPitch * 0.55 - climb * 0.2 + 0.2 * this.reach + 0.16 * this.admire + br * 0.8, 1.4 * hipYaw * this.ikW, -0.2 * hipRoll);
    // Arms (without poles planted): swing with the opposite leg; bent 90° running.
    const armAmp = lerp(0.26, 0.62, wRun) * moveW;
    for (const arm of this.arms) {
      const swing = arm.side > 0 ? armAmp * Math.cos(cyc) : -armAmp * Math.cos(cyc);
      const reach = arm.side > 0 ? this.reach : 0; // the right hand places the stone
      arm.shoulder.rotation.set(P.arm + swing * this.ikW + reach * 1.35 + 0.5 * risingLean, 0, arm.side * (P.armOut + br * 0.4));
      arm.elbow.rotation.x = P.elbow + lerp(0.2, 1.2, wRun) * this.gait * this.ikW + Math.max(0, swing) * 0.35 - reach * 0.35;
    }

    // Leaving a stone: the right hand goes to the top of the cairn (as far as it reaches).
    if (this.reach > 0.01 && this.reachTarget) {
      this.root.updateMatrixWorld(true);
      const arm = this.arms[1], S = arm.shoulder.getWorldPosition(_S);
      _hd.subVectors(this.reachTarget, S);
      const dd = Math.min(_hd.length(), UPPER + FORE - 0.03);
      _hd.setLength(dd).add(S);
      this.solveArm(arm, _hd, smooth(0, 0.6, this.reach), fwdW, rightW);
    }

    // --- Poles. Walking, each is planted with the opposite foot beside its heel, stays where it
    // went in while the body passes, and swings forward hanging from the hand; the arm reaches the
    // grip by IK. Running, they're carried, trailing back. Otherwise they hang from the mittens;
    // lying in the snow they lie beside you and are picked up as you get up.
    this.root.updateMatrixWorld(true);
    const hand = _hd, lying = 1 - smooth(0.45, 0.85, this.wake);
    const plantW = this.ikW * (1 - wRun) * (1 - this.reach) * (rising ? 0 : 1);
    for (const pole of this.poles) {
      const arm = this.arms[pole.side < 0 ? 0 : 1], f = this.feet[pole.side < 0 ? 1 : 0];
      arm.elbow.localToWorld(hand.set(0, -FORE, 0));
      let hang = 1;
      if (plantW > 0.01 && f.init) {
        const u = (this.phase + (pole.side < 0 ? 0.5 : 0)) % 1;
        // Planted only as its foot touches down (not partway through a stance), and lifted if the
        // hand has moved out of reach of it.
        if (f.planted && !pole.planted && pole.touch !== f.touch && (f.touch ?? 0) > 0 && (u < 0.12 * duty)) {
          pole.plant.copy(f.plant).addScaledVector(rightW, pole.side * 0.24).addScaledVector(fwdW, -0.06); pole.plant.y = this.ground(pole.plant.x, pole.plant.z);
          pole.planted = true; pole.touch = f.touch;
        }
        if (pole.planted && hand.distanceTo(pole.plant) > POLE + 0.12) { pole.planted = false; pole.from.copy(pole.plant); }
        if (f.planted && pole.planted) {
          pole.tip.copy(pole.plant);
          hang = 0;
        } else if (f.planted) { // waiting for its foot's next step: hanging from the hand
          pole.tip.copy(hand).addScaledVector(DOWN, POLE); pole.from.copy(pole.tip); pole.from.y = this.ground(pole.from.x, pole.from.z);
          hang = 1;
        } else {
          if (pole.planted) { pole.from.copy(pole.plant); pole.planted = false; }
          const e = (u - duty) / (1 - duty), se = e * e * (3 - 2 * e);
          _S.copy(f.target).addScaledVector(rightW, pole.side * 0.24).addScaledVector(fwdW, -0.06);
          pole.tip.set(lerp(pole.from.x, _S.x, se), 0, lerp(pole.from.z, _S.z, se));
          pole.tip.y = this.ground(pole.tip.x, pole.tip.z) + 0.18 * Math.sin(Math.PI * e) * drive;
          hang = Math.pow(Math.sin(Math.PI * e), 0.7) * drive;
        }
        pole.grip.subVectors(hand, pole.tip).normalize().multiplyScalar(POLE).add(pole.tip).lerp(hand, hang);
        this.solveArm(arm, pole.grip, plantW, fwdW, rightW);
        arm.elbow.localToWorld(hand.set(0, -FORE, 0));
      } else pole.planted = false;
      // The shaft: hanging (or trailing back when running, or behind on the sled), toward the
      // planted tip when walking (never through the snow).
      _v.copy(DOWN).addScaledVector(fwdW, -lerp(0.35, 1.1, wRun * this.ikW)).addScaledVector(rightW, pole.side * 0.08).normalize();
      if (seated > 0.01) _v.lerp(_x.copy(DOWN).multiplyScalar(0.5).addScaledVector(fwdW, -0.8).addScaledVector(rightW, pole.side * 0.35).normalize(), seated).normalize();
      if (plantW > 0.01) {
        _x.subVectors(pole.tip, hand).normalize();
        const gy = this.ground(hand.x + _x.x * POLE, hand.z + _x.z * POLE);
        const minY = (gy + 0.02 - hand.y) / POLE;
        if (_x.y < minY && minY > -1) { const kk = Math.sqrt(Math.max(0, 1 - minY * minY) / Math.max(1e-6, _x.x * _x.x + _x.z * _x.z)); _x.set(_x.x * kk, minY, _x.z * kk); }
        _v.lerp(_x, plantW).normalize();
      }
      let grip = hand;
      if (lying > 0) {
        _y.set(pos.x + rx * pole.side * 0.62 + fx * 0.35, 0, pos.z + rz * pole.side * 0.62 + fz * 0.35);
        _y.y = this.ground(_y.x, _y.z) + 0.03;
        _z.copy(fwdW).multiplyScalar(-1).addScaledVector(DOWN, 0.02).normalize();
        grip = _S.lerpVectors(hand, _y, lying);
        _v.lerp(_z, lying).normalize();
      }
      _q.setFromUnitVectors(DOWN, _v);
      _m.compose(grip, _q, _y.set(1, 1, 1)).premultiply(this._inv.copy(this.root.matrixWorld).invert());
      _m.decompose(pole.g.position, pole.g.quaternion, pole.g.scale);
    }
  }

  /** Plant both feet where the posed legs have them now (landing from the air, getting up). */
  plantFromPose(pos, fwdW, rightW) {
    this.root.updateMatrixWorld(true);
    for (const [i, leg] of this.legs.entries()) {
      const f = this.feet[i];
      leg.ankle.getWorldPosition(_S);
      _S.y = this.ground(_S.x, _S.z, _n);
      f.plant.copy(_S); f.pos.copy(_S); f.lift.copy(_S); f.target.copy(_S);
      f.yaw = f.curYaw = f.liftYaw = Math.atan2(-fwdW.x, -fwdW.z); f.rot = f.liftRot = 0;
      f.init = true;
      this.footPose(f, f.plant, fwdW, _n, 0);
    }
    // Resume the cycle at double support (both feet down), so neither foot is caught mid-swing.
    const duty = 0.6;
    this.phase = duty - 0.5 + 0.02;
    for (const f of this.feet) f.planted = true;
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
