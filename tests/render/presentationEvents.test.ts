import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import { combatPresentationKind, isPresentationEventEligible } from '../../src/render/presentationEvents';

describe('presentation event eligibility', () => {
  it('keeps friendly and visible hostile events while hiding unseen hostile events', () => {
    const visibleEntities = new Set<number>();
    const visiblePoints = new Set<string>();
    const world = {
      isEntityVisible: (_viewer: Faction, id: number) => visibleEntities.has(id),
      isVisible: (_viewer: Faction, s: number, z: number) => visiblePoints.has(`${s}|${z}`),
    } as unknown as World;

    expect(isPresentationEventEligible(event(Faction.Compact, 1, 100, 0), world, 0, Faction.Compact)).toBe(true);
    expect(isPresentationEventEligible(event(Faction.Choir, 2, 100, 0), world, 0, Faction.Compact)).toBe(false);

    visibleEntities.add(2);
    expect(isPresentationEventEligible(event(Faction.Choir, 2, 100, 0), world, 0, Faction.Compact)).toBe(true);

    visibleEntities.clear();
    visiblePoints.add('100|0');
    expect(isPresentationEventEligible(event(Faction.Choir, 2, 100, 0), world, 0, Faction.Compact)).toBe(true);
  });

  it('uses wrapped range and never requires vision for neutral events', () => {
    const world = {
      isEntityVisible: () => false,
      isVisible: () => false,
    } as unknown as World;

    expect(isPresentationEventEligible(
      event(-1, 3, RING_CIRCUMFERENCE - 40, 0),
      world,
      20,
      Faction.Compact,
    )).toBe(true);
    expect(isPresentationEventEligible(
      event(-1, 4, RING_CIRCUMFERENCE * 0.29, 0),
      world,
      0,
      Faction.Compact,
    )).toBe(true);
    expect(isPresentationEventEligible(
      event(-1, 5, RING_CIRCUMFERENCE * 0.31, 0),
      world,
      0,
      Faction.Compact,
    )).toBe(false);
  });

  it('does not disclose a hostile Alignment event until both pair members are visible', () => {
    const visible = new Set<number>([7]);
    const world = {
      spinalPairs: [{ id: 'hidden-axis', members: [7, 8] }],
      isEntityVisible: (_viewer: Faction, id: number) => visible.has(id),
      isVisible: () => true,
    } as unknown as World;
    const alignment: SimEvent = {
      kind: 'alignmentStarted', faction: Faction.Choir, id: 7, s: 100, z: 0, h: 0, scale: 1,
      pairId: 'hidden-axis',
    };

    expect(isPresentationEventEligible(alignment, world, 0, Faction.Compact)).toBe(false);
    visible.add(8);
    expect(isPresentationEventEligible(alignment, world, 0, Faction.Compact)).toBe(true);
  });

  it('classifies Chord presentation without changing simulation event kinds', () => {
    expect(combatPresentationKind({ ...event(Faction.Compact, 1, 0, 0), kind: 'weaponFired', weapon: 'chordShot' }))
      .toBe('chordLaunch');
    expect(combatPresentationKind({ ...event(Faction.Compact, 2, 0, 0), weapon: 'chordShot' }))
      .toBe('chordImpact');
    expect(combatPresentationKind({ ...event(Faction.Compact, 3, 0, 0), weapon: 'batteryGun' }))
      .toBe('impact');
  });

  it('[deep-shadow-launch-signal] exposes a hostile deep-shadow launch globally without revealing day launches', () => {
    const world = {
      isEntityVisible: () => false,
      isVisible: () => false,
      shadowTimingAt: (s: number) => ({ state: s === 100 ? 'shadow' : 'day' }),
    } as unknown as World;
    const nightLaunch = { ...event(Faction.Choir, 7, 100, 0), kind: 'weaponFired' as const, weapon: 'batteryGun' };
    const dayLaunch = { ...event(Faction.Choir, 8, 200, 0), kind: 'weaponFired' as const, weapon: 'batteryGun' };

    expect(isPresentationEventEligible(nightLaunch, world, RING_CIRCUMFERENCE * 0.5, Faction.Compact)).toBe(true);
    expect(isPresentationEventEligible(dayLaunch, world, 0, Faction.Compact)).toBe(false);
  });
});

function event(faction: Faction | -1, id: number, s: number, z: number): SimEvent {
  return { kind: 'impact', faction, id, s, z, h: 0, scale: 1 };
}
