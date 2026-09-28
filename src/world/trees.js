// Conifers low on the mountain (DECISIONS #90): the trailhead sits at the tree line, so a few
// snow-laden firs stand near the start and forest thickens down the valley slopes below the route —
// they give the mountain its scale, and from the ridge and the summit they are the dark forests far
// below. One low-poly fir (trunk and three open cones, ~28 triangles) with snow in its vertex
// colours (white crowns fading to dark green at the rims), instanced: the handful near the route
// cast shadows, the far forest doesn't and uses a 10-triangle fir (it is only ever seen from afar).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, Noise } from './noise.js';

/** The far forest's fir: two five-sided cones, no trunk (~10 triangles; only ever seen from afar). */
function farFirGeometry() {
  const parts = [];
  for (const [r, h, y] of [[1.8, 4.2, 0.6], [1.1, 3.2, 3.2]]) {
    const cone = new THREE.ConeGeometry(r, h, 5, 1, true).translate(0, y + h / 2, 0);
    paint(cone, (py) => { const t = Math.min(1, Math.max(0, (py - y) / h)), snow = Math.min(1, 0.3 + 1.1 * t); return [0.07 + 0.83 * snow, 0.13 + 0.79 * snow, 0.09 + 0.89 * snow]; });
    parts.push(cone);
  }
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
}

function firGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.16, 1.6, 5, 1, true).translate(0, 0.8, 0);
  paint(trunk, () => [0.16, 0.11, 0.08]);
  parts.push(trunk);
  // Tiers: [base radius, height, base y]; the cone's apex is snow, its rim dark green.
  for (const [r, h, y] of [[1.9, 3.2, 1.0], [1.45, 2.7, 2.6], [0.95, 2.2, 4.0]]) {
    const cone = new THREE.ConeGeometry(r, h, 6, 1, true).translate(0, y + h / 2, 0);
    paint(cone, (py) => {
      const t = Math.min(1, Math.max(0, (py - y) / h)); // 0 rim … 1 apex
      const snow = Math.min(1, 0.25 + 1.2 * t);
      return [0.07 + (0.9 - 0.07) * snow, 0.13 + (0.92 - 0.13) * snow, 0.09 + (0.98 - 0.09) * snow];
    });
    parts.push(cone);
  }
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
}

function paint(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(fn(p.getY(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/**
 * Place firs on the play heightfield. mountain: buildMountain() result. Returns the group (two
 * instanced meshes: near the route, casting shadows; the far forest, not).
 */
export function buildTrees(scene, mountain, { treeline = 14, max = 1100 } = {}) {
  const hf = mountain.heightfield, rand = rng(9001), noise = new Noise(77), route = mountain.route;
  const near = [], far = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const nrm = new THREE.Vector3(), pr = {};
  const step = 11, half = hf.size / 2 - 6;
  for (let z = -half; z < half; z += step) {
    for (let x = -half; x < half; x += step) {
      const px = x + (rand() - 0.5) * step, pz = z + (rand() - 0.5) * step, h = hf.heightAt(px, pz);
      if (h > treeline) continue;
      hf.sample(px, pz, nrm);
      if (nrm.y < 0.84) continue; // no trees on slopes steeper than ~33°
      mountain.project(px, pz, pr);
      const bed = pr.s >= 0 ? route.profileAt(pr.s).w + 9 : 0;
      if (pr.s >= 0 && Math.abs(pr.d) < bed) continue; // keep the way clear
      // Forest patches (noise), denser lower down, sparse at the tree line.
      const patch = noise.fbm(px / 160, pz / 160, 3) * 0.5 + 0.5;
      const low = Math.min(1, Math.max(0.25, (treeline - h) / 40));
      if (rand() > patch * patch * 1.6 * low) continue;
      const s = 0.65 + rand() * 0.85;
      e.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
      m.compose(pos.set(px, h - 0.25, pz), q.setFromEuler(e), sc.set(s * (0.85 + 0.3 * rand()), s, s * (0.85 + 0.3 * rand())));
      const nearRoute = pr.s >= 0 && pr.s < 360 && Math.abs(pr.d) < 70;
      (nearRoute ? near : far).push(m.clone());
    }
  }
  const all = near.length + far.length;
  if (all > max) far.length = Math.max(0, max - near.length); // (deterministic cap)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const group = new THREE.Group();
  for (const [list, shadow, geo] of [[near, true, firGeometry()], [far, false, farFirGeometry()]]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  scene.add(group);
  group.userData.count = [near.length, far.length];
  return group;
}
