// Props and set pieces placed along the route: cairns (checkpoints), boulders and scattered rocks,
// route marker poles, the snow bridge, wall-kick slots and step blocks, the ice-cave roof and the
// summit pole. Produces collider specs for three-mesh-bvh and a THREE.Group of flat placeholder
// meshes. Deterministic; runs in Node for the tools (the render group is simply unused there).
import * as THREE from 'three';
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
  const rockMat = mat(SURFACE_TINTS[3]), iceMat = mat(SURFACE_TINTS[2]), snowMat = mat([0.9, 0.92, 0.97]);
  const ground = (x, z) => hf.heightAt(x, z);

  const addBox = (spec, material, castShadow = true) => {
    boxes.push(spec);
    const m = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), material);
    m.position.set(...spec.center);
    m.rotation.y = spec.yaw ?? 0;
    m.castShadow = castShadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const addRock = (x, z, r, squash, sink = 0.3) => {
    const g = rockGeometry(rand, r, squash);
    g.rotateY(rand() * Math.PI * 2);
    g.translate(x, ground(x, z) + r * squash * (1 - sink), z);
    meshes.push({ geometry: g, surface: SURFACE.ROCK });
    const m = new THREE.Mesh(g, rockMat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };

  route.sections.forEach((sec, k) => {
    // --- Cairns: stacked stones; checkpoints.
    for (const [ls, d] of sec.cairns ?? []) {
      const p = route.place(k, ls, d);
      const y = ground(p.x, p.z);
      cairns.push({ x: p.x, y, z: p.z, s: p.s, section: k, yaw: p.yaw, name: `${sec.name} ${ls}` });
      boxes.push({ center: [p.x, y + 0.6, p.z], size: [1.1, 1.2, 1.1], surface: SURFACE.ROCK, yaw: p.yaw });
      let h = y;
      for (let i = 0; i < 5; i++) {
        const r = 0.55 - i * 0.09;
        const g = rockGeometry(rand, r, 0.55);
        const m = new THREE.Mesh(g, rockMat);
        m.position.set(p.x + (rand() - 0.5) * 0.12, h + r * 0.5, p.z + (rand() - 0.5) * 0.12);
        m.castShadow = true;
        group.add(m);
        h += r * 0.9;
      }
    }

    // --- Set-piece boulders.
    for (const pr of sec.props ?? []) {
      const p = route.place(k, pr.at, pr.d);
      addRock(p.x, p.z, pr.r, 0.8, 0.25);
    }

    // --- Wall-kick chimneys: a back panel `gap` metres before the step face, with a doorway on the
    // `door` side (+1 = right of travel); the step block's face is the other wall.
    for (const sl of sec.slots ?? []) {
      const prof = route.profileAt(sec.s0 + sl.at - 1);
      const outer = prof.w + 3, doorW = 2.2;
      const floor = route.heightAt(sec.s0 + sl.at - 1);
      let top = route.heightAt(sec.s0 + sl.at + 2.5);
      const wallMat = sl.surface === SURFACE.ICE ? iceMat : rockMat;
      // Panel spans d from the closed side's outer edge to the doorway.
      const dA = -sl.door * outer, dB = sl.door * (prof.w - doorW);
      const pc = route.place(k, sl.at - sl.gap - 0.5, (dA + dB) / 2);
      addBox({
        center: [pc.x, floor - 1 + (sl.wall + 1) / 2, pc.z], size: [Math.abs(dB - dA), sl.wall + 1, 1], surface: sl.surface, yaw: pc.yaw,
      }, wallMat);
      const stepLen = 3, sp = route.place(k, sl.at + stepLen / 2);
      // Sit the block's top just above the heightfield's bicubic overshoot at the step, so you
      // stand on the box rather than on a steep sliver of terrain poking through it.
      for (let a = sl.at - 0.5; a <= sl.at + stepLen; a += 0.25) {
        for (let dd = -prof.w + 0.5; dd <= prof.w - 0.5; dd += 0.5) { const q = route.place(k, a, dd); top = Math.max(top, ground(q.x, q.z) + 0.02); }
      }
      addBox({
        center: [sp.x, (floor - 1 + top) / 2, sp.z], size: [2 * outer, top - floor + 1, stepLen], surface: sl.surface, yaw: sp.yaw,
      }, wallMat);
    }

    // --- Snow bridge (collapses).
    if (sec.bridge) {
      const b = sec.bridge, len = b.to - b.from, mid = route.place(k, (b.from + b.to) / 2);
      const spec = { center: [mid.x, b.top - 0.5, mid.z], size: [b.w, 1, len], surface: SURFACE.PACKED, yaw: mid.yaw, group: 'bridge' };
      const mesh = addBox(spec, snowMat);
      mountain.bridge = { mesh, section: k, s0: sec.s0 + b.from, s1: sec.s0 + b.to, collapseAt: sec.s0 + b.collapseAt, top: b.top };
    }

    // --- Ice-cave roof: an arched slab over the trench, extruded along the route.
    if (sec.roof) {
      const prof = sec.profile, half = prof.w + 14 / Math.tan((70 * Math.PI) / 180) + 2.5;
      const cols = 9, pos = [], idx = [];
      const rows = Math.ceil((sec.roof.to - sec.roof.from) / 2) + 1;
      for (let r = 0; r < rows; r++) {
        const s = sec.s0 + Math.min(sec.roof.from + r * 2, sec.roof.to), p = route.at(s), H = route.heightAt(s);
        for (let c = 0; c < cols; c++) {
          const d = -half + (2 * half * c) / (cols - 1), bottom = H + 12 + 2.5 * (1 - (d / half) ** 2);
          for (const y of [bottom, bottom + 2.5]) pos.push(p.x + p.rx * d, y, p.z + p.rz * d);
        }
      }
      const v = (r, c, top) => (r * cols + c) * 2 + (top ? 1 : 0);
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          idx.push(v(r, c, 0), v(r, c + 1, 0), v(r + 1, c, 0), v(r, c + 1, 0), v(r + 1, c + 1, 0), v(r + 1, c, 0));
          idx.push(v(r, c, 1), v(r + 1, c, 1), v(r, c + 1, 1), v(r, c + 1, 1), v(r + 1, c, 1), v(r + 1, c + 1, 1));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      meshes.push({ geometry: g, surface: SURFACE.ICE });
      const m = new THREE.Mesh(g, mat([0.5, 0.68, 0.95], { side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
      group.add(m);
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

  // --- Summit pole: tall, with a red flag, visible from far down the mountain.
  const top = route.at(route.length - 4);
  const hy = ground(top.x, top.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), mat([0.25, 0.22, 0.2]));
  pole.position.set(top.x, hy + 3, top.z);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), mat([0.85, 0.12, 0.1], { side: THREE.DoubleSide }));
  flag.position.set(top.x + 0.8, hy + 5.4, top.z);
  group.add(pole, flag);
  boxes.push({ center: [top.x, hy + 3, top.z], size: [0.3, 6, 0.3], surface: SURFACE.ROCK });

  return { boxes, meshes, cairns, group };
}
