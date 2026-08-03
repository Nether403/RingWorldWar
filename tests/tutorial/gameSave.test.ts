import { AiOpponent } from '@ai/opponent';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { serializeMatchSession } from '@headless/session';
import {
  createGameSaveSnapshot,
  deserializeGameSave,
  MAX_GAME_SAVE_BYTES,
  parseGameSaveSnapshot,
  serializeGameSave,
} from '../../src/gameSave';
import { MissionController } from '../../src/tutorial/mission';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('game saves', () => {
  it('round-trips the match, AI mode, and tutorial progress as one validated envelope', () => {
    const world = new World(terrain, 71);
    world.setup();
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 20_000, 0, 1);
    const target = world.spawnStructure(Faction.Choir, 'fusionCore', 19_500, 0, 1);
    const mission = MissionController.start('first-contact', world.tick, {
      tutorialNode: node.id,
      artilleryTarget: target.id,
    });
    mission.observePlayerAction({ kind: 'selection-changed', selectedIds: [world.units[0]!.id] }, world);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 171),
      new AiOpponent(Faction.Choir, 'veteran', 271),
    ] as const;

    const snapshot = createGameSaveSnapshot(world, controllers, false, mission.snapshot());
    const restored = deserializeGameSave(serializeGameSave(world, controllers, false, mission.snapshot()), terrain);

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(restored.aiEnabled).toBe(false);
    expect(restored.world.stateHash()).toBe(world.stateHash());
    expect(restored.mission?.hudModel().objectiveId).toBe('build-power');
  });

  it('loads legacy match-session saves with no mission and AI enabled', () => {
    const world = new World(terrain, 72);
    world.setup();
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 172),
      new AiOpponent(Faction.Choir, 'veteran', 272),
    ] as const;

    const restored = deserializeGameSave(serializeMatchSession(world, controllers), terrain);

    expect(restored.aiEnabled).toBe(true);
    expect(restored.mission).toBeNull();
    expect(restored.world.stateHash()).toBe(world.stateHash());
  });

  it('rejects malformed mission progress before returning any live authority', () => {
    const world = new World(terrain, 73);
    world.setup();
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 173),
      new AiOpponent(Faction.Choir, 'veteran', 273),
    ] as const;
    const snapshot = createGameSaveSnapshot(world, controllers, true, null) as unknown as {
      mission: unknown;
    };
    snapshot.mission = { schema: 'ring-world-war/mission' };

    expect(() => parseGameSaveSnapshot(snapshot)).toThrow(/mission/i);
  });

  it('rejects oversized browser slots before JSON expansion', () => {
    expect(() => parseGameSaveSnapshot('x'.repeat(MAX_GAME_SAVE_BYTES + 1))).toThrow(/size limit/i);
  });

  it('refuses to serialize a world that the loader cardinality bounds reject', () => {
    const world = new World(terrain, 74);
    world.setup();
    for (let index = world.structures.length; index < 257; index++) {
      world.spawnStructure(Faction.Compact, 'solarArray', index * 10, 0, 1);
    }
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 174),
      new AiOpponent(Faction.Choir, 'veteran', 274),
    ] as const;

    expect(() => serializeGameSave(world, controllers, true, null)).toThrow(/structures.*at most 256/i);
  });
});
