import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE } from '../../src/core/constants';
import {
  FOUNDATION_DISTRICT_PLAN,
  parseDistrictPlan,
} from '../../src/render/districtPlan';

describe('district plan', () => {
  it('declares bounded authored districts with all three scatter scales', () => {
    expect(FOUNDATION_DISTRICT_PLAN.districts.length).toBeGreaterThan(1);
    expect(new Set(FOUNDATION_DISTRICT_PLAN.districts.map((district) => district.id)).size)
      .toBe(FOUNDATION_DISTRICT_PLAN.districts.length);
    expect(new Set(FOUNDATION_DISTRICT_PLAN.districts.flatMap((district) =>
      district.layers.map((layer) => layer.scale),
    ))).toEqual(new Set(['overhead', 'tactical', 'micro']));
    expect(FOUNDATION_DISTRICT_PLAN.districts.every((district) =>
      district.centerS >= 0 && district.centerS < RING_CIRCUMFERENCE
      && district.halfLength > 0
      && district.zMin < district.zMax,
    )).toBe(true);
  });

  it('strictly rejects unknown fields, duplicate IDs, and unbounded counts', () => {
    expect(() => parseDistrictPlan({
      ...structuredClone(FOUNDATION_DISTRICT_PLAN),
      surprise: true,
    })).toThrow(/unknown.*surprise/i);

    const duplicate = structuredClone(FOUNDATION_DISTRICT_PLAN);
    duplicate.districts[1]!.id = duplicate.districts[0]!.id;
    expect(() => parseDistrictPlan(duplicate)).toThrow(/duplicate district/i);

    const excessive = structuredClone(FOUNDATION_DISTRICT_PLAN);
    excessive.districts[0]!.layers[0]!.count = 10_000;
    expect(() => parseDistrictPlan(excessive)).toThrow(/count/i);
  });

  it('accepts a district that deliberately crosses the joined ring edge', () => {
    const plan = structuredClone(FOUNDATION_DISTRICT_PLAN);
    plan.districts = [{
      ...plan.districts[0]!,
      id: 'seam-district',
      centerS: RING_CIRCUMFERENCE - 40,
      halfLength: 120,
    }];

    expect(parseDistrictPlan(plan).districts[0]?.centerS).toBe(RING_CIRCUMFERENCE - 40);
  });
});
