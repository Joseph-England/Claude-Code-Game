// Sun lighting (DESIGN §4, §6): cascaded shadow maps (three's CSM; cascade count and size come from
// the quality tier) for props and the avatar — the terrain shadows itself by ray marching
// (sunshadow.js) — and the sun colour from the atmosphere's transmittance. Ambient comes from the
// sky-view LUT inside every lit material (materials.js), so there is no hemisphere light.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

export function createLights(scene, camera, { cascades = 2, size = 1024, maxFar = 220 } = {}) {
  const csm = new CSM({
    camera, parent: scene, cascades, shadowMapSize: size, maxFar, mode: 'practical',
    lightDirection: new THREE.Vector3(0.5, -0.5, 0.5).normalize(), lightIntensity: 1,
    lightNear: 1, lightFar: 900, lightMargin: 120, shadowBias: -0.0002,
  });
  csm.fade = true;
  for (const l of csm.lights) { l.shadow.radius = 3; l.shadow.normalBias = 0.04; }
  let fov = camera.fov, aspect = camera.aspect;

  /** Each frame: sun direction (toward the sun) and HDR colour. */
  function update(sunDir, sunColor) {
    csm.lightDirection.copy(sunDir).negate();
    const up = sunDir.y > -0.01;
    for (const l of csm.lights) { l.color.copy(sunColor); l.intensity = up ? 1 : 0; l.castShadow = up; }
    if (Math.abs(camera.fov - fov) > 0.5 || camera.aspect !== aspect) {
      fov = camera.fov; aspect = camera.aspect;
      csm.updateFrustums();
    }
    csm.update();
  }
  return { csm, update };
}
