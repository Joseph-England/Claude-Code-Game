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

export class Colliders {
  /** boxes: [{ center:[x,y,z], size:[sx,sy,sz], surface }] */
  constructor(boxes = []) {
    const bySurface = new Map();
    for (const b of boxes) {
      const g = new THREE.BoxGeometry(...b.size);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      g.translate(...b.center);
      if (!bySurface.has(b.surface)) bySurface.set(b.surface, []);
      bySurface.get(b.surface).push(g);
    }
    this.parts = [...bySurface].map(([surface, geos]) => {
      const geometry = mergeGeometries(geos);
      return { surface, geometry, bvh: new MeshBVH(geometry) };
    });
  }

  /**
   * Push a capsule (segment `seg` = Line3 of sphere centres, radius r) out of every collider.
   * Moves seg in place. Appends { normal, surface, depth } per resolved triangle to `contacts`.
   */
  collideCapsule(seg, r, contacts) {
    let hit = false;
    for (const part of this.parts) {
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
      const h = part.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (h && h.distance < best) best = h.distance;
    }
    return best;
  }
}
