import { describe, expect, it } from 'vitest';
import {
  AiOpponent,
  STRATEGIST_CONFIG,
  collectStrategicState,
  scoreStrategicGoals,
  type StrategicState,
} from '@ai/opponent';
import { RING_CIRCUMFERENCE, SIM_DT } from '@core/constants';
import { surfaceDist, wrapS } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { Faction, UNITS } from '@sim/data';
import { World } from '@sim/world';

const BASE_STATE: StrategicState = {
  salvageRatio: 0.5,
  energyRatio: 0.75,
  ownArmyStrength: 400,
  visibleEnemyArmyStrength: 300,
  ownScoutCount: 1,
  ownExtractorCount: 2,
  ownNodeCount: 1,
  visibleEnemyNodeCount: 1,
  availableDeposits: 2,
  safeDepositRatio: 0.75,
  techLevel: 1,
  visibleEnemyExpansions: 1,
  visibleThreat: 0.2,
  bastionHealthRatio: 1,
  matchProgress: 0.25,
};

describe('strategist configuration', () => {
  it('uses the required cadence and candidate sets for every difficulty', () => {
    expect(STRATEGIST_CONFIG.recruit.evaluationInterval).toBe(3);
    expect(STRATEGIST_CONFIG.veteran.evaluationInterval).toBe(1.5);
    expect(STRATEGIST_CONFIG.commander.evaluationInterval).toBe(0.6);
    expect(STRATEGIST_CONFIG.recruit.candidateGoals).toEqual(['expand', 'tech', 'defend']);
    expect(STRATEGIST_CONFIG.veteran.candidateGoals).toEqual([
      'expand',
      'tech',
      'harass',
      'defend',
      'allIn',
    ]);
    expect(STRATEGIST_CONFIG.commander.candidateGoals).toEqual(
      STRATEGIST_CONFIG.veteran.candidateGoals,
    );
    expect(STRATEGIST_CONFIG.commander.weights).not.toEqual(STRATEGIST_CONFIG.veteran.weights);
  });
});

describe('scoreStrategicGoals', () => {
  it('returns one finite score for every configured candidate', () => {
    for (const difficulty of ['recruit', 'veteran', 'commander'] as const) {
      const scores = scoreStrategicGoals(BASE_STATE, difficulty);

      expect(scores.map((score) => score.goal)).toEqual(
        STRATEGIST_CONFIG[difficulty].candidateGoals,
      );
      expect(scores.every((score) => Number.isFinite(score.score))).toBe(true);
    }
  });

  it('keeps scores finite for invalid or extreme numeric input', () => {
    const extreme = Object.fromEntries(
      Object.keys(BASE_STATE).map((key, index) => [key, index % 2 === 0 ? Infinity : Number.NaN]),
    ) as unknown as StrategicState;

    const scores = scoreStrategicGoals(extreme, 'commander');

    expect(scores).toHaveLength(5);
    expect(scores.every((score) => Number.isFinite(score.score))).toBe(true);
  });

  it('transitions the active goal during the same evaluation', () => {
    const ai = new AiOpponent(Faction.Compact, 'veteran', 10);
    const expansionState: StrategicState = {
      ...BASE_STATE,
      ownExtractorCount: 0,
      availableDeposits: 5,
      safeDepositRatio: 1,
      visibleThreat: 0,
      visibleEnemyArmyStrength: 0,
    };
    const threatenedState: StrategicState = {
      ...BASE_STATE,
      availableDeposits: 0,
      ownExtractorCount: 4,
      visibleThreat: 1,
      ownArmyStrength: 100,
      visibleEnemyArmyStrength: 2_000,
      bastionHealthRatio: 0.3,
    };

    ai.evaluateStrategicState(expansionState);
    expect(ai.activeGoal).toBe('expand');

    ai.evaluateStrategicState(threatenedState);
    expect(ai.activeGoal).toBe('defend');
  });
});

describe('strategist information and resource boundaries', () => {
  it('counts enemy strength only after that enemy becomes visible', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 5_000, 0);

    expect(collectStrategicState(world, Faction.Compact).visibleEnemyArmyStrength).toBe(0);

    world.spawnStructure(Faction.Compact, 'radarMast', 4_900, 0, 1);
    expect(collectStrategicState(world, Faction.Compact).visibleEnemyArmyStrength).toBeGreaterThan(0);
  });

  it('does not mutate resources while evaluating a strategy', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const before = { ...world.players[Faction.Compact] };
    const ai = new AiOpponent(Faction.Compact, 'commander', 22);

    ai.evaluateStrategy(world);

    expect(world.players[Faction.Compact].salvage).toBe(before.salvage);
    expect(world.players[Faction.Compact].energyProduced).toBe(before.energyProduced);
    expect(world.players[Faction.Compact].energyDrawn).toBe(before.energyDrawn);
    expect(world.players[Faction.Compact].commandUsed).toBe(before.commandUsed);
  });

  it('does not place an extractor on an unseen deposit', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnUnit(Faction.Compact, 'engineer', 0, 20);
    world.deposits.push({ s: 400, z: 0, amount: 5_000, claimedBy: 0 });
    world.players[Faction.Compact].salvage = 10_000;
    const ai = new AiOpponent(Faction.Compact, 'commander', 22);

    ai.update(world, 1 / 30);

    expect(world.structures.some((structure) => structure.kind === 'extractor')).toBe(false);
  });
});

describe('strategist production planning', () => {
  it('queues only the faction-exclusive unit for each faction', () => {
    for (const faction of [Faction.Compact, Faction.Choir]) {
      const world = emptyWorld();
      const foundries = Array.from({ length: 4 }, (_, index) =>
        world.spawnStructure(faction, 'mechFoundry', index * 100, 0, 1));
      world.players[faction].salvage = 10_000;
      world.players[faction].commandCap = 20;

      new AiOpponent(faction, 'commander', 70 + faction).update(world, SIM_DT);
      const queued = foundries.flatMap((foundry) => foundry.queue);
      if (faction === Faction.Compact) {
        expect(queued).toContain('bulwark');
        expect(queued).not.toContain('needle');
      } else {
        expect(queued).toContain('needle');
        expect(queued).not.toContain('bulwark');
      }
    }
  });

  it('reserves one Wisp across stable producer ordering and updates the next choice immediately', () => {
    const world = emptyWorld();
    const first = world.spawnStructure(Faction.Compact, 'mechFoundry', 0, 0, 1);
    const second = world.spawnStructure(Faction.Compact, 'mechFoundry', 100, 0, 1);
    world.players[Faction.Compact].salvage = 1_000;

    new AiOpponent(Faction.Compact, 'commander', 71).update(world, SIM_DT);

    expect(first.queue).toEqual(['wisp']);
    expect(second.queue).toEqual(['vanguard']);
    expect([...first.queue, ...second.queue].filter((kind) => kind === 'wisp')).toHaveLength(1);
  });

  it('does not reserve more Engineers than the alive-plus-queued target', () => {
    const world = emptyWorld();
    const first = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const second = world.spawnStructure(Faction.Compact, 'fabricator', 100, 0, 1);
    for (let index = 0; index < 3; index++) {
      world.spawnUnit(Faction.Compact, 'engineer', 20 + index * 10, 20);
    }
    world.players[Faction.Compact].salvage = 300;

    new AiOpponent(Faction.Compact, 'commander', 72).update(world, SIM_DT);

    expect(first.queue).toEqual(['engineer']);
    expect(second.queue).toEqual([]);
  });

  it('falls back to the first feasible positive want when the preferred Extractor has no site', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fabricator', 80, 180, 1);
    world.spawnStructure(Faction.Compact, 'mechFoundry', 180, -180, 1);
    world.spawnStructure(Faction.Compact, 'rocketBattery', 260, 160, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 260, -160, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 340, 120, 1);
    for (let index = 0; index < 4; index++) {
      world.spawnStructure(Faction.Compact, 'extractor', 100 + index * 90, -300, 1);
    }
    world.spawnUnit(Faction.Compact, 'engineer', 0, 20);
    world.players[Faction.Compact].salvage = 10_000;
    const before = world.structures.length;

    new AiOpponent(Faction.Compact, 'commander', 73).update(world, SIM_DT);

    expect(world.structures).toHaveLength(before + 1);
    expect(world.structures.at(-1)).toMatchObject({ kind: 'fusionCore', progress: 0 });
  });

  it('builds and fires an endgame Silo at the scenario-known enemy Bastion', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const enemyBastion = world.spawnStructure(
      Faction.Choir,
      'bastion',
      RING_CIRCUMFERENCE * 0.5,
      0,
      1,
    );
    world.spawnStructure(Faction.Compact, 'fabricator', 900, 0, 1);
    world.spawnStructure(Faction.Compact, 'mechFoundry', 1_000, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 1_100, -120, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 1_200, -120, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 1_300, -120, 1);
    const engineer = world.spawnUnit(Faction.Compact, 'engineer', 20, 0);
    world.time = 20 * 60;
    world.players[Faction.Compact].salvage = 10_000;
    const opponent = new AiOpponent(Faction.Compact, 'commander', 730);
    expect(world.canPlace(Faction.Compact, 'silo', 100, 0)).toBe(true);

    opponent.update(world, SIM_DT);
    const silo = world.structures.find((structure) => structure.kind === 'silo');
    expect(silo).toBeDefined();
    expect(engineer.buildTargetId).toBe(silo!.id);

    silo!.progress = 1;
    silo!.hp = silo!.maxHp;
    world.players[Faction.Compact].unlocked.add('silo');
    world.step();
    opponent.update(world, 0.6);

    expect(world.projectiles.filter((projectile) => projectile.weapon === 'chordShot')).toHaveLength(1);
    expect(silo!.revealed).toBeGreaterThan(0);
    expect(enemyBastion.alive).toBe(true);
  });
});

describe('strategist objective assignment and recovery', () => {
  it('assigns stable-ID scouts to nearest distinct reachable non-owned nodes', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const first = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    const second = world.spawnUnit(Faction.Compact, 'wisp', 1_000, 0);
    const far = world.spawnStructure(-1 as Faction, 'spinalNode', 900, 0, 1);
    const near = world.spawnStructure(-1 as Faction, 'spinalNode', 100, 0, 1);

    new AiOpponent(Faction.Compact, 'commander', 74).update(world, SIM_DT);

    expect(first.order).toMatchObject({ kind: 'attackMove', s: near.s, z: near.z });
    expect(second.order).toMatchObject({ kind: 'attackMove', s: far.s, z: far.z });
  });

  it('preserves a hostile reachable scout objective and skips a disconnected replacement', () => {
    const world = disconnectedWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 500, 0, 1);
    const scout = world.spawnUnit(Faction.Compact, 'wisp', 500, 0);
    const reachable = world.spawnStructure(-1 as Faction, 'spinalNode', 800, 0, 1);
    world.spawnStructure(-1 as Faction, 'spinalNode', 5_500, 0, 1);
    scout.order = { kind: 'attackMove', s: reachable.s, z: reachable.z, targetId: 0 };

    new AiOpponent(Faction.Compact, 'commander', 75).update(world, SIM_DT);

    expect(scout.order).toMatchObject({ kind: 'attackMove', s: reachable.s, z: reachable.z });
    expect(world.nav.directionAt(scout.s, scout.z, scout.order.s, scout.order.z).reachable).toBe(true);
  });

  it('clears AI-only unreachable movement and build orders on the strategist cadence', () => {
    const world = disconnectedWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 500, 0, 1);
    const mover = world.spawnUnit(Faction.Compact, 'engineer', 500, 0);
    const builder = world.spawnUnit(Faction.Compact, 'engineer', 600, 0);
    const strandedLine = world.spawnUnit(Faction.Compact, 'vanguard', 5_500, 0);
    const site = world.spawnStructure(Faction.Compact, 'solarArray', 5_500, 0, 0);
    mover.order = { kind: 'move', s: site.s, z: site.z, targetId: 0 };
    builder.order = { kind: 'build', s: site.s, z: site.z, targetId: site.id };
    builder.buildTargetId = site.id;
    strandedLine.order = { kind: 'move', s: 500, z: 0, targetId: 0 };
    world.players[Faction.Compact].salvage = 0;

    new AiOpponent(Faction.Compact, 'commander', 76).update(world, SIM_DT);

    expect(mover.order.kind).toBe('idle');
    expect(builder.order.kind).toBe('idle');
    expect(builder.buildTargetId).toBe(0);
    expect(strandedLine.order.kind).toBe('idle');
  });

  it('uses only the fixed unseen enemy Bastion as a scenario-known march objective', () => {
    const world = emptyWorld();
    world.setup();
    for (let index = 0; index < 4; index++) {
      world.spawnUnit(Faction.Compact, 'vanguard', 100 + index * 15, 0);
    }
    world.time = 15 * 60;
    const hiddenExpansion = world.spawnStructure(Faction.Choir, 'fusionCore', 2_000, 0, 1);
    const enemyBastion = world.structures.find(
      (structure) => structure.kind === 'bastion' && structure.faction === Faction.Choir,
    )!;
    for (const structure of world.structures) {
      if (structure.kind === 'spinalNode') structure.faction = Faction.Compact;
    }
    expect(world.isEntityVisible(Faction.Compact, hiddenExpansion.id)).toBe(false);
    expect(world.isEntityVisible(Faction.Compact, enemyBastion.id)).toBe(false);
    const opponent = new AiOpponent(Faction.Compact, 'commander', 77);

    opponent.update(world, SIM_DT);

    expect(opponent.exportPersistenceState().pushTarget).toEqual({ s: enemyBastion.s, z: enemyBastion.z });
  });

  it('prioritizes the enemy Bastion over recurring node trades after fifteen minutes', () => {
    const world = emptyWorld();
    world.setup();
    const enemyBastion = world.structures.find(
      (structure) => structure.kind === 'bastion' && structure.faction === Faction.Choir,
    )!;
    for (let index = 0; index < 5; index++) {
      world.spawnUnit(Faction.Compact, 'vanguard', 100 + index * 15, 0);
    }
    const recurringNode = world.structures.find(
      (structure) => structure.kind === 'spinalNode' && structure.faction !== Faction.Compact,
    )!;
    world.time = 15 * 60;
    world.players[Faction.Compact].salvage = 0;
    const initial = new AiOpponent(Faction.Compact, 'veteran', 771).exportPersistenceState();
    const opponent = AiOpponent.fromPersistenceState({
      ...initial,
      pushTarget: { s: recurringNode.s, z: recurringNode.z },
    });

    opponent.update(world, SIM_DT);

    expect(opponent.exportPersistenceState().pushTarget).toEqual({
      s: enemyBastion.s,
      z: enemyBastion.z,
    });
  });

  it('converts the final Bastion approach into an entity-targeted attack', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const enemyBastion = world.spawnStructure(
      Faction.Choir,
      'bastion',
      RING_CIRCUMFERENCE * 0.5,
      0,
      1,
    );
    const line = Array.from({ length: 5 }, (_, index) =>
      world.spawnUnit(Faction.Compact, 'vanguard', enemyBastion.s - 150 + index * 5, 0));
    world.time = 15 * 60;
    world.players[Faction.Compact].salvage = 0;
    const initial = new AiOpponent(Faction.Compact, 'veteran', 772).exportPersistenceState();
    const opponent = AiOpponent.fromPersistenceState({
      ...initial,
      pushTarget: { s: enemyBastion.s, z: enemyBastion.z },
    });

    opponent.update(world, SIM_DT);

    for (const unit of line) {
      expect(unit.order).toMatchObject({ kind: 'attack', targetId: enemyBastion.id });
    }
  });

  it.each(['captured', 'destroyed', 'arrived', 'unreachable'] as const)(
    'reselects a non-stale push objective after the current target is %s',
    (condition) => {
      const world = emptyWorld();
      const home = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
      const enemyBastion = world.spawnStructure(Faction.Choir, 'bastion', RING_CIRCUMFERENCE * 0.5, 0, 1);
      const target = world.spawnStructure(-1 as Faction, 'spinalNode', 500, 0, 1);
      const line = Array.from({ length: 3 }, (_, index) =>
        world.spawnUnit(Faction.Compact, 'vanguard', 100 + index * 10, 0));
      world.spawnUnit(Faction.Compact, 'vanguard', 135, 0);
      world.time = 15 * 60;
      const initial = new AiOpponent(Faction.Compact, 'commander', 78).exportPersistenceState();
      const opponent = AiOpponent.fromPersistenceState({ ...initial, pushTarget: { s: target.s, z: target.z } });

      if (condition === 'captured') target.faction = Faction.Compact;
      if (condition === 'destroyed') target.alive = false;
      if (condition === 'arrived') {
        line[0]!.s = target.s;
        line[0]!.z = target.z;
      }
      if (condition === 'unreachable') {
        world.nav.directionAt = (_s, _z, targetS, _targetZ, out = { ds: 0, dz: 0, reachable: false }) => {
          out.ds = 0;
          out.dz = 0;
          out.reachable = targetS !== target.s;
          return out;
        };
      }

      opponent.update(world, SIM_DT);

      const next = opponent.exportPersistenceState().pushTarget;
      expect(next).toEqual({ s: enemyBastion.s, z: enemyBastion.z });
      expect(next).not.toEqual({ s: target.s, z: target.z });
      expect(home.alive).toBe(true);
    },
  );
});

describe('bounded deterministic AI progression', () => {
  it('reserves one scout, takes a reachable node, expands command, and gives its line a live push', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'bastion', RING_CIRCUMFERENCE * 0.5, 0, 1);
    const first = world.spawnStructure(Faction.Compact, 'mechFoundry', 80, 120, 1);
    const second = world.spawnStructure(Faction.Compact, 'mechFoundry', 80, -120, 1);
    const node = world.spawnStructure(-1 as Faction, 'spinalNode', 360, 0, 1);
    world.spawnStructure(-1 as Faction, 'spinalNode', 720, 0, 1);
    world.players[Faction.Compact].salvage = 20_000;
    const opponent = new AiOpponent(Faction.Compact, 'commander', 79);
    opponent.update(world, SIM_DT);

    expect([...first.queue, ...second.queue].filter((kind) => kind === 'wisp')).toHaveLength(1);

    let objectiveTick = -1;
    let commandExpansionTick = -1;
    let pushTick = -1;
    for (let tick = 1; tick <= 2_700; tick++) {
      world.step();
      if (commandExpansionTick < 0 && world.players[Faction.Compact].commandCap > 4) {
        commandExpansionTick = tick;
        world.players[Faction.Compact].salvage = 1_100;
      }
      opponent.update(world, SIM_DT);

      const scout = world.units.find((unit) => unit.alive && unit.faction === Faction.Compact && unit.kind === 'wisp');
      if (objectiveTick < 0 && scout?.order.kind === 'attackMove') {
        const objective = world.structures.find(
          (structure) => structure.alive && structure.kind === 'spinalNode' &&
            surfaceDist(structure.s, structure.z, scout.order.s, scout.order.z) < 1,
        );
        if (objective && world.nav.directionAt(scout.s, scout.z, objective.s, objective.z).reachable) {
          objectiveTick = tick;
        }
      }
      const push = opponent.exportPersistenceState().pushTarget;
      const line = world.units.find(
        (unit) => unit.alive && unit.faction === Faction.Compact &&
          (unit.kind === 'vanguard' || unit.kind === 'aegis'),
      );
      const liveTarget = push && world.structures.find(
        (structure) => structure.alive && structure.faction !== Faction.Compact &&
          surfaceDist(structure.s, structure.z, push.s, push.z) < 1,
      );
      if (pushTick < 0 && line && liveTarget && world.nav.directionAt(line.s, line.z, push.s, push.z).reachable) {
        pushTick = tick;
      }
      if (objectiveTick >= 0 && commandExpansionTick >= 0 && pushTick >= 0) break;
    }

    const plannedWisps = world.units.filter(
      (unit) => unit.alive && unit.faction === Faction.Compact && unit.kind === 'wisp',
    ).length + world.structures.reduce(
      (total, structure) => total + structure.queue.filter((kind) => kind === 'wisp').length,
      0,
    );
    expect(plannedWisps).toBe(1);
    expect(node.faction).toBe(Faction.Compact);
    expect(objectiveTick).toBeGreaterThan(0);
    expect(commandExpansionTick).toBeGreaterThan(0);
    expect(pushTick).toBeGreaterThan(commandExpansionTick);
    expect(world.players[Faction.Compact].commandCap).toBeGreaterThan(4);
    expect(world.tick).toBeLessThanOrEqual(2_700);
    expect({ objectiveTick, commandExpansionTick, pushTick, worldTick: world.tick }).toEqual({
      objectiveTick: 486,
      commandExpansionTick: 1_319,
      pushTick: 2_178,
      worldTick: 2_178,
    });
    expect(world.units.filter(
      (unit) => unit.kind === 'vanguard' || unit.kind === 'aegis',
    ).length).toBeGreaterThanOrEqual(2);
    expect(world.players[Faction.Compact].commandUsed).toBeLessThanOrEqual(
      world.players[Faction.Compact].commandCap,
    );
    expect(UNITS.wisp.cost.command).toBe(1);
  });
});

function emptyWorld(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 21);
}

function disconnectedWorld(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: (s: number) => {
      const normalized = wrapS(s);
      return normalized < 1_000 || (normalized > 5_000 && normalized < 6_000) ? 0 : 1;
    },
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 22);
}
