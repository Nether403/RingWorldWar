import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';

interface AuthoredBuildingAsset {
  readonly id: string;
  readonly url: string;
}

interface AuthoredBuildingPlacement {
  readonly id: string;
  readonly assetId: string;
  readonly s: number;
  readonly z: number;
  readonly yaw: number;
}

export interface AuthoredBuildingPilotDiagnostics {
  readonly loaded: boolean;
  readonly assetIds: readonly string[];
  readonly placementIds: readonly string[];
  readonly meshCount: number;
}

const ASSET_ROOT = '/assets/buildings/ondrasaur';

/** Bounded first cohort: five static models chosen for a close-range visual review. */
const ASSETS: readonly AuthoredBuildingAsset[] = [
  { id: 'outpost-tower-low-a', url: `${ASSET_ROOT}/outpost-tower-low-a.glb` },
  { id: 'settlement-large-a', url: `${ASSET_ROOT}/settlement-large-a.glb` },
  { id: 'settlement-large-broad-a', url: `${ASSET_ROOT}/settlement-large-broad-a.glb` },
  { id: 'settlement-large-narrow-a', url: `${ASSET_ROOT}/settlement-large-narrow-a.glb` },
  { id: 'settlement-large-square-a', url: `${ASSET_ROOT}/settlement-large-square-a.glb` },
];

/**
 * Presentation-only placements near the two normal skirmish starts. They are
 * deliberately independent of entities, saves, collision, navigation, and LOS.
 */
const PLACEMENTS: readonly AuthoredBuildingPlacement[] = [
  { id: 'compact-pilot-tower', assetId: 'outpost-tower-low-a', s: 180, z: -150, yaw: 0.25 },
  { id: 'compact-pilot-square', assetId: 'settlement-large-square-a', s: 270, z: 140, yaw: -0.45 },
  { id: 'compact-pilot-broad', assetId: 'settlement-large-broad-a', s: 390, z: 20, yaw: 0.65 },
  { id: 'choir-pilot-large', assetId: 'settlement-large-a', s: 11_490, z: -160, yaw: Math.PI + 0.35 },
  { id: 'choir-pilot-narrow', assetId: 'settlement-large-narrow-a', s: 11_650, z: 145, yaw: Math.PI - 0.3 },
];

/**
 * First authored-asset pilot. Models are normalised at load, then positioned in
 * ring space on every anchor rebase. The source GLBs remain presentation-only.
 */
export class AuthoredBuildingPilot {
  readonly object = new THREE.Group();
  private readonly sources = new Map<string, THREE.Group>();
  private readonly instances: THREE.Group[] = [];
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private lastAnchorVersion = -1;
  private loaded = false;
  private shadows = true;

  constructor() {
    this.object.name = 'authored-building-pilot';
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const loader = new GLTFLoader();
    const loadedAssets = await Promise.all(ASSETS.map(async (asset) => ({
      id: asset.id,
      scene: this.normalise(await loader.loadAsync(asset.url), asset.id),
    })));
    for (const asset of loadedAssets) this.sources.set(asset.id, asset.scene);
    for (const placement of PLACEMENTS) {
      const source = this.sources.get(placement.assetId);
      if (!source) throw new Error(`Missing authored-building pilot asset: ${placement.assetId}`);
      const instance = source.clone(true);
      instance.name = `authored-building:${placement.id}`;
      this.instances.push(instance);
      this.object.add(instance);
    }
    this.loaded = true;
    this.setQuality(this.shadows);
  }

  setQuality(shadows: boolean): void {
    this.shadows = shadows;
    this.object.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = shadows;
      object.receiveShadow = shadows;
    });
  }

  update(anchor: RenderAnchor, terrain: Terrain): void {
    if (!this.loaded || anchor.version === this.lastAnchorVersion) return;
    this.lastAnchorVersion = anchor.version;
    for (let index = 0; index < PLACEMENTS.length; index++) {
      const placement = PLACEMENTS[index]!;
      const instance = this.instances[index]!;
      anchor.toVector(placement.s, terrain.heightAt(placement.s, placement.z), placement.z, this.position);
      anchor.orientation(placement.s, placement.yaw, this.orientation);
      instance.position.copy(this.position);
      instance.quaternion.copy(this.orientation);
      instance.updateMatrixWorld();
    }
  }

  diagnostics(): AuthoredBuildingPilotDiagnostics {
    let meshCount = 0;
    this.object.traverse((object) => {
      if (object instanceof THREE.Mesh) meshCount++;
    });
    return {
      loaded: this.loaded,
      assetIds: ASSETS.map((asset) => asset.id),
      placementIds: PLACEMENTS.map((placement) => placement.id),
      meshCount,
    };
  }

  dispose(): void {
    disposeObject(this.object);
    this.sources.clear();
    this.instances.length = 0;
    this.loaded = false;
  }

  private normalise(gltf: { scene: THREE.Group }, assetId: string): THREE.Group {
    const scene = gltf.scene;
    scene.name = `authored-building-source:${assetId}`;
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    if (bounds.isEmpty()) throw new Error(`Authored-building pilot asset has no visible bounds: ${assetId}`);
    const center = bounds.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -bounds.min.y, -center.z);
    scene.updateMatrixWorld(true);
    return scene;
  }
}
