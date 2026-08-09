import * as THREE from 'three';
import { RING_RADIUS, SHADOW_SQUARE_COUNT } from '@core/constants';
import { deltaS, wrapS } from '@core/ringMath';
import { STRUCTURES, type Faction } from '@sim/data';
import type { StrategicContactCategory, World } from '@sim/world';
import type { RenderAnchor } from './anchor';

export const STRATEGIC_LAYER = 2;

const SEGMENTS = 192;
const INNER_RADIUS = RING_RADIUS - 130;
const OUTER_RADIUS = RING_RADIUS + 130;
const MARKER_RADIUS = RING_RADIUS - 8;
const MAX_MARKERS_PER_CATEGORY = 32;
const CATEGORIES: readonly StrategicContactCategory[] = [
  'bastion',
  'launch-site',
  'active-node',
  'major-construction',
];

export interface StrategicAnnulusSnapshot {
  readonly shadowPanelCount: number;
  readonly hostileContactCount: number;
  readonly hostileCategories: readonly StrategicContactCategory[];
  readonly friendlyLandmarkCount: number;
  readonly markerCount: number;
  readonly renderables: number;
}

export function projectSurfaceToAnnulus(
  s: number,
  anchorS: number,
  radius = MARKER_RADIUS,
): { x: number; y: number } {
  const theta = deltaS(anchorS, s) / RING_RADIUS;
  return {
    x: Math.sin(theta) * radius,
    y: -Math.cos(theta) * radius,
  };
}

export class StrategicAnnulus {
  readonly object = new THREE.Group();

  private readonly annulus: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly hostileMarkers = new Map<StrategicContactCategory, THREE.InstancedMesh>();
  private readonly friendlyMarkers = new Map<StrategicContactCategory, THREE.InstancedMesh>();
  private readonly focusMarker: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly rotation = new THREE.Quaternion();
  private readonly dayColor = new THREE.Color('#536b79');
  private readonly shadowColor = new THREE.Color('#18243a');
  private readonly sampleColor = new THREE.Color();
  private disposed = false;
  private currentSnapshot: StrategicAnnulusSnapshot = Object.freeze({
    shadowPanelCount: SHADOW_SQUARE_COUNT,
    hostileContactCount: 0,
    hostileCategories: Object.freeze([]),
    friendlyLandmarkCount: 0,
    markerCount: 1,
    renderables: 0,
  });

  constructor() {
    this.object.name = 'strategic-annulus';
    this.object.position.set(0, RING_RADIUS, 0);

    const geometry = createAnnulusGeometry();
    this.colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    this.annulus = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }));
    this.annulus.name = 'strategic-annulus:shadow-bands';
    this.object.add(this.annulus);

    this.object.add(
      createOutline(INNER_RADIUS, '#607d8c'),
      createOutline(OUTER_RADIUS, '#9fb6c3'),
    );

    const geometries = createMarkerGeometries();
    const hostileMaterial = new THREE.MeshBasicMaterial({
      color: '#f3c778',
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const friendlyMaterial = new THREE.MeshBasicMaterial({
      color: '#8fd5ff',
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    for (const category of CATEGORIES) {
      const hostile = markerPool(geometries.get(category)!, hostileMaterial, `hostile:${category}`);
      const friendly = markerPool(geometries.get(category)!, friendlyMaterial, `friendly:${category}`);
      this.hostileMarkers.set(category, hostile);
      this.friendlyMarkers.set(category, friendly);
      this.object.add(hostile, friendly);
    }

    this.focusMarker = new THREE.Mesh(
      new THREE.RingGeometry(58, 84, 4),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.focusMarker.name = 'strategic-annulus:tactical-focus';
    this.focusMarker.position.z = 8;
    this.object.add(this.focusMarker);

    this.object.traverse((child) => child.layers.set(STRATEGIC_LAYER));
    this.currentSnapshot = Object.freeze({
      ...this.currentSnapshot,
      renderables: countRenderables(this.object),
    });
  }

  get snapshot(): StrategicAnnulusSnapshot {
    return this.currentSnapshot;
  }

  update(world: World, viewer: Faction, anchor: RenderAnchor, focusS: number): void {
    if (this.disposed) return;
    this.updateShadowBands(world, anchor.s);
    const hostile = world.strategicContacts(viewer);
    const friendly = world.structures.filter((structure) =>
      structure.alive && structure.faction === viewer && strategicCategory(structure.kind, structure.progress) !== null);

    for (const category of CATEGORIES) {
      const hostilePool = this.hostileMarkers.get(category)!;
      const friendlyPool = this.friendlyMarkers.get(category)!;
      hostilePool.count = 0;
      friendlyPool.count = 0;
      for (const contact of hostile) {
        if (contact.category !== category || hostilePool.count >= MAX_MARKERS_PER_CATEGORY) continue;
        this.placeMarker(hostilePool, hostilePool.count++, contact.s, anchor.s, category, 7, 1.18);
      }
      for (const structure of friendly) {
        if (strategicCategory(structure.kind, structure.progress) !== category ||
          friendlyPool.count >= MAX_MARKERS_PER_CATEGORY) continue;
        this.placeMarker(friendlyPool, friendlyPool.count++, structure.s, anchor.s, category, 6, 1);
      }
      hostilePool.instanceMatrix.needsUpdate = true;
      friendlyPool.instanceMatrix.needsUpdate = true;
    }

    const focus = projectSurfaceToAnnulus(focusS, anchor.s, MARKER_RADIUS);
    this.focusMarker.position.set(focus.x, focus.y, 10);
    const hostileCategories = [...new Set(hostile.map((contact) => contact.category))].sort();
    const displayedMarkers = [...this.hostileMarkers.values(), ...this.friendlyMarkers.values()]
      .reduce((total, pool) => total + pool.count, 1);
    this.currentSnapshot = Object.freeze({
      shadowPanelCount: SHADOW_SQUARE_COUNT,
      hostileContactCount: hostile.length,
      hostileCategories: Object.freeze(hostileCategories),
      friendlyLandmarkCount: friendly.length,
      markerCount: displayedMarkers,
      renderables: countRenderables(this.object),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.object.traverse((child) => {
      const renderable = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
        dispose?: () => void;
      };
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        const entries = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of entries) materials.add(material);
      }
      if (child instanceof THREE.InstancedMesh) child.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.object.clear();
  }

  private updateShadowBands(world: World, anchorS: number): void {
    const colors = this.colorAttribute.array as Float32Array;
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const theta = ((segment + 0.5) / SEGMENTS) * Math.PI * 2;
      const s = wrapS(anchorS + theta * RING_RADIUS);
      this.sampleColor.lerpColors(this.shadowColor, this.dayColor, world.daylightAt(s));
      for (let vertex = 0; vertex < 4; vertex++) {
        const index = (segment * 4 + vertex) * 3;
        colors[index] = this.sampleColor.r;
        colors[index + 1] = this.sampleColor.g;
        colors[index + 2] = this.sampleColor.b;
      }
    }
    this.colorAttribute.needsUpdate = true;
  }

  private placeMarker(
    pool: THREE.InstancedMesh,
    index: number,
    s: number,
    anchorS: number,
    category: StrategicContactCategory,
    z: number,
    affiliationScale: number,
  ): void {
    const point = projectSurfaceToAnnulus(s, anchorS);
    const size = category === 'bastion' ? 1.35 : category === 'major-construction' ? 0.9 : 1;
    this.position.set(point.x, point.y, z);
    this.scale.setScalar(size * affiliationScale);
    this.matrix.compose(this.position, this.rotation, this.scale);
    pool.setMatrixAt(index, this.matrix);
  }
}

function createAnnulusGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(SEGMENTS * 4 * 3);
  const colors = new Float32Array(SEGMENTS * 4 * 3);
  const indices = new Uint16Array(SEGMENTS * 6);
  for (let segment = 0; segment < SEGMENTS; segment++) {
    const a0 = (segment / SEGMENTS) * Math.PI * 2;
    const a1 = ((segment + 1) / SEGMENTS) * Math.PI * 2;
    const points = [
      [Math.sin(a0) * INNER_RADIUS, -Math.cos(a0) * INNER_RADIUS],
      [Math.sin(a0) * OUTER_RADIUS, -Math.cos(a0) * OUTER_RADIUS],
      [Math.sin(a1) * INNER_RADIUS, -Math.cos(a1) * INNER_RADIUS],
      [Math.sin(a1) * OUTER_RADIUS, -Math.cos(a1) * OUTER_RADIUS],
    ];
    for (let vertex = 0; vertex < 4; vertex++) {
      const offset = (segment * 4 + vertex) * 3;
      positions[offset] = points[vertex]![0]!;
      positions[offset + 1] = points[vertex]![1]!;
      positions[offset + 2] = 0;
      colors[offset] = colors[offset + 1] = colors[offset + 2] = 0.3;
    }
    const vertex = segment * 4;
    const index = segment * 6;
    indices.set([vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3], index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createOutline(radius: number, color: THREE.ColorRepresentation): THREE.LineLoop {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.sin(angle) * radius, -Math.cos(angle) * radius, 2));
  }
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false }),
  );
  line.name = `strategic-annulus:outline:${radius}`;
  return line;
}

function createMarkerGeometries(): Map<StrategicContactCategory, THREE.BufferGeometry> {
  const geometries = new Map<StrategicContactCategory, THREE.BufferGeometry>();
  geometries.set('bastion', new THREE.CircleGeometry(54, 12));
  geometries.set('launch-site', new THREE.CircleGeometry(60, 3));
  geometries.set('active-node', new THREE.PlaneGeometry(86, 86));
  geometries.set('major-construction', new THREE.RingGeometry(34, 54, 4));
  return geometries;
}

function markerPool(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_MARKERS_PER_CATEGORY);
  mesh.name = `strategic-annulus:${name}`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

function strategicCategory(
  kind: keyof typeof STRUCTURES,
  progress: number,
): StrategicContactCategory | null {
  const definition = STRUCTURES[kind];
  if (progress < 1 && definition.majorConstruction) return 'major-construction';
  if (progress >= 1 && definition.overheadIntel) return definition.overheadIntel;
  if (progress >= 1 && kind === 'spinalNode') return 'active-node';
  return null;
}

function countRenderables(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) count++;
  });
  return count;
}
