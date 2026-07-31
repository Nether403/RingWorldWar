/**
 * Floating origin.
 *
 * The ring is 22.6 km around. That is small enough that float32 would *almost*
 * cope, but "almost" produces shimmering shadows and jittering units at the far
 * end of the map, and it would stop working immediately if the ring were ever
 * scaled up. Anchoring the render frame to the camera keeps every coordinate
 * Three.js sees within a few kilometres of the origin, permanently.
 *
 * The anchor also defines which way is "up" in render space, since up depends
 * on where you are standing on the ring.
 */

import * as THREE from 'three';
import { RING_RADIUS } from '@core/constants';
import { deltaS, wrapS, type Vec3Out } from '@core/ringMath';

/** Re-base once the camera has moved this far, in metres. */
const REBASE_DISTANCE = 600;

export class RenderAnchor {
  /** Arc-length position of the anchor. */
  s = 0;
  /** Axial position of the anchor. */
  z = 0;
  /** Incremented whenever the anchor moves, so caches know to rebuild. */
  version = 0;

  /**
   * Move the anchor if the focus has drifted too far. Returns true if it moved,
   * which tells dependent systems (terrain chunks, decals, trails) to rebuild
   * their local-space positions.
   */
  update(focusS: number, focusZ: number): boolean {
    if (Math.abs(deltaS(this.s, focusS)) < REBASE_DISTANCE && Math.abs(focusZ - this.z) < REBASE_DISTANCE) {
      return false;
    }
    this.s = wrapS(focusS);
    this.z = focusZ;
    this.version++;
    return true;
  }

  /** Force the anchor to a position (used when the camera teleports). */
  set(s: number, z: number): void {
    this.s = wrapS(s);
    this.z = z;
    this.version++;
  }

  /** Project a ring-space point into render space. */
  toRender(s: number, h: number, z: number, out: Vec3Out): Vec3Out {
    const dTheta = deltaS(this.s, s) / RING_RADIUS;
    const r = RING_RADIUS - h;
    out.x = r * Math.sin(dTheta);
    out.y = RING_RADIUS - r * Math.cos(dTheta);
    out.z = z - this.z;
    return out;
  }

  /** Project into a THREE.Vector3. */
  toVector(s: number, h: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const dTheta = deltaS(this.s, s) / RING_RADIUS;
    const r = RING_RADIUS - h;
    out.set(r * Math.sin(dTheta), RING_RADIUS - r * Math.cos(dTheta), z - this.z);
    return out;
  }

  /** Inverse projection, for turning a mouse ray hit back into a command. */
  toRing(v: THREE.Vector3): { s: number; h: number; z: number } {
    const dy = RING_RADIUS - v.y;
    const r = Math.hypot(v.x, dy);
    const dTheta = Math.atan2(v.x, dy);
    return {
      s: wrapS(this.s + dTheta * RING_RADIUS),
      h: RING_RADIUS - r,
      z: v.z + this.z,
    };
  }

  /**
   * Orientation for an object standing on the surface at (s, z) facing `yaw`,
   * where yaw 0 points spinward. Writes into `quat`.
   *
   * Deriving the basis rather than storing a free rotation guarantees units are
   * always planted correctly on the curve, however far around the ring they are.
   */
  orientation(s: number, yaw: number, quat: THREE.Quaternion): THREE.Quaternion {
    const dTheta = deltaS(this.s, s) / RING_RADIUS;
    const c = Math.cos(dTheta);
    const sn = Math.sin(dTheta);

    // Local frame at that point, expressed in render space.
    _up.set(-sn, c, 0);
    _tangent.set(c, sn, 0);
    _axial.set(0, 0, 1);

    // Forward = tangent rotated about up by yaw.
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    _forward.copy(_tangent).multiplyScalar(cy).addScaledVector(_axial, sy);
    _right.crossVectors(_up, _forward).normalize();

    _basis.makeBasis(_right, _up, _forward);
    return quat.setFromRotationMatrix(_basis);
  }

  /** The local up direction at an arc position, in render space. */
  upAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const dTheta = deltaS(this.s, s) / RING_RADIUS;
    return out.set(-Math.sin(dTheta), Math.cos(dTheta), 0);
  }

  /** Render-space position of the ring axis (the world's centre line). */
  axisPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, RING_RADIUS, 0);
  }
}

const _up = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _axial = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _basis = new THREE.Matrix4();
