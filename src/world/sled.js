// The sled (DECISIONS #83): a small wooden Davos-style sled — two bent-wood runners shod with
// steel that curl up at the front, struts, four long seat slats, a foot bar and a red rope tied to
// the curls. Someone left it by the cairn at the top of the chutes (like the notes: help left
// behind by whoever came before). Render only: its state (where it rests, whether it is ridden)
// lives in LevelState so the Node playthrough can ride it too.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _y = new THREE.Quaternion();

function runner(side) {
  // Bottom straight from the back to the front, then a curl up and back over the front.
  const x = side * 0.19;
  const pts = [[0.44, 0.03], [0.2, 0.018], [-0.2, 0.018], [-0.36, 0.03], [-0.47, 0.09], [-0.5, 0.18], [-0.46, 0.25], [-0.39, 0.26]]
    .map(([z, y]) => new THREE.Vector3(x, y, z));
  return new THREE.CatmullRomCurve3(pts);
}

export class Sled {
  constructor(scene) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c6a3a, roughness: 0.68 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5c636b, roughness: 0.35, metalness: 0.8 });
    const rope = new THREE.MeshStandardMaterial({ color: 0xb52a22, roughness: 0.9 });
    const W = [], S = [], R = [];
    for (const side of [-1, 1]) {
      const c = runner(side);
      W.push(new THREE.TubeGeometry(c, 40, 0.02, 6, false).scale(1, 1.35, 1));
      // Steel shoe under the straight part of the runner.
      const shoe = new THREE.CatmullRomCurve3(c.points.slice(0, 5).map((p) => p.clone().add(new THREE.Vector3(0, -0.018, 0))));
      S.push(new THREE.TubeGeometry(shoe, 24, 0.008, 5, false));
      // Struts from the runner up to the seat frame.
      for (const z of [0.36, 0.05, -0.26]) W.push(new THREE.BoxGeometry(0.028, 0.2, 0.035).translate(side * 0.19, 0.12, z));
      W.push(new THREE.BoxGeometry(0.035, 0.03, 0.78).translate(side * 0.19, 0.215, 0.04)); // side rail
    }
    for (const z of [0.36, 0.05, -0.26]) W.push(new THREE.BoxGeometry(0.4, 0.025, 0.04).translate(0, 0.2, z)); // cross braces
    for (const x of [-0.135, -0.045, 0.045, 0.135]) W.push(new THREE.BoxGeometry(0.075, 0.018, 0.8).translate(x, 0.238, 0.04)); // slats
    W.push(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 0.2, -0.47)); // foot bar
    // Rope: tied at both curls, lying back over the slats in a loose loop.
    const loop = new THREE.CatmullRomCurve3([[-0.19, 0.25, -0.44], [-0.13, 0.26, -0.3], [-0.06, 0.255, -0.12], [0.02, 0.255, -0.08], [0.1, 0.258, -0.2], [0.19, 0.25, -0.44]].map((p) => new THREE.Vector3(...p)));
    R.push(new THREE.TubeGeometry(loop, 30, 0.008, 5, false));
    const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
    this.group = new THREE.Group();
    for (const [list, m] of [[W, wood], [S, steel], [R, rope]]) {
      const mesh = new THREE.Mesh(merge(list), m);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    scene.add(this.group);
    this.normal = new THREE.Vector3(0, 1, 0);
    this.quaternion = this.group.quaternion;
  }

  /**
   * Place the sled at (x, y, z) facing yaw (0 = −z), tilted to the ground normal n (smoothed by
   * rate k; pass k = 1 to snap).
   */
  place(x, y, z, yaw, n, k = 1) {
    this.normal.lerp(n, k).normalize();
    this.group.position.set(x, y, z);
    _q.setFromUnitVectors(UP, _n.copy(this.normal));
    _y.setFromAxisAngle(UP, yaw);
    this.group.quaternion.copy(_q).multiply(_y);
  }
}
