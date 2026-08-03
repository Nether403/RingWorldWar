import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import type { SimEvent } from '@sim/world';
import { World } from '@sim/world';
import {
  MissionController,
  parseMissionSnapshot,
  type MissionBindings,
  type BreakLineBindings,
} from '../../src/tutorial/mission';
import { BREAK_LINE_HOLD_TICKS } from '../../src/tutorial/breakLine';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('First Contact mission', () => {
  it('advances from real player actions and simulation events without losing early milestones', () => {
    const world = new World(terrain, 41);
    const engineer = world.spawnUnit(Faction.Compact, 'engineer', 0, 0);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 20_000, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 19_500, 0, 1);
    const bindings: MissionBindings = { tutorialNode: node.id, artilleryTarget: target.id };
    const mission = MissionController.start('first-contact', world.tick, bindings);

    expect(mission.hudModel()).toMatchObject({
      missionId: 'first-contact',
      objectiveId: 'select-engineer',
      status: 'active',
      progressText: '1 / 10',
    });

    mission.observePlayerAction({ kind: 'selection-changed', selectedIds: [engineer.id] }, world);
    expect(mission.hudModel().objectiveId).toBe('build-power');

    // Completing later milestones early must not strand the sequential tutorial.
    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'extractor')]);
    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'solarArray')]);
    expect(mission.hudModel().objectiveId).toBe('build-power');
    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'solarArray')]);
    expect(mission.hudModel().objectiveId).toBe('build-fabricator');

    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'fabricator')]);
    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'mechFoundry')]);
    mission.advanceTick(world, [event('unitComplete', Faction.Compact, 'wisp')]);
    mission.advanceTick(world, [{ ...event('nodeCaptured', Faction.Compact), id: node.id }]);
    mission.advanceTick(world, [event('unitComplete', Faction.Compact, 'longbow')]);

    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 100, 0);
    longbow.ability!.active = true;
    longbow.ability!.transitionTimer = 0;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('fire-antispinward');

    mission.observePlayerAction({
      kind: 'artillery-fired',
      sourceId: longbow.id,
      weaponId: 'siegeMortar',
      targetS: target.s,
      targetZ: target.z,
    }, world);
    expect(mission.hudModel()).toMatchObject({ status: 'completed', objectiveId: null, progressText: '10 / 10' });
  });

  it('requires the bound target to be antispinward of the firing Longbow', () => {
    const world = new World(terrain, 42);
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 100, 0);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 500, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 700, 0, 1);
    const mission = missionAtFinalObjective(world, { tutorialNode: node.id, artilleryTarget: target.id });

    mission.observePlayerAction({
      kind: 'artillery-fired', sourceId: longbow.id, weaponId: 'siegeMortar', targetS: target.s, targetZ: target.z,
    }, world);

    expect(mission.hudModel().objectiveId).toBe('fire-antispinward');
    expect(mission.hudModel().status).toBe('active');
  });

  it('round-trips validated progress and rejects malformed mission state', () => {
    const world = new World(terrain, 43);
    const engineer = world.spawnUnit(Faction.Compact, 'engineer', 0, 0);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 20_000, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 19_500, 0, 1);
    const bindings = { tutorialNode: node.id, artilleryTarget: target.id };
    const mission = MissionController.start('first-contact', world.tick, bindings);
    mission.observePlayerAction({ kind: 'selection-changed', selectedIds: [engineer.id] }, world);
    mission.advanceTick(world, [event('structureComplete', Faction.Compact, 'solarArray')]);

    const snapshot = mission.snapshot();
    const restored = MissionController.fromSnapshot(parseMissionSnapshot(JSON.stringify(snapshot)), world);
    const legacySnapshot = JSON.parse(JSON.stringify(snapshot));
    delete legacySnapshot.milestones.breakLine;

    expect(restored.snapshot()).toEqual(snapshot);
    expect(parseMissionSnapshot(legacySnapshot).milestones.breakLine).toBeNull();
    expect(() => parseMissionSnapshot({ ...snapshot, objectiveIndex: 99 })).toThrow(/objectiveIndex/i);
    expect(() => parseMissionSnapshot({
      ...snapshot,
      objectiveIndex: 10,
      completedObjectiveTicks: Array.from({ length: 10 }, () => world.tick),
    })).toThrow(/active.*objectiveIndex/i);
    expect(() => parseMissionSnapshot({
      ...snapshot,
      status: 'completed',
      objectiveIndex: 10,
      completedAtTick: world.tick,
      objectiveStartedAtTick: world.tick,
      completedObjectiveTicks: Array.from({ length: 10 }, () => world.tick),
    })).toThrow(/milestones/i);
    expect(() => MissionController.fromSnapshot({
      ...snapshot,
      bindings: { ...snapshot.bindings, artilleryTarget: 999_999 },
    }, world)).toThrow(/artilleryTarget/i);
    expect(() => MissionController.fromSnapshot({
      ...snapshot,
      startedAtTick: world.tick + 1,
      objectiveStartedAtTick: world.tick + 1,
      completedObjectiveTicks: [world.tick + 1],
    }, world)).toThrow(/world tick/i);

    node.faction = Faction.Compact;
    expect(() => MissionController.fromSnapshot(snapshot, world)).toThrow(/neutral Spinal Node/i);
  });

  it('restores a completed mission after its bound battlefield entities are gone', () => {
    const world = new World(terrain, 44);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 20_000, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 19_500, 0, 1);
    const mission = missionAtFinalObjective(world, { tutorialNode: node.id, artilleryTarget: target.id });
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 100, 0);
    mission.observePlayerAction({
      kind: 'artillery-fired', sourceId: longbow.id, weaponId: 'siegeMortar', targetS: target.s, targetZ: target.z,
    }, world);
    const completed = mission.snapshot();
    node.alive = false;
    target.alive = false;

    expect(MissionController.fromSnapshot(completed, world).snapshot()).toEqual(completed);
  });

  it('restores retained out-of-order milestones after their bound entities change', () => {
    const world = new World(terrain, 45);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 20_000, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 19_500, 0, 1);
    const snapshot = MissionController.start('first-contact', world.tick, {
      tutorialNode: node.id,
      artilleryTarget: target.id,
    }).snapshot();
    snapshot.milestones.capturedNodeIds = [node.id];
    snapshot.milestones.firedAntispinward = true;
    node.faction = Faction.Compact;
    target.alive = false;

    expect(MissionController.fromSnapshot(snapshot, world).snapshot()).toEqual(snapshot);
  });
});

describe('Break the Line mission', () => {
  it('records pacing ticks across scouting, defence, artillery, assault, and consolidation', () => {
    const world = new World(terrain, 51);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 4_700, 0, 1);
    const extractor = world.spawnStructure(Faction.Compact, 'extractor', 190, 150, 1);
    const battery = world.spawnStructure(Faction.Choir, 'rocketBattery', 3_200, 0, 1);
    const core = world.spawnStructure(Faction.Choir, 'fusionCore', 3_300, 150, 1);
    const radar = world.spawnStructure(Faction.Choir, 'radarMast', 3_300, -150, 1);
    const raiderA = world.spawnUnit(Faction.Choir, 'vanguard', 800, 0);
    const raiderB = world.spawnUnit(Faction.Choir, 'vanguard', 900, 0);
    const wisp = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', node.s, node.z);
    const bindings: BreakLineBindings = {
      forwardNode: node.id,
      protectedExtractor: extractor.id,
      enemyArtillery: battery.id,
      strongpointIds: [core.id, radar.id],
      raiderIds: [raiderA.id, raiderB.id],
    };
    const mission = MissionController.start('break-the-line', world.tick, bindings);

    mission.advanceTick(world, []);
    expect(mission.hudModel()).toMatchObject({ objectiveId: 'hold-salvage-line', progressText: '1 / 7' });

    world.tick++;
    raiderA.alive = false;
    raiderB.alive = false;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('scout-forward-line');

    world.tick++;
    wisp.s = battery.s;
    wisp.z = battery.z;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('secure-forward-node');

    world.tick++;
    node.faction = Faction.Compact;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('establish-high-ground');

    world.tick++;
    longbow.ability!.active = true;
    longbow.ability!.transitionTimer = 0;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('silence-artillery');

    world.tick++;
    battery.alive = false;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('break-strongpoint');

    world.tick++;
    core.alive = false;
    mission.advanceTick(world, []);
    expect(MissionController.fromSnapshot(mission.snapshot(), world).snapshot()).toEqual(mission.snapshot());
    expect(mission.hudModel().objectiveId).toBe('break-strongpoint');

    world.tick++;
    radar.alive = false;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('hold-forward-line');

    for (let tick = 0; tick < BREAK_LINE_HOLD_TICKS; tick++) {
      world.tick++;
      mission.advanceTick(world, []);
    }
    const snapshot = mission.snapshot();
    expect(mission.hudModel()).toMatchObject({ status: 'completed', objectiveId: null, progressText: '7 / 7' });
    expect(snapshot.completedObjectiveTicks).toHaveLength(7);
    expect(snapshot.completedObjectiveTicks).toEqual([...snapshot.completedObjectiveTicks].sort((a, b) => a - b));
    expect(MissionController.fromSnapshot(parseMissionSnapshot(JSON.stringify(snapshot)), world).snapshot()).toEqual(snapshot);
    expect(snapshot.milestones.breakLine?.milestoneTicks).toEqual([
      1, 2, 3, 4, 5, 7, 7 + BREAK_LINE_HOLD_TICKS,
    ]);
    const future = structuredClone(snapshot);
    future.milestones.breakLine!.milestoneTicks[0] = world.tick + 1;
    expect(() => MissionController.fromSnapshot(future, world)).toThrow(/milestoneTicks/i);
    expect(wisp.alive).toBe(true);
  });

  it('fails if the protected Extractor falls before the raid is defeated', () => {
    const world = new World(terrain, 52);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 4_700, 0, 1);
    const extractor = world.spawnStructure(Faction.Compact, 'extractor', 190, 150, 1);
    const battery = world.spawnStructure(Faction.Choir, 'rocketBattery', 3_200, 0, 1);
    const core = world.spawnStructure(Faction.Choir, 'fusionCore', 3_300, 150, 1);
    const raider = world.spawnUnit(Faction.Choir, 'vanguard', 800, 0);
    const mission = MissionController.start('break-the-line', world.tick, {
      forwardNode: node.id,
      protectedExtractor: extractor.id,
      enemyArtillery: battery.id,
      strongpointIds: [core.id],
      raiderIds: [raider.id],
    });

    extractor.alive = false;
    mission.advanceTick(world, []);

    expect(mission.hudModel().status).toBe('failed');
    expect(mission.snapshot().failedAtTick).toBe(world.tick);
    expect(parseMissionSnapshot(JSON.stringify(mission.snapshot())).status).toBe('failed');
  });

  it('fails instead of accumulating hold time after the underlying match ends', () => {
    const world = new World(terrain, 53);
    const node = world.spawnStructure(Faction.Compact, 'spinalNode', 4_700, 0, 1);
    const extractor = world.spawnStructure(Faction.Compact, 'extractor', 190, 150, 1);
    const battery = world.spawnStructure(Faction.Choir, 'rocketBattery', 3_200, 0, 1);
    const core = world.spawnStructure(Faction.Choir, 'fusionCore', 3_300, 150, 1);
    const raider = world.spawnUnit(Faction.Choir, 'vanguard', 800, 0);
    const mission = MissionController.start('break-the-line', world.tick, {
      forwardNode: node.id,
      protectedExtractor: extractor.id,
      enemyArtillery: battery.id,
      strongpointIds: [core.id],
      raiderIds: [raider.id],
    });
    world.status = 'completed';
    mission.advanceTick(world, []);
    const failed = mission.snapshot();
    mission.advanceTick(world, []);

    expect(failed.status).toBe('failed');
    expect(failed.milestones.breakLine?.failureReason).toBe('match-ended');
    expect(mission.snapshot()).toEqual(failed);
  });

  it('does not strand progression when the battery is destroyed before positioning', () => {
    const world = new World(terrain, 54);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 4_700, 0, 1);
    const extractor = world.spawnStructure(Faction.Compact, 'extractor', 190, 150, 1);
    const battery = world.spawnStructure(Faction.Choir, 'rocketBattery', 3_200, 0, 1);
    const core = world.spawnStructure(Faction.Choir, 'fusionCore', 3_300, 150, 1);
    const raider = world.spawnUnit(Faction.Choir, 'vanguard', 800, 0);
    const mission = MissionController.start('break-the-line', world.tick, {
      forwardNode: node.id,
      protectedExtractor: extractor.id,
      enemyArtillery: battery.id,
      strongpointIds: [core.id],
      raiderIds: [raider.id],
    });
    raider.alive = false;
    battery.alive = false;
    mission.advanceTick(world, []);
    node.faction = Faction.Compact;
    world.tick++;
    mission.advanceTick(world, []);

    expect(mission.hudModel().objectiveId).toBe('break-strongpoint');
  });
});

function event(
  kind: SimEvent['kind'],
  faction: SimEvent['faction'],
  entityKind?: SimEvent['entityKind'],
): SimEvent {
  return { kind, faction, entityKind, id: 1, s: 0, z: 0, h: 0, scale: 1 };
}

function missionAtFinalObjective(world: World, bindings: MissionBindings): MissionController {
  const snapshot = MissionController.start('first-contact', world.tick, bindings).snapshot();
  return MissionController.fromSnapshot({
    ...snapshot,
    objectiveIndex: 9,
    milestones: {
      selectedEngineer: true,
      structureCounts: { solarArray: 2, extractor: 1, fabricator: 1, mechFoundry: 1 },
      unitCounts: { wisp: 1, longbow: 1 },
      capturedNodeIds: [bindings.tutorialNode],
      deployedLongbow: true,
      firedAntispinward: false,
      breakLine: null,
      counterfire: null,
      signalInSpine: null,
    },
    completedObjectiveTicks: Array.from({ length: 9 }, () => world.tick),
  }, world);
}
