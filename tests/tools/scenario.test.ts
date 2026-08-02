import { describe, expect, it } from 'vitest';

// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseScenario, resolveScenarioPath } from '../../tools/rww/scenario.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { computeVisualSignature } from '../../tools/rww/visual-signature.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { evaluateBrowserBudget, percentile, summarizeFrameMetrics } from '../../tools/rww/browser-metrics.mjs';
import { validateScenarioUnitState } from '../../e2e/support/scenario-driver';

const scenario = {
  schema: 'rww.browser-scenario',
  version: 1,
  id: 'test-scene',
  revision: 1,
  worldSeed: 42,
  quality: 'low',
  viewport: { width: 320, height: 180, deviceScaleFactor: 1 },
  simulation: { fixedTickSeconds: 1 / 30, targetTick: 3, visualTimeSeconds: 4, settlingFrames: 2 },
  camera: { focusS: 100, focusZ: 0, yawRadians: 0.2, zoom: 240 },
  setup: {
    units: [{
      id: 'front', faction: 'compact', kind: 'longbow', s: 100, z: 0, yawRadians: 0,
      selected: true, abilityActive: true, abilityTransitionTimer: 0,
      weaponCooldowns: [0],
    }],
    structures: [{ id: 'grid', faction: 'choir', kind: 'laserGrid', s: 150, z: 0, progress: 1 }],
  },
  observationRegions: [{ id: 'world', kind: 'ground', x: 0, y: 0.5, width: 1, height: 0.5 }],
  benchmark: { warmupSeconds: 1, sampleSeconds: 5 },
  invariants: { minimumMeanLuminance: 1, minimumLuminanceVariance: 1, minimumUnits: 1, minimumStructures: 1 },
};

describe('browser scenario schema', () => {
  it('parses a complete versioned scenario without retaining mutable input', () => {
    const parsed = parseScenario(scenario);
    expect(parsed).toEqual({
      ...scenario,
      setup: { ...scenario.setup, disableAi: false },
    });
    expect(parsed).not.toBe(scenario);
  });

  it('strictly parses the optional deterministic AI control', () => {
    expect(parseScenario({
      ...scenario,
      setup: { ...scenario.setup, disableAi: true },
    }).setup.disableAi).toBe(true);
    expect(() => parseScenario({
      ...scenario,
      setup: { ...scenario.setup, disableAi: 'yes' },
    })).toThrow(/disableAi.*boolean/i);
  });

  it('rejects unsupported versions and unknown nested fields', () => {
    expect(() => parseScenario({ ...scenario, version: 2 })).toThrow(/version/i);
    expect(() => parseScenario({ ...scenario, camera: { ...scenario.camera, pitch: 1 } })).toThrow(/camera\.pitch.*unknown/i);
    expect(() => parseScenario({ ...scenario, setup: { ...scenario.setup, units: [
      { ...scenario.setup.units[0], kind: 'tank' },
    ] } })).toThrow(/kind/i);
  });

  it('validates optional deterministic selection and ability state', () => {
    expect(parseScenario(scenario).setup.units[0]).toMatchObject({
      selected: true,
      abilityActive: true,
      abilityTransitionTimer: 0,
    });
    expect(() => parseScenario({ ...scenario, setup: { ...scenario.setup, units: [
      { ...scenario.setup.units[0], abilityTransitionTimer: -1 },
    ] } })).toThrow(/abilityTransitionTimer/i);
  });

  it('requires exact weapon cooldown cardinality for each unit kind', () => {
    expect(() => parseScenario({ ...scenario, setup: { ...scenario.setup, units: [
      { ...scenario.setup.units[0], weaponCooldowns: [] },
    ] } })).toThrow(/weaponCooldowns.*exactly 1.*longbow/i);
    expect(() => parseScenario({ ...scenario, setup: { ...scenario.setup, units: [
      { id: 'front', faction: 'compact', kind: 'vanguard', s: 100, z: 0, weaponCooldowns: [0] },
    ] } })).toThrow(/weaponCooldowns.*exactly 2.*vanguard/i);
  });

  it('rejects passive or absent active ability setup in both parser and driver', () => {
    const wisp = { id: 'scout', faction: 'compact', kind: 'wisp', s: 100, z: 0, abilityActive: true } as const;
    expect(() => parseScenario({ ...scenario, setup: { ...scenario.setup, units: [wisp] } }))
      .toThrow(/passive Wisp cloak/i);
    expect(() => validateScenarioUnitState(wisp, {
      kind: 'wisp', ability: { id: 'cloak', active: false, cooldown: 0, transitionTimer: 0 }, cd: [0],
    })).toThrow(/passive Wisp cloak/i);
    expect(() => validateScenarioUnitState(
      { id: 'builder', faction: 'compact', kind: 'engineer', s: 0, z: 0, abilityTransitionTimer: 0 },
      { kind: 'engineer', ability: null, cd: [] },
    )).toThrow(/cannot set ability state/i);
  });

  it('makes the driver reject rather than truncate cooldown state', () => {
    expect(() => validateScenarioUnitState(
      { id: 'front', faction: 'compact', kind: 'vanguard', s: 0, z: 0, weaponCooldowns: [0] },
      { kind: 'vanguard', ability: { id: 'shieldWall', active: false, cooldown: 0, transitionTimer: 0 }, cd: [0, 0] },
    )).toThrow(/cooldown count is unsupported/i);
  });

  it('rejects unsafe scenario paths while resolving names under validation/scenarios', () => {
    expect(resolveScenarioPath('C:/repo', 'heavy-combat')).toMatch(/validation[\\/]scenarios[\\/]heavy-combat\.json$/);
    expect(() => resolveScenarioPath('C:/repo', '../secrets')).toThrow(/unsafe/i);
    expect(() => resolveScenarioPath('C:/repo', 'C:/outside.json')).toThrow(/unsafe/i);
  });
});

describe('visual signature', () => {
  it('is deterministic for synthetic RGBA pixels and reports masked regions', () => {
    const pixels = new Uint8Array([
      0, 0, 0, 255, 255, 0, 0, 255,
      0, 255, 0, 255, 255, 255, 255, 255,
    ]);
    const regions = [{ id: 'left', kind: 'unit', x: 0, y: 0, width: 0.5, height: 1 }];
    const first = computeVisualSignature(pixels, 2, 2, regions, { gridColumns: 2, gridRows: 2 });
    const second = computeVisualSignature(pixels.slice(), 2, 2, regions, { gridColumns: 2, gridRows: 2 });

    expect(first).toEqual(second);
    expect(first.regions.left.kind).toBe('unit');
    expect(first.histogram.reduce((sum: number, value: number) => sum + value, 0)).toBeCloseTo(1);
    expect(first.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.differenceHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('browser performance math', () => {
  it('uses interpolated percentiles and counts long frames per minute', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(summarizeFrameMetrics([16, 17, 18, 120], 30)).toMatchObject({
      medianFrameMilliseconds: 17.5,
      p95FrameMilliseconds: 104.7,
      p99FrameMilliseconds: 116.94,
      over100MillisecondsCount: 1,
      over100MillisecondsPerMinute: 2,
    });
  });

  it('evaluates candidate hard and advisory budgets without changing doctor semantics', () => {
    const metrics = summarizeFrameMetrics([16, 17, 20, 35], 5);
    expect(evaluateBrowserBudget(metrics, {
      id: 'hard', maximumP95FrameMilliseconds: 40, maximumP99FrameMilliseconds: 50,
      targetFps: 30, classification: 'candidate-hard', resolution: [1280, 720], quality: 'low',
    }).status).toBe('pass');
    expect(evaluateBrowserBudget(metrics, {
      id: 'advisory', maximumP95FrameMilliseconds: 20,
      targetFps: 60, classification: 'advisory', resolution: [1280, 720], quality: 'low',
    }).status).toBe('warn');
  });
});
