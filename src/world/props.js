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
  const ground = (x, z) => hf.heightAt(x, z);
  const rockGeos = []; // every rock and cairn stone, merged into one draw call at the end

  const addRock = (x, z, r, squash, sink = 0.3) => {
    const g = rockGeometry(rand, r, squash);
    g.rotateY(rand() * Math.PI * 2);
    g.translate(x, ground(x, z) + r * squash * (1 - sink), z);
    meshes.push({ geometry: g, surface: SURFACE.ROCK });
    rockGeos.push(g);
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

  // --- Scattered rocks on the shoulders (not in chutes, cave or on the ridge crest).
  for (let s = 20; s < route.length - 30; s += 9) {
    const prof = route.profileAt(s);
    if (prof.type !== 'trail' && prof.type !== 'basin' && prof.type !== 'plateau') continue;
    if (rand() < 0.45) continue;
    const p = route.at(s), side = rand() < 0.5 ? -1 : 1;
    const d = side * (prof.w + (prof.type === 'plateau' ? prof.bank + 4 : 3) + rand() * 14);
    addRock(p.x + p.rx * d, p.z + p.rz * d, 0.6 + rand() * rand() * 2.4, 0.55 + rand() * 0.3);
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

  return { boxes, meshes, cairns, group, rockMaterial: rockMat };
}
