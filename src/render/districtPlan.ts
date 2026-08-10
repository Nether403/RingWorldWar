import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';

export type DistrictScale = 'overhead' | 'tactical' | 'micro';
export type DistrictShape = 'tower' | 'slab' | 'pipe' | 'debris';
export type DistrictPattern = 'anchors' | 'clusters' | 'rows' | 'scatter';
export const DISTRICT_LIFE_CUES = ['habitation', 'vegetation', 'transit', 'ambient'] as const;
export type DistrictLifeCue = typeof DISTRICT_LIFE_CUES[number];
export const DISTRICT_PALETTES = [
  'arc-city',
  'agricultural',
  'spinal-industrial',
  'breach-evacuation',
] as const;
export type DistrictPalette = typeof DISTRICT_PALETTES[number];

const PALETTE_SILHOUETTES = {
  'arc-city': ['civic-tower', 'shelter-block', 'transit-viaduct', 'shelter-light'],
  agricultural: ['canopy-spire', 'terrace-bank', 'water-channel', 'farm-rig'],
  'spinal-industrial': ['maintenance-pylon', 'gantry-deck', 'power-trunk', 'salvage-stack'],
  'breach-evacuation': ['seal-wall', 'ruined-block', 'exposed-scrith', 'abandoned-convoy'],
} as const satisfies Record<DistrictPalette, readonly string[]>;
export type DistrictSilhouette = typeof PALETTE_SILHOUETTES[DistrictPalette][number];

export interface DistrictSilhouetteStyle {
  readonly shape: DistrictShape;
  readonly color: number;
  readonly lifeCue: DistrictLifeCue | null;
}

export const DISTRICT_SILHOUETTE_STYLES: Readonly<Record<DistrictSilhouette, DistrictSilhouetteStyle>> = Object.freeze({
  'civic-tower': { shape: 'tower', color: 0x7896a2, lifeCue: 'habitation' },
  'shelter-block': { shape: 'slab', color: 0x817869, lifeCue: 'habitation' },
  'transit-viaduct': { shape: 'pipe', color: 0x4d8791, lifeCue: 'transit' },
  'shelter-light': { shape: 'debris', color: 0xd7a556, lifeCue: 'ambient' },
  'canopy-spire': { shape: 'tower', color: 0x668358, lifeCue: 'vegetation' },
  'terrace-bank': { shape: 'slab', color: 0x7f8454, lifeCue: 'vegetation' },
  'water-channel': { shape: 'pipe', color: 0x477f8e, lifeCue: 'ambient' },
  'farm-rig': { shape: 'debris', color: 0xa17b42, lifeCue: 'ambient' },
  'maintenance-pylon': { shape: 'tower', color: 0x707d80, lifeCue: 'habitation' },
  'gantry-deck': { shape: 'slab', color: 0x726c5f, lifeCue: 'transit' },
  'power-trunk': { shape: 'pipe', color: 0xb28a3d, lifeCue: 'ambient' },
  'salvage-stack': { shape: 'debris', color: 0x895943, lifeCue: 'ambient' },
  'seal-wall': { shape: 'tower', color: 0x968b78, lifeCue: null },
  'ruined-block': { shape: 'slab', color: 0x74554e, lifeCue: null },
  'exposed-scrith': { shape: 'pipe', color: 0x4d5558, lifeCue: null },
  'abandoned-convoy': { shape: 'debris', color: 0x9a603d, lifeCue: null },
});

export interface DistrictExclusion {
  centerS: number;
  halfLength: number;
  zMin: number;
  zMax: number;
}

export interface DistrictLayer {
  id: string;
  scale: DistrictScale;
  silhouette: DistrictSilhouette;
  lifeCue: DistrictLifeCue | null;
  pattern: DistrictPattern;
  count: number;
  maxSlope: number;
  width: [number, number];
  height: [number, number];
  depth: [number, number];
}

export interface DistrictDefinition {
  id: string;
  palette: DistrictPalette;
  centerS: number;
  halfLength: number;
  zMin: number;
  zMax: number;
  exclusions: DistrictExclusion[];
  layers: DistrictLayer[];
}

export interface DistrictPlan {
  version: 2;
  districts: DistrictDefinition[];
  ringLifeCells: RingLifeCell[];
}

export interface RingLifeCell {
  id: string;
  palette: DistrictPalette;
  silhouette: DistrictSilhouette;
  lifeCue: 'habitation' | 'vegetation';
  centerS: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

const MAX_DISTRICTS = 16;
const MAX_LAYERS_PER_DISTRICT = 8;
const MAX_ITEMS_PER_LAYER = 256;
const MAX_RING_LIFE_CELLS = 64;
export const MAX_DISTRICT_SCATTER_ITEMS = 2_048;

export function parseDistrictPlan(value: unknown): DistrictPlan {
  const root = record(value, 'district plan');
  exactKeys(root, ['version', 'districts', 'ringLifeCells'], 'district plan');
  if (root.version !== 2) throw new Error('District plan version must be 2');
  const rawDistricts = array(root.districts, 'district plan districts');
  if (rawDistricts.length < 1 || rawDistricts.length > MAX_DISTRICTS) {
    throw new Error(`District plan must contain 1..${MAX_DISTRICTS} districts`);
  }

  const districtIds = new Set<string>();
  let itemCount = 0;
  const districts = rawDistricts.map((raw, districtIndex): DistrictDefinition => {
    const path = `district plan districts[${districtIndex}]`;
    const district = record(raw, path);
    exactKeys(district, ['id', 'palette', 'centerS', 'halfLength', 'zMin', 'zMax', 'exclusions', 'layers'], path);
    const id = identifier(district.id, `${path}.id`);
    if (districtIds.has(id)) throw new Error(`Duplicate district id: ${id}`);
    districtIds.add(id);
    if (!isPalette(district.palette)) throw new Error(`${path}.palette is invalid`);
    const palette = district.palette;
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
      exactKeys(layer, ['id', 'scale', 'silhouette', 'lifeCue', 'pattern', 'count', 'maxSlope', 'width', 'height', 'depth'], layerPath);
      const layerId = identifier(layer.id, `${layerPath}.id`);
      if (layerIds.has(layerId)) throw new Error(`Duplicate layer id in ${id}: ${layerId}`);
      layerIds.add(layerId);
      if (!isScale(layer.scale)) throw new Error(`${layerPath}.scale is invalid`);
      if (!isSilhouetteForPalette(layer.silhouette, palette)) {
        throw new Error(`${layerPath}.silhouette does not belong to ${palette}`);
      }
      if (layer.lifeCue !== null && !isLifeCue(layer.lifeCue)) throw new Error(`${layerPath}.lifeCue is invalid`);
      if (DISTRICT_SILHOUETTE_STYLES[layer.silhouette].lifeCue !== layer.lifeCue) {
        throw new Error(`${layerPath}.lifeCue does not match ${layer.silhouette}`);
      }
      if (!isPattern(layer.pattern)) throw new Error(`${layerPath}.pattern is invalid`);
      const count = integer(layer.count, `${layerPath}.count`);
      if (count < 0 || count > MAX_ITEMS_PER_LAYER) throw new Error(`${layerPath}.count exceeds its bound`);
      const maxSlope = finite(layer.maxSlope, `${layerPath}.maxSlope`);
      if (maxSlope < 0 || maxSlope > 1) throw new Error(`${layerPath}.maxSlope must be in 0..1`);
      itemCount += count;
      return {
        id: layerId,
        scale: layer.scale,
        silhouette: layer.silhouette,
        lifeCue: layer.lifeCue,
        pattern: layer.pattern,
        count,
        maxSlope,
        width: range(layer.width, `${layerPath}.width`),
        height: range(layer.height, `${layerPath}.height`),
        depth: range(layer.depth, `${layerPath}.depth`),
      };
    });
    return { id, palette, centerS, halfLength, zMin, zMax, exclusions, layers };
  });
  if (itemCount > MAX_DISTRICT_SCATTER_ITEMS) {
    throw new Error(`District plan count exceeds ${MAX_DISTRICT_SCATTER_ITEMS}`);
  }
  const rawRingLifeCells = array(root.ringLifeCells, 'district plan ringLifeCells');
  if (rawRingLifeCells.length < 1 || rawRingLifeCells.length > MAX_RING_LIFE_CELLS) {
    throw new Error(`District plan ringLifeCells must contain 1..${MAX_RING_LIFE_CELLS} cells`);
  }
  const cellIds = new Set<string>();
  const ringLifeCells = rawRingLifeCells.map((rawCell, index): RingLifeCell => {
    const path = `district plan ringLifeCells[${index}]`;
    const cell = record(rawCell, path);
    exactKeys(cell, ['id', 'palette', 'silhouette', 'lifeCue', 'centerS', 'z', 'width', 'height', 'depth'], path);
    const id = identifier(cell.id, `${path}.id`);
    if (cellIds.has(id)) throw new Error(`Duplicate ring life cell id: ${id}`);
    cellIds.add(id);
    if (!isPalette(cell.palette)) throw new Error(`${path}.palette is invalid`);
    const palette = cell.palette;
    if (!isSilhouetteForPalette(cell.silhouette, palette)) throw new Error(`${path}.silhouette does not belong to ${palette}`);
    const style = DISTRICT_SILHOUETTE_STYLES[cell.silhouette];
    if ((cell.lifeCue !== 'habitation' && cell.lifeCue !== 'vegetation') || style.lifeCue !== cell.lifeCue) {
      throw new Error(`${path}.lifeCue must match a habitation or vegetation silhouette`);
    }
    const centerS = finite(cell.centerS, `${path}.centerS`);
    if (centerS < 0 || centerS >= RING_CIRCUMFERENCE) throw new Error(`${path}.centerS is outside the ring`);
    const z = finite(cell.z, `${path}.z`);
    if (z < -RING_HALF_WIDTH || z > RING_HALF_WIDTH) throw new Error(`${path}.z is outside the ring`);
    return {
      id,
      palette,
      silhouette: cell.silhouette,
      lifeCue: cell.lifeCue,
      centerS,
      z,
      width: positive(cell.width, `${path}.width`),
      height: positive(cell.height, `${path}.height`),
      depth: positive(cell.depth, `${path}.depth`),
    };
  });
  return { version: 2, districts, ringLifeCells };
}

const PALETTE_LAYERS: Readonly<Record<DistrictPalette, readonly DistrictLayer[]>> = {
  'arc-city': [
    layer('occupied-towers', 'overhead', 'civic-tower', 'habitation', 'anchors', 8, 0.2, [14, 24], [34, 58], [12, 22]),
    layer('shelter-blocks', 'tactical', 'shelter-block', 'habitation', 'clusters', 28, 0.3, [9, 24], [5, 15], [6, 14]),
    layer('transit-viaducts', 'tactical', 'transit-viaduct', 'transit', 'rows', 18, 0.26, [1.2, 2.8], [44, 80], [1.2, 2.8]),
    layer('shelter-lights', 'micro', 'shelter-light', 'ambient', 'scatter', 56, 0.36, [1, 3], [0.8, 2.2], [1, 3]),
  ],
  agricultural: [
    layer('canopy-spires', 'overhead', 'canopy-spire', 'vegetation', 'clusters', 8, 0.24, [18, 32], [22, 40], [18, 32]),
    layer('terrace-banks', 'tactical', 'terrace-bank', 'vegetation', 'rows', 28, 0.22, [12, 30], [2, 7], [8, 18]),
    layer('water-channels', 'tactical', 'water-channel', 'ambient', 'rows', 18, 0.18, [1.8, 3.6], [36, 68], [1.8, 3.6]),
    layer('farm-rigs', 'micro', 'farm-rig', 'ambient', 'clusters', 56, 0.32, [1.5, 5], [0.8, 3], [1.5, 4]),
  ],
  'spinal-industrial': [
    layer('maintenance-pylons', 'overhead', 'maintenance-pylon', 'habitation', 'anchors', 8, 0.18, [12, 20], [38, 64], [10, 18]),
    layer('gantry-decks', 'tactical', 'gantry-deck', 'transit', 'rows', 28, 0.25, [14, 32], [4, 10], [5, 12]),
    layer('power-trunks', 'tactical', 'power-trunk', 'ambient', 'rows', 18, 0.22, [1.6, 3.2], [50, 88], [1.6, 3.2]),
    layer('salvage-stacks', 'micro', 'salvage-stack', 'ambient', 'clusters', 56, 0.38, [2, 6], [1, 3.6], [1.5, 5]),
  ],
  'breach-evacuation': [
    layer('seal-walls', 'overhead', 'seal-wall', null, 'rows', 8, 0.16, [16, 28], [24, 44], [8, 14]),
    layer('ruined-blocks', 'tactical', 'ruined-block', null, 'clusters', 28, 0.34, [10, 26], [3, 12], [6, 16]),
    layer('exposed-scrith', 'tactical', 'exposed-scrith', null, 'scatter', 18, 0.3, [1.4, 3], [32, 62], [1.4, 3]),
    layer('abandoned-convoys', 'micro', 'abandoned-convoy', null, 'rows', 56, 0.3, [2, 7], [1.2, 3.2], [1.5, 4]),
  ],
};

function layer(
  id: string,
  scale: DistrictScale,
  silhouette: DistrictSilhouette,
  lifeCue: DistrictLifeCue | null,
  pattern: DistrictPattern,
  count: number,
  maxSlope: number,
  width: [number, number],
  height: [number, number],
  depth: [number, number],
): DistrictLayer {
  return { id, scale, silhouette, lifeCue, pattern, count, maxSlope, width, height, depth };
}

function authoredDistrict(id: string, palette: DistrictPalette, centerS: number): DistrictDefinition {
  return {
    id,
    palette,
    centerS,
    halfLength: 650,
    zMin: -600,
    zMax: 600,
    exclusions: [{ centerS, halfLength: 130, zMin: -220, zMax: 220 }],
    layers: PALETTE_LAYERS[palette].map((entry) => ({
      ...entry,
      width: [...entry.width],
      height: [...entry.height],
      depth: [...entry.depth],
    })),
  };
}

export const ENVIRONMENT_DISTRICT_PLAN: DistrictPlan = parseDistrictPlan({
  version: 2,
  districts: [
    authoredDistrict('arc-city-00', 'arc-city', RING_CIRCUMFERENCE - 600),
    authoredDistrict('agricultural-00', 'agricultural', RING_CIRCUMFERENCE - 200),
    authoredDistrict('spinal-industrial-00', 'spinal-industrial', 200),
    authoredDistrict('breach-evacuation-00', 'breach-evacuation', 600),
    authoredDistrict('arc-city-01', 'arc-city', RING_CIRCUMFERENCE * 0.5 - 600),
    authoredDistrict('agricultural-01', 'agricultural', RING_CIRCUMFERENCE * 0.5 - 200),
    authoredDistrict('spinal-industrial-01', 'spinal-industrial', RING_CIRCUMFERENCE * 0.5 + 200),
    authoredDistrict('breach-evacuation-01', 'breach-evacuation', RING_CIRCUMFERENCE * 0.5 + 600),
  ],
  ringLifeCells: Array.from({ length: 16 }, (_, ringIndex) =>
    [-1_500, -500, 500, 1_500].map((z, axialIndex) => {
      const vegetation = (ringIndex + axialIndex) % 2 === 1;
      return {
        id: `ring-life-${ringIndex.toString().padStart(2, '0')}-${axialIndex}`,
        palette: vegetation ? 'agricultural' : 'arc-city',
        silhouette: vegetation ? 'canopy-spire' : 'civic-tower',
        lifeCue: vegetation ? 'vegetation' : 'habitation',
        centerS: ringIndex * RING_CIRCUMFERENCE / 16,
        z,
        width: vegetation ? 14 : 10,
        height: vegetation ? 24 : 34,
        depth: vegetation ? 14 : 10,
      };
    })).flat(),
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

function isLifeCue(value: unknown): value is DistrictLifeCue {
  return typeof value === 'string' && DISTRICT_LIFE_CUES.includes(value as DistrictLifeCue);
}

function isPalette(value: unknown): value is DistrictPalette {
  return typeof value === 'string' && DISTRICT_PALETTES.includes(value as DistrictPalette);
}

function isSilhouetteForPalette(value: unknown, palette: DistrictPalette): value is DistrictSilhouette {
  return typeof value === 'string' && PALETTE_SILHOUETTES[palette].includes(value as never);
}

function isPattern(value: unknown): value is DistrictPattern {
  return value === 'anchors' || value === 'clusters' || value === 'rows' || value === 'scatter';
}
