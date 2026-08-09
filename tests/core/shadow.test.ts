import { describe, expect, it } from 'vitest';
import { DAY_LENGTH, RING_CIRCUMFERENCE } from '@core/constants';
import {
  panelPhaseAt,
  shadowFactorAtAngle,
  SHADOW_PANEL_HALF_SPAN,
  SHADOW_PANEL_SPACING,
  shadowTimingAtSurface,
} from '@core/shadow';

describe('shadow-square authority', () => {
  it('[shadow-cycle-authority] repeats exactly after one local cycle and across the surface seam', () => {
    const samples = [0, 0.04, 0.19, 0.7, 1.2];
    for (const theta of samples) {
      expect(shadowFactorAtAngle(theta, DAY_LENGTH)).toBeCloseTo(shadowFactorAtAngle(theta, 0), 12);
    }
    expect(shadowTimingAtSurface(0, 91).daylight)
      .toBeCloseTo(shadowTimingAtSurface(RING_CIRCUMFERENCE, 91).daylight, 12);
  });

  it('[shadow-transition-timing] reports deterministic day, penumbra, and deep-shadow boundaries', () => {
    const shadowCenter = panelPhaseAt(0) / (Math.PI * 2) * RING_CIRCUMFERENCE;
    const deep = shadowTimingAtSurface(shadowCenter, 0);
    const day = shadowTimingAtSurface(0, 0);

    expect(deep).toMatchObject({ state: 'shadow', nextState: 'transition' });
    expect(deep.daylight).toBeCloseTo(0.28, 12);
    expect(deep.secondsToTransition)
      .toBeCloseTo(SHADOW_PANEL_HALF_SPAN * 0.5 / (SHADOW_PANEL_SPACING / DAY_LENGTH), 8);
    expect(day.state).toBe('day');
    expect(day.secondsToTransition).toBeGreaterThan(0);
    expect(day.secondsToTransition).toBeLessThan(DAY_LENGTH);
  });

  it('[shadow-boundary-semantics] uses direction-aware half-open states at all four boundaries', () => {
    const phase = panelPhaseAt(0);
    const core = SHADOW_PANEL_HALF_SPAN * 0.5;
    const at = (relative: number) => shadowTimingAtSurface(
      (phase + relative) / (Math.PI * 2) * RING_CIRCUMFERENCE,
      0,
    );

    expect(at(core)).toMatchObject({ state: 'shadow', nextState: 'transition' });
    expect(at(SHADOW_PANEL_HALF_SPAN)).toMatchObject({ state: 'transition', nextState: 'shadow' });
    expect(at(SHADOW_PANEL_SPACING - SHADOW_PANEL_HALF_SPAN))
      .toMatchObject({ state: 'day', nextState: 'transition' });
    expect(at(SHADOW_PANEL_SPACING - core)).toMatchObject({ state: 'transition', nextState: 'day' });
    for (const relative of [core, SHADOW_PANEL_HALF_SPAN, SHADOW_PANEL_SPACING - SHADOW_PANEL_HALF_SPAN, SHADOW_PANEL_SPACING - core]) {
      expect(at(relative).secondsToTransition).toBeGreaterThan(0);
    }
  });
});
