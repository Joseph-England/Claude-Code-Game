// Mesh collision via three-mesh-bvh (DECISIONS #7): capsule push-out for the controller and
// ray queries for the camera. Colliders are static and built in world space, one BVH per surface.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _box = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();

function indexify(g) {
  const count = g.attributes.position.count;
  g.setIndex([...Array(count).keys()]);
  return g;
}

export class Colliders {
  /**
   * boxes:  [{ center:[x,y,z], size:[sx,sy,sz], surface, yaw?, group? }]
   * meshes: [{ geometry (world space), surface, group? }]
   * Parts are merged per (surface, group); groups can be switched off (the collapsing bridge).
   */
  constructor(boxes = [], meshes = []) {
    const byKey = new Map();
    const add = (surface, group, g) => {
      const key = `${surface}:${group ?? ''}`;
      if (!byKey.has(key)) byKey.set(key, { surface, group, geos: [] });
      byKey.get(key).geos.push(g);
    };
    for (const b of boxes) {
      const g = new THREE.BoxGeometry(...b.size);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      if (b.yaw) g.rotateY(b.yaw);
      g.translate(...b.center);
      add(b.surface, b.group, g);
    }
    for (const m of meshes) {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
      add(m.surface, m.group, g);
    }
    this.parts = [...byKey.values()].map(({ surface, group, geos }) => {
      const indexed = geos.some((g) => g.index);
      const geometry = mergeGeometries(indexed ? geos.map((g) => (g.index ? g : indexify(g))) : geos);
      return { surface, group, geometry, bvh: new MeshBVH(geometry), enabled: true };
    });
  }

  setGroupEnabled(group, enabled) {
    for (const p of this.parts) if (p.group === group) p.enabled = enabled;
  }

  /**
   * Push a capsule (segment `seg` = Line3 of sphere centres, radius r) out of every collider.
   * Moves seg in place. Appends { normal, surface, depth } per resolved triangle to `contacts`.
   */
  collideCapsule(seg, r, contacts) {
    let hit = false;
    for (const part of this.parts) {
      if (!part.enabled) continue;
      _box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end);
      _box.min.addScalar(-r);
      _box.max.addScalar(r);
      part.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(seg, _triPoint, _capPoint);
          if (dist >= r) return false;
          if (dist > 1e-6) _dir.subVectors(_capPoint, _triPoint).divideScalar(dist);
          else tri.getNormal(_dir);
          const depth = r - dist;
          seg.start.addScaledVector(_dir, depth);
          seg.end.addScaledVector(_dir, depth);
          contacts.push({ normal: _dir.clone(), surface: part.surface, depth });
          hit = true;
          return false;
        },
      });
    }
    return hit;
  }

  /** Distance to the first hit along a normalized direction, or Infinity. */
  raycast(origin, dir, far) {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    let best = Infinity;
    for (const part of this.parts) {
      if (!part.enabled) continue;
      const h = part.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (h && h.distance < best) best = h.distance;
    }
    return best;
  }
}
