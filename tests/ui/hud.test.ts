import { describe, expect, it } from 'vitest';
import { Faction } from '@sim/data';
import { ballisticFireMessage, hudEventText, shadowTimingCopy, strategicContactSummary } from '@ui/hud';

describe('artillery fire messages', () => {
  it('maps every authoritative reason to concise player copy', () => {
    expect(ballisticFireMessage({ ok: false, reason: 'match-ended' })).toBe('MATCH ENDED');
    expect(ballisticFireMessage({ ok: false, reason: 'invalid-source' })).toBe('INVALID ARTILLERY SOURCE');
    expect(ballisticFireMessage({ ok: false, reason: 'longbow-not-deployed' })).toBe('LONG BOW MUST DEPLOY');
    expect(ballisticFireMessage({ ok: false, reason: 'longbow-transitioning' }))
      .toBe('LONG BOW MUST FINISH DEPLOYING');
    expect(ballisticFireMessage({ ok: false, reason: 'reloading', remainingSeconds: 3.2 }))
      .toBe('RELOADING — 3.2s');
    expect(ballisticFireMessage({
      ok: false,
      reason: 'insufficient-power',
      requiredPower: 10,
      availablePower: 6,
    })).toBe('NEED 10 POWER — 6 AVAILABLE');
    expect(ballisticFireMessage({ ok: false, reason: 'outside-sensor-range' }))
      .toBe('NO SENSOR COVERAGE');
    expect(ballisticFireMessage({ ok: false, reason: 'sensor-los-blocked' }))
      .toBe('SENSOR LOS BLOCKED');
    expect(ballisticFireMessage({ ok: false, reason: 'no-ballistic-solution' }))
      .toBe('NO VALID TRAJECTORY FROM THIS SIDE');
    expect(ballisticFireMessage({ ok: true, reason: 'success' })).toBe('READY TO FIRE');
  });
});

describe('shadow timing copy', () => {
  it('[shadow-timing-copy] names every state and next transition without relying on color', () => {
    expect(shadowTimingCopy({ state: 'day', nextState: 'transition', secondsToTransition: 12, daylight: 1 }))
      .toBe('DAY · PENUMBRA IN 12s');
    expect(shadowTimingCopy({ state: 'transition', nextState: 'shadow', secondsToTransition: 8, daylight: 0.7 }))
      .toBe('PENUMBRA · DEEP SHADOW IN 8s');
    expect(shadowTimingCopy({ state: 'shadow', nextState: 'transition', secondsToTransition: 31, daylight: 0.28 }))
      .toBe('DEEP SHADOW · PENUMBRA IN 31s');
  });

  it('[strategic-contact-category-copy] summarizes categories with visible, accessible wording', () => {
    expect(strategicContactSummary([
      { entityId: 1, s: 0, z: 0, faction: Faction.Choir, category: 'bastion' },
      { entityId: 2, s: 0, z: 0, faction: Faction.Choir, category: 'launch-site' },
      { entityId: 3, s: 0, z: 0, faction: Faction.Choir, category: 'launch-site' },
    ])).toBe('1 Bastion, 2 launch sites');
  });
});

describe('HUD event allegiance', () => {
  it('describes the same event relative to the active player faction', () => {
    const event = {
      kind: 'unitDied' as const,
      s: 0,
      z: 0,
      h: 0,
      faction: Faction.Choir,
      scale: 1,
      id: 7,
    };

    expect(hudEventText(event, Faction.Compact)).toBe('HOSTILE UNIT DESTROYED');
    expect(hudEventText(event, Faction.Choir)).toBe('FRIENDLY UNIT LOST');
  });

  it('describes interceptions from the defending faction perspective', () => {
    const event = {
      kind: 'intercepted' as const,
      s: 0,
      z: 0,
      h: 0,
      faction: Faction.Compact,
      scale: 1,
      id: 8,
    };

    expect(hudEventText(event, Faction.Compact)).toBe('HOSTILE ORDNANCE INTERCEPTED');
    expect(hudEventText(event, Faction.Choir)).toBe('FRIENDLY ORDNANCE INTERCEPTED');
  });
});
