import { describe, expect, it } from 'vitest';
import { Faction, type UnitKind } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import {
  VoiceDirector,
  type VoiceClip,
  type VoicePlayback,
} from '../../src/audio/voiceDirector';

const CLIPS: readonly VoiceClip[] = [
  clip('compact.vanguard.selected', Faction.Compact, 'vanguard', 'selected', 1),
  clip('compact.vanguard.move', Faction.Compact, 'vanguard', 'move', 2),
  clip('compact.vanguard.attack', Faction.Compact, 'vanguard', 'attack', 3),
  clip('compact.vanguard.ready', Faction.Compact, 'vanguard', 'ready', 1),
  clip('compact.vanguard.critical', Faction.Compact, 'vanguard', 'critical', 5),
  clip('compact.group-selected', Faction.Compact, undefined, 'group-selected', 1),
  clip('compact.group-move', Faction.Compact, undefined, 'group-move', 2),
  clip('compact.group-lost', Faction.Compact, undefined, 'group-lost', 6),
];

describe('VoiceDirector', () => {
  it('uses unit and group clips for accepted player actions', () => {
    let now = 1_000;
    const played: VoicePlayback[] = [];
    const director = new VoiceDirector((request) => played.push(request), CLIPS, () => now);

    director.observeSelection(Faction.Compact, [{ id: 10, kind: 'vanguard' }]);
    now += 700;
    director.observeOrder(Faction.Compact, [{ id: 10, kind: 'vanguard' }], 'move');
    now += 700;
    director.observeSelection(Faction.Compact, [
      { id: 10, kind: 'vanguard' },
      { id: 11, kind: 'vanguard' },
    ]);

    expect(played.map((request) => request.clip.id)).toEqual([
      'compact.vanguard.selected',
      'compact.vanguard.move',
      'compact.group-selected',
    ]);
  });

  it('suppresses rapid and repeated selection chatter', () => {
    let now = 1_000;
    const played: VoicePlayback[] = [];
    const director = new VoiceDirector((request) => played.push(request), CLIPS, () => now);
    const selection = [{ id: 10, kind: 'vanguard' as const }];

    director.observeSelection(Faction.Compact, selection);
    now += 500;
    director.observeSelection(Faction.Compact, selection);
    now += 1_100;
    director.observeSelection(Faction.Compact, selection);

    expect(played).toHaveLength(2);
  });

  it('plays at most one highest-priority event cue and suppresses fatal critical warnings', () => {
    let now = 1_000;
    const played: VoicePlayback[] = [];
    const director = new VoiceDirector((request) => played.push(request), CLIPS, () => now);
    const world = {
      unitById: (id: number) => id === 8 ? { id, kind: 'vanguard' } : undefined,
    } as unknown as World;

    director.consumePresentation([
      event('unitComplete', 7, { entityKind: 'vanguard' }),
      event('damageStateChanged', 8, { scale: 2 }),
    ], world, Faction.Compact);
    now += 700;
    director.consumePresentation([
      event('damageStateChanged', 8, { scale: 2 }),
      event('unitDied', 8, { entityKind: 'vanguard' }),
    ], world, Faction.Compact);

    expect(played.map((request) => request.clip.id)).toEqual([
      'compact.vanguard.critical',
      'compact.group-lost',
    ]);
  });

  it('clears cooldown state on reset', () => {
    let now = 1_000;
    const played: VoicePlayback[] = [];
    const director = new VoiceDirector((request) => played.push(request), CLIPS, () => now);
    const selection = [{ id: 10, kind: 'vanguard' as const }];

    director.observeSelection(Faction.Compact, selection);
    now += 100;
    director.reset();
    director.observeSelection(Faction.Compact, selection);

    expect(played).toHaveLength(2);
  });

  it('coalesces emergency chatter across consecutive presentation batches', () => {
    let now = 1_000;
    const played: VoicePlayback[] = [];
    const director = new VoiceDirector((request) => played.push(request), CLIPS, () => now);
    const world = { unitById: () => undefined } as unknown as World;

    director.consumePresentation([event('unitDied', 8, { entityKind: 'vanguard' })], world, Faction.Compact);
    now += 100;
    director.consumePresentation([event('unitDied', 9, { entityKind: 'vanguard' })], world, Faction.Compact);
    now += 2_500;
    director.consumePresentation([event('unitDied', 10, { entityKind: 'vanguard' })], world, Faction.Compact);

    expect(played.map((request) => request.clip.id)).toEqual([
      'compact.group-lost',
      'compact.group-lost',
    ]);
  });
});

function clip(
  id: string,
  faction: Faction,
  unit: UnitKind | undefined,
  trigger: VoiceClip['trigger'],
  priority: number,
): VoiceClip {
  return { id, faction, unit, trigger, priority, src: `/voices/${id}.mp3` };
}

function event(kind: SimEvent['kind'], id: number, overrides: Partial<SimEvent> = {}): SimEvent {
  return { kind, id, faction: Faction.Compact, s: 0, z: 0, h: 0, scale: 1, ...overrides };
}
