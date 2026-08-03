import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { MissionController, parseMissionSnapshot } from '../../src/tutorial/mission';
import { SIGNAL_HOLD_TICKS } from '../../src/tutorial/signalInSpine';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('A Signal in the Spine', () => {
  it('pauses at the briefing and persists acknowledged narrative progression', () => {
    const setup = storyWorld();
    const mission = MissionController.start('a-signal-in-the-spine', setup.world.tick, setup.bindings);

    expect(mission.narrativeBlocksSimulation).toBe(true);
    expect(mission.narrativeHudModel()?.id).toBe('signal-briefing');
    mission.acknowledgeNarrative();
    expect(mission.narrativeBlocksSimulation).toBe(false);

    setup.engineer.s = setup.node.s;
    setup.engineer.z = setup.node.z;
    setup.bulwark.s = setup.node.s;
    setup.bulwark.z = setup.node.z;
    mission.advanceTick(setup.world, []);
    expect(mission.hudModel().objectiveId).toBe('break-hunter-screen');
    expect(mission.narrativeHudModel()?.id).toBe('signal-hunters');
    mission.acknowledgeNarrative();

    for (const needle of setup.needles) needle.alive = false;
    mission.advanceTick(setup.world, []);
    setup.power.progress = 1;
    mission.advanceTick(setup.world, []);
    expect(mission.narrativeHudModel()).toBeNull();
    setup.node.faction = Faction.Compact;
    mission.advanceTick(setup.world, []);
    for (let tick = 0; tick < SIGNAL_HOLD_TICKS; tick++) {
      setup.world.tick++;
      mission.advanceTick(setup.world, []);
    }
    expect(mission.narrativeHudModel()?.id).toBe('signal-migration');
    mission.acknowledgeNarrative();
    const activeAfterHold = mission.snapshot();
    setup.command.alive = false;
    mission.advanceTick(setup.world, []);

    expect(mission.hudModel().status).toBe('completed');
    expect(mission.narrativeHudModel()?.id).toBe('signal-last-correction');
    expect(mission.narrativeBlocksSimulation).toBe(true);
    const restored = MissionController.fromSnapshot(
      parseMissionSnapshot(JSON.stringify(mission.snapshot())),
      setup.world,
    );
    expect(restored.narrativeHudModel()?.id).toBe('signal-last-correction');
    expect(restored.snapshot()).toEqual(mission.snapshot());

    setup.command.alive = true;
    const recaptureController = MissionController.fromSnapshot(activeAfterHold, setup.world);
    setup.node.faction = Faction.Choir;
    setup.power.alive = false;
    setup.world.tick++;
    recaptureController.advanceTick(setup.world, []);
    const recaptured = recaptureController.snapshot();
    expect(MissionController.fromSnapshot(recaptured, setup.world).snapshot()).toEqual(recaptured);

    const forgedHold = structuredClone(recaptured);
    forgedHold.milestones.signalInSpine!.milestoneTicks[3] = setup.world.tick;
    forgedHold.milestones.signalInSpine!.holdTicks = SIGNAL_HOLD_TICKS;
    expect(() => MissionController.fromSnapshot(forgedHold, setup.world)).toThrow(/holdTicks|cannot precede/i);
  });
});

function storyWorld() {
  const world = new World(terrain, 71);
  const node = world.spawnStructure(-1 as Faction, 'spinalNode', 1_400, 0, 1);
  const engineer = world.spawnUnit(Faction.Compact, 'engineer', 0, 0);
  const bulwark = world.spawnUnit(Faction.Compact, 'bulwark', 0, 50);
  const needles = [
    world.spawnUnit(Faction.Choir, 'needle', 700, 100),
    world.spawnUnit(Faction.Choir, 'needle', 800, -100),
  ];
  const power = world.spawnStructure(Faction.Compact, 'fusionCore', 1_250, -150, 0.25);
  const command = world.spawnStructure(Faction.Choir, 'mechFoundry', 2_000, 0, 1);
  return {
    world, node, engineer, bulwark, needles, power, command,
    bindings: {
      signalNode: node.id,
      engineer: engineer.id,
      bulwark: bulwark.id,
      needleIds: needles.map((needle) => needle.id),
      restorationPower: power.id,
      fieldCommand: command.id,
    },
  };
}
