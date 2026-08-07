import { other, UNITS } from '@sim/data';
import type { Terrain } from '@gen/terrain';
import { World } from '@sim/world';
import type { RuntimeScenario } from './runtimeScenario';

export interface RuntimeScenarioWorld {
  world: World;
  playerFaction: RuntimeScenario['playerFaction'];
  opponentFaction: RuntimeScenario['playerFaction'];
  ai: Readonly<RuntimeScenario['ai']>;
  entityIds: ReadonlyMap<string, number>;
  bindings: ReadonlyMap<string, number>;
  openingView: RuntimeScenarioResolvedOpeningView;
}

export interface RuntimeScenarioResolvedOpeningView {
  focusS: number;
  focusZ: number;
  yawRadians: number;
  zoom: number;
  actionEntityIds: readonly number[];
  contextEntityIds: readonly number[];
  highlightDeposits: boolean;
}

export function createRuntimeScenarioWorld(
  terrain: Terrain,
  scenario: RuntimeScenario,
): RuntimeScenarioWorld {
  const world = new World(terrain, scenario.worldSeed);
  const entityIds = new Map<string, number>();

  for (const declaration of scenario.structures) {
    const structure = world.spawnStructure(
      declaration.faction,
      declaration.kind,
      declaration.s,
      declaration.z,
      declaration.progress,
    );
    if (declaration.yawRadians !== undefined) structure.yaw = declaration.yawRadians;
    if (declaration.healthFraction !== undefined) {
      structure.hp = structure.maxHp * declaration.healthFraction;
    }
    entityIds.set(declaration.id, structure.id);
  }

  for (const declaration of scenario.units) {
    const unit = world.spawnUnit(declaration.faction, declaration.kind, declaration.s, declaration.z);
    if (declaration.yawRadians !== undefined) {
      unit.yaw = declaration.yawRadians;
      unit.prevYaw = declaration.yawRadians;
    }
    if (declaration.healthFraction !== undefined) {
      unit.hp = unit.maxHp * declaration.healthFraction;
      if (UNITS[unit.kind].isMech) {
        unit.damageState = declaration.healthFraction < 0.33 ? 2 : declaration.healthFraction < 0.66 ? 1 : 0;
        unit.speedMultiplier = unit.damageState === 2 ? 0.8 : 1;
      }
    }
    entityIds.set(declaration.id, unit.id);
  }

  for (const declaration of scenario.deposits) {
    world.deposits.push({
      s: declaration.s,
      z: declaration.z,
      amount: declaration.amount,
      claimedBy: declaration.claimedBy === undefined ? 0 : requiredId(entityIds, declaration.claimedBy),
    });
  }

  for (const declaration of scenario.units) {
    const unit = world.unitById(requiredId(entityIds, declaration.id))!;
    const order = declaration.order;
    if (order.kind === 'idle') continue;
    if (order.kind === 'move' || order.kind === 'attackMove') {
      unit.order = { kind: order.kind, s: order.s, z: order.z, targetId: 0 };
      continue;
    }
    if (order.kind !== 'attack' && order.kind !== 'build') {
      throw new Error(`Unsupported parsed scenario order ${order.kind}`);
    }
    const targetId = requiredId(entityIds, order.target);
    const target = world.unitById(targetId) ?? world.structureById(targetId)!;
    unit.order = { kind: order.kind, s: target.s, z: target.z, targetId };
    if (order.kind === 'attack') unit.targetId = targetId;
    else unit.buildTargetId = targetId;
  }

  for (const declaration of scenario.players) {
    const player = world.players[declaration.faction];
    player.salvage = declaration.salvage;
    player.dominance = declaration.dominance;
  }
  world.recomputeCommandCaps();

  const bindings = new Map<string, number>();
  for (const binding of scenario.bindings) {
    bindings.set(binding.id, requiredId(entityIds, binding.entity));
  }

  return {
    world,
    playerFaction: scenario.playerFaction,
    opponentFaction: other(scenario.playerFaction),
    ai: { ...scenario.ai },
    entityIds,
    bindings,
    openingView: {
      focusS: scenario.openingView.focusS,
      focusZ: scenario.openingView.focusZ,
      yawRadians: scenario.openingView.yawRadians,
      zoom: scenario.openingView.zoom,
      actionEntityIds: scenario.openingView.actionEntities.map((id) => requiredId(entityIds, id)),
      contextEntityIds: scenario.openingView.contextEntities.map((id) => requiredId(entityIds, id)),
      highlightDeposits: scenario.openingView.highlightDeposits,
    },
  };
}

function requiredId(ids: ReadonlyMap<string, number>, symbolicId: string): number {
  const id = ids.get(symbolicId);
  if (id === undefined) throw new Error(`Parsed scenario references unresolved entity ${symbolicId}`);
  return id;
}
