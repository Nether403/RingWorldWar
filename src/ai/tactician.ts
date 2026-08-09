import { RING_HALF_WIDTH } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { ABILITIES } from '@sim/abilities';
import { Faction, UNITS, WEAPONS } from '@sim/data';
import type { Structure, Unit, World } from '@sim/world';
import {
  DifficultyGate,
  Selector,
  Sequence,
  type BTContext,
  type BTNode,
  type BTStatus,
} from './behaviorTree';
import { issueAttack, issueMove, type AiPoint } from './commands';
import type { Difficulty, StrategicGoal } from './contracts';

const MAX_SQUAD_SIZE = 4;
// Retreat only when a unit is genuinely at risk of being lost. The previous
// 30% threshold produced permanently withdrawing survivors (there is no repair
// system yet), occupied command capacity, and prevented replacement assault
// waves for the remainder of a match.
const RETREAT_HEALTH_RATIO = 0.15;

export const TACTICIAN_REACTION_DELAY: Readonly<Record<Difficulty, number>> = {
  recruit: 1.6,
  veteran: 0.8,
  commander: 0,
};

export interface Squad {
  id: number;
  unitIds: number[];
  tree: BTNode<TacticianContext>;
  rallyPoint: AiPoint;
  targetId: number;
}

export interface TacticianContext extends BTContext {
  world: World;
  faction: Faction;
  squad: Squad;
  goal: StrategicGoal;
  retreating: Set<number>;
  dodging: Set<number>;
}

export interface TacticianPersistenceState {
  faction: Faction;
  difficulty: Difficulty;
  reactionTimer: number;
  elapsed: number;
  squads: Array<{
    id: number;
    unitIds: number[];
    rallyPoint: AiPoint;
    targetId: number;
  }>;
}

export class Tactician {
  squads: Squad[] = [];

  private reactionTimer = 0;
  private elapsed = 0;

  constructor(
    private readonly faction: Faction,
    private readonly difficulty: Difficulty,
  ) {}

  exportPersistenceState(): TacticianPersistenceState {
    return {
      faction: this.faction,
      difficulty: this.difficulty,
      reactionTimer: this.reactionTimer,
      elapsed: this.elapsed,
      squads: this.squads.map((squad) => ({
        id: squad.id,
        unitIds: [...squad.unitIds],
        rallyPoint: { ...squad.rallyPoint },
        targetId: squad.targetId,
      })),
    };
  }

  restorePersistenceState(state: TacticianPersistenceState): void {
    if (state.faction !== this.faction || state.difficulty !== this.difficulty) {
      throw new Error('Tactician state does not match its controller');
    }
    const squads = state.squads.map((squad) => ({
      id: squad.id,
      unitIds: [...squad.unitIds],
      tree: createSquadTree(),
      rallyPoint: { ...squad.rallyPoint },
      targetId: squad.targetId,
    } satisfies Squad));
    this.reactionTimer = state.reactionTimer;
    this.elapsed = state.elapsed;
    this.squads = squads;
  }

  reformSquads(world: World): readonly Squad[] {
    for (const squad of this.squads) squad.tree.reset();

    const remaining = world.units
      .filter((unit) => unit.alive && unit.faction === this.faction && UNITS[unit.kind].isMech);
    remaining.sort((a, b) => a.id - b.id);
    const squads: Squad[] = [];

    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const members = [seed];
      while (members.length < MAX_SQUAD_SIZE && remaining.length > 0) {
        const nextIndex = nearestCompatibleIndex(seed, members, remaining);
        members.push(remaining.splice(nextIndex, 1)[0]!);
      }

      const rallyPoint = nearestRallyPoint(world, this.faction, centroid(members));
      const squad = {
        id: squads.length + 1,
        unitIds: members.map((unit) => unit.id),
        tree: createSquadTree(),
        rallyPoint,
        targetId: 0,
      } satisfies Squad;
      squads.push(squad);
    }

    this.squads = squads;
    return this.squads;
  }

  update(world: World, dt: number, goal: StrategicGoal): void {
    if (world.status === 'completed') return;
    this.elapsed += Math.max(0, finite(dt));
    this.reactionTimer -= Math.max(0, finite(dt));
    if (this.reactionTimer > 0) return;
    if (this.squads.length === 0 && hasMechs(world, this.faction)) this.reformSquads(world);

    this.reactionTimer = TACTICIAN_REACTION_DELAY[this.difficulty];
    for (const squad of this.squads) {
      const context: TacticianContext = {
        now: this.elapsed,
        difficulty: this.difficulty,
        world,
        faction: this.faction,
        squad,
        goal,
        retreating: new Set(),
        dodging: new Set(),
      };
      squad.tree.tick(context);
    }
  }
}

class Retreat implements BTNode<TacticianContext> {
  tick(ctx: TacticianContext): BTStatus {
    for (const id of ctx.squad.unitIds) {
      const unit = ctx.world.unitById(id);
      if (!unit || unit.hp / unit.maxHp >= RETREAT_HEALTH_RATIO) continue;
      const rally = nearestRallyPoint(ctx.world, ctx.faction, unit);
      issueMove(unit, rally);
      ctx.retreating.add(unit.id);
    }
    return 'success';
  }

  reset(): void {}
}

class DodgeIncoming implements BTNode<TacticianContext> {
  tick(ctx: TacticianContext): BTStatus {
    for (const id of ctx.squad.unitIds) {
      if (ctx.retreating.has(id)) continue;
      const unit = ctx.world.unitById(id);
      if (!unit) continue;
      const threat = ctx.world.projectiles.find((projectile) => {
        if (!projectile.alive || projectile.doomed || projectile.faction === ctx.faction) return false;
        const splash = WEAPONS[projectile.weapon]?.splash ?? 0;
        return splash > 0 && surfaceDist(unit.s, unit.z, projectile.impactS, projectile.impactZ) <= splash + 20;
      });
      if (!threat) continue;

      let ds = deltaS(threat.impactS, unit.s);
      let dz = unit.z - threat.impactZ;
      if (Math.hypot(ds, dz) < 1e-6) {
        const angle = deterministicAngle(unit.id, threat.id);
        ds = Math.cos(angle);
        dz = Math.sin(angle);
      }
      const length = Math.hypot(ds, dz);
      issueMove(unit, {
        s: wrapS(unit.s + (ds / length) * 110),
        z: clamp(unit.z + (dz / length) * 110, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
      });
      ctx.dodging.add(unit.id);
    }
    return 'success';
  }

  reset(): void {}
}

class FocusFire implements BTNode<TacticianContext> {
  tick(ctx: TacticianContext): BTStatus {
    const members = ctx.squad.unitIds
      .filter((id) => !ctx.retreating.has(id) && !ctx.dodging.has(id))
      .map((id) => ctx.world.unitById(id))
      .filter((unit): unit is Unit => unit !== undefined)
      .filter((unit) => !isCommittedBastionAttack(ctx, unit));
    const target = chooseFocusTarget(ctx, members);
    ctx.squad.targetId = target?.id ?? 0;
    if (!target) return 'success';

    for (const unit of members) issueAttack(unit, target.id, target);
    return 'success';
  }

  reset(): void {}
}

class FormUpAegis implements BTNode<TacticianContext> {
  tick(ctx: TacticianContext): BTStatus {
    const members = ctx.squad.unitIds
      .map((id) => ctx.world.unitById(id))
      .filter((unit): unit is Unit => unit !== undefined);
    const protectedUnits = members.filter((unit) => unit.kind !== 'aegis');
    if (protectedUnits.length === 0) return 'success';
    const coverageCenter = centroid(protectedUnits);
    for (const aegis of members) {
      if (aegis.kind !== 'aegis' || ctx.retreating.has(aegis.id) || ctx.dodging.has(aegis.id)) continue;
      if (isCommittedBastionAttack(ctx, aegis)) continue;
      if (surfaceDist(aegis.s, aegis.z, coverageCenter.s, coverageCenter.z) <=
        ABILITIES.umbrella.protectionRadius * 0.6) continue;
      issueMove(aegis, coverageCenter);
    }
    return 'success';
  }

  reset(): void {}
}

class ActivateAbility implements BTNode<TacticianContext> {
  tick(ctx: TacticianContext): BTStatus {
    for (const id of ctx.squad.unitIds) {
      const unit = ctx.world.unitById(id);
      if (!unit?.ability || unit.ability.id === 'cloak') continue;
      let active = false;
      if (unit.ability.id === 'shieldWall') {
        active = hasIncomingThreat(ctx, unit, 90) || hasVisibleEnemy(ctx, unit, 260);
      } else if (unit.ability.id === 'siegeMode') {
        active = !ctx.retreating.has(unit.id) && !ctx.dodging.has(unit.id) && hasSiegeTarget(ctx, unit);
      } else if (unit.ability.id === 'umbrella') {
        active = ctx.squad.unitIds.some((memberId) => {
          const member = ctx.world.unitById(memberId);
          return member !== undefined &&
            surfaceDist(unit.s, unit.z, member.s, member.z) <= ABILITIES.umbrella.protectionRadius &&
            hasIncomingThreat(ctx, member, 35);
        });
      }
      if (active !== unit.ability.active) ctx.world.activateAbility(unit.id, active);
    }
    return 'success';
  }

  reset(): void {}
}

class AlwaysSuccess implements BTNode<TacticianContext> {
  tick(): BTStatus {
    return 'success';
  }

  reset(): void {}
}

function createSquadTree(): BTNode<TacticianContext> {
  return new Sequence<TacticianContext>([
    new Retreat(),
    new Selector<TacticianContext>([
      new DifficultyGate<TacticianContext>(new DodgeIncoming(), 'veteran'),
      new AlwaysSuccess(),
    ]),
    new FocusFire(),
    new DifficultyGate<TacticianContext>(
      new Sequence<TacticianContext>([new FormUpAegis(), new ActivateAbility()]),
      'veteran',
    ),
  ]);
}

function hasIncomingThreat(ctx: TacticianContext, unit: Unit, margin: number): boolean {
  return ctx.world.projectiles.some((projectile) =>
    projectile.alive &&
    !projectile.doomed &&
    projectile.ballistic &&
    projectile.faction !== ctx.faction &&
    surfaceDist(unit.s, unit.z, projectile.impactS, projectile.impactZ) <= UNITS[unit.kind].radius + margin,
  );
}

function isCommittedBastionAttack(ctx: TacticianContext, unit: Unit): boolean {
  if (unit.order.kind !== 'attack' || unit.order.targetId === 0) return false;
  const target = ctx.world.structureById(unit.order.targetId);
  return target?.kind === 'bastion' && target.faction !== ctx.faction;
}

function hasVisibleEnemy(ctx: TacticianContext, unit: Unit, range: number): boolean {
  return ctx.world.units.some((enemy) =>
    enemy.alive &&
    enemy.faction !== ctx.faction &&
    ctx.world.isEntityVisible(ctx.faction, enemy.id) &&
    surfaceDist(unit.s, unit.z, enemy.s, enemy.z) <= range,
  );
}

function hasSiegeTarget(ctx: TacticianContext, unit: Unit): boolean {
  const mobileRange = WEAPONS.siegeMortar.range;
  const siegeRange = mobileRange * ABILITIES.siegeMode.rangeMultiplier;
  return [...ctx.world.units, ...ctx.world.structures].some((enemy) => {
    if (!enemy.alive || enemy.faction < 0 || enemy.faction === ctx.faction) return false;
    if (!ctx.world.isEntityVisible(ctx.faction, enemy.id)) return false;
    const distance = surfaceDist(unit.s, unit.z, enemy.s, enemy.z);
    return distance > mobileRange * 0.9 &&
      distance <= siegeRange &&
      ctx.world.isBallisticTargetWithinReachEnvelope(
        unit.id,
        enemy.s,
        enemy.z,
        ctx.faction,
        'siegeMortar',
      );
  });
}

function chooseFocusTarget(ctx: TacticianContext, members: readonly Unit[]): Unit | Structure | null {
  if (members.length === 0) return null;
  const candidates: Array<Unit | Structure> = [
    ...ctx.world.units.filter(
      (unit) =>
        unit.alive &&
        unit.faction !== ctx.faction &&
        ctx.world.isEntityVisible(ctx.faction, unit.id),
    ),
    ...ctx.world.structures.filter(
      (structure) =>
        structure.alive &&
        structure.faction >= 0 &&
        structure.faction !== ctx.faction &&
        ctx.world.isEntityVisible(ctx.faction, structure.id),
    ),
  ];

  let best: Unit | Structure | null = null;
  let bestScore = -Infinity;
  const needleHunter = members.some((member) => member.kind === 'needle');
  for (const candidate of candidates) {
    if (!members.every((member) => surfaceDist(member.s, member.z, candidate.s, candidate.z) <= attackRange(member))) {
      continue;
    }
    const distance = averageDistance(members, candidate);
    const score = targetPriority(candidate, ctx.difficulty, needleHunter) -
      distance * 0.1 - candidate.hp * 0.0001;
    if (score > bestScore || (score === bestScore && candidate.id < (best?.id ?? Infinity))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function targetPriority(target: Unit | Structure, difficulty: Difficulty, needleHunter = false): number {
  if (!('order' in target)) {
    if (target.kind === 'rocketBattery') return difficulty === 'commander' ? 75 : 42;
    if (target.kind === 'mechFoundry') return difficulty === 'commander' ? 62 : 38;
    return target.kind === 'bastion' ? 35 : 20;
  }
  if (needleHunter) {
    if (target.kind === 'engineer') return 120;
    if (target.kind === 'longbow') return 110;
    if (target.kind === 'wisp') return 100;
  }
  if (difficulty !== 'commander') {
    if (target.kind === 'longbow') return 48;
    if (target.kind === 'aegis' || target.kind === 'needle') return 42;
    return 35;
  }
  switch (target.kind) {
    case 'longbow': return 100;
    case 'aegis': return 82;
    case 'vanguard': return 65;
    case 'wisp': return 55;
    case 'engineer': return 32;
    case 'bulwark': return 58;
    case 'needle': return 88;
  }
}

function attackRange(unit: Unit): number {
  let range = 0;
  for (const weaponId of UNITS[unit.kind].weapons) {
    const weapon = WEAPONS[weaponId]!;
    if (weapon.kind !== 'interceptor') range = Math.max(range, weapon.range);
  }
  return range || 60;
}

function averageDistance(units: readonly Unit[], target: AiPoint): number {
  let total = 0;
  for (const unit of units) total += surfaceDist(unit.s, unit.z, target.s, target.z);
  return total / units.length;
}

function nearestCompatibleIndex(seed: Unit, members: readonly Unit[], candidates: readonly Unit[]): number {
  let bestIndex = 0;
  let bestScore = Infinity;
  const memberRoles = new Set(members.map(roleOf));
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const duplicateRolePenalty = memberRoles.has(roleOf(candidate)) ? 35 : 0;
    const score = surfaceDist(seed.s, seed.z, candidate.s, candidate.z) + duplicateRolePenalty;
    if (score < bestScore || (score === bestScore && candidate.id < candidates[bestIndex]!.id)) {
      bestIndex = i;
      bestScore = score;
    }
  }
  return bestIndex;
}

function roleOf(unit: Unit): 'line' | 'artillery' | 'scout' | 'hunter' {
  if (unit.kind === 'longbow') return 'artillery';
  if (unit.kind === 'wisp') return 'scout';
  if (unit.kind === 'needle') return 'hunter';
  return 'line';
}

function nearestRallyPoint(world: World, faction: Faction, from: AiPoint): AiPoint {
  let nearest: Structure | null = null;
  let nearestDistance = Infinity;
  for (const structure of world.structures) {
    if (!structure.alive || structure.faction !== faction || structure.progress < 1) continue;
    const distance = surfaceDist(from.s, from.z, structure.s, structure.z);
    if (distance < nearestDistance || (distance === nearestDistance && structure.id < (nearest?.id ?? Infinity))) {
      nearest = structure;
      nearestDistance = distance;
    }
  }
  return nearest ? { s: nearest.s, z: nearest.z } : { s: from.s, z: from.z };
}

function centroid(units: readonly Unit[]): AiPoint {
  const anchor = units[0]!;
  let ds = 0;
  let z = 0;
  for (const unit of units) {
    ds += deltaS(anchor.s, unit.s);
    z += unit.z;
  }
  return { s: wrapS(anchor.s + ds / units.length), z: z / units.length };
}

function hasMechs(world: World, faction: Faction): boolean {
  return world.units.some((unit) => unit.alive && unit.faction === faction && UNITS[unit.kind].isMech);
}

function deterministicAngle(a: number, b: number): number {
  return ((Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0) * (Math.PI * 2 / 0xffffffff);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
