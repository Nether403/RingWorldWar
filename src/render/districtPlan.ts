import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';

export type DistrictScale = 'overhead' | 'tactical' | 'micro';
export type DistrictShape = 'tower' | 'slab' | 'pipe' | 'debris';
export type DistrictPattern = 'anchors' | 'clusters' | 'rows' | 'scatter';

export interface DistrictExclusion {
  centerS: number;
  halfLength: number;
  zMin: number;
  zMax: number;
}

export interface DistrictLayer {
  id: string;
  scale: DistrictScale;
  shape: DistrictShape;
  pattern: DistrictPattern;
  count: number;
  maxSlope: number;
  width: [number, number];
  height: [number, number];
  depth: [number, number];
}

export interface DistrictDefinition {
  id: string;
  centerS: number;
  halfLength: number;
  zMin: number;
  zMax: number;
  exclusions: DistrictExclusion[];
  layers: DistrictLayer[];
}

export interface DistrictPlan {
  version: 1;
  districts: DistrictDefinition[];
}

const MAX_DISTRICTS = 16;
const MAX_LAYERS_PER_DISTRICT = 8;
const MAX_ITEMS_PER_LAYER = 256;
export const MAX_DISTRICT_SCATTER_ITEMS = 2_048;

export function parseDistrictPlan(value: unknown): DistrictPlan {
  const root = record(value, 'district plan');
  exactKeys(root, ['version', 'districts'], 'district plan');
  if (root.version !== 1) throw new Error('District plan version must be 1');
  const rawDistricts = array(root.districts, 'district plan districts');
  if (rawDistricts.length < 1 || rawDistricts.length > MAX_DISTRICTS) {
    throw new Error(`District plan must contain 1..${MAX_DISTRICTS} districts`);
  }

  const districtIds = new Set<string>();
  let itemCount = 0;
  const districts = rawDistricts.map((raw, districtIndex): DistrictDefinition => {
    const path = `district plan districts[${districtIndex}]`;
    const district = record(raw, path);
    exactKeys(district, ['id', 'centerS', 'halfLength', 'zMin', 'zMax', 'exclusions', 'layers'], path);
    const id = identifier(district.id, `${path}.id`);
    if (districtIds.has(id)) throw new Error(`Duplicate district id: ${id}`);
    districtIds.add(id);
    const centerS = finite(district.centerS, `${path}.centerS`);
    if (centerS < 0 || centerS >= RING_CIRCUMFERENCE) throw new Error(`${path}.centerS is outside the ring`);
    const halfLength = positive(district.halfLength, `${path}.halfLength`);
    if (halfLength > RING_CIRCUMFERENCE / 2) throw new Error(`${path}.halfLength is unbounded`);
    const zMin = finite(district.zMin, `${path}.zMin`);
    const zMax = finite(district.zMax, `${path}.zMax`);
    axialRange(zMin, zMax, path);

    const exclusions = array(district.exclusions, `${path}.exclusions`).map((rawExclusion, exclusionIndex) => {
      const exclusionPath = `${path}.exclusions[${exclusionIndex}]`;
      const exclusion = record(rawExclusion, exclusionPath);
      exactKeys(exclusion, ['centerS', 'halfLength', 'zMin', 'zMax'], exclusionPath);
      const exclusionCenter = finite(exclusion.centerS, `${exclusionPath}.centerS`);
      if (exclusionCenter < 0 || exclusionCenter >= RING_CIRCUMFERENCE) {
        throw new Error(`${exclusionPath}.centerS is outside the ring`);
      }
      const exclusionHalfLength = positive(exclusion.halfLength, `${exclusionPath}.halfLength`);
      const exclusionZMin = finite(exclusion.zMin, `${exclusionPath}.zMin`);
      const exclusionZMax = finite(exclusion.zMax, `${exclusionPath}.zMax`);
      axialRange(exclusionZMin, exclusionZMax, exclusionPath);
      return {
        centerS: exclusionCenter,
        halfLength: exclusionHalfLength,
        zMin: exclusionZMin,
        zMax: exclusionZMax,
      };
    });

    const rawLayers = array(district.layers, `${path}.layers`);
    if (rawLayers.length < 1 || rawLayers.length > MAX_LAYERS_PER_DISTRICT) {
      throw new Error(`${path}.layers must contain 1..${MAX_LAYERS_PER_DISTRICT} layers`);
    }
    const layerIds = new Set<string>();
    const layers = rawLayers.map((rawLayer, layerIndex): DistrictLayer => {
      const layerPath = `${path}.layers[${layerIndex}]`;
      const layer = record(rawLayer, layerPath);
      exactKeys(layer, ['id', 'scale', 'shape', 'pattern', 'count', 'maxSlope', 'width', 'height', 'depth'], layerPath);
      const layerId = identifier(layer.id, `${layerPath}.id`);
      if (layerIds.has(layerId)) throw new Error(`Duplicate layer id in ${id}: ${layerId}`);
      layerIds.add(layerId);
      if (!isScale(layer.scale)) throw new Error(`${layerPath}.scale is invalid`);
      if (!isShape(layer.shape)) throw new Error(`${layerPath}.shape is invalid`);
      if (!isPattern(layer.pattern)) throw new Error(`${layerPath}.pattern is invalid`);
      const count = integer(layer.count, `${layerPath}.count`);
      if (count < 0 || count > MAX_ITEMS_PER_LAYER) throw new Error(`${layerPath}.count exceeds its bound`);
      const maxSlope = finite(layer.maxSlope, `${layerPath}.maxSlope`);
      if (maxSlope < 0 || maxSlope > 1) throw new Error(`${layerPath}.maxSlope must be in 0..1`);
      itemCount += count;
      return {
        id: layerId,
        scale: layer.scale,
        shape: layer.shape,
        pattern: layer.pattern,
        count,
        maxSlope,
        width: range(layer.width, `${layerPath}.width`),
        height: range(layer.height, `${layerPath}.height`),
        depth: range(layer.depth, `${layerPath}.depth`),
      };
    });
    return { id, centerS, halfLength, zMin, zMax, exclusions, layers };
  });
  if (itemCount > MAX_DISTRICT_SCATTER_ITEMS) {
    throw new Error(`District plan count exceeds ${MAX_DISTRICT_SCATTER_ITEMS}`);
  }
  return { version: 1, districts };
}

const COMMON_LAYERS: DistrictLayer[] = [
  { id: 'vertical-landmarks', scale: 'overhead', shape: 'tower', pattern: 'anchors', count: 8, maxSlope: 0.2, width: [14, 24], height: [30, 54], depth: [12, 22] },
  { id: 'habitat-shells', scale: 'tactical', shape: 'slab', pattern: 'clusters', count: 28, maxSlope: 0.3, width: [8, 22], height: [4, 14], depth: [5, 13] },
  { id: 'service-trunks', scale: 'tactical', shape: 'pipe', pattern: 'rows', count: 18, maxSlope: 0.26, width: [1, 2.6], height: [40, 76], depth: [1, 2.6] },
  { id: 'bounded-deck-detail', scale: 'micro', shape: 'debris', pattern: 'scatter', count: 56, maxSlope: 0.36, width: [1, 5], height: [0.5, 2.6], depth: [1, 4] },
];

function authoredDistrict(id: string, centerS: number): DistrictDefinition {
  return {
    id,
    centerS,
    halfLength: 650,
    zMin: -600,
    zMax: 600,
    exclusions: [{ centerS, halfLength: 130, zMin: -220, zMax: 220 }],
    layers: COMMON_LAYERS.map((layer) => ({ ...layer, width: [...layer.width], height: [...layer.height], depth: [...layer.depth] })),
  };
}

/** Neutral authored coverage used until LS-13 supplies reusable visual palettes. */
export const FOUNDATION_DISTRICT_PLAN: DistrictPlan = parseDistrictPlan({
  version: 1,
  districts: [
    authoredDistrict('habitation-00', 0),
    authoredDistrict('habitation-01', RING_CIRCUMFERENCE * 0.125),
    authoredDistrict('habitation-02', RING_CIRCUMFERENCE * 0.25),
    authoredDistrict('habitation-03', RING_CIRCUMFERENCE * 0.375),
    authoredDistrict('habitation-04', RING_CIRCUMFERENCE * 0.5),
    authoredDistrict('habitation-05', RING_CIRCUMFERENCE * 0.625),
    authoredDistrict('habitation-06', RING_CIRCUMFERENCE * 0.75),
    authoredDistrict('habitation-07', RING_CIRCUMFERENCE * 0.875),
  ],
});

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path} has unknown field ${key}`);
  for (const key of keys) if (!(key in value)) throw new Error(`${path} is missing ${key}`);
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(value)) throw new Error(`${path} is invalid`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) throw new Error(`${path} must be positive`);
  return result;
}

function integer(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result)) throw new Error(`${path} must be an integer`);
  return result;
}

function axialRange(min: number, max: number, path: string): void {
  if (min < -RING_HALF_WIDTH || max > RING_HALF_WIDTH || min >= max) throw new Error(`${path} has an invalid axial range`);
}

function range(value: unknown, path: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${path} must be a two-value range`);
  const min = positive(value[0], `${path}[0]`);
  const max = positive(value[1], `${path}[1]`);
  if (min > max) throw new Error(`${path} is reversed`);
  return [min, max];
}

function isScale(value: unknown): value is DistrictScale {
  return value === 'overhead' || value === 'tactical' || value === 'micro';
}

function isShape(value: unknown): value is DistrictShape {
  return value === 'tower' || value === 'slab' || value === 'pipe' || value === 'debris';
}

function isPattern(value: unknown): value is DistrictPattern {
  return value === 'anchors' || value === 'clusters' || value === 'rows' || value === 'scatter';
}
