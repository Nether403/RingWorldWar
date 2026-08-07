import { RING_CIRCUMFERENCE } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { Faction, STARTING_SALVAGE } from '@sim/data';
import { World } from '@sim/world';
import {
  FIRST_CONTACT_RUNTIME_SCENARIO,
  resolveFirstContactMissionBindings,
} from '../../src/scenario/firstContact';
import {
  parseRuntimeScenario,
} from '../../src/scenario/runtimeScenario';
import { runtimeScenarioFromParams } from '../../src/scenario/route';
import { createRuntimeScenarioWorld } from '../../src/scenario/worldFactory';
import { MissionController } from '../../src/tutorial/mission';
import { describe, expect, it } from 'vitest';

const terrain = {
  seed: 73,
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('runtime scenario parsing', () => {
  it('strictly parses the versioned production envelope', () => {
    const scenario = parseRuntimeScenario(JSON.stringify(validScenario()));

    expect(scenario.schema).toBe('ring-world-war/runtime-scenario');
    expect(scenario.version).toBe(1);
    expect(scenario.playerFaction).toBe(Faction.Choir);
    expect(scenario.ai).toEqual({ enabled: false, difficulty: 'commander' });
    expect(scenario.openingView).toEqual({
      focusS: 55,
      focusZ: 0,
      yawRadians: 0,
      zoom: 130,
      actionEntities: ['choir-raider'],
      contextEntities: ['compact-bastion'],
      highlightDeposits: true,
    });
    expect(scenario.units[0]!.faction).toBe(Faction.Choir);
    expect(scenario.structures.find((structure) => structure.id === 'forward-node')!.faction).toBe(Faction.Compact);
  });

  it.each(['benchmark', 'camera', 'observationRegions'])('rejects browser-only %s data', (field) => {
    expect(() => parseRuntimeScenario({ ...validScenario(), [field]: {} })).toThrow(
      new RegExp(`\\$\\.${field}.*unexpected field`, 'i'),
    );
  });

  it('rejects unknown fields at every level', () => {
    const input = validScenario();
    (input.ai as Record<string, unknown>).quality = 'low';

    expect(() => parseRuntimeScenario(input)).toThrow(/\$\.ai\.quality.*unexpected field/i);
  });

  it('strictly validates opening presentation metadata and references', () => {
    const unknownField = validScenario();
    unknownField.openingView.camera = 'browser-only';
    expect(() => parseRuntimeScenario(unknownField)).toThrow(/openingView\.camera.*unexpected field/i);

    const unsafeZoom = validScenario();
    unsafeZoom.openingView.zoom = 1_000_000;
    expect(() => parseRuntimeScenario(unsafeZoom)).toThrow(/openingView\.zoom/i);

    const missingAction = validScenario();
    missingAction.openingView.actionEntities = ['missing'];
    expect(() => parseRuntimeScenario(missingAction)).toThrow(/actionEntities\[0\].*declared entity/i);
  });

  it.each(['__proto__', 'Uppercase', 'has space', 'a/b'])('rejects unsafe symbolic id %s', (id) => {
    const input = validScenario();
    input.units[0]!.id = id;

    expect(() => parseRuntimeScenario(input)).toThrow(/units\[0\]\.id.*safe symbolic id/i);
  });

  it('rejects duplicate symbolic entity and binding ids', () => {
    const duplicateEntity = validScenario();
    duplicateEntity.units[0]!.id = duplicateEntity.structures[0]!.id;
    expect(() => parseRuntimeScenario(duplicateEntity)).toThrow(/duplicate symbolic id/i);

    const duplicateBinding = validScenario();
    duplicateBinding.bindings.push({ ...duplicateBinding.bindings[0]! });
    expect(() => parseRuntimeScenario(duplicateBinding)).toThrow(/duplicate binding id/i);
  });

  it('rejects invalid factions, kinds, numbers, and faction-incompatible units', () => {
    const invalidFaction = validScenario();
    invalidFaction.units[0]!.faction = 'neutral';
    expect(() => parseRuntimeScenario(invalidFaction)).toThrow(/units\[0\]\.faction/i);

    const invalidKind = validScenario();
    invalidKind.structures[0]!.kind = 'castle';
    expect(() => parseRuntimeScenario(invalidKind)).toThrow(/structures\[0\]\.kind/i);

    const invalidNumber = validScenario();
    invalidNumber.deposits[0]!.amount = Number.NaN;
    expect(() => parseRuntimeScenario(invalidNumber)).toThrow(/deposits\[0\]\.amount/i);

    const invalidUnit = validScenario();
    invalidUnit.units[0]!.kind = 'bulwark';
    expect(() => parseRuntimeScenario(invalidUnit)).toThrow(/unavailable to faction/i);
  });

  it('rejects missing and semantically malformed references', () => {
    const missingOrderTarget = validScenario();
    missingOrderTarget.units[0]!.order = { kind: 'attack', target: 'missing' };
    expect(() => parseRuntimeScenario(missingOrderTarget)).toThrow(/order\.target.*declared entity/i);

    const malformedClaim = validScenario();
    malformedClaim.deposits[0]!.claimedBy = 'compact-bastion';
    expect(() => parseRuntimeScenario(malformedClaim)).toThrow(/claimedBy.*extractor/i);

    const malformedBinding = validScenario();
    malformedBinding.bindings[0]!.entity = 'missing';
    expect(() => parseRuntimeScenario(malformedBinding)).toThrow(/bindings\[0\]\.entity.*declared entity/i);
  });
});

describe('runtime scenario world factory', () => {
  it('creates deterministic identical authoritative state', () => {
    const scenario = parseRuntimeScenario(validScenario());
    const a = createRuntimeScenarioWorld(terrain, scenario);
    const b = createRuntimeScenarioWorld(terrain, scenario);

    expect(a.world).not.toBe(b.world);
    expect(a.world.stateHash()).toBe(b.world.stateHash());
    expect(a.openingView).toEqual(b.openingView);
  });

  it('starts from a fresh world without leaking the standard setup', () => {
    const scenario = parseRuntimeScenario(validScenario());
    const created = createRuntimeScenarioWorld(terrain, scenario);

    expect(created.world.structures).toHaveLength(scenario.structures.length);
    expect(created.world.units).toHaveLength(scenario.units.length);
    expect(created.world.deposits).toHaveLength(scenario.deposits.length);
    expect(created.world.structures.some((structure) =>
      structure.kind === 'bastion' && structure.faction === Faction.Choir)).toBe(false);
  });

  it('applies perspective, AI metadata, resources, orders, bindings, and authoritative caps', () => {
    const scenario = parseRuntimeScenario(validScenario());
    const created = createRuntimeScenarioWorld(terrain, scenario);
    const raider = created.world.unitById(created.entityIds.get('choir-raider')!)!;
    const bastion = created.world.structureById(created.entityIds.get('compact-bastion')!)!;
    const extractor = created.world.structureById(created.entityIds.get('compact-extractor')!)!;

    expect(created.playerFaction).toBe(Faction.Choir);
    expect(created.opponentFaction).toBe(Faction.Compact);
    expect(created.ai).toEqual({ enabled: false, difficulty: 'commander' });
    expect(created.world.players[Faction.Compact].salvage).toBe(2_400);
    expect(created.world.players[Faction.Choir].dominance).toBe(12);
    expect(created.world.players[Faction.Compact].commandCap).toBe(7);
    expect(created.world.players[Faction.Choir].commandUsed).toBe(1);
    expect(raider.order).toEqual({ kind: 'attack', s: bastion.s, z: bastion.z, targetId: bastion.id });
    expect(raider.targetId).toBe(bastion.id);
    expect(created.bindings.get('primary-target')).toBe(raider.id);
    expect(created.world.deposits[0]!.claimedBy).toBe(extractor.id);
    expect(created.openingView).toEqual({
      focusS: 55,
      focusZ: 0,
      yawRadians: 0,
      zoom: 130,
      actionEntityIds: [raider.id],
      contextEntityIds: [bastion.id],
      highlightDeposits: true,
    });
  });

  it('provides a distinct, playable authored First Contact setup', () => {
    const created = createRuntimeScenarioWorld(terrain, FIRST_CONTACT_RUNTIME_SCENARIO);

    expect(FIRST_CONTACT_RUNTIME_SCENARIO.id).toBe('first-contact');
    expect(FIRST_CONTACT_RUNTIME_SCENARIO.ai.enabled).toBe(false);
    expect(created.world.structures.filter((structure) => structure.kind === 'bastion')).toHaveLength(2);
    expect(created.world.units.filter((unit) => unit.faction === Faction.Compact)).toHaveLength(3);
    expect(created.world.units.filter((unit) => unit.faction === Faction.Choir)).toHaveLength(5);
    const raider = created.world.unitById(created.entityIds.get('choir-tutorial-raider')!)!;
    const hunter = created.world.unitById(created.entityIds.get('choir-tutorial-hunter')!)!;
    expect({ kind: raider.kind, order: raider.order }).toEqual({
      kind: 'vanguard',
      order: { kind: 'move', s: 68, z: -70, targetId: 0 },
    });
    expect({ kind: hunter.kind, order: hunter.order }).toEqual({
      kind: 'vanguard',
      order: { kind: 'move', s: 68, z: 38, targetId: 0 },
    });
    expect(raider.hp / raider.maxHp).toBeCloseTo(0.65);
    expect(hunter.hp / hunter.maxHp).toBeCloseTo(0.65);
    expect(created.world.deposits).toHaveLength(6);
    expect(created.world.players[Faction.Compact].salvage).toBeGreaterThan(STARTING_SALVAGE);
    expect(created.world.players[Faction.Choir].salvage).toBe(STARTING_SALVAGE);
    expect(created.bindings.get('tutorial-node')).toBeTypeOf('number');
    expect(created.bindings.get('artillery-target')).toBeTypeOf('number');
    expect(created.openingView.actionEntityIds).toHaveLength(3);
    expect(created.openingView.contextEntityIds).toEqual([
      created.entityIds.get('compact-bastion'),
    ]);
  });

  it('lets the authored raider threat reach and fail an ignored First Contact deterministically', () => {
    const created = createRuntimeScenarioWorld(terrain, FIRST_CONTACT_RUNTIME_SCENARIO);
    const mission = MissionController.start(
      'first-contact',
      created.world.tick,
      resolveFirstContactMissionBindings(created.bindings),
    );

    for (let tick = 0; tick < 6_000 && mission.hudModel().status === 'active'; tick++) {
      created.world.step();
      mission.advanceTick(created.world, created.world.drainEvents());
    }

    const survivorState = created.world.units.map((unit) => ({
      faction: unit.faction, kind: unit.kind, alive: unit.alive, s: Math.round(unit.s), z: Math.round(unit.z), hp: Math.round(unit.hp),
      targetId: unit.targetId, order: unit.order.kind,
    }));
    expect(created.world.units.filter((unit) =>
      unit.alive && unit.faction === Faction.Compact && unit.kind === 'engineer'), JSON.stringify(survivorState)).toHaveLength(0);
    expect(mission.hudModel()).toMatchObject({
      status: 'failed',
      objectiveTitle: 'Construction crew lost',
    });
    expect(created.world.tick).toBeGreaterThan(1_800);
    expect(created.world.tick).toBeLessThan(6_000);
  });

  it('starts First Contact at the first objective without auto-skipping developed-base goals', () => {
    const created = createRuntimeScenarioWorld(terrain, FIRST_CONTACT_RUNTIME_SCENARIO);
    const bindings = resolveFirstContactMissionBindings(created.bindings);
    const mission = MissionController.start('first-contact', created.world.tick, bindings);
    const engineer = created.world.units.find((unit) =>
      unit.faction === Faction.Compact && unit.kind === 'engineer')!;

    expect(mission.hudModel().objectiveId).toBe('select-engineer');
    mission.observePlayerAction({ kind: 'selection-changed', selectedIds: [engineer.id] }, created.world);
    mission.advanceTick(created.world, []);

    expect(mission.hudModel().objectiveId).toBe('build-power');
    expect(mission.hudModel().progressText).toBe('2 / 10');
  });

  it('fails clearly when a required First Contact binding is absent', () => {
    expect(() => resolveFirstContactMissionBindings(new Map([['tutorial-node', 7]]))).toThrow(
      'First Contact runtime scenario is missing required binding artillery-target',
    );
  });
});

describe('runtime scenario browser route', () => {
  it('allowlists only the authored First Contact scenario', () => {
    expect(runtimeScenarioFromParams(new URLSearchParams('scenario=first-contact'))).toBe(
      FIRST_CONTACT_RUNTIME_SCENARIO,
    );
    expect(runtimeScenarioFromParams(new URLSearchParams())).toBeNull();
    expect(() => runtimeScenarioFromParams(new URLSearchParams('scenario=unknown'))).toThrow(
      'Unsupported runtime scenario: unknown',
    );
    expect(() => runtimeScenarioFromParams(
      new URLSearchParams('scenario=first-contact&scenario=first-contact'),
    )).toThrow('Runtime scenario query must be specified exactly once');
  });
});

describe('standard skirmish regression', () => {
  it('keeps World.setup as the existing standard two-player start', () => {
    const world = new World(terrain, 73);
    world.setup();

    expect(world.units).toHaveLength(6);
    expect(world.structures).toHaveLength(6);
    expect(world.structures.filter((structure) => structure.kind === 'bastion')).toHaveLength(2);
    expect(world.structures.filter((structure) => structure.kind === 'spinalNode')).toHaveLength(4);
    expect(world.players[Faction.Compact].salvage).toBe(STARTING_SALVAGE);
    expect(world.players[Faction.Choir].salvage).toBe(STARTING_SALVAGE);
  });
});

function validScenario(): any {
  return {
    schema: 'ring-world-war/runtime-scenario',
    version: 1,
    id: 'factory-contract',
    worldSeed: 73,
    playerFaction: 'choir',
    ai: { enabled: false, difficulty: 'commander' },
    openingView: {
      focusS: 55,
      focusZ: 0,
      yawRadians: 0,
      zoom: 130,
      actionEntities: ['choir-raider'],
      contextEntities: ['compact-bastion'],
      highlightDeposits: true,
    },
    players: [
      { faction: 'compact', salvage: 2_400, dominance: 4 },
      { faction: 'choir', salvage: 1_900, dominance: 12 },
    ],
    structures: [
      { id: 'compact-bastion', faction: 'compact', kind: 'bastion', s: 0, z: 0, progress: 1 },
      { id: 'forward-node', faction: 'compact', kind: 'spinalNode', s: 400, z: 0, progress: 1 },
      { id: 'compact-extractor', faction: 'compact', kind: 'extractor', s: 180, z: 120, progress: 1 },
    ],
    units: [
      {
        id: 'choir-raider',
        faction: 'choir',
        kind: 'needle',
        s: RING_CIRCUMFERENCE * 0.5,
        z: 0,
        order: { kind: 'attack', target: 'compact-bastion' },
      },
    ],
    deposits: [
      { s: 180, z: 120, amount: 8_000, claimedBy: 'compact-extractor' },
    ],
    bindings: [
      { id: 'primary-target', entity: 'choir-raider' },
    ],
  };
}
