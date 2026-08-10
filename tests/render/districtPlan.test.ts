import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE } from '../../src/core/constants';
import { deltaS } from '../../src/core/ringMath';
import {
  DISTRICT_LIFE_CUES,
  DISTRICT_PALETTES,
  ENVIRONMENT_DISTRICT_PLAN,
  parseDistrictPlan,
} from '../../src/render/districtPlan';

describe('district plan', () => {
  it('declares bounded authored districts with all three scatter scales', () => {
    expect(ENVIRONMENT_DISTRICT_PLAN.districts).toHaveLength(8);
    expect(new Set(ENVIRONMENT_DISTRICT_PLAN.districts.map((district) => district.id)).size)
      .toBe(ENVIRONMENT_DISTRICT_PLAN.districts.length);
    expect(new Set(ENVIRONMENT_DISTRICT_PLAN.districts.flatMap((district) =>
      district.layers.map((layer) => layer.scale),
    ))).toEqual(new Set(['overhead', 'tactical', 'micro']));
    expect(ENVIRONMENT_DISTRICT_PLAN.districts.every((district) =>
      district.centerS >= 0 && district.centerS < RING_CIRCUMFERENCE
      && district.halfLength > 0
      && district.zMin < district.zMax,
    )).toBe(true);
  });

  it('declares exactly four reusable palettes with owned silhouette sets', () => {
    expect(DISTRICT_PALETTES).toEqual([
      'arc-city',
      'agricultural',
      'spinal-industrial',
      'breach-evacuation',
    ]);
    const districtsByPalette = new Map(DISTRICT_PALETTES.map((palette) => [
      palette,
      ENVIRONMENT_DISTRICT_PLAN.districts.filter((district) => district.palette === palette),
    ]));
    for (const districts of districtsByPalette.values()) {
      expect(districts).toHaveLength(2);
      expect(new Set(districts[0]!.layers.map((layer) => layer.silhouette)).size).toBe(4);
      expect(districts[1]!.layers.map((layer) => layer.silhouette))
        .toEqual(districts[0]!.layers.map((layer) => layer.silhouette));
    }
  });

  it('assigns every authored layer one bounded inhabited-ring life cue', () => {
    expect(DISTRICT_LIFE_CUES).toEqual(['habitation', 'vegetation', 'transit', 'ambient']);
    expect(new Set(ENVIRONMENT_DISTRICT_PLAN.districts.flatMap((district) =>
      district.layers.flatMap((layer) => layer.lifeCue === null ? [] : [layer.lifeCue]),
    ))).toEqual(new Set(DISTRICT_LIFE_CUES));
    const breach = ENVIRONMENT_DISTRICT_PLAN.districts.find((district) => district.palette === 'breach-evacuation')!;
    expect(breach.layers.every((layer) => layer.lifeCue === null)).toBe(true);
  });

  it('strictly rejects unknown fields, duplicate IDs, and unbounded counts', () => {
    expect(() => parseDistrictPlan({
      ...structuredClone(ENVIRONMENT_DISTRICT_PLAN),
      surprise: true,
    })).toThrow(/unknown.*surprise/i);

    const duplicate = structuredClone(ENVIRONMENT_DISTRICT_PLAN);
    duplicate.districts[1]!.id = duplicate.districts[0]!.id;
    expect(() => parseDistrictPlan(duplicate)).toThrow(/duplicate district/i);

    const excessive = structuredClone(ENVIRONMENT_DISTRICT_PLAN);
    excessive.districts[0]!.layers[0]!.count = 10_000;
    expect(() => parseDistrictPlan(excessive)).toThrow(/count/i);
  });

  it('rejects unknown palettes and silhouettes owned by another palette', () => {
    const unknownPalette = structuredClone(ENVIRONMENT_DISTRICT_PLAN) as Record<string, any>;
    unknownPalette.districts[0].palette = 'generic-ruins';
    expect(() => parseDistrictPlan(unknownPalette)).toThrow(/palette/i);

    const crossedSilhouette = structuredClone(ENVIRONMENT_DISTRICT_PLAN);
    crossedSilhouette.districts[0]!.layers[0]!.silhouette =
      ENVIRONMENT_DISTRICT_PLAN.districts.find((district) => district.palette === 'agricultural')!.layers[0]!.silhouette;
    expect(() => parseDistrictPlan(crossedSilhouette)).toThrow(/silhouette.*arc-city/i);
  });

  it('rejects undeclared inhabited-ring life cues', () => {
    const invalidCue = structuredClone(ENVIRONMENT_DISTRICT_PLAN) as Record<string, any>;
    invalidCue.districts[0].layers[0].lifeCue = 'wildlife-simulation';
    expect(() => parseDistrictPlan(invalidCue)).toThrow(/lifeCue/i);

    const mismatchedCue = structuredClone(ENVIRONMENT_DISTRICT_PLAN);
    mismatchedCue.districts[0]!.layers[0]!.lifeCue = 'transit';
    expect(() => parseDistrictPlan(mismatchedCue)).toThrow(/lifeCue.*civic-tower/i);
  });

  it('covers the full ring width with bounded habitation or vegetation cells', () => {
    expect(ENVIRONMENT_DISTRICT_PLAN.ringLifeCells).toHaveLength(64);
    for (let s = 0; s < RING_CIRCUMFERENCE; s += 400) {
      for (const z of [-2_000, -1_000, 0, 1_000, 2_000]) {
        const nearest = Math.min(...ENVIRONMENT_DISTRICT_PLAN.ringLifeCells.map((cell) =>
          Math.hypot(deltaS(cell.centerS, s), cell.z - z),
        ));
        expect(nearest).toBeLessThan(1_000);
      }
    }
  });

  it('accepts a district that deliberately crosses the joined ring edge', () => {
    const plan = structuredClone(ENVIRONMENT_DISTRICT_PLAN);
    plan.districts = [{
      ...plan.districts[0]!,
      id: 'seam-district',
      centerS: RING_CIRCUMFERENCE - 40,
      halfLength: 120,
    }];

    expect(parseDistrictPlan(plan).districts[0]?.centerS).toBe(RING_CIRCUMFERENCE - 40);
  });
});
