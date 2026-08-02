import { isAbsolute, relative, resolve } from 'node:path';

export const SCENARIO_SCHEMA = 'rww.browser-scenario';
export const SCENARIO_VERSION = 1;

const QUALITY = new Set(['low', 'medium', 'high', 'ultra']);
const FACTIONS = new Set(['compact', 'choir']);
const STRUCTURE_FACTIONS = new Set(['compact', 'choir', 'neutral']);
const UNITS = new Set(['vanguard', 'longbow', 'wisp', 'aegis', 'engineer']);
const UNIT_WEAPON_COUNTS = { engineer: 0, vanguard: 2, longbow: 1, wisp: 1, aegis: 2 };
const ACTIVE_ABILITY_UNITS = new Set(['vanguard', 'longbow', 'aegis']);
const STRUCTURES = new Set([
  'bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator', 'mechFoundry',
  'rocketBattery', 'pointDefense', 'laserGrid', 'radarMast', 'silo', 'spinalNode',
]);
const REGION_KINDS = new Set(['sky', 'ground', 'unit', 'ui']);

export function resolveScenarioPath(cwd, value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Unsafe scenario name: ${value}`);
  }
  const filename = value.endsWith('.json') ? value : `${value}.json`;
  const root = resolve(cwd, 'validation/scenarios');
  const path = resolve(root, filename);
  const child = relative(root, path);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`Unsafe scenario name: ${value}`);
  return path;
}

export function parseScenario(input) {
  record(input, 'scenario');
  exactKeys(input, [
    'schema', 'version', 'id', 'revision', 'worldSeed', 'quality', 'viewport', 'simulation',
    'camera', 'setup', 'observationRegions', 'benchmark', 'invariants', 'expectedVisual',
  ], 'scenario');
  if (input.schema !== SCENARIO_SCHEMA) fail('schema', `must be ${SCENARIO_SCHEMA}`);
  if (input.version !== SCENARIO_VERSION) fail('version', `must be ${SCENARIO_VERSION}`);
  safeId(input.id, 'id');
  positiveInteger(input.revision, 'revision');
  integer(input.worldSeed, 'worldSeed');
  member(input.quality, QUALITY, 'quality');

  record(input.viewport, 'viewport');
  exactKeys(input.viewport, ['width', 'height', 'deviceScaleFactor'], 'viewport');
  boundedInteger(input.viewport.width, 320, 7680, 'viewport.width');
  boundedInteger(input.viewport.height, 180, 4320, 'viewport.height');
  boundedNumber(input.viewport.deviceScaleFactor, 0.5, 4, 'viewport.deviceScaleFactor');

  record(input.simulation, 'simulation');
  exactKeys(input.simulation, ['fixedTickSeconds', 'targetTick', 'visualTimeSeconds', 'settlingFrames'], 'simulation');
  if (Math.abs(input.simulation.fixedTickSeconds - 1 / 30) > 1e-12) fail('simulation.fixedTickSeconds', 'must be exactly 1/30');
  nonNegativeInteger(input.simulation.targetTick, 'simulation.targetTick');
  nonNegativeNumber(input.simulation.visualTimeSeconds, 'simulation.visualTimeSeconds');
  boundedInteger(input.simulation.settlingFrames, 1, 120, 'simulation.settlingFrames');

  record(input.camera, 'camera');
  exactKeys(input.camera, ['focusS', 'focusZ', 'yawRadians', 'zoom'], 'camera');
  finiteNumber(input.camera.focusS, 'camera.focusS');
  finiteNumber(input.camera.focusZ, 'camera.focusZ');
  finiteNumber(input.camera.yawRadians, 'camera.yawRadians');
  boundedNumber(input.camera.zoom, 45, 1150, 'camera.zoom');

  record(input.setup, 'setup');
  exactKeys(input.setup, ['units', 'structures', 'disableAi'], 'setup');
  if (input.setup.disableAi !== undefined && typeof input.setup.disableAi !== 'boolean') {
    fail('setup.disableAi', 'must be a boolean');
  }
  array(input.setup.units, 'setup.units');
  array(input.setup.structures, 'setup.structures');
  const ids = new Set();
  input.setup.units.forEach((unit, index) => {
    const path = `setup.units[${index}]`;
    record(unit, path);
    exactKeys(unit, [
      'id', 'faction', 'kind', 's', 'z', 'yawRadians', 'target', 'selected',
      'abilityActive', 'abilityTransitionTimer', 'weaponCooldowns',
    ], path);
    uniqueId(unit.id, `${path}.id`, ids);
    member(unit.faction, FACTIONS, `${path}.faction`);
    member(unit.kind, UNITS, `${path}.kind`);
    finiteNumber(unit.s, `${path}.s`);
    finiteNumber(unit.z, `${path}.z`);
    optionalFinite(unit.yawRadians, `${path}.yawRadians`);
    if (unit.target !== undefined) safeId(unit.target, `${path}.target`);
    if (unit.selected !== undefined && typeof unit.selected !== 'boolean') fail(`${path}.selected`, 'must be a boolean');
    if (unit.abilityActive !== undefined && typeof unit.abilityActive !== 'boolean') fail(`${path}.abilityActive`, 'must be a boolean');
    if (unit.abilityTransitionTimer !== undefined) nonNegativeNumber(unit.abilityTransitionTimer, `${path}.abilityTransitionTimer`);
    if (unit.abilityActive !== undefined || unit.abilityTransitionTimer !== undefined) {
      if (unit.kind === 'wisp') fail(path, 'cannot set active ability state for passive Wisp cloak');
      if (!ACTIVE_ABILITY_UNITS.has(unit.kind)) fail(path, 'cannot set ability state for a unit without an active ability');
    }
    if (unit.weaponCooldowns !== undefined) {
      array(unit.weaponCooldowns, `${path}.weaponCooldowns`);
      if (unit.weaponCooldowns.length !== UNIT_WEAPON_COUNTS[unit.kind]) {
        fail(`${path}.weaponCooldowns`, `must contain exactly ${UNIT_WEAPON_COUNTS[unit.kind]} values for ${unit.kind}`);
      }
      unit.weaponCooldowns.forEach((cooldown, cooldownIndex) =>
        nonNegativeNumber(cooldown, `${path}.weaponCooldowns[${cooldownIndex}]`));
    }
  });
  input.setup.structures.forEach((structure, index) => {
    const path = `setup.structures[${index}]`;
    record(structure, path);
    exactKeys(structure, ['id', 'faction', 'kind', 's', 'z', 'progress', 'yawRadians'], path);
    uniqueId(structure.id, `${path}.id`, ids);
    member(structure.faction, STRUCTURE_FACTIONS, `${path}.faction`);
    member(structure.kind, STRUCTURES, `${path}.kind`);
    finiteNumber(structure.s, `${path}.s`);
    finiteNumber(structure.z, `${path}.z`);
    boundedNumber(structure.progress, 0, 1, `${path}.progress`);
    optionalFinite(structure.yawRadians, `${path}.yawRadians`);
  });
  input.setup.units.forEach((unit, index) => {
    if (unit.target !== undefined && !ids.has(unit.target)) fail(`setup.units[${index}].target`, 'must reference a setup id');
  });

  array(input.observationRegions, 'observationRegions');
  if (input.observationRegions.length === 0) fail('observationRegions', 'must not be empty');
  const regionIds = new Set();
  input.observationRegions.forEach((region, index) => {
    const path = `observationRegions[${index}]`;
    record(region, path);
    exactKeys(region, ['id', 'kind', 'x', 'y', 'width', 'height'], path);
    uniqueId(region.id, `${path}.id`, regionIds);
    member(region.kind, REGION_KINDS, `${path}.kind`);
    boundedNumber(region.x, 0, 1, `${path}.x`);
    boundedNumber(region.y, 0, 1, `${path}.y`);
    boundedNumber(region.width, Number.EPSILON, 1, `${path}.width`);
    boundedNumber(region.height, Number.EPSILON, 1, `${path}.height`);
    if (region.x + region.width > 1 || region.y + region.height > 1) fail(path, 'must fit inside the viewport');
  });

  record(input.benchmark, 'benchmark');
  exactKeys(input.benchmark, ['warmupSeconds', 'sampleSeconds'], 'benchmark');
  boundedNumber(input.benchmark.warmupSeconds, 0, 300, 'benchmark.warmupSeconds');
  boundedNumber(input.benchmark.sampleSeconds, 1, 600, 'benchmark.sampleSeconds');

  record(input.invariants, 'invariants');
  exactKeys(input.invariants, [
    'minimumMeanLuminance', 'minimumLuminanceVariance', 'minimumUnits', 'minimumStructures',
    'maximumContextLosses',
  ], 'invariants');
  nonNegativeNumber(input.invariants.minimumMeanLuminance, 'invariants.minimumMeanLuminance');
  nonNegativeNumber(input.invariants.minimumLuminanceVariance, 'invariants.minimumLuminanceVariance');
  nonNegativeInteger(input.invariants.minimumUnits, 'invariants.minimumUnits');
  nonNegativeInteger(input.invariants.minimumStructures, 'invariants.minimumStructures');
  if (input.invariants.maximumContextLosses !== undefined) nonNegativeInteger(input.invariants.maximumContextLosses, 'invariants.maximumContextLosses');

  if (input.expectedVisual !== undefined) parseExpectedVisual(input.expectedVisual, input.observationRegions);
  const parsed = structuredClone(input);
  parsed.setup.disableAi ??= false;
  return parsed;
}

function parseExpectedVisual(value, observationRegions) {
  record(value, 'expectedVisual');
  exactKeys(value, ['signature', 'tolerances'], 'expectedVisual');
  record(value.signature, 'expectedVisual.signature');
  exactKeys(value.signature, [
    'schema', 'version', 'width', 'height', 'meanLuminance', 'luminanceVariance', 'meanChroma',
    'luminanceChromaGrid', 'histogram', 'edgeDensity', 'perceptualHash', 'differenceHash', 'regions',
  ], 'expectedVisual.signature');
  if (value.signature.schema !== 'rww.visual-signature' || value.signature.version !== 1) fail('expectedVisual.signature', 'must be rww.visual-signature version 1');
  positiveInteger(value.signature.width, 'expectedVisual.signature.width');
  positiveInteger(value.signature.height, 'expectedVisual.signature.height');
  for (const key of ['meanLuminance', 'luminanceVariance', 'meanChroma', 'edgeDensity']) nonNegativeNumber(value.signature[key], `expectedVisual.signature.${key}`);
  if (!/^[0-9a-f]{16}$/.test(value.signature.perceptualHash)) fail('expectedVisual.signature.perceptualHash', 'must be a 64-bit lowercase hex hash');
  if (!/^[0-9a-f]{16}$/.test(value.signature.differenceHash)) fail('expectedVisual.signature.differenceHash', 'must be a 64-bit lowercase hex hash');
  record(value.signature.luminanceChromaGrid, 'expectedVisual.signature.luminanceChromaGrid');
  exactKeys(value.signature.luminanceChromaGrid, ['columns', 'rows', 'cells'], 'expectedVisual.signature.luminanceChromaGrid');
  positiveInteger(value.signature.luminanceChromaGrid.columns, 'expectedVisual.signature.luminanceChromaGrid.columns');
  positiveInteger(value.signature.luminanceChromaGrid.rows, 'expectedVisual.signature.luminanceChromaGrid.rows');
  array(value.signature.luminanceChromaGrid.cells, 'expectedVisual.signature.luminanceChromaGrid.cells');
  if (value.signature.luminanceChromaGrid.cells.length !== value.signature.luminanceChromaGrid.columns * value.signature.luminanceChromaGrid.rows) fail('expectedVisual.signature.luminanceChromaGrid.cells', 'length must match columns times rows');
  value.signature.luminanceChromaGrid.cells.forEach((cell, index) => {
    const path = `expectedVisual.signature.luminanceChromaGrid.cells[${index}]`;
    record(cell, path); exactKeys(cell, ['luminance', 'chroma'], path);
    nonNegativeNumber(cell.luminance, `${path}.luminance`); nonNegativeNumber(cell.chroma, `${path}.chroma`);
  });
  array(value.signature.histogram, 'expectedVisual.signature.histogram');
  if (value.signature.histogram.length !== 16) fail('expectedVisual.signature.histogram', 'must contain 16 bins');
  value.signature.histogram.forEach((bin, index) => boundedNumber(bin, 0, 1, `expectedVisual.signature.histogram[${index}]`));
  record(value.signature.regions, 'expectedVisual.signature.regions');
  const expectedRegionIds = new Set(observationRegions.map((region) => region.id));
  for (const id of Object.keys(value.signature.regions)) if (!expectedRegionIds.has(id)) fail(`expectedVisual.signature.regions.${id}`, 'is unknown');
  for (const region of observationRegions) {
    const stats = value.signature.regions[region.id];
    const path = `expectedVisual.signature.regions.${region.id}`;
    record(stats, path); exactKeys(stats, ['kind', 'meanLuminance', 'luminanceVariance', 'meanChroma'], path);
    if (stats.kind !== region.kind) fail(`${path}.kind`, `must be ${region.kind}`);
    for (const key of ['meanLuminance', 'luminanceVariance', 'meanChroma']) nonNegativeNumber(stats[key], `${path}.${key}`);
  }
  record(value.tolerances, 'expectedVisual.tolerances');
  exactKeys(value.tolerances, [
    'maximumMeanLuminanceDelta', 'maximumMeanChromaDelta', 'maximumHistogramL1',
    'maximumEdgeDensityDelta', 'maximumPerceptualHashHamming', 'maximumDifferenceHashHamming',
    'maximumRegionMeanLuminanceDelta',
  ], 'expectedVisual.tolerances');
  for (const [key, child] of Object.entries(value.tolerances)) nonNegativeNumber(child, `expectedVisual.tolerances.${key}`);
}

function exactKeys(value, allowed, path) {
  const permit = new Set(allowed);
  for (const key of Object.keys(value)) if (!permit.has(key)) fail(`${path}.${key}`, 'is unknown');
  for (const key of allowed) {
    if (![
      'expectedVisual', 'yawRadians', 'target', 'maximumContextLosses', 'selected',
      'abilityActive', 'abilityTransitionTimer', 'weaponCooldowns',
      'disableAi',
    ].includes(key) && !(key in value)) {
      fail(`${path}.${key}`, 'is required');
    }
  }
}
function record(value, path) { if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object'); }
function array(value, path) { if (!Array.isArray(value)) fail(path, 'must be an array'); }
function member(value, choices, path) { if (!choices.has(value)) fail(path, `must be one of ${[...choices].join(', ')}`); }
function finiteNumber(value, path) { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number'); }
function nonNegativeNumber(value, path) { finiteNumber(value, path); if (value < 0) fail(path, 'must be non-negative'); }
function optionalFinite(value, path) { if (value !== undefined) finiteNumber(value, path); }
function integer(value, path) { if (!Number.isSafeInteger(value)) fail(path, 'must be a safe integer'); }
function positiveInteger(value, path) { integer(value, path); if (value < 1) fail(path, 'must be positive'); }
function nonNegativeInteger(value, path) { integer(value, path); if (value < 0) fail(path, 'must be non-negative'); }
function boundedInteger(value, min, max, path) { integer(value, path); if (value < min || value > max) fail(path, `must be between ${min} and ${max}`); }
function boundedNumber(value, min, max, path) { finiteNumber(value, path); if (value < min || value > max) fail(path, `must be between ${min} and ${max}`); }
function safeId(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) fail(path, 'must be a safe id'); }
function uniqueId(value, path, ids) { safeId(value, path); if (ids.has(value)) fail(path, 'must be unique'); ids.add(value); }
function fail(path, message) { throw new Error(`Scenario ${path} ${message}`); }
