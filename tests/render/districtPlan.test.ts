import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE } from '../../src/core/constants';
import {
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
