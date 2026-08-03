import * as THREE from 'three';
import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { deltaS } from '@core/ringMath';
import { Rng } from '@core/rng';
import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';

const DRESSING_COUNT = 320;
const MAX_VISIBLE = 256;

interface DressingItem {
  s: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  depth: number;
  pipe: boolean;
}

/** Seeded, non-interactive ruins. They never enter collision, LOS, or navigation. */
export class BattlefieldDressing {
  readonly object = new THREE.Group();
  private readonly slabs: THREE.InstancedMesh;
  private readonly pipes: THREE.InstancedMesh;
  private readonly items: DressingItem[] = [];
  private lastAnchorVersion = -1;
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly localOrientation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly local = new THREE.Matrix4();
  private readonly basis = new THREE.Matrix4();
  private readonly result = new THREE.Matrix4();
  private readonly tilt = new THREE.Quaternion();
  private drawDistance = 2_400;
  private instanceCap = 192;

  constructor(seed: number) {
    this.object.name = 'battlefield-dressing';
    const slabMaterial = new THREE.MeshStandardMaterial({
      color: 0x625b50,
      roughness: 0.88,
      metalness: 0.28,
    });
    const pipeMaterial = new THREE.MeshStandardMaterial({
      color: 0x4c5558,
      roughness: 0.72,
      metalness: 0.62,
    });
    this.slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), slabMaterial, MAX_VISIBLE);
    this.pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 7), pipeMaterial, MAX_VISIBLE);
    for (const mesh of [this.slabs, this.pipes]) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.object.add(mesh);
    }

    const rng = new Rng(seed ^ 0x51a7d3);
    for (let index = 0; index < DRESSING_COUNT; index++) {
      const pipe = rng.chance(0.28);
      this.items.push({
        s: rng.range(0, RING_CIRCUMFERENCE),
        z: rng.range(-RING_HALF_WIDTH * 0.92, RING_HALF_WIDTH * 0.92),
        yaw: rng.range(0, Math.PI),
        width: pipe ? rng.range(0.7, 1.8) : rng.range(5, 18),
        height: pipe ? rng.range(5, 22) : rng.range(1.2, 7),
        depth: pipe ? rng.range(0.7, 1.8) : rng.range(2, 9),
        pipe,
      });
    }
  }

  setQuality(drawDistance: number, instanceCap: number, shadows: boolean): void {
    this.drawDistance = Math.max(200, drawDistance);
    this.instanceCap = Math.max(0, Math.min(MAX_VISIBLE * 2, Math.floor(instanceCap)));
    this.slabs.castShadow = shadows;
    this.pipes.castShadow = shadows;
    this.lastAnchorVersion = -1;
  }

  update(anchor: RenderAnchor, terrain: Terrain): void {
    if (anchor.version === this.lastAnchorVersion) return;
    this.lastAnchorVersion = anchor.version;
    this.slabs.count = 0;
    this.pipes.count = 0;

    const candidates = this.items
      .map((item) => {
        const ds = deltaS(anchor.s, item.s);
        const dz = item.z - anchor.z;
        return { item, distanceSq: ds * ds + dz * dz, ds, dz };
      })
      .filter((candidate) => candidate.distanceSq <= this.drawDistance * this.drawDistance)
      .sort((a, b) => a.distanceSq - b.distanceSq);
    let placed = 0;
    for (const { item } of candidates) {
      if (placed >= this.instanceCap) break;
      const mesh = item.pipe ? this.pipes : this.slabs;
      if (mesh.count >= MAX_VISIBLE) continue;
      const ground = terrain.heightAt(item.s, item.z);
      anchor.toVector(item.s, ground, item.z, this.position);
      anchor.orientation(item.s, 0, this.orientation);
      this.basis.compose(this.position, this.orientation, ONE);
      this.localOrientation.setFromAxisAngle(UP, item.yaw);
      let centerY = item.height * 0.5;
      if (item.pipe) {
        const tiltAngle = Math.PI * 0.5 + Math.sin(item.yaw * 3.1) * 0.12;
        this.tilt.setFromAxisAngle(AXIAL, tiltAngle);
        this.localOrientation.multiply(this.tilt);
        centerY = item.width * 1.05 + Math.abs(Math.cos(tiltAngle)) * item.height * 0.5;
      }
      this.scale.set(item.width, item.height, item.depth);
      this.local.compose(LOCAL_CENTER.set(0, centerY, 0), this.localOrientation, this.scale);
      this.result.multiplyMatrices(this.basis, this.local);
      mesh.setMatrixAt(mesh.count++, this.result);
      placed++;
    }
    this.slabs.instanceMatrix.needsUpdate = true;
    this.pipes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.slabs, this.pipes]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const AXIAL = new THREE.Vector3(0, 0, 1);
const LOCAL_CENTER = new THREE.Vector3();
