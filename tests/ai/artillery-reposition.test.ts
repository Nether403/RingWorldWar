import { AiOpponent, type Difficulty } from '@ai/opponent';
import { SIM_DT } from '@core/constants';
import { surfaceDist, wrapS } from '@core/ringMath';
import { TERRAIN_CELL, Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { describe, expect, it } from 'vitest';

const flatTerrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;
const disconnectedTerrain = createDisconnectedTerrain();

const difficulties: Difficulty[] = ['recruit', 'veteran', 'commander'];

describe.each(difficulties)('AI artillery reposition at %s difficulty', (difficulty) => {
  it('issues a new move order within two simulated seconds after reveal expiry', () => {
    const world = new World(flatTerrain, 101);
    const longbow = world.spawnUnit(Faction.Choir, 'longbow', 1_000, 200);
    const opponent = new AiOpponent(Faction.Choir, difficulty, 201);
    longbow.revealed = SIM_DT * 6;

    opponent.update(world, SIM_DT);
    longbow.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };

    let expiredAt: number | null = null;
    let orderedAt: number | null = null;
    for (let tick = 0; tick < 90 && orderedAt === null; tick++) {
      const wasRevealed = longbow.revealed > 0;
      world.step();
      opponent.update(world, SIM_DT);
      if (wasRevealed && longbow.revealed === 0) expiredAt = world.time;
      if (expiredAt !== null && longbow.order.kind === 'move') orderedAt = world.time;
    }

    expect(expiredAt).not.toBeNull();
    expect(orderedAt).not.toBeNull();
    expect(orderedAt! - expiredAt!).toBeLessThanOrEqual(2);
    expect(longbow.order.kind).toBe('move');
    expect({ s: longbow.order.s, z: longbow.order.z }).not.toEqual({ s: longbow.s, z: longbow.z });
  });

  it('chooses a reachable short offset and can advance on disconnected procedural terrain', () => {
    const world = new World(disconnectedTerrain, 102);
    const longbow = world.spawnUnit(Faction.Choir, 'longbow', 0, 0);
    const opponent = new AiOpponent(Faction.Choir, difficulty, 202);
    const origin = { s: 120, z: 0 };
    const preferredOffset = { ds: 160, dz: 90 };
    expect(world.nav.directionAt(
      origin.s,
      origin.z,
      wrapS(origin.s + preferredOffset.ds),
      origin.z + preferredOffset.dz,
    ).reachable).toBe(false);
    longbow.s = origin.s;
    longbow.z = origin.z;
    longbow.prevS = origin.s;
    longbow.prevZ = origin.z;
    longbow.revealed = SIM_DT;

    opponent.update(world, SIM_DT);
    longbow.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
    world.step();
    opponent.update(world, SIM_DT);

    expect(longbow.order.kind).toBe('move');
    expect(world.nav.segmentPassable(origin.s, origin.z, longbow.order.s, longbow.order.z)).toBe(true);
    expect(world.nav.directionAt(origin.s, origin.z, longbow.order.s, longbow.order.z).reachable).toBe(true);

    for (let tick = 0; tick < 90 && longbow.order.kind === 'move'; tick++) world.step();
    expect(surfaceDist(origin.s, origin.z, longbow.s, longbow.z)).toBeGreaterThan(1);
  }, 30_000);
});

it('clears safely when no post-reveal offset is passable', () => {
  const world = new World(flatTerrain, 103);
  const longbow = world.spawnUnit(Faction.Choir, 'longbow', 1_000, 200);
  const opponent = new AiOpponent(Faction.Choir, 'veteran', 203);
  longbow.revealed = SIM_DT;
  opponent.update(world, SIM_DT);
  longbow.order = { kind: 'move', s: 5_000, z: 500, targetId: 0 };
  world.nav.segmentPassable = () => false;

  world.step();
  opponent.update(world, SIM_DT);

  expect(longbow.order).toEqual({ kind: 'idle', s: 0, z: 0, targetId: 0 });
});

function createDisconnectedTerrain(): Terrain {
  const terrain = new Terrain({ seed: 501, flatZones: [{ s: 120, z: 0, radius: 600 }] });
  for (const wallS of [192, 448]) {
    const center = Math.round(wallS / TERRAIN_CELL);
    for (let row = 0; row < terrain.rows; row++) {
      for (let offset = -1; offset <= 1; offset++) {
        const col = (center + offset + terrain.cols) % terrain.cols;
        terrain.slope[row * terrain.cols + col] = 1;
      }
    }
  }
  return terrain;
}
