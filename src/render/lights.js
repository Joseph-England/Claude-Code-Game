// Placeholder lighting for Phase 3 (Phase 4 replaces it): one sun with soft PCF shadows in a tight
// frustum that follows the player (texel-snapped, DECISIONS #33), plus hemisphere ambient.
import * as THREE from 'three';

export function createLights(scene, { dir = [-0.6, 0.45, 0.35], half = 55, res = 2048 } = {}) {
  const sunDir = new THREE.Vector3(...dir).normalize();
  const sun = new THREE.DirectionalLight(0xffe6cc, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(res, res);
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 600 });
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  const hemi = new THREE.HemisphereLight(0xc4d4ff, 0x6a6478, 1.25);
  scene.add(sun, sun.target, hemi);

  const texel = (2 * half) / res;
  const lightRot = new THREE.Matrix4().lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const inv = lightRot.clone().invert();
  const tmp = new THREE.Vector3();
  function follow(focus) {
    tmp.copy(focus).applyMatrix4(inv);
    tmp.x = Math.round(tmp.x / texel) * texel;
    tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyMatrix4(lightRot);
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(sunDir, 300);
  }
  return { sun, hemi, follow, sunDir };
}
