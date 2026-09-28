// Props placed along the route: cairns (checkpoints and story cairns), boulders, scattered rocks and
// route marker poles (the chimneys, snow bridge, ice-cave roof and summit flag went in Phase 5,
// DECISIONS #60–62). Produces collider specs for three-mesh-bvh and a THREE.Group of flat placeholder
// meshes. Deterministic; runs in Node for the tools (the render group is simply unused there).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './noise.js';
import { SURFACE } from './surfaces.js';
import { SURFACE_TINTS } from '../render/terrain.js';

const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(...c), roughness: 0.85, flatShading: true, ...extra });

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const ROCK_C = [0.3, 0.28, 0.27], SNOW_C = [0.93, 0.95, 1.0];

/**
 * A fractured rock (DECISIONS #90): a sphere clipped by random planes, so it breaks into flat
 * angular facets like real rock, jittered a little; unit size, to be scaled and placed.
 */
function fracturedRock(rand, planes = 14, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const P = [];
  // Deep cuts from spread-out directions (a jittered Fibonacci sphere), so nothing stays round.
  for (let k = 0; k < planes; k++) {
    const z = 1 - (2 * (k + 0.5)) / planes + (rand() - 0.5) * 0.25, a = k * 2.39996 + rand() * 0.8, r = Math.sqrt(Math.max(0, 1 - z * z));
    P.push([r * Math.cos(a), z, r * Math.sin(a), 0.42 + rand() * 0.3]);
  }
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    for (const [nx, ny, nz, o] of P) {
      const d = _v.x * nx + _v.y * ny + _v.z * nz;
      if (d > o) _v.set(_v.x - nx * (d - o), _v.y - ny * (d - o), _v.z - nz * (d - o));
    }
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return g.index ? g.toNonIndexed() : g;
}

/**
 * Colour a placed (world-space) rock: grey-brown rock varied per rock, snow lying on the faces
 * that look up (flat-shaded, so each facet is rock or snow, with a soft edge between).
 */
function snowCap(g, rand, snowUp = 0.62) {
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  const tint = 0.8 + 0.35 * rand(), warm = (rand() - 0.5) * 0.04;
  for (let i = 0; i < n; i += 3) {
    _v.fromBufferAttribute(pos, i); _a.fromBufferAttribute(pos, i + 1); _b.fromBufferAttribute(pos, i + 2);
    _n.crossVectors(_a.sub(_v), _b.sub(_v)).normalize();
    const snow = Math.min(1, Math.max(0, (_n.y - snowUp) / 0.2)) * (rand() < 0.12 ? 0.3 : 1);
    for (let k = 0; k < 3; k++) {
      const c = [(ROCK_C[0] + warm) * tint, ROCK_C[1] * tint, (ROCK_C[2] - warm) * tint];
      col.set(c.map((cc, q) => cc + (SNOW_C[q] - cc) * snow), (i + k) * 3);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Rough rock: an icosahedron with seeded vertex jitter, scaled (sx, sy, sz). */
function rockGeometry(rand, r, squash = 0.7) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.8 + rand() * 0.35);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function buildProps(mountain) {
  const { route, heightfield: hf } = mountain;
  const rand = rng(4242);
  const boxes = [], meshes = [], cairns = [];
  const group = new THREE.Group();
  const rockMat = mat(SURFACE_TINTS[3]);
  const boulderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const ground = (x, z) => hf.heightAt(x, z);
  const rockGeos = []; // cairn stones, merged into one draw call at the end
  const boulders = new Map(); // fractured, snow-capped rocks, bucketed by section (so far ones cull)

  /**
   * A fractured rock of size (sx, sy, sz) at (x, z), sunk `sink` of its height into the snow,
   * turned at random and leaning with the slope; collides if `solid`.
   */
  const addRock = (x, z, r, squash, sink = 0.35, solid = true, dims = null, lean = 0) => {
    const [sx, sy, sz] = dims ?? [r * (0.9 + 0.4 * rand()), r * squash, r * (0.8 + 0.3 * rand())];
    const g = fracturedRock(rand, 12 + Math.floor(rand() * 6), Math.max(sx, sy, sz) < 1.3 ? 1 : 2);
    g.scale(sx, sy, sz);
    if (lean) g.rotateZ(lean * (rand() < 0.5 ? -1 : 1));
    g.rotateY(rand() * Math.PI * 2);
    hf.sample(x, z, _n);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _n.clone().lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize());
    g.applyQuaternion(q);
    g.translate(x, ground(x, z) + sy * (1 - 2 * sink), z);
    snowCap(g, rand);
    if (solid) meshes.push({ geometry: g, surface: SURFACE.ROCK });
    const pr = mountain.project?.(x, z) ?? { s: -1 }, key = pr.s >= 0 ? route.sectionIndexAt(pr.s) : -1;
    if (!boulders.has(key)) boulders.set(key, []);
    boulders.get(key).push(g);
  };

  route.sections.forEach((sec, k) => {
    // --- Cairns: stacked stones; checkpoints.
    for (const [ls, d, kind] of sec.cairns ?? []) {
      const p = route.place(k, ls, d);
      const y = ground(p.x, p.z);
      cairns.push({ x: p.x, y, z: p.z, s: p.s, section: k, yaw: p.yaw, name: `${sec.name} ${ls}`, checkpoint: kind !== 'note' });
      boxes.push({ center: [p.x, y + 0.6, p.z], size: [1.1, 1.2, 1.1], surface: SURFACE.ROCK, yaw: p.yaw });
      let h = y;
      for (let i = 0; i < 5; i++) {
        const r = 0.55 - i * 0.09;
        const g = rockGeometry(rand, r, 0.55);
        g.translate(p.x + (rand() - 0.5) * 0.12, h + r * 0.5, p.z + (rand() - 0.5) * 0.12);
        rockGeos.push(g);
        h += r * 0.9;
      }
      cairns.at(-1).top = h;
    }

    // --- Set-piece boulders.
    for (const pr of sec.props ?? []) {
      const p = route.place(k, pr.at, pr.d);
      addRock(p.x, p.z, pr.r, 0.8, 0.25);
    }
  });

  // --- Rocks that belong (user playtest: some rocks didn't; DECISIONS #90): outcrops breaking
  // through the snow on the shoulders — small clusters, sunk deep, snow on their tops — and bigger
  // blocks where the ground beside the route steepens into rock.
  for (let s = 20; s < route.length - 30; s += 11) {
    const prof = route.profileAt(s);
    if (prof.type !== 'trail' && prof.type !== 'basin') continue;
    if (rand() < 0.4) continue;
    const p = route.at(s), side = rand() < 0.5 ? -1 : 1;
    const d = side * (prof.w + 4 + rand() * 16);
    const cx = p.x + p.rx * d, cz = p.z + p.rz * d, count = 1 + Math.floor(rand() * 3), big = 0.7 + rand() * 1.6;
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2, rr = k ? big * (0.9 + rand()) : 0;
      addRock(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, big * (k ? 0.4 + 0.4 * rand() : 1), 0.45 + 0.35 * rand(), 0.45);
    }
  }
  for (let s = 10; s < route.length - 10; s += 7) {
    const p = route.at(s), prof = route.profileAt(s);
    for (const side of [-1, 1]) {
      const d = side * (prof.w + 14 + rand() * 40), x = p.x + p.rx * d, z = p.z + p.rz * d;
      hf.sample(x, z, _n);
      if (_n.y > Math.cos((42 * Math.PI) / 180) || rand() < 0.5) continue; // only on steep ground
      const r = 1.6 + rand() * 3.2;
      addRock(x, z, r, 0.55 + 0.4 * rand(), 0.5, Math.abs(d) < 30);
    }
  }
  // --- The summit's rocks: jagged blocks either side of the top and gendarmes along the upper
  // crest, so the peak ends in rock, not a snow hump (DECISIONS #89). Off the path (|d| ≥ 4.6).
  const top = route.sections.length - 1, push = route.sections.findIndex((x) => x.name === 'Summit Push');
  // Leaning shards, mostly on the north side where the face drops, one tower just past the top.
  for (const [k, ls, d, w, hgt] of [[top, 5, -6.2, 1.1, 2.6], [top, 10, -7.4, 1.6, 4.6], [top, 16, 5.6, 0.9, 1.8], [top, 21, -5.4, 1.8, 5.6], [top, 24, -3.0, 1.2, 3.2],
    [push, 110, -6.6, 0.9, 2.0], [push, 128, -6.2, 1.2, 3.0], [push, 136, 6.4, 0.8, 1.6]]) {
    const p = route.place(k, ls, d);
    addRock(p.x, p.z, 1, 1, 0.3, true, [w, hgt, w * (0.8 + 0.5 * rand())], 0.12 + 0.15 * rand());
  }

  // --- Route marker poles (orange tips) every 18 m, alternating sides; the direction aid.
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5);
  poleGeo.translate(0, 0.9, 0);
  const tipGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.35, 5);
  tipGeo.translate(0, 1.6, 0);
  const marks = [];
  for (let s = 6, i = 0; s < route.length - 10; s += 18, i++) {
    const prof = route.profileAt(s);
    if (prof.type === 'pipe' || prof.type === 'cave' || prof.type === 'ridge') continue;
    const p = route.at(s), d = (i % 2 ? 1 : -1) * (prof.w + 0.6);
    const x = p.x + p.rx * d, z = p.z + p.rz * d;
    marks.push(new THREE.Matrix4().makeTranslation(x, ground(x, z) - 0.2, z));
  }
  for (const [geo, color] of [[poleGeo, [0.2, 0.2, 0.22]], [tipGeo, [1.0, 0.35, 0.08]]]) {
    const im = new THREE.InstancedMesh(geo, mat(color), marks.length);
    marks.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    group.add(im);
  }

  const rocks = new THREE.Mesh(mergeGeometries(rockGeos), rockMat);
  rocks.castShadow = rocks.receiveShadow = true;
  group.add(rocks);
  for (const list of boulders.values()) {
    const b = new THREE.Mesh(mergeGeometries(list), boulderMat);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
  }

  return { boxes, meshes, cairns, group, rockMaterial: rockMat };
}
