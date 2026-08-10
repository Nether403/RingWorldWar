import * as THREE from 'three';
import { deltaS, wrapS } from '@core/ringMath';
import { hashSeed, Rng } from '@core/rng';
import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';
import {
  DISTRICT_PALETTES,
  DISTRICT_LIFE_CUES,
  DISTRICT_SILHOUETTE_STYLES,
  ENVIRONMENT_DISTRICT_PLAN,
  MAX_DISTRICT_SCATTER_ITEMS,
  parseDistrictPlan,
  type DistrictDefinition,
  type DistrictLifeCue,
  type DistrictPlan,
  type DistrictPattern,
  type DistrictPalette,
  type DistrictScale,
  type DistrictShape,
  type DistrictSilhouette,
} from './districtPlan';

const MAX_VISIBLE = 256;
const PLACEMENT_ATTEMPTS = 12;

export interface GeneratedDressingItem {
  readonly districtId: string;
  readonly layerId: string;
  readonly palette: DistrictPalette;
  readonly silhouette: DistrictSilhouette;
  readonly lifeCue: DistrictLifeCue | null;
  readonly scale: DistrictScale;
  readonly shape: DistrictShape;
  readonly color: number;
  readonly s: number;
  readonly z: number;
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly maxSlope: number;
  readonly phase: number;
}

interface Candidate {
  readonly item: GeneratedDressingItem;
  distanceSq: number;
}

interface ScaleCounts {
  overhead: number;
  tactical: number;
  micro: number;
}

type PaletteCounts = Record<DistrictPalette, number>;
type LifeCueCounts = Record<DistrictLifeCue, number>;

export interface BattlefieldDressingDiagnostics {
  districtIds: string[];
  generatedTotal: number;
  generatedByScale: ScaleCounts;
  generatedByPalette: PaletteCounts;
  generatedByLifeCue: LifeCueCounts;
  visibleTotal: number;
  visibleByScale: ScaleCounts;
  visibleByPalette: PaletteCounts;
  visibleByLifeCue: LifeCueCounts;
  visiblePalettes: DistrictPalette[];
  visibleLifeCues: DistrictLifeCue[];
  activityFrame: number;
  motionEnabled: boolean;
  matrixSignature: number[];
  colorSignature: number[];
  drawBuckets: number;
}

/** Authored, seeded district scatter. It never enters collision, LOS, navigation, or saves. */
export class BattlefieldDressing {
  readonly object = new THREE.Group();
  private readonly buckets: Record<DistrictShape, THREE.InstancedMesh>;
  private readonly items: GeneratedDressingItem[] = [];
  private readonly candidates: Candidate[] = [];
  private readonly eligible: Candidate[] = [];
  private readonly visible: GeneratedDressingItem[] = [];
  private readonly plan: DistrictPlan;
  private readonly generatedCounts = emptyScaleCounts();
  private readonly generatedPaletteCounts = emptyPaletteCounts();
  private readonly generatedLifeCueCounts = emptyLifeCueCounts();
  private visibleCounts = emptyScaleCounts();
  private visiblePaletteCounts = emptyPaletteCounts();
  private visibleLifeCueCounts = emptyLifeCueCounts();
  private lastAnchorVersion = -1;
  private lastActivityFrame = -1;
  private motionEnabled = true;
  private motionPreference: MediaQueryList | null = null;
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly localOrientation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly local = new THREE.Matrix4();
  private readonly basis = new THREE.Matrix4();
  private readonly result = new THREE.Matrix4();
  private readonly tilt = new THREE.Quaternion();
  private readonly color = new THREE.Color();
  private drawDistance = 2_400;
  private instanceCap = 192;

  constructor(seed: number, plan: DistrictPlan = ENVIRONMENT_DISTRICT_PLAN) {
    this.plan = parseDistrictPlan(plan);
    this.object.name = 'layered-district-scatter';
    this.buckets = {
      tower: this.createBucket('district-overhead-landmarks', new THREE.CylinderGeometry(0.5, 1, 1, 6), 0.34),
      slab: this.createBucket('district-tactical-shells', new THREE.BoxGeometry(1, 1, 1), 0.28),
      pipe: this.createBucket('district-tactical-trunks', new THREE.CylinderGeometry(1, 1, 1, 7), 0.62, true),
      debris: this.createBucket('district-bounded-detail', new THREE.OctahedronGeometry(0.7, 0), 0.4, true),
    };
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.setMotionEnabled(!this.motionPreference.matches);
      this.motionPreference.addEventListener('change', this.syncMotionPreference);
    }
    this.generate(seed);
  }

  setQuality(drawDistance: number, instanceCap: number, shadows: boolean): void {
    this.drawDistance = Math.max(200, drawDistance);
    this.instanceCap = Math.max(0, Math.min(MAX_VISIBLE, Math.floor(instanceCap)));
    for (const mesh of Object.values(this.buckets)) mesh.castShadow = shadows;
    this.lastAnchorVersion = -1;
  }

  setMotionEnabled(enabled: boolean): void {
    if (this.motionEnabled === enabled) return;
    this.motionEnabled = enabled;
    this.lastAnchorVersion = -1;
    this.lastActivityFrame = -1;
  }

  update(anchor: RenderAnchor, terrain: Terrain, visualTime?: number): void {
    const resolvedVisualTime = visualTime ?? (typeof window === 'undefined' ? 0 : performance.now() / 1_000);
    const activityFrame = this.motionEnabled ? Math.floor(Math.max(0, resolvedVisualTime) * 12) : 0;
    const selectionChanged = anchor.version !== this.lastAnchorVersion;
    if (!selectionChanged && activityFrame === this.lastActivityFrame) return;
    this.lastAnchorVersion = anchor.version;
    this.lastActivityFrame = activityFrame;

    if (selectionChanged) {
      this.visible.length = 0;
      this.visibleCounts = emptyScaleCounts();
      this.visiblePaletteCounts = emptyPaletteCounts();
      this.visibleLifeCueCounts = emptyLifeCueCounts();
      this.eligible.length = 0;

      const maximumDistanceSq = this.drawDistance * this.drawDistance;
      for (const candidate of this.candidates) {
        const ds = deltaS(anchor.s, candidate.item.s);
        const dz = candidate.item.z - anchor.z;
        candidate.distanceSq = ds * ds + dz * dz;
        if (candidate.distanceSq <= maximumDistanceSq) this.eligible.push(candidate);
      }
      this.eligible.sort((a, b) => scaleRank(a.item.scale) - scaleRank(b.item.scale)
        || a.distanceSq - b.distanceSq
        || a.item.layerId.localeCompare(b.item.layerId));

      const reserved = new Set<GeneratedDressingItem>();
      for (const palette of DISTRICT_PALETTES) {
        for (const scale of REQUIRED_LOW_SCALES) {
          const representative = this.eligible.find(({ item }) =>
            item.palette === palette
            && item.scale === scale
            && terrain.slopeAt(item.s, item.z) <= item.maxSlope);
          if (!representative || this.visible.length >= this.instanceCap) continue;
          this.selectVisible(representative.item);
          reserved.add(representative.item);
        }
      }
      for (const lifeCue of DISTRICT_LIFE_CUES) {
        const representative = this.eligible.find(({ item }) =>
          item.lifeCue === lifeCue
          && !reserved.has(item)
          && terrain.slopeAt(item.s, item.z) <= item.maxSlope);
        if (!representative || this.visible.length >= this.instanceCap) continue;
        this.selectVisible(representative.item);
        reserved.add(representative.item);
      }
      for (const { item } of this.eligible) {
        if (this.visible.length >= this.instanceCap) break;
        if (reserved.has(item)) continue;
        if (terrain.slopeAt(item.s, item.z) > item.maxSlope) continue;
        this.selectVisible(item);
      }
    }

    for (const mesh of Object.values(this.buckets)) mesh.count = 0;
    for (const item of this.visible) {
      this.place(this.buckets[item.shape], item, anchor, terrain, activityFrame / 12);
    }
    for (const mesh of Object.values(this.buckets)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  diagnostics(): BattlefieldDressingDiagnostics {
    const matrix = new THREE.Matrix4();
    const instanceColor = new THREE.Color();
    const matrixSignature: number[] = [];
    const colorSignature: number[] = [];
    for (const mesh of Object.values(this.buckets)) {
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix);
        mesh.getColorAt(index, instanceColor);
        matrixSignature.push(...matrix.elements.map((value) => Number(value.toFixed(4))));
        colorSignature.push(instanceColor.getHex());
      }
    }
    return {
      districtIds: this.plan.districts.map((district) => district.id),
      generatedTotal: this.items.length,
      generatedByScale: { ...this.generatedCounts },
      generatedByPalette: { ...this.generatedPaletteCounts },
      generatedByLifeCue: { ...this.generatedLifeCueCounts },
      visibleTotal: this.visible.length,
      visibleByScale: { ...this.visibleCounts },
      visibleByPalette: { ...this.visiblePaletteCounts },
      visibleByLifeCue: { ...this.visibleLifeCueCounts },
      visiblePalettes: Object.entries(this.visiblePaletteCounts)
        .filter(([, count]) => count > 0)
        .map(([palette]) => palette as DistrictPalette),
      visibleLifeCues: DISTRICT_LIFE_CUES.filter((lifeCue) => this.visibleLifeCueCounts[lifeCue] > 0),
      activityFrame: this.lastActivityFrame,
      motionEnabled: this.motionEnabled,
      matrixSignature,
      colorSignature,
      drawBuckets: Object.keys(this.buckets).length,
    };
  }

  generatedItems(): readonly GeneratedDressingItem[] {
    return this.items;
  }

  visibleItems(): readonly GeneratedDressingItem[] {
    return this.visible;
  }

  dispose(): void {
    this.motionPreference?.removeEventListener('change', this.syncMotionPreference);
    this.motionPreference = null;
    disposeObject(this.object);
    this.eligible.length = 0;
    this.visible.length = 0;
  }

  private createBucket(
    name: string,
    geometry: THREE.BufferGeometry,
    metalness: number,
    unlit = false,
  ): THREE.InstancedMesh {
    const material = unlit
      ? new THREE.MeshBasicMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0x111311,
          emissiveIntensity: 0.18,
          roughness: 0.82,
          metalness,
        });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_VISIBLE);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.add(mesh);
    return mesh;
  }

  private readonly syncMotionPreference = (): void => {
    this.setMotionEnabled(!(this.motionPreference?.matches ?? false));
  };

  private generate(seed: number): void {
    for (const cell of this.plan.ringLifeCells) {
      const style = DISTRICT_SILHOUETTE_STYLES[cell.silhouette];
      const rng = new Rng(seed ^ hashSeed(cell.id) ^ 0x19f41d);
      const item: GeneratedDressingItem = {
        districtId: 'inhabited-ring-corridor',
        layerId: cell.id,
        palette: cell.palette,
        silhouette: cell.silhouette,
        lifeCue: cell.lifeCue,
        scale: 'overhead',
        shape: style.shape,
        color: style.color,
        s: cell.centerS,
        z: cell.z,
        yaw: rng.range(0, Math.PI),
        width: cell.width,
        height: cell.height,
        depth: cell.depth,
        maxSlope: 1,
        phase: rng.range(0, Math.PI * 2),
      };
      this.items.push(item);
      this.candidates.push({ item, distanceSq: 0 });
      this.generatedCounts[item.scale]++;
      this.generatedPaletteCounts[item.palette]++;
      this.generatedLifeCueCounts[cell.lifeCue]++;
    }
    for (const district of this.plan.districts) {
      for (const layer of district.layers) {
        const style = DISTRICT_SILHOUETTE_STYLES[layer.silhouette];
        const rng = new Rng(seed ^ hashSeed(`${district.id}:${layer.id}`) ^ 0x51a7d3);
        for (let index = 0; index < layer.count && this.items.length < MAX_DISTRICT_SCATTER_ITEMS; index++) {
          const point = samplePoint(rng, district, layer.pattern, index);
          if (!point) continue;
          const item: GeneratedDressingItem = {
            districtId: district.id,
            layerId: layer.id,
            palette: district.palette,
            silhouette: layer.silhouette,
            lifeCue: layer.lifeCue,
            scale: layer.scale,
            shape: style.shape,
            color: style.color,
            s: point.s,
            z: point.z,
            yaw: yawForPattern(rng, layer.pattern, index),
            width: rng.range(layer.width[0], layer.width[1]),
            height: rng.range(layer.height[0], layer.height[1]),
            depth: rng.range(layer.depth[0], layer.depth[1]),
            maxSlope: layer.maxSlope,
            phase: rng.range(0, Math.PI * 2),
          };
          this.items.push(item);
          this.candidates.push({ item, distanceSq: 0 });
          this.generatedCounts[item.scale]++;
          this.generatedPaletteCounts[item.palette]++;
          if (item.lifeCue !== null) this.generatedLifeCueCounts[item.lifeCue]++;
        }
      }
    }
  }

  private place(
    mesh: THREE.InstancedMesh,
    item: GeneratedDressingItem,
    anchor: RenderAnchor,
    terrain: Terrain,
    visualTime: number,
  ): void {
    const signal = this.motionEnabled && item.lifeCue !== null
      ? Math.sin(visualTime * cueSpeed(item.lifeCue) + item.phase)
      : 0;
    const renderedS = item.s;
    const renderedYaw = item.lifeCue === 'vegetation' ? item.yaw + signal * 0.08 : item.yaw;
    const renderedHeight = item.height;
    const ground = terrain.heightAt(renderedS, item.z);
    anchor.toVector(renderedS, ground, item.z, this.position);
    anchor.orientation(renderedS, 0, this.orientation);
    this.basis.compose(this.position, this.orientation, ONE);
    this.localOrientation.setFromAxisAngle(UP, renderedYaw);
    let centerY = renderedHeight * 0.5;
    if (item.shape === 'pipe') {
      const tiltAngle = Math.PI * 0.5 + Math.sin(renderedYaw * 3.1) * 0.12;
      this.tilt.setFromAxisAngle(AXIAL, tiltAngle);
      this.localOrientation.multiply(this.tilt);
      centerY = item.width * 1.05 + Math.abs(Math.cos(tiltAngle)) * renderedHeight * 0.5;
    }
    this.scale.set(item.width, renderedHeight, item.depth);
    this.local.compose(LOCAL_CENTER.set(0, centerY, 0), this.localOrientation, this.scale);
    this.result.multiplyMatrices(this.basis, this.local);
    mesh.setMatrixAt(mesh.count++, this.result);
    const brightness = item.lifeCue === null || item.lifeCue === 'vegetation'
      ? 1
      : 0.72 + (signal + 1) * 0.14;
    mesh.setColorAt(mesh.count - 1, this.color.setHex(item.color).multiplyScalar(brightness));
  }

  private selectVisible(item: GeneratedDressingItem): void {
    this.visible.push(item);
    this.visibleCounts[item.scale]++;
    this.visiblePaletteCounts[item.palette]++;
    if (item.lifeCue !== null) this.visibleLifeCueCounts[item.lifeCue]++;
  }
}

function samplePoint(
  rng: Rng,
  district: DistrictDefinition,
  pattern: DistrictPattern,
  index: number,
): { s: number; z: number } | null {
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const normalized = patternedPoint(rng, pattern, index + attempt);
    const s = wrapS(district.centerS + normalized.s * district.halfLength);
    const z = district.zMin + (normalized.z + 1) * 0.5 * (district.zMax - district.zMin);
    if (!district.exclusions.some((exclusion) =>
      Math.abs(deltaS(exclusion.centerS, s)) <= exclusion.halfLength
      && z >= exclusion.zMin
      && z <= exclusion.zMax,
    )) return { s, z };
  }
  return null;
}

function patternedPoint(rng: Rng, pattern: DistrictPattern, index: number): { s: number; z: number } {
  if (pattern === 'anchors') {
    const anchor = DISTRICT_ANCHORS[index % DISTRICT_ANCHORS.length]!;
    return { s: anchor.s + rng.signed() * 0.025, z: anchor.z + rng.signed() * 0.025 };
  }
  if (pattern === 'clusters') {
    const anchor = DISTRICT_ANCHORS[index % DISTRICT_ANCHORS.length]!;
    return { s: anchor.s + rng.signed() * 0.11, z: anchor.z + rng.signed() * 0.11 };
  }
  if (pattern === 'rows') {
    const row = index % 2 === 0 ? -0.42 : 0.42;
    const column = Math.floor(index / 2) % 9;
    return { s: 0.2 + column * 0.085 + rng.signed() * 0.012, z: row + rng.signed() * 0.012 };
  }
  return { s: rng.signed(), z: rng.signed() };
}

function yawForPattern(rng: Rng, pattern: DistrictPattern, index: number): number {
  if (pattern === 'rows') return index % 2 === 0 ? 0 : Math.PI * 0.5;
  if (pattern === 'clusters') return (index % 4) * Math.PI * 0.5 + rng.signed() * 0.08;
  return rng.range(0, Math.PI);
}

function emptyScaleCounts(): ScaleCounts {
  return { overhead: 0, tactical: 0, micro: 0 };
}

function emptyPaletteCounts(): PaletteCounts {
  return {
    'arc-city': 0,
    agricultural: 0,
    'spinal-industrial': 0,
    'breach-evacuation': 0,
  };
}

function emptyLifeCueCounts(): LifeCueCounts {
  return { habitation: 0, vegetation: 0, transit: 0, ambient: 0 };
}

function cueSpeed(lifeCue: DistrictLifeCue): number {
  if (lifeCue === 'transit') return 1.4;
  if (lifeCue === 'vegetation') return 0.7;
  if (lifeCue === 'habitation') return 0.45;
  return 0.9;
}

function scaleRank(scale: DistrictScale): number {
  if (scale === 'overhead') return 0;
  if (scale === 'tactical') return 1;
  return 2;
}

const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const AXIAL = new THREE.Vector3(0, 0, 1);
const LOCAL_CENTER = new THREE.Vector3();
const REQUIRED_LOW_SCALES: readonly DistrictScale[] = ['overhead', 'tactical'];
const DISTRICT_ANCHORS = [
  { s: 0.22, z: -0.48 },
  { s: 0.22, z: 0.48 },
  { s: 0.42, z: -0.3 },
  { s: 0.42, z: 0.3 },
  { s: 0.62, z: -0.48 },
  { s: 0.62, z: 0.48 },
  { s: 0.82, z: -0.3 },
  { s: 0.82, z: 0.3 },
] as const;
