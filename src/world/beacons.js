// Beacons at the note cairns (user playtest, Session 7: "some visual indicators around the pile of
// rocks, something that entices the player to go and check them out"; DECISIONS #85). Beside each
// cairn with a note, whoever left it planted a stake with a storm lantern hanging from it and
// strung prayer flags from the stake over the cairn to a stone. The lantern's glass glows (HDR, so
// it blooms), it throws a warm pool of light on the snow (world uniform, one lamp at a time: the
// nearest), and in the storm its light scatters into a halo you can see from far off (fog.js
// integrates a point light's in-scattering along each view ray). The flags flutter in the wind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLAG_COLORS = [0x2f6fd6, 0xf2f0ea, 0xd23b2c, 0x2f9a55, 0xf2c230]; // blue, white, red, green, yellow
const STAKE_H = 1.85, ARM = 0.34, HANG = 0.22; // stake height, arm length, lantern hang below the arm
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));

export class Beacons {
  /** cairns: [{ x, y, z, top, yaw }] (props.cairns entries with notes); hf: heightfield. */
  constructor(scene, cairns, hf) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.7 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.2, emissive: 0xffa640, emissiveIntensity: 30 });
    const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.4).multiplyScalar(60) });
    this.flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    this.lamps = [];
    this.flags = [];
    const stakes = [];
    for (const c of cairns) {
      // The stake stands on the path side of the cairn, a little uphill; the arm reaches toward the path.
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = -fz, rz = fx;
      const sx = c.x + rx * 1.35 + fx * 0.9, sz = c.z + rz * 1.35 + fz * 0.9, sy = hf.heightAt(sx, sz) - 0.15;
      stakes.push(new THREE.CylinderGeometry(0.028, 0.034, STAKE_H + 0.15, 7).translate(sx, sy + (STAKE_H + 0.15) / 2, sz));
      const ax = sx + rx * ARM, az = sz + rz * ARM, ay = sy + STAKE_H + 0.1;
      stakes.push(new THREE.BoxGeometry(0.03, 0.03, ARM + 0.04).rotateY(Math.atan2(rx, rz)).translate((sx + ax) / 2, ay, (sz + az) / 2));
      // The lantern: base, glass, flame, cap, guards, bail; hung from the arm's tip (swings a little).
      const lantern = new THREE.Group();
      lantern.position.set(ax, ay, az);
      const L = [];
      L.push(new THREE.CylinderGeometry(0.065, 0.075, 0.03, 12).translate(0, -HANG - 0.1, 0));
      L.push(new THREE.ConeGeometry(0.075, 0.07, 12).translate(0, -HANG + 0.075, 0));
      L.push(new THREE.TorusGeometry(0.055, 0.005, 4, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -HANG + 0.1, 0)); // bail
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; L.push(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 4).translate(Math.cos(a) * 0.066, -HANG - 0.02, Math.sin(a) * 0.066)); }
      const body = new THREE.Mesh(merge(L), iron);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.14, 14).translate(0, -HANG - 0.02, 0), this.glass);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5).scale(1, 1.8, 1).translate(0, -HANG - 0.03, 0), flame);
      body.castShadow = true;
      lantern.add(body, glass, fl);
      scene.add(lantern);
      this.lamps.push({ group: lantern, pos: new THREE.Vector3(ax, ay - HANG - 0.02, az), phase: Math.random() * 10, glow: 1 });
      // Prayer flags: a sagging line from the stake top over the cairn's top to a stone beyond it.
      const p0 = new THREE.Vector3(sx, sy + STAKE_H + 0.12, sz), p1 = new THREE.Vector3(c.x, c.top + 0.05, c.z);
      const ex = c.x - rx * 2.6 - fx * 0.8, ez = c.z - rz * 2.6 - fz * 0.8;
      const p2 = new THREE.Vector3(ex, hf.heightAt(ex, ez) + 0.1, ez);
      this.flags.push(...this.stringFlags(p0, p1, 5), ...this.stringFlags(p1, p2, 8));
      stakes.push(new THREE.DodecahedronGeometry(0.16, 0).translate(ex, p2.y - 0.05, ez)); // the stone the line is tied to
    }
    this.stakes = new THREE.Mesh(merge(stakes), wood);
    this.stakes.castShadow = true;
    scene.add(this.stakes);
    // All flags are one dynamic mesh (4 vertices each), fluttered on the CPU.
    const n = this.flags.length;
    this.flagPos = new Float32Array(n * 4 * 3);
    const col = new Float32Array(n * 4 * 3), idx = [];
    this.flags.forEach((f, i) => {
      const c = new THREE.Color(FLAG_COLORS[i % FLAG_COLORS.length]);
      for (let v = 0; v < 4; v++) col.set([c.r, c.g, c.b], (i * 4 + v) * 3);
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.flagPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.flagMesh = new THREE.Mesh(g, this.flagMat);
    this.flagMesh.frustumCulled = false;
    this.flagMesh.castShadow = true;
    scene.add(this.flagMesh);
    this.update(0, new THREE.Vector3(1, 0, 0));
  }

  /** Flags along a sagging line from a to b: [{ a, b (top corners), hang }]. */
  stringFlags(a, b, count) {
    const out = [], len = a.distanceTo(b), sag = 0.12 * len;
    const at = (u) => new THREE.Vector3().lerpVectors(a, b, u).add(new THREE.Vector3(0, -sag * 4 * u * (1 - u), 0));
    for (let k = 0; k < count; k++) {
      const u0 = (k + 0.08) / count, u1 = (k + 0.92) / count;
      out.push({ a: at(u0), b: at(u1), hang: 0.27, seed: Math.random() * 6 });
    }
    return out;
  }

  /** Per frame: flicker, the lanterns' sway and the flags' flutter. Returns the lamps. */
  update(time, wind) {
    const w = Math.min(1, Math.hypot(wind.x, wind.z) / 10);
    for (const l of this.lamps) {
      l.glow = 0.86 + 0.08 * Math.sin(time * 13.1 + l.phase) + 0.06 * Math.sin(time * 29.7 + l.phase * 2);
      l.group.rotation.set(0.05 * w * Math.sin(time * 1.7 + l.phase), 0, 0.08 * w * Math.sin(time * 1.3 + l.phase));
    }
    this.glass.emissiveIntensity = 30 * this.lamps.reduce((s, l) => s + l.glow, 0) / Math.max(1, this.lamps.length);
    // Each flag hangs from its two top corners and streams downwind, rippling.
    const P = this.flagPos, wl = Math.hypot(wind.x, wind.z) || 1, wx = wind.x / wl, wz = wind.z / wl;
    this.flags.forEach((f, i) => {
      const o = i * 12, lift = 0.35 + 0.6 * w;
      const flut = (s) => 0.05 * Math.sin(time * (6 + 4 * w) + f.seed + s);
      const dx = wx * f.hang * lift, dz = wz * f.hang * lift, dy = -f.hang * Math.sqrt(Math.max(0.05, 1 - lift * lift));
      P.set([f.a.x, f.a.y, f.a.z, f.b.x, f.b.y, f.b.z], o);
      P.set([f.a.x + dx + flut(0), f.a.y + dy + flut(1.3), f.a.z + dz, f.b.x + dx + flut(2.1), f.b.y + dy + flut(0.7), f.b.z + dz + flut(3)], o + 6);
    });
    const g = this.flagMesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    return this.lamps;
  }
}
