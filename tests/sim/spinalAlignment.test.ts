import { RING_CIRCUMFERENCE, SIM_DT } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { COMMAND_PER_NODE, Faction, STARTING_COMMAND, WEAPONS } from '@sim/data';
import { World, type Structure } from '@sim/world';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('paired Spinal Node topology', () => {
  it('[canonical-pair-topology] stores standard and custom pairs in canonical order and rejects malformed topology', () => {
    const standard = new World(terrain, 7);
    standard.setup();
    expect(standard.spinalPairs.map((pair) => pair.id)).toEqual(['standard-axis', 'standard-rim']);
    expect(standard.spinalPairs.every((pair) => pair.members[0] < pair.members[1])).toBe(true);

    const world = emptyWorld();
    const first = node(world, 100);
    const second = node(world, 200);
    const third = node(world, 300);
    const fourth = node(world, 400);
    world.setSpinalPairs([
      { id: 'zulu-pair', members: [fourth.id, second.id] },
      { id: 'alpha-pair', members: [first.id, third.id] },
    ]);
    expect(world.spinalPairs).toEqual([
      { id: 'alpha-pair', members: [first.id, third.id] },
      { id: 'zulu-pair', members: [second.id, fourth.id] },
    ]);

    expect(() => world.setSpinalPairs([{ id: 'Upper', members: [first.id, second.id] }])).toThrow(/safe/i);
    expect(() => world.setSpinalPairs([{ id: 'same', members: [first.id, first.id] }])).toThrow(/distinct/i);
    expect(() => world.setSpinalPairs([
      { id: 'a', members: [first.id, second.id] },
      { id: 'b', members: [second.id, third.id] },
    ])).toThrow(/more than one pair/i);
    const nonNode = world.spawnStructure(Faction.Compact, 'bastion', 500, 0, 1);
    expect(() => world.setSpinalPairs([{ id: 'wrong-kind', members: [first.id, nonNode.id] }])).toThrow(/not a Spinal Node/i);
    const unfinished = world.spawnStructure(-1, 'spinalNode', 600, 0, 0.5);
    expect(() => world.setSpinalPairs([{ id: 'unfinished', members: [first.id, unfinished.id] }])).toThrow(/unfinished/i);
    expect(() => world.setSpinalPairs([{ id: 'missing', members: [first.id, 999_999] }])).toThrow(/missing/i);
  });
});

describe('Spinal Node capture state machine', () => {
  it('[two-phase-capture-timing] captures neutral in 600 ticks and requires another 600 after neutralization', () => {
    const world = emptyWorld();
    const target = node(world, 100, Faction.Compact, -1);
    world.recomputeCommandCaps();
    world.spawnUnit(Faction.Choir, 'engineer', target.s, target.z);

    run(world, 599);
    expect(target.faction).toBe(Faction.Compact);
    expect(target.capture).toBeLessThan(0);
    run(world, 1);
    expect(target).toMatchObject({ faction: -1, capture: 0 });
    expect(world.drainEvents().filter((event) => event.kind === 'nodeNeutralized')).toHaveLength(1);
    expect(world.players[Faction.Compact].commandCap).toBe(STARTING_COMMAND);

    run(world, 599);
    expect(target.faction).toBe(-1);
    expect(target.capture).toBeLessThan(1);
    run(world, 1);
    expect(target).toMatchObject({ faction: Faction.Choir, capture: 1 });
    expect(world.drainEvents().filter((event) => event.kind === 'nodeCaptured')).toHaveLength(1);
    expect(world.players[Faction.Choir].commandCap).toBe(STARTING_COMMAND + COMMAND_PER_NODE);
  });

  it('[contested-freeze-friendly-repair] freezes equal pressure, preserves partial progress, and repairs toward owner endpoint', () => {
    const world = emptyWorld();
    const target = node(world, 100, Faction.Compact, -0.4);
    world.spawnUnit(Faction.Compact, 'engineer', target.s - 5, target.z);
    world.spawnUnit(Faction.Choir, 'engineer', target.s + 5, target.z);
    run(world, 120);
    expect(target.capture).toBe(-0.4);

    const choir = world.units.find((unit) => unit.faction === Faction.Choir)!;
    choir.s += 500;
    run(world, 360);
    expect(target).toMatchObject({ faction: Faction.Compact, capture: -1 });
  });

  it('[damage-neutralization] resets a controlled Node to neutral at 35% HP without duplicate neutral events', () => {
    const world = emptyWorld();
    const target = node(world, 100, Faction.Compact, -1);
    world.recomputeCommandCaps();

    world.applyDamage(target.id, 100_000, 'explosive', Faction.Choir);
    expect(target.faction).toBe(-1);
    expect(target.capture).toBe(0);
    expect(target.hp).toBe(target.maxHp * 0.35);
    expect(world.players[Faction.Compact].commandCap).toBe(STARTING_COMMAND);
    expect(world.drainEvents().map((event) => event.kind)).toEqual(['nodeNeutralized']);

    world.applyDamage(target.id, 100_000, 'explosive', Faction.Choir);
    expect(target.hp).toBe(target.maxHp * 0.35);
    expect(world.drainEvents()).toEqual([]);
  });
});

describe('Spinal Alignment state machine', () => {
  it('[alignment-event-order] starts after capture, breaks before neutralization, and never duplicates events', () => {
    const world = emptyWorld();
    const first = node(world, 100, Faction.Compact, -1);
    const second = node(world, 300);
    world.setSpinalPairs([{ id: 'test-axis', members: [first.id, second.id] }]);
    world.spawnUnit(Faction.Compact, 'engineer', second.s, second.z);

    run(world, 600);
    expect(world.spinalAlignmentOwner(world.spinalPairs[0]!)).toBe(Faction.Compact);
    expect(world.drainEvents().map((event) => event.kind)).toEqual(['nodeCaptured', 'alignmentStarted']);
    run(world, 30);
    expect(world.drainEvents()).toEqual([]);

    world.applyDamage(second.id, 100_000, 'explosive', Faction.Choir);
    expect(world.drainEvents().map((event) => event.kind)).toEqual(['alignmentBroken', 'nodeNeutralized']);
  });

  it('[unpaired-node-behavior] grants Command but never Alignment or pair Dominance', () => {
    const world = emptyWorld();
    node(world, 100, Faction.Compact, -1);
    world.recomputeCommandCaps();
    run(world, 30);

    expect(world.players[Faction.Compact].commandCap).toBe(STARTING_COMMAND + COMMAND_PER_NODE);
    expect(world.alignedPairCount(Faction.Compact)).toBe(0);
    expect(world.players[Faction.Compact].dominance).toBe(0);
    expect(world.drainEvents()).toEqual([]);
  });
});

describe('Spinal Alignment gameplay consequence and scope', () => {
  it('[pair-only-dominance] generates exactly two Dominance per second for each aligned pair only', () => {
    const world = emptyWorld();
    const first = node(world, 100, Faction.Compact, -1);
    const second = node(world, 300, Faction.Compact, -1);
    node(world, 500, Faction.Compact, -1);
    world.setSpinalPairs([{ id: 'scoring-pair', members: [first.id, second.id] }]);

    run(world, 30);
    expect(world.players[Faction.Compact].dominance).toBeCloseTo(2, 10);
    expect(world.players[Faction.Choir].dominance).toBe(0);
  });

  it('[existing-victory-outcomes] leaves Bastion and time-cap Dominance outcomes unchanged', () => {
    const timed = new World(terrain, 12, SIM_DT);
    timed.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    timed.spawnStructure(Faction.Choir, 'bastion', RING_CIRCUMFERENCE * 0.5, 0, 1);
    const first = node(timed, 100, Faction.Compact, -1);
    const second = node(timed, 300, Faction.Compact, -1);
    timed.setSpinalPairs([{ id: 'time-pair', members: [first.id, second.id] }]);
    timed.step();
    expect(timed).toMatchObject({ status: 'completed', winner: Faction.Compact, endReason: 'Time limit — decided on Dominance' });

    const bastion = new World(terrain, 13);
    bastion.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const choirBastion = bastion.spawnStructure(Faction.Choir, 'bastion', 500, 0, 1);
    bastion.applyDamage(choirBastion.id, 100_000, 'explosive', Faction.Compact);
    bastion.step();
    expect(bastion).toMatchObject({ status: 'completed', winner: Faction.Compact, endReason: 'Enemy Bastion destroyed' });
  });

  it('[ls07-scope-exclusions] adds no activation, chord, visibility, transport, stabilization, or alternate-victory state', () => {
    const world = emptyWorld();
    const first = node(world, 100, Faction.Compact, -1);
    const second = node(world, 300, Faction.Compact, -1);
    world.setSpinalPairs([{ id: 'bounded-pair', members: [first.id, second.id] }]);

    expect(world.spinalPairs[0]).toEqual({ id: 'bounded-pair', members: [first.id, second.id] });
    expect(Object.keys(world.spinalPairs[0]!)).toEqual(['id', 'members']);
    expect(WEAPONS.chordShot).toMatchObject({ damage: 1200, cooldown: 45, flightMode: 'chord' });
    expect(world.status).toBe('running');
    expect(world.winner).toBeNull();
  });
});

function emptyWorld(): World {
  return new World(terrain, 11);
}

function node(world: World, s: number, faction: Faction | -1 = -1, capture = 0): Structure {
  const structure = world.spawnStructure(faction, 'spinalNode', s, 0, 1);
  structure.capture = capture;
  return structure;
}

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) world.step();
}
