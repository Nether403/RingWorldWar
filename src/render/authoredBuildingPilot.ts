import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';
import { makeHabitationMaterial, type HabitationUniforms } from './materials/habitationMaterial';

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
  readonly materialColors: readonly string[];
  readonly minRoughness: number;
  readonly maxMetalness: number;
}

const ASSET_ROOT = '/assets/buildings/ondrasaur';

/**
 * All ten distinct settlement forms in the shipped catalogue.
 *
 * The first cohort loaded five and placed five. Now that the models wear the
 * shared procedural surface rather than a flat albedo, variety is worth having:
 * a settlement built from two silhouettes reads as a texture swatch, not a town.
 */
const ASSETS: readonly AuthoredBuildingAsset[] = [
  { id: 'outpost-tower-low-a', url: `${ASSET_ROOT}/outpost-tower-low-a.glb` },
  { id: 'settlement-large-a', url: `${ASSET_ROOT}/settlement-large-a.glb` },
  { id: 'settlement-large-broad-a', url: `${ASSET_ROOT}/settlement-large-broad-a.glb` },
  { id: 'settlement-large-narrow-a', url: `${ASSET_ROOT}/settlement-large-narrow-a.glb` },
  { id: 'settlement-large-square-a', url: `${ASSET_ROOT}/settlement-large-square-a.glb` },
  { id: 'settlement-small-a', url: `${ASSET_ROOT}/settlement-small-a.glb` },
  { id: 'settlement-dual-a', url: `${ASSET_ROOT}/settlement-dual-a.glb` },
  { id: 'settlement-dual-small-a', url: `${ASSET_ROOT}/settlement-dual-small-a.glb` },
  { id: 'settlement-cluster-small-a', url: `${ASSET_ROOT}/settlement-cluster-small-a.glb` },
  { id: 'settlement-cluster-tower-a', url: `${ASSET_ROOT}/settlement-cluster-tower-a.glb` },
];

/**
 * Presentation-only placements near the two normal skirmish starts. They remain
 * deliberately independent of entities, saves, collision, navigation, and LOS.
 */
const PLACEMENTS: readonly AuthoredBuildingPlacement[] = [
  { id: 'compact-pilot-tower', assetId: 'outpost-tower-low-a', s: 180, z: -150, yaw: 0.25 },
  { id: 'compact-pilot-square', assetId: 'settlement-large-square-a', s: 270, z: 140, yaw: -0.45 },
  { id: 'compact-pilot-broad', assetId: 'settlement-large-broad-a', s: 390, z: 20, yaw: 0.65 },
  { id: 'compact-pilot-small', assetId: 'settlement-small-a', s: 320, z: -230, yaw: 1.15 },
  { id: 'compact-pilot-dual', assetId: 'settlement-dual-a', s: 470, z: -90, yaw: -0.85 },
  { id: 'compact-pilot-cluster', assetId: 'settlement-cluster-small-a', s: 120, z: 210, yaw: 2.05 },
  { id: 'choir-pilot-large', assetId: 'settlement-large-a', s: 11_490, z: -160, yaw: Math.PI + 0.35 },
  { id: 'choir-pilot-narrow', assetId: 'settlement-large-narrow-a', s: 11_650, z: 145, yaw: Math.PI - 0.3 },
  { id: 'choir-pilot-dual-small', assetId: 'settlement-dual-small-a', s: 11_380, z: 60, yaw: Math.PI + 1.1 },
  { id: 'choir-pilot-cluster-tower', assetId: 'settlement-cluster-tower-a', s: 11_760, z: -215, yaw: Math.PI - 1.4 },
];

/** Stable per-placement seed, so a building's surface never changes between runs. */
function placementSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 997;
}

/**
 * First authored-asset pilot. Models are normalised at load, then positioned in
 * ring space on every anchor rebase. The source GLBs remain presentation-only.
 */
export class AuthoredBuildingPilot {
  readonly object = new THREE.Group();
  private readonly sources = new Map<string, THREE.Group>();
  private readonly instances: THREE.Group[] = [];
  private readonly materials: Array<{
    material: THREE.MeshStandardMaterial;
    uniforms: HabitationUniforms;
  }> = [];
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

      // The model is wrapped rather than positioned directly. `normalise` stores
      // the footprint-centring and ground-alignment offset on the source root's
      // own `position`, and the previous implementation overwrote that property
      // when placing, silently discarding it: every pilot building was seated on
      // its raw glTF origin instead of on its footprint. The wrapper carries the
      // ring transform so the inner offset survives.
      const model = source.clone(true);
      model.name = `authored-building-model:${placement.id}`;
      const instance = new THREE.Group();
      instance.name = `authored-building:${placement.id}`;
      instance.add(model);

      // One material per building, so each gets its own surface seed. These are a
      // handful of static presentation meshes, so the material count is not a
      // meaningful cost, and sharing one would make every settlement identical.
      const habitation = makeHabitationMaterial(placementSeed(placement.id));
      this.materials.push(habitation);
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material = habitation.material;
      });

      this.instances.push(instance);
      this.object.add(instance);
    }
    this.loaded = true;
    this.setQuality(this.shadows);
  }

  /**
   * Light the windows as the shadow squares pass overhead.
   *
   * Driven from the same daylight value as the colour grade, so a settlement
   * coming alive is part of the terminator sweeping across the map rather than an
   * independent effect.
   */
  setNightGlow(nightGlow: number): void {
    const clamped = Math.min(1, Math.max(0, nightGlow));
    for (const entry of this.materials) entry.uniforms.uNightGlow.value = clamped;
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
    const materialColors = new Set<string>();
    let minRoughness = 1;
    let maxMetalness = 0;
    this.object.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount++;
      for (const material of this.materialsOf(object)) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        materialColors.add(`#${material.color.getHexString()}`);
        minRoughness = Math.min(minRoughness, material.roughness);
        maxMetalness = Math.max(maxMetalness, material.metalness);
      }
    });
    return {
      loaded: this.loaded,
      assetIds: ASSETS.map((asset) => asset.id),
      placementIds: PLACEMENTS.map((placement) => placement.id),
      meshCount,
      materialColors: [...materialColors].sort(),
      minRoughness,
      maxMetalness,
    };
  }

  dispose(): void {
    disposeObject(this.object);
    this.materials.length = 0;
    this.sources.clear();
    this.instances.length = 0;
    this.loaded = false;
  }

  private normalise(gltf: { scene: THREE.Group }, assetId: string): THREE.Group {
    const scene = gltf.scene;
    scene.name = `authored-building-source:${assetId}`;
    // Materials are not touched here any more. The imported ones were being
    // forced to a flat sandstone albedo, which is precisely what made these
    // models read as untextured clay beside the procedural structures. Each
    // placement is given a shared procedural habitation material in `load`
    // instead. The GLBs carry vertex normals and no UVs, verified from their JSON
    // chunks, which is why that material has to be triplanar in object space.
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    if (bounds.isEmpty()) throw new Error(`Authored-building pilot asset has no visible bounds: ${assetId}`);
    const center = bounds.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -bounds.min.y, -center.z);
    scene.updateMatrixWorld(true);
    return scene;
  }

  private materialsOf(mesh: THREE.Mesh): THREE.Material[] {
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  }
}
