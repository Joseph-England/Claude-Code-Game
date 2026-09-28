// Gray-box rendering for Phase 2: terrain mesh with a world-space grid, surface tints, box
// colliders, a cairn marker, a sun with soft shadows that follow the player.
import * as THREE from 'three';

// Linear-space tints per surface id (snow, powder, ice, rock).
const SURFACE_TINTS = [
  [0.78, 0.8, 0.84], [0.97, 0.97, 1.0], [0.45, 0.68, 0.92], [0.42, 0.38, 0.36],
];

function gridTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(40,40,60,0.18)'; // 1 m lines (texture covers 4 m)
  for (let i = 0; i < 4; i++) { g.fillRect(i * 64, 0, 2, 256); g.fillRect(0, i * 64, 256, 2); }
  g.fillStyle = 'rgba(40,40,60,0.35)'; // 4 m lines
  g.fillRect(0, 0, 4, 256); g.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function terrainGeometry(hf) {
  const { n, cell, origin, heights, normals, surfaces } = hf;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = origin + i * cell, z = origin + j * cell;
      pos.set([x, heights[k], z], k * 3);
      col.set(SURFACE_TINTS[surfaces[k]], k * 3);
      uv.set([x / 4, z / 4], k * 2);
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals.slice(), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

export function createGraybox(renderer, scene, course) {
  const grid = gridTexture(renderer);
  scene.background = new THREE.Color(0x9fb4d8);
  scene.fog = new THREE.Fog(0x9fb4d8, 150, 520);

  const terrain = new THREE.Mesh(
    terrainGeometry(course.heightfield),
    new THREE.MeshStandardMaterial({ vertexColors: true, map: grid, roughness: 0.9 }),
  );
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  const boxMats = SURFACE_TINTS.map((c) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...c), map: grid, roughness: 0.8 });
    return m;
  });
  for (const b of course.boxes) {
    const geo = new THREE.BoxGeometry(...b.size);
    // World-space-ish UVs so the grid reads at 4 m per tile on every face.
    const uv = geo.attributes.uv, p = geo.attributes.position, nrm = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const x = p.getX(i) + b.center[0], y = p.getY(i) + b.center[1], z = p.getZ(i) + b.center[2];
      const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
      uv.setXY(i, (ax > 0.5 ? z : x) / 4, (ay > 0.5 ? z : y) / 4);
    }
    const mesh = new THREE.Mesh(geo, boxMats[b.surface]);
    mesh.position.set(...b.center);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Sun: moderately high for gray-box readability. Soft PCF (vogel disk, radius) and a tight
  // frustum that follows the player, snapped to shadow texels so edges don't crawl.
  const sunDir = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.6);
  sun.castShadow = true;
  const SHADOW_HALF = 45, SHADOW_RES = 2048;
  sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 400 });
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x6a6070, 1.3));

  const texel = (2 * SHADOW_HALF) / SHADOW_RES;
  const lightRot = new THREE.Matrix4().lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const inv = lightRot.clone().invert();
  const tmp = new THREE.Vector3();
  function follow(focus) {
    // Snap the focus to whole shadow texels in light space to stop shimmering.
    tmp.copy(focus).applyMatrix4(inv);
    tmp.x = Math.round(tmp.x / texel) * texel;
    tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyMatrix4(lightRot);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(sunDir, 200);
  }
  follow(new THREE.Vector3());

  return { terrain, sun, follow };
}
