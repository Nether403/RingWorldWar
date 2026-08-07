/**
 * The tactical camera.
 *
 * Its one non-obvious job: the pitch is tied to the zoom level. Close in, it
 * sits low and near-horizontal so you can read a mech's silhouette against the
 * ground. Pulled back, it tilts up so the ring sweeps into frame on both sides
 * and closes overhead. The game's beauty shot is therefore something the player
 * arrives at by playing normally, not a cutscene they watch once.
 *
 * The camera's focus lives in ring space (arc length + axial), so it wraps for
 * free: pan spinward long enough and you come back round to where you started.
 */

import * as THREE from 'three';
import { RING_HALF_WIDTH } from '@core/constants';
import { clamp, clamp01, lerp, smoothstep } from '@gen/noise';
import { wrapS } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';

export const ZOOM_MIN = 45;
/** Capped well below the ring radius. Any higher and the camera drifts toward
 *  the axis, which loses the "walls of the world rising around you" framing
 *  that is the entire reason to set a game inside a ring. */
export const ZOOM_MAX = 1150;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  /** Focus point on the ring surface. */
  s = 0;
  z = 0;
  /** Distance from the focus to the camera. Opens close enough that a mech is
   *  clearly a mech, since that first impression is doing a lot of work. */
  distance = 240;
  /** Rotation of the camera around the focus, radians. 0 looks spinward. */
  yaw = 0;

  private targetDistance = 240;
  private smoothS = 0;
  private smoothZ = 0;
  private smoothYaw = 0;
  private focusHeight = 0;
  private direct = false;
  private savedDistance = 240;

  /** Shake state, driven by impacts and footfalls. */
  private shake = 0;
  private shakeTime = 0;

  private readonly _pos = new THREE.Vector3();
  private readonly _target = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 1.0, 60000);
  }

  /**
   * Pitch in radians below the horizontal, derived from the zoom level.
   *
   * Deliberately shallow. A conventional RTS can pitch down 50 degrees or more
   * because there is nothing above the horizon worth seeing. Here there is: the
   * floor climbs away on every side and closes overhead, and a steep pitch puts
   * the entire frame below the horizontal, throwing away the one view that
   * makes this world what it is. 17 to 31 degrees keeps ground legible while
   * always leaving the top third of the frame for the world rising away.
   */
  get pitch(): number {
    if (this.direct) return 0.22;
    const t = smoothstep(ZOOM_MIN, ZOOM_MAX, this.distance);
    return lerp(0.30, 0.545, t);
  }

  /** Field of view widens slightly when zoomed out, exaggerating the curve. */
  private get targetFov(): number {
    if (this.direct) return 55;
    const t = smoothstep(ZOOM_MIN, ZOOM_MAX, this.distance);
    return lerp(46, 62, t);
  }

  setFocus(s: number, z: number): void {
    this.s = wrapS(s);
    this.z = clamp(z, -RING_HALF_WIDTH, RING_HALF_WIDTH);
    this.smoothS = this.s;
    this.smoothZ = this.z;
  }

  /** Pan in screen-relative metres. */
  pan(right: number, forward: number): void {
    // Panning speed scales with zoom, or it feels glued at range.
    const scale = 0.55 + this.distance * 0.0022;
    const c = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    this.s = wrapS(this.s + (forward * c - right * sn) * scale);
    this.z = clamp(this.z + (forward * sn + right * c) * scale, -RING_HALF_WIDTH + 60, RING_HALF_WIDTH - 60);
  }

  zoom(delta: number): void {
    // Multiplicative so each notch feels the same at every scale.
    this.targetDistance = clamp(this.targetDistance * Math.pow(1.12, delta), ZOOM_MIN, ZOOM_MAX);
  }

  rotate(delta: number): void {
    this.yaw += delta;
  }

  /** Apply an authored initial view without a visible interpolation from defaults. */
  setView(s: number, z: number, yaw: number, distance: number): void {
    this.setFocus(s, z);
    this.yaw = yaw;
    this.smoothYaw = yaw;
    this.distance = clamp(distance, ZOOM_MIN, ZOOM_MAX);
    this.targetDistance = this.distance;
  }

  enterDirect(): void {
    if (this.direct) return;
    this.direct = true;
    this.savedDistance = this.targetDistance;
    this.targetDistance = 68;
  }

  followDirect(s: number, z: number, yaw: number): void {
    if (!this.direct) return;
    this.s = wrapS(s);
    this.z = clamp(z, -RING_HALF_WIDTH, RING_HALF_WIDTH);
    this.yaw = yaw;
  }

  exitDirect(): void {
    if (!this.direct) return;
    this.direct = false;
    this.targetDistance = this.savedDistance;
  }

  get directMode(): boolean {
    return this.direct;
  }

  /** Add camera shake. `amount` is roughly metres of displacement. */
  addShake(amount: number): void {
    this.shake = Math.min(this.shake + amount, 14);
  }

  update(dt: number, anchor: RenderAnchor, terrain: Terrain): void {
    // Smooth everything -- an RTS camera that snaps feels cheap.
    const k = 1 - Math.exp(-dt * 12);
    this.distance = lerp(this.distance, this.targetDistance, k);
    this.smoothYaw = lerp(this.smoothYaw, this.yaw, k);

    // Follow the focus through the wrap without ever taking the long way.
    const kf = 1 - Math.exp(-dt * 18);
    this.smoothS = wrapS(this.smoothS + shortestDelta(this.smoothS, this.s) * kf);
    this.smoothZ = lerp(this.smoothZ, this.z, kf);

    // Ride the terrain so the camera does not clip through hills.
    const ground = terrain.heightAt(this.smoothS, this.smoothZ);
    this.focusHeight = lerp(this.focusHeight, ground, 1 - Math.exp(-dt * 6));

    this.camera.fov = lerp(this.camera.fov, this.targetFov, 1 - Math.exp(-dt * 6));
    // Keep the depth range as tight as the world allows. The far side of the
    // ring is only ~7.2 km away and the starfield sits just beyond that, so
    // there is no reason for a far plane in the tens of kilometres -- and a
    // huge near/far ratio wrecks depth precision for any screen-space effect.
    this.camera.near = clamp(this.distance * 0.05, 2, 40);
    this.camera.updateProjectionMatrix();

    // --- Build the camera transform in the local tangent frame --------------
    const pitch = this.pitch;
    const horiz = Math.cos(pitch) * this.distance;
    const vert = Math.sin(pitch) * this.distance;

    // Offset from the focus, in surface coordinates.
    const offS = -Math.cos(this.smoothYaw) * horiz;
    const offZ = -Math.sin(this.smoothYaw) * horiz;

    // Keep the camera above the ground it is standing behind. The pitch here is
    // shallow by design, so on terrain with 150 m of relief the camera would
    // otherwise end up inside a ridge and render nothing but the inside of a
    // hill. Sampling a few points along the view ray and taking the highest is
    // enough to clear a crest without the camera visibly popping.
    let clearance = this.focusHeight + vert;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const gs = this.smoothS + offS * t;
      const gz = this.smoothZ + offZ * t;
      clearance = Math.max(clearance, terrain.heightAt(gs, gz) + 55);
    }

    anchor.toVector(this.smoothS + offS, clearance, this.smoothZ + offZ, this._pos);
    // Aim above the focus, more so when zoomed out. This lifts the horizon down
    // the frame and lets the ring arc occupy the top without having to raise
    // the camera itself.
    const aimLift = this.distance * lerp(0.10, 0.42, smoothstep(ZOOM_MIN, ZOOM_MAX, this.distance));
    anchor.toVector(this.smoothS, this.focusHeight + aimLift, this.smoothZ, this._target);
    anchor.upAt(this.smoothS, this._up);

    // --- Shake ---------------------------------------------------------------
    if (this.shake > 0.001) {
      this.shakeTime += dt * 34;
      const decay = Math.exp(-dt * 6.5);
      const a = this.shake;
      this._pos.x += Math.sin(this.shakeTime * 1.7) * a * 0.6;
      this._pos.y += Math.sin(this.shakeTime * 2.3 + 1.1) * a * 0.5;
      this._pos.z += Math.sin(this.shakeTime * 1.3 + 2.7) * a * 0.6;
      this.shake *= decay;
    }

    this.camera.position.copy(this._pos);
    this.camera.up.copy(this._up);
    this.camera.lookAt(this._target);
  }

  /** How zoomed out we are, 0..1. Used to fade tactical overlays in and out. */
  get zoomFraction(): number {
    return clamp01(smoothstep(ZOOM_MIN, ZOOM_MAX, this.distance));
  }
}

function shortestDelta(from: number, to: number): number {
  const C = 2 * Math.PI * 3600;
  let d = (to - from) % C;
  if (d > C / 2) d -= C;
  else if (d < -C / 2) d += C;
  return d;
}
