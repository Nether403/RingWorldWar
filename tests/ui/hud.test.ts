import { describe, expect, it } from 'vitest';
import { ballisticFireMessage } from '@ui/hud';

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
