/**
 * The AI opponent.
 *
 * Two layers, deliberately separated:
 *
 *   STRATEGIST decides what the faction is trying to achieve right now by
 *   scoring a handful of goals against the current economy and map control.
 *   Utility scoring rather than a fixed build order, so it adapts instead of
 *   executing the same opening whichever way the match goes.
 *
 *   TACTICIAN moves what already exists: forms a strike group once it has
 *   enough mass, sends scouts to contest nodes, and pulls artillery back when
 *   something closes on it.
 *
 * It does not cheat on resources at any difficulty. What difficulty changes is
 * how often it thinks and how well it reads the map, which produces an
 * opponent that feels slow rather than one that feels unfair.
 */

import { RING_CIRCUMFERENCE, RING_HALF_WIDTH, SIM_HZ } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { Rng } from '@core/rng';
import {
  Faction,
  MATCH_TIME_LIMIT,
  other,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
  type UnitKind,
} from '@sim/data';
import type { Structure, Unit, World } from '@sim/world';
import { issueAttack, issueAttackMove, issueBuild, issueMove, type AiPoint } from './commands';
import type { Difficulty, StrategicGoal } from './contracts';
import { Tactician, type TacticianPersistenceState } from './tactician';

export type { Difficulty, StrategicGoal } from './contracts';
export { TACTICIAN_REACTION_DELAY, Tactician } from './tactician';
export type { Squad, TacticianContext } from './tactician';

export interface GoalScore {
  goal: StrategicGoal;
  score: number;
}

export interface FailedBallisticPlanState {
  sourceId: number;
  targetId: number;
  weaponId: 'batteryGun';
  deltaSCell: number;
  deltaZCell: number;
  failureCount: number;
  retryAtTick: number;
}

export interface ArtilleryRevealTrackingState {
  unitId: number;
}

type BallisticPlanKeyState = Pick<
  FailedBallisticPlanState,
  'sourceId' | 'targetId' | 'weaponId' | 'deltaSCell' | 'deltaZCell'
>;

export interface StrategistWeights {
  expand: number;
  tech: number;
  harass: number;
  defend: number;
  allIn: number;
  mapControl: number;
  visibility: number;
}

export interface StrategistConfig {
  evaluationInterval: number;
  candidateGoals: readonly StrategicGoal[];
  weights: Readonly<StrategistWeights>;
}

export interface StrategicState {
  salvageRatio: number;
  energyRatio: number;
  ownArmyStrength: number;
  visibleEnemyArmyStrength: number;
  ownScoutCount: number;
  ownExtractorCount: number;
  ownNodeCount: number;
  visibleEnemyNodeCount: number;
  availableDeposits: number;
  safeDepositRatio: number;
  techLevel: number;
  visibleEnemyExpansions: number;
  visibleThreat: number;
  bastionHealthRatio: number;
  matchProgress: number;
}

export interface AiOpponentPersistenceState {
  faction: Faction;
  difficulty: Difficulty;
  rngState: number;
  activeGoal: StrategicGoal;
  lastGoalScores: GoalScore[];
  strategyTimer: number;
  pushTarget: { s: number; z: number } | null;
  regroupUntil: number;
  artilleryRevealTracking: ArtilleryRevealTrackingState[];
  failedBallisticPlans: FailedBallisticPlanState[];
  tactician: TacticianPersistenceState;
}

const FULL_GOAL_SET: readonly StrategicGoal[] = ['expand', 'tech', 'harass', 'defend', 'allIn'];
const BASE_WEIGHTS: Readonly<StrategistWeights> = {
  expand: 1,
  tech: 1,
  harass: 1,
  defend: 1,
  allIn: 1,
  mapControl: 1,
  visibility: 1,
};

export const STRATEGIST_CONFIG: Readonly<Record<Difficulty, StrategistConfig>> = {
  recruit: {
    evaluationInterval: 3,
    candidateGoals: ['expand', 'tech', 'defend'],
    weights: BASE_WEIGHTS,
  },
  veteran: {
    evaluationInterval: 1.5,
    candidateGoals: FULL_GOAL_SET,
    weights: BASE_WEIGHTS,
  },
  commander: {
    evaluationInterval: 0.6,
    candidateGoals: FULL_GOAL_SET,
    weights: {
      expand: 1.08,
      tech: 1.12,
      harass: 1.25,
      defend: 1.3,
      allIn: 1.2,
      mapControl: 1.15,
      visibility: 1.2,
    },
  },
};

const TACTICAL_DIFFICULTY = {
  recruit: { army: 5, aggression: 0.6, expand: 0.7 },
  veteran: { army: 4, aggression: 1, expand: 1 },
  commander: { army: 3, aggression: 1.35, expand: 1.3 },
} as const;

const BALLISTIC_GEOMETRY_QUANTUM = 64;
const BASTION_ASSAULT_TIME = 15 * 60;
const SILO_DEPLOYMENT_TIME = 20 * 60;
const CHORD_VOLLEY_SIZE = 1;
const BALLISTIC_RETRY_BASE_TICKS = 30 * SIM_HZ;
export const MAX_FAILED_BALLISTIC_PLANS = 2_048;
export const MAX_BALLISTIC_PLAN_FAILURE_COUNT = 16;
export const MAX_BALLISTIC_PLAN_RETRY_TICKS = 5 * 60 * SIM_HZ;
const ARTILLERY_REPOSITION_OFFSETS = [
  { ds: -160, dz: -90 },
  { ds: 160, dz: -90 },
  { ds: -160, dz: 90 },
  { ds: 160, dz: 90 },
] as const;

export function scoreStrategicGoals(state: StrategicState, difficulty: Difficulty): GoalScore[] {
  const config = STRATEGIST_CONFIG[difficulty];
  const weights = config.weights;
  const salvage = unitInterval(state.salvageRatio);
  const energy = unitInterval(state.energyRatio);
  const ownStrength = nonNegative(state.ownArmyStrength);
  const enemyStrength = nonNegative(state.visibleEnemyArmyStrength);
  const extractors = nonNegative(state.ownExtractorCount);
  const deposits = unitInterval(nonNegative(state.availableDeposits) / 4);
  const depositNeed = unitInterval((4 - extractors) / 4);
  const safety = unitInterval(state.safeDepositRatio);
  const techNeed = unitInterval((3 - nonNegative(state.techLevel)) / 3);
  const scouts = unitInterval(nonNegative(state.ownScoutCount) / 2);
  const expansions = unitInterval(nonNegative(state.visibleEnemyExpansions) / 2);
  const threat = unitInterval(state.visibleThreat);
  const bastionPressure = 1 - unitInterval(state.bastionHealthRatio);
  const progress = unitInterval(state.matchProgress);
  const mapDeficit = unitInterval(
    (nonNegative(state.visibleEnemyNodeCount) + 1 - nonNegative(state.ownNodeCount)) / 4,
  );
  const armyGap = unitInterval((enemyStrength - ownStrength) / Math.max(1, enemyStrength));
  const strengthAdvantage = unitInterval((ownStrength / Math.max(200, enemyStrength + 200)) / 2);
  const economyExhaustion = unitInterval((1 - salvage) * 0.6 + progress * 0.4);

  const scores: Record<StrategicGoal, number> = {
    expand:
      weights.expand * (12 + deposits * depositNeed * safety * 44) +
      mapDeficit * weights.mapControl * 14 +
      (1 - salvage) * 6,
    tech: weights.tech * (10 + techNeed * ((salvage + energy) * 0.5) * 48) + progress * 8,
    harass:
      weights.harass * (8 + scouts * expansions * 48) +
      mapDeficit * weights.mapControl * 10 +
      expansions * weights.visibility * 8,
    defend:
      weights.defend * (8 + threat * 56 + armyGap * 28 + bastionPressure * 22) +
      nonNegative(state.visibleEnemyNodeCount) * 2,
    allIn:
      weights.allIn * (6 + strengthAdvantage * economyExhaustion * 58) +
      progress * weights.mapControl * 12,
  };

  return config.candidateGoals.map((goal) => ({ goal, score: finiteScore(scores[goal]) }));
}

export function selectStrategicGoal(scores: readonly GoalScore[]): StrategicGoal {
  let selected: StrategicGoal = scores[0]?.goal ?? 'expand';
  let selectedScore = scores[0]?.score ?? -Infinity;
  for (let i = 1; i < scores.length; i++) {
    const candidate = scores[i]!;
    if (candidate.score > selectedScore) {
      selected = candidate.goal;
      selectedScore = candidate.score;
    }
  }
  return selected;
}

export function collectStrategicState(world: World, faction: Faction): StrategicState {
  const mine = world.structures.filter((structure) => structure.alive && structure.faction === faction);
  const myUnits = world.units.filter((unit) => unit.alive && unit.faction === faction);
  const myArmy = myUnits.filter((unit) => UNITS[unit.kind].isMech);
  const visibleEnemyUnits = world.units.filter(
    (unit) => unit.alive && unit.faction !== faction && world.isEntityVisible(faction, unit.id),
  );
  const visibleEnemyArmy = visibleEnemyUnits.filter((unit) => UNITS[unit.kind].isMech);
  const visibleEnemyStructures = world.structures.filter(
    (structure) =>
      structure.alive &&
      structure.faction >= 0 &&
      structure.faction !== faction &&
      world.isEntityVisible(faction, structure.id),
  );
  const knownStructures = [...mine, ...visibleEnemyStructures];
  const visibleDeposits = world.deposits.filter(
    (deposit) =>
      deposit.amount > 0 &&
      world.isVisible(faction, deposit.s, deposit.z) &&
      !knownStructures.some(
        (structure) => surfaceDist(structure.s, structure.z, deposit.s, deposit.z) < 70,
      ),
  );
  const safeDepositRatio = visibleDeposits.length === 0
    ? 0
    : visibleDeposits.reduce((total, deposit) => {
        let nearestThreat = 700;
        for (const enemy of [...visibleEnemyUnits, ...visibleEnemyStructures]) {
          nearestThreat = Math.min(
            nearestThreat,
            surfaceDist(deposit.s, deposit.z, enemy.s, enemy.z),
          );
        }
        return total + unitInterval(nearestThreat / 700);
      }, 0) / visibleDeposits.length;
  const bastion = mine.find((structure) => structure.kind === 'bastion');
  const completedKinds = new Set(
    mine.filter((structure) => structure.progress >= 1).map((structure) => structure.kind),
  );
  const techLevel = Number(completedKinds.has('fabricator')) +
    Number(completedKinds.has('mechFoundry')) +
    Number(completedKinds.has('rocketBattery'));

  let visibleThreat = 0;
  for (const enemy of visibleEnemyArmy) {
    let nearestOwn = Infinity;
    for (const structure of mine) {
      nearestOwn = Math.min(nearestOwn, surfaceDist(enemy.s, enemy.z, structure.s, structure.z));
    }
    visibleThreat = Math.max(visibleThreat, unitInterval((650 - nearestOwn) / 650));
  }

  return {
    salvageRatio: unitInterval(world.players[faction].salvage / 1_200),
    energyRatio: unitInterval((world.players[faction].energyProduced - world.players[faction].energyDrawn + 10) / 30),
    ownArmyStrength: myArmy.reduce((total, unit) => total + unitStrength(unit), 0),
    visibleEnemyArmyStrength: visibleEnemyArmy.reduce((total, unit) => total + unitStrength(unit), 0),
    ownScoutCount: myUnits.filter((unit) => unit.kind === 'wisp').length,
    ownExtractorCount: mine.filter((structure) => structure.kind === 'extractor').length,
    ownNodeCount: mine.filter((structure) => structure.kind === 'spinalNode').length,
    visibleEnemyNodeCount: visibleEnemyStructures.filter((structure) => structure.kind === 'spinalNode').length,
    availableDeposits: visibleDeposits.length,
    safeDepositRatio,
    techLevel,
    visibleEnemyExpansions: visibleEnemyStructures.filter(
      (structure) =>
        structure.kind === 'extractor' ||
        structure.kind === 'fabricator' ||
        structure.kind === 'mechFoundry',
    ).length,
    visibleThreat,
    bastionHealthRatio: bastion ? unitInterval(bastion.hp / bastion.maxHp) : 0,
    matchProgress: unitInterval(world.time / MATCH_TIME_LIMIT),
  };
}

export class AiOpponent {
  activeGoal: StrategicGoal = 'expand';
  lastGoalScores: readonly GoalScore[] = [];

  readonly tactician: Tactician;

  private strategyTimer = 0;
  private readonly rng: Rng;
  private readonly cfg: (typeof TACTICAL_DIFFICULTY)[Difficulty];
  /** Where the current push is headed, or null when regrouping. */
  private pushTarget: { s: number; z: number } | null = null;
  private regroupUntil = 0;
  /** Longbows observed during their current counter-battery reveal window. */
  private readonly artilleryRevealTracking = new Set<number>();
  /** Bounded authoritative backoff state; insertion order determines deterministic eviction. */
  private readonly failedBallisticPlans = new Map<string, FailedBallisticPlanState>();

  constructor(
    private readonly faction: Faction,
    private readonly difficulty: Difficulty,
    seed: number,
  ) {
    this.cfg = TACTICAL_DIFFICULTY[difficulty];
    this.rng = new Rng(seed ^ 0xa11);
    this.tactician = new Tactician(faction, difficulty);
  }

  exportPersistenceState(): AiOpponentPersistenceState {
    return {
      faction: this.faction,
      difficulty: this.difficulty,
      rngState: this.rng.snapshot(),
      activeGoal: this.activeGoal,
      lastGoalScores: this.lastGoalScores.map((score) => ({ ...score })),
      strategyTimer: this.strategyTimer,
      pushTarget: this.pushTarget ? { ...this.pushTarget } : null,
      regroupUntil: this.regroupUntil,
      artilleryRevealTracking: [...this.artilleryRevealTracking]
        .sort((a, b) => a - b)
        .map((unitId) => ({ unitId })),
      failedBallisticPlans: [...this.failedBallisticPlans.values()].map((plan) => ({ ...plan })),
      tactician: this.tactician.exportPersistenceState(),
    };
  }

  static fromPersistenceState(state: AiOpponentPersistenceState): AiOpponent {
    const opponent = new AiOpponent(state.faction, state.difficulty, 0);
    opponent.rng.restore(state.rngState);
    opponent.activeGoal = state.activeGoal;
    opponent.lastGoalScores = state.lastGoalScores.map((score) => ({ ...score }));
    opponent.strategyTimer = state.strategyTimer;
    opponent.pushTarget = state.pushTarget ? { ...state.pushTarget } : null;
    opponent.regroupUntil = state.regroupUntil;
    for (const tracked of state.artilleryRevealTracking) {
      opponent.artilleryRevealTracking.add(tracked.unitId);
    }
    for (const plan of state.failedBallisticPlans) {
      opponent.failedBallisticPlans.set(ballisticPlanKey(plan), { ...plan });
    }
    opponent.tactician.restorePersistenceState(state.tactician);
    return opponent;
  }

  update(world: World, dt: number): void {
    if (world.status === 'completed') return;
    let ranStrategist = false;
    this.strategyTimer -= Math.max(0, finiteScore(dt));
    if (this.strategyTimer <= 0) {
      ranStrategist = true;
      this.strategyTimer += STRATEGIST_CONFIG[this.difficulty].evaluationInterval;
      if (this.strategyTimer <= 0) {
        this.strategyTimer = STRATEGIST_CONFIG[this.difficulty].evaluationInterval;
      }

      this.recoverUnreachableOrders(world);
      this.evaluateStrategy(world);
      this.runEconomy(world);
      this.tactician.reformSquads(world);
    }
    this.tactician.update(world, dt, this.activeGoal);
    // Strategic directives are the final authority on evaluation ticks. If the
    // tactician runs afterward in the same update it can replace a committed
    // Bastion attack before World observes even one simulation step.
    if (ranStrategist) this.runTactics(world);
    this.updateArtilleryRepositioning(world);
    if (ranStrategist) this.recoverUnreachableOrders(world);
  }

  evaluateStrategicState(state: StrategicState): readonly GoalScore[] {
    const scores = scoreStrategicGoals(state, this.difficulty);
    this.lastGoalScores = scores;
    this.activeGoal = selectStrategicGoal(scores);
    return scores;
  }

  evaluateStrategy(world: World): readonly GoalScore[] {
    return this.evaluateStrategicState(collectStrategicState(world, this.faction));
  }

  // -------------------------------------------------------------------------
  // Strategy
  // -------------------------------------------------------------------------

  private runEconomy(world: World): void {
    const me = world.players[this.faction];
    const mine = this.myStructures(world);
    const engineers = this.myUnits(world).filter((u) => UNITS[u.kind].canBuild);

    const count = (k: StructureKind): number => mine.filter((s) => s.kind === k).length;
    const extractors = count('extractor');
    const power = me.energyProduced - me.energyDrawn;
    const hasFab = count('fabricator') > 0;
    const hasFoundry = count('mechFoundry') > 0;
    const silos = count('silo');
    const endgamePowerShortfall = silos > 0 && power < 20 + silos * (WEAPONS.chordShot.energyPerShot ?? 0);

    // --- Keep production queues fed -----------------------------------------
    // Engineers first: without them nothing else can be built.
    const planned = this.plannedUnitCounts(mine, this.myUnits(world));
    const producers = [...mine].sort((a, b) => a.id - b.id);
    for (const st of producers) {
      if (st.progress < 1 || st.queue.length > 1) continue;
      const produces = STRUCTURES[st.kind].produces;
      if (!produces) continue;

      if (produces.includes('engineer') && planned.engineer < 4 && me.salvage > 200) {
        if (world.tryQueueUnit(st.id, 'engineer')) planned.engineer++;
        continue;
      }
      if (st.kind === 'mechFoundry') {
        const kind = this.chooseMech(planned, me.salvage);
        if (world.tryQueueUnit(st.id, kind)) planned[kind]++;
      }
    }

    // --- Decide what to build next -------------------------------------------
    // Scored rather than sequenced: whichever need is most acute wins.
    const wants: Array<{ kind: StructureKind; score: number }> = [];
    wants.push({
      kind: 'extractor',
      score: (4 - extractors) * 30 * this.cfg.expand * (this.activeGoal === 'expand' ? 1.45 : 1),
    });
    wants.push({ kind: 'solarArray', score: power < 8 ? 40 : 0 });
    wants.push({ kind: 'fabricator', score: hasFab ? 0 : 90 * (this.activeGoal === 'tech' ? 1.35 : 1) });
    wants.push({
      kind: 'mechFoundry',
      score: hasFab && !hasFoundry ? 100 * (this.activeGoal === 'tech' ? 1.35 : 1) : 0,
    });
    wants.push({
      kind: 'fusionCore',
      score: endgamePowerShortfall ? 130 : power < 14 && hasFoundry ? 45 : 0,
    });
    wants.push({
      kind: 'rocketBattery',
      score: hasFoundry && count('rocketBattery') < 2 ? 35 * (this.activeGoal === 'defend' ? 1.3 : 1) : 0,
    });
    wants.push({
      kind: 'pointDefense',
      score: count('pointDefense') < 2 && hasFoundry ? 30 * (this.activeGoal === 'defend' ? 1.5 : 1) : 0,
    });
    wants.push({ kind: 'radarMast', score: count('radarMast') < 1 && hasFoundry ? 28 : 0 });
    wants.push({
      kind: 'silo',
      score: hasFoundry && world.time >= SILO_DEPLOYMENT_TIME && silos < CHORD_VOLLEY_SIZE ? 120 : 0,
    });

    wants.sort((a, b) => b.score - a.score);
    const idle = [...engineers].sort((a, b) => a.id - b.id).find((e) => e.order.kind === 'idle');
    if (!idle) return;

    for (const pick of wants) {
      if (pick.score <= 0) break;
      const def = STRUCTURES[pick.kind];
      // Leave a reserve so the AI does not starve unit production to build.
      if (me.salvage < (def.cost.salvage ?? 0) + 120) continue;
      const spot = this.findBuildSpot(world, pick.kind, idle);
      if (!spot) continue;
      const site = world.tryPlaceStructure(this.faction, pick.kind, spot.s, spot.z);
      if (!site) continue;
      issueBuild(idle, site.id, spot);
      return;
    }
  }

  /** Composition logic: a core of brawlers, then artillery, screened by scouts. */
  private chooseMech(planned: Readonly<Record<UnitKind, number>>, salvage: number): UnitKind {
    const n = (kind: UnitKind): number => planned[kind];

    // A scout early is worth more than anything else: artillery cannot fire at
    // what nobody can see.
    if (n('wisp') < 1) return 'wisp';
    if (n('vanguard') < 2) return 'vanguard';
    if (n('wisp') < 2) return 'wisp';
    if (this.faction === Faction.Compact && n('bulwark') < 1 && salvage > 850) return 'bulwark';
    if (this.faction === Faction.Choir && n('needle') < 1 && salvage > 550) return 'needle';
    if (n('longbow') < 1 && salvage > 700) return 'longbow';
    if (n('aegis') < 1 && n('vanguard') >= 2) return 'aegis';
    if (n('vanguard') < n('longbow') * 2) return 'vanguard';
    if (salvage > 1200) return 'longbow';
    return 'vanguard';
  }

  /**
   * Where to put a building. Extractors go on the nearest free deposit; other
   * buildings cluster near the Bastion, with a slight bias away from the enemy
   * so that the economy sits behind the fighting.
   */
  private findBuildSpot(world: World, kind: StructureKind, engineer: Unit): AiPoint | null {
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    if (!home) return null;

    if (STRUCTURES[kind].needsDeposit) {
      let best: { s: number; z: number } | null = null;
      let bestD = Infinity;
      for (const d of world.deposits) {
        if (d.amount <= 0) continue;
        if (!world.isVisible(this.faction, d.s, d.z)) continue;
        if (d.claimedBy !== 0 && world.structureById(d.claimedBy)) continue;
        const dist = surfaceDist(home.s, home.z, d.s, d.z);
        if (dist > 420) continue; // must be within the build anchor radius
        if (
          dist < bestD &&
          world.canPlace(this.faction, kind, d.s, d.z) &&
          world.nav.segmentPassable(engineer.s, engineer.z, d.s, d.z)
        ) {
          bestD = dist;
          best = { s: d.s, z: d.z };
        }
      }
      return best;
    }

    // Rejection-sample a ring around the Bastion.
    for (let i = 0; i < 40; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(60, 380);
      const s = wrapS(home.s + Math.cos(a) * r);
      const z = clamp(home.z + Math.sin(a) * r, -RING_HALF_WIDTH + 120, RING_HALF_WIDTH - 120);
      const spot = { s, z };
      if (
        world.canPlace(this.faction, kind, s, z) &&
        world.nav.segmentPassable(engineer.s, engineer.z, spot.s, spot.z)
      ) return spot;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Tactics
  // -------------------------------------------------------------------------

  private runTactics(world: World): void {
    const army = this.myUnits(world).filter((u) => UNITS[u.kind].isMech);
    const scouts = army.filter((u) => u.kind === 'wisp').sort((a, b) => a.id - b.id);
    const artillery = army.filter((u) => u.kind === 'longbow');
    const line = army
      .filter((u) => u.kind === 'vanguard' || u.kind === 'aegis' || u.kind === 'bulwark' || u.kind === 'needle')
      .sort((a, b) => a.id - b.id);

    // Chord Shots close late games when terrain and layered defenses prevent
    // ground forces from reaching the opposing headquarters.
    const enemyBastion = world.structures.find(
      (structure) =>
        structure.alive &&
        structure.kind === 'bastion' &&
        structure.faction === other(this.faction),
    );
    if (enemyBastion) {
      const readySilos = this.myStructures(world)
        .filter(
          (structure) =>
            structure.kind === 'silo' &&
            structure.progress >= 1 &&
            (structure.cd[0] ?? 0) <= 0,
        )
        .sort((a, b) => a.id - b.id);
      const volleyEnergy = CHORD_VOLLEY_SIZE * (WEAPONS.chordShot.energyPerShot ?? 0);
      const availableEnergy = world.players[this.faction].energyProduced - world.players[this.faction].energyDrawn;
      if (readySilos.length >= CHORD_VOLLEY_SIZE && availableEnergy >= volleyEnergy) {
        for (const silo of readySilos.slice(0, CHORD_VOLLEY_SIZE)) {
          world.fireBallisticAt(
            silo.id,
            enemyBastion.s,
            enemyBastion.z,
            this.faction,
            'chordShot',
          );
        }
      }
    }

    for (const battery of this.myStructures(world).filter((structure) => structure.kind === 'rocketBattery')) {
      if ((battery.cd[0] ?? 0) > 0) continue;
      const targets = [
        ...world.units.filter(
          (unit) => unit.alive && unit.faction !== this.faction && world.isEntityVisible(this.faction, unit.id),
        ),
        ...world.structures.filter(
          (structure) =>
            structure.alive &&
            structure.faction >= 0 &&
            structure.faction !== this.faction &&
            world.isEntityVisible(this.faction, structure.id),
        ),
      ];
      const reachableTargets = targets.filter((target) =>
        world.isBallisticTargetWithinReachEnvelope(
          battery.id,
          target.s,
          target.z,
          this.faction,
          'batteryGun',
        ));
      reachableTargets.sort((a, b) => {
        const valueDifference = artilleryTargetValue(b) - artilleryTargetValue(a);
        if (valueDifference !== 0) return valueDifference;
        const distanceDifference =
          surfaceDist(battery.s, battery.z, a.s, a.z) -
          surfaceDist(battery.s, battery.z, b.s, b.z);
        return distanceDifference !== 0 ? distanceDifference : a.id - b.id;
      });
      for (const target of reachableTargets) {
        const plan = createBallisticPlanState(battery, target);
        const planKey = ballisticPlanKey(plan);
        const previousFailure = this.failedBallisticPlans.get(planKey);
        if (previousFailure && world.tick < previousFailure.retryAtTick) continue;
        if (world.fireBallisticAt(battery.id, target.s, target.z, this.faction, 'batteryGun')) {
          this.failedBallisticPlans.delete(planKey);
          break;
        }
        this.rememberFailedBallisticPlan(planKey, plan, previousFailure, world.tick);
        // Try at most one new expensive geometry per battery planning cycle.
        break;
      }
    }

    // --- Scouts take and hold nodes ------------------------------------------
    const nodes = world.structures
      .filter((structure) => structure.alive && structure.kind === 'spinalNode')
      .sort((a, b) => a.id - b.id);
    const assignedNodes = new Set<number>();
    const preservedScouts = new Set<number>();
    for (const scout of scouts) {
      if (scout.order.kind !== 'attackMove') continue;
      const objective = nodes.find((node) =>
        node.faction !== this.faction && !assignedNodes.has(node.id) &&
        samePoint(node, scout.order) && isReachable(world, scout, node));
      if (!objective) continue;
      assignedNodes.add(objective.id);
      preservedScouts.add(scout.id);
    }
    for (const scout of scouts) {
      if (preservedScouts.has(scout.id)) continue;
      let objective: Structure | null = null;
      let objectivePriority = -Infinity;
      let objectiveDistance = Infinity;
      for (const node of nodes) {
        if (node.faction === this.faction || assignedNodes.has(node.id)) continue;
        if (!isReachable(world, scout, node)) continue;
        const priority = spinalNodePriority(world, node, this.faction);
        const distance = surfaceDist(scout.s, scout.z, node.s, node.z);
        if (
          priority > objectivePriority ||
          (priority === objectivePriority && (
            distance < objectiveDistance ||
            (distance === objectiveDistance && node.id < (objective?.id ?? Infinity))
          ))
        ) {
          objective = node;
          objectivePriority = priority;
          objectiveDistance = distance;
        }
      }
      if (objective) {
        assignedNodes.add(objective.id);
        issueAttackMove(scout, objective);
      } else if (scout.order.kind === 'attackMove' && nodes.some((node) => samePoint(node, scout.order))) {
        clearAiOrder(scout);
      }
    }

    // --- Artillery reacts to nearby threats ----------------------------------
    // Post-reveal repositioning is handled every AI tick below, independently
    // of this slower strategist cadence.
    for (const a of artillery) {
      const threat = this.nearestEnemy(world, a.s, a.z, 260);
      if (threat) {
        // Something is close: back off toward home.
        const home = this.myStructures(world).find((s) => s.kind === 'bastion');
        if (home) {
          const away = Math.atan2(a.z - threat.z, deltaS(threat.s, a.s));
          issueMove(a, {
            s: wrapS(a.s + Math.cos(away) * 220),
            z: clamp(a.z + Math.sin(away) * 220, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
          });
          void home;
        }
      } else if (this.pushTarget && a.order.kind === 'idle') {
        // Follow the push at a standoff distance rather than joining it.
        issueAttackMove(a, {
          s: wrapS(this.pushTarget.s - this.approachSign(world) * 500),
          z: this.pushTarget.z,
        });
      }
    }

    // --- The main body -------------------------------------------------------
    const strength = line.length;
    const home = this.myStructures(world).find((structure) => structure.kind === 'bastion');
    const emergencyDefense = home !== undefined && this.nearestEnemy(world, home.s, home.z, 700) !== null;
    if (emergencyDefense) {
      this.pushTarget = null;
      if (home) {
        for (const unit of line) {
          if (unit.order.kind === 'idle' || unit.order.kind === 'move') {
            issueAttackMove(unit, { s: wrapS(home.s + 90), z: home.z });
          }
        }
      }
      return;
    }
    const pairDefense = world.time < BASTION_ASSAULT_TIME ? this.pairDefenseTarget(world) : null;
    if (pairDefense) {
      const availableLine = line.filter((unit) => unit.order.kind === 'idle' || unit.order.kind === 'move');
      if (availableLine.length > 0) {
        for (const unit of availableLine) issueAttackMove(unit, pairDefense);
        return;
      }
    }
    if (this.activeGoal === 'defend' && world.time < BASTION_ASSAULT_TIME) {
      this.pushTarget = null;
      if (home) {
        for (const unit of line) {
          if (unit.order.kind === 'idle' || unit.order.kind === 'move') {
            issueAttackMove(unit, { s: wrapS(home.s + 90), z: home.z });
          }
        }
      }
      return;
    }
    if (world.time < this.regroupUntil) {
      const home = this.myStructures(world).find((s) => s.kind === 'bastion');
      if (home) {
        for (const u of line) {
          if (u.order.kind === 'idle') {
            issueMove(u, { s: wrapS(home.s + 90), z: home.z });
          }
        }
      }
      return;
    }

    const attackThreshold = this.activeGoal === 'allIn' || this.activeGoal === 'harass'
      ? Math.max(2, this.cfg.army - 1)
      : this.cfg.army;
    const currentStrategicTarget = this.pushTarget
      ? world.structures.find((structure) => structure.alive && samePoint(structure, this.pushTarget!))
      : undefined;
    const requiredStrength = currentStrategicTarget?.kind === 'bastion'
      ? this.cfg.army
      : attackThreshold;
    if (strength >= requiredStrength) {
      const excludedTargetId = this.refreshPushTarget(world, line);
      if (!this.pushTarget) this.pushTarget = this.chooseAttackTarget(world, line, excludedTargetId);
      const t = this.pushTarget;
      if (t) {
        const strategicTarget = world.structures.find(
          (structure) => structure.alive && samePoint(structure, t),
        );
        for (const u of line) {
          const assaultRange = Math.min(
            u.vision,
            Math.max(
              0,
              ...UNITS[u.kind].weapons
                .map((weaponId) => WEAPONS[weaponId]!)
                .filter((weapon) => weapon.kind !== 'interceptor')
                .map((weapon) => world.effectiveWeaponRange(u.id, weapon.id)),
            ),
          ) * 0.95;
          const committedBastionAttack =
            strategicTarget?.kind === 'bastion' &&
            u.hp / Math.max(1, u.maxHp) >= 0.3 &&
            surfaceDist(u.s, u.z, strategicTarget.s, strategicTarget.z) <= assaultRange;
          if (committedBastionAttack) {
            // Preserve objective identity at the end of a strategic push. A
            // coordinate-only attack-move otherwise reacquires every nearby
            // defender and structure without ever targeting the win condition.
            issueAttack(u, strategicTarget.id, strategicTarget);
          } else if (u.order.kind === 'idle' || u.order.kind === 'move') {
            issueAttackMove(u, t);
          }
        }
      }
    } else {
      // Too weak to attack: pull back and rebuild.
      this.pushTarget = null;
      const home = this.myStructures(world).find((s) => s.kind === 'bastion');
      if (home) {
        for (const u of line) {
          if (u.order.kind === 'idle') {
            const a = this.rng.range(0, Math.PI * 2);
            issueAttackMove(u, {
              s: wrapS(home.s + Math.cos(a) * 140),
              z: clamp(home.z + Math.sin(a) * 140, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
            });
          }
        }
      }
    }

    // If the push has been wiped out, stop feeding units into it.
    if (this.pushTarget && strength < 2) {
      this.pushTarget = null;
      this.regroupUntil = world.time + 45;
    }
  }

  private updateArtilleryRepositioning(world: World): void {
    for (const unitId of this.artilleryRevealTracking) {
      const unit = world.unitById(unitId);
      if (!unit || unit.faction !== this.faction || unit.kind !== 'longbow') {
        this.artilleryRevealTracking.delete(unitId);
      }
    }

    for (const unit of world.units) {
      if (!unit.alive || unit.faction !== this.faction || unit.kind !== 'longbow') continue;
      if (unit.revealed > 0) {
        this.artilleryRevealTracking.add(unit.id);
        continue;
      }
      if (!this.artilleryRevealTracking.delete(unit.id)) continue;

      if (unit.ability?.id === 'siegeMode' && unit.ability.active) {
        world.activateAbility(unit.id, false);
      }
      const signature = (
        Math.imul(unit.id, 0x9e3779b1) ^ Math.imul(world.tick + 1, 0x85ebca6b)
      ) >>> 0;
      let destination: AiPoint | null = null;
      for (let index = 0; index < ARTILLERY_REPOSITION_OFFSETS.length; index++) {
        const offset = ARTILLERY_REPOSITION_OFFSETS[
          (signature + index) % ARTILLERY_REPOSITION_OFFSETS.length
        ]!;
        const candidate = {
          s: wrapS(unit.s + offset.ds),
          z: clamp(unit.z + offset.dz, -RING_HALF_WIDTH + 80, RING_HALF_WIDTH - 80),
        };
        if (!world.nav.segmentPassable(unit.s, unit.z, candidate.s, candidate.z)) continue;
        if (!world.nav.directionAt(unit.s, unit.z, candidate.s, candidate.z).reachable) continue;
        destination = candidate;
        break;
      }
      if (destination) issueMove(unit, destination);
      else clearAiOrder(unit);
    }
  }

  private recoverUnreachableOrders(world: World): void {
    const units = this.myUnits(world).sort((a, b) => a.id - b.id);
    for (const unit of units) {
      if (
        unit.order.kind !== 'move' &&
        unit.order.kind !== 'attackMove' &&
        unit.order.kind !== 'build'
      ) continue;

      // Only strategic objectives need topology recovery. Generic rally and
      // reposition orders are short-lived and checking each generated point
      // would build a new whole-map flow field every strategist cycle.
      const objective = unit.order.kind === 'build'
        ? world.structureById(unit.buildTargetId)
        : world.structures.find((structure) => structure.alive && samePoint(structure, unit.order));
      if (!objective && unit.order.kind === 'move') continue;
      if (isReachable(world, unit, unit.order)) continue;
      clearAiOrder(unit);
    }
  }

  private plannedUnitCounts(
    structures: readonly Structure[],
    units: readonly Unit[],
  ): Record<UnitKind, number> {
    const counts: Record<UnitKind, number> = {
      engineer: 0,
      vanguard: 0,
      longbow: 0,
      wisp: 0,
      aegis: 0,
      bulwark: 0,
      needle: 0,
    };
    for (const unit of units) counts[unit.kind]++;
    for (const structure of structures) {
      for (const kind of structure.queue) counts[kind]++;
    }
    return counts;
  }

  private refreshPushTarget(world: World, line: readonly Unit[]): number | undefined {
    if (!this.pushTarget) return undefined;
    const target = world.structures.find((structure) =>
      structure.alive && samePoint(structure, this.pushTarget!));
    const leader = line[0];
    const knownHostile = target && (
      (target.kind === 'spinalNode' && target.faction !== this.faction) ||
      (target.faction === other(this.faction) && (
        world.isEntityVisible(this.faction, target.id) ||
        world.hasStrategicContact(this.faction, target.id) ||
        isScenarioKnownEnemyBastion(target, this.faction)
      ))
    );
    const arrived = target !== undefined && line.some((unit) =>
      surfaceDist(unit.s, unit.z, target.s, target.z) <= 110);
    const lateBastionCommit = world.time >= BASTION_ASSAULT_TIME && target?.kind !== 'bastion';
    if (
      knownHostile &&
      leader &&
      !arrived &&
      !lateBastionCommit &&
      isReachable(world, leader, target)
    ) return undefined;

    this.pushTarget = null;
    return arrived || lateBastionCommit ? target?.id : undefined;
  }

  private rememberFailedBallisticPlan(
    planKey: string,
    plan: BallisticPlanKeyState,
    previousFailure: FailedBallisticPlanState | undefined,
    tick: number,
  ): void {
    if (!previousFailure && this.failedBallisticPlans.size >= MAX_FAILED_BALLISTIC_PLANS) {
      const oldest = this.failedBallisticPlans.keys().next().value;
      if (oldest !== undefined) this.failedBallisticPlans.delete(oldest);
    }
    const failureCount = Math.min(
      MAX_BALLISTIC_PLAN_FAILURE_COUNT,
      (previousFailure?.failureCount ?? 0) + 1,
    );
    const retryDelay = Math.min(
      BALLISTIC_RETRY_BASE_TICKS * 2 ** Math.min(failureCount - 1, 30),
      MAX_BALLISTIC_PLAN_RETRY_TICKS,
    );
    this.failedBallisticPlans.set(planKey, {
      ...plan,
      failureCount,
      retryAtTick: tick + retryDelay,
    });
  }

  /**
   * Pick something to attack.
   *
   * The ring's asymmetric artillery ranges make direction matter: approaching
   * from antispinward means our own artillery reaches much further into their
   * base than theirs does into ours. So an undefended node or expansion on that
   * side is worth more than a closer one on the wrong side.
   */
  private chooseAttackTarget(
    world: World,
    line: readonly Unit[],
    excludedTargetId?: number,
  ): AiPoint | null {
    const enemy = other(this.faction);
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    const leader = line[0];
    if (!home || !leader) return null;

    let best: { s: number; z: number } | null = null;
    let bestScore = -Infinity;

    const candidates: Structure[] = world.structures.filter(
      (s) =>
        s.alive &&
        s.id !== excludedTargetId &&
        (s.faction === enemy || (s.kind === 'spinalNode' && s.faction !== this.faction)) &&
        (
          world.isEntityVisible(this.faction, s.id) ||
          world.hasStrategicContact(this.faction, s.id) ||
          (
            world.time >= BASTION_ASSAULT_TIME &&
            line.length >= this.cfg.army &&
            isScenarioKnownEnemyBastion(s, this.faction)
          )
        ) &&
        isReachable(world, leader, s),
    );

    for (const c of candidates) {
      const contact = world.strategicContactFor(this.faction, c.id);
      const exact = world.isEntityVisible(this.faction, c.id);
      const d = Math.abs(deltaS(home.s, c.s));
      // Closer is better, but not linearly -- crossing the map is fine if the
      // prize is right.
      let score = 100 - (d / RING_CIRCUMFERENCE) * 160;

      if (contact?.category === 'major-construction') score += 30;
      if (exact && c.kind === 'extractor') score += this.activeGoal === 'harass' ? 44 : 25;
      if (exact && c.kind === 'mechFoundry') score += 35;
      if (contact?.category === 'active-node' || (exact && c.kind === 'spinalNode')) {
        score += this.activeGoal === 'harass' ? 52 : 40;
        score += spinalMainForceBonus(world, c, this.faction);
      }
      if (contact?.category === 'bastion' || (exact && c.kind === 'bastion')) {
        score += (this.activeGoal === 'allIn' ? 52 : 10) * this.cfg.aggression;
        // Map-control skirmishing must eventually turn into an attempt at the
        // actual win condition. From fifteen minutes onward, a ready line force
        // commits to the scenario-known Bastion instead of endlessly trading
        // the higher-scored neutral nodes back and forth.
        if (world.time >= BASTION_ASSAULT_TIME) score += 180;
      }

      // Prefer approaching from antispinward of the target.
      const spinwardOfUs = deltaS(home.s, c.s) > 0;
      if (spinwardOfUs) score += 22;

      // Avoid walking into point defence and turrets.
      let defended = 0;
      for (const o of world.structures) {
        if (!o.alive || o.faction !== enemy) continue;
        if (!world.isEntityVisible(this.faction, o.id)) continue;
        if (STRUCTURES[o.kind].weapons.length === 0) continue;
        if (surfaceDist(o.s, o.z, c.s, c.z) < 220) defended++;
      }
      score -= defended * 18;

      score += this.rng.range(-8, 8);
      if (score > bestScore) {
        bestScore = score;
        best = { s: c.s, z: c.z };
      }
    }
    return best;
  }

  private approachSign(world: World): number {
    const home = this.myStructures(world).find((s) => s.kind === 'bastion');
    if (!home || !this.pushTarget) return 1;
    return Math.sign(deltaS(home.s, this.pushTarget.s)) || 1;
  }

  private nearestEnemy(world: World, s: number, z: number, range: number): Unit | null {
    let best: Unit | null = null;
    let bestD = range;
    for (const u of world.units) {
      if (!u.alive || u.faction === this.faction) continue;
      if (!world.isEntityVisible(this.faction, u.id)) continue;
      const d = surfaceDist(u.s, u.z, s, z);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private pairDefenseTarget(world: World): Structure | null {
    let selected: { node: Structure; hostileDistance: number; pairId: string } | null = null;
    for (const pair of world.spinalPairs) {
      if (world.spinalAlignmentOwner(pair) !== this.faction) continue;
      for (const nodeId of pair.members) {
        const node = world.structureById(nodeId);
        if (!node) continue;
        let nearest = Infinity;
        for (const hostile of world.units) {
          if (!hostile.alive || hostile.faction === this.faction || !UNITS[hostile.kind].isMech) continue;
          if (!world.isEntityVisible(this.faction, hostile.id)) continue;
          nearest = Math.min(nearest, surfaceDist(node.s, node.z, hostile.s, hostile.z));
        }
        if (nearest > 600) continue;
        if (
          !selected || nearest < selected.hostileDistance ||
          (nearest === selected.hostileDistance && (
            pair.id.localeCompare(selected.pairId) < 0 ||
            (pair.id === selected.pairId && node.id < selected.node.id)
          ))
        ) {
          selected = { node, hostileDistance: nearest, pairId: pair.id };
        }
      }
    }
    return selected?.node ?? null;
  }

  private myUnits(world: World): Unit[] {
    return world.units.filter((u) => u.alive && u.faction === this.faction);
  }

  private myStructures(world: World): Structure[] {
    return world.structures.filter((s) => s.alive && s.faction === this.faction);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function unitStrength(unit: Unit): number {
  const definition = UNITS[unit.kind];
  if (!definition.isMech) return 0;
  return unit.salvageCost * unitInterval(unit.hp / unit.maxHp);
}

function artilleryTargetValue(target: Unit | Structure): number {
  return target.maxHp + target.salvageCost;
}

function spinalNodePriority(world: World, node: Structure, faction: Faction): number {
  const pair = world.spinalPairForNode(node.id);
  if (!pair) return 100;
  const owner = world.spinalAlignmentOwner(pair);
  if (owner === other(faction)) return 300;
  const mate = world.spinalPairMate(node.id);
  if (mate?.faction === faction) return 200;
  if (mate?.faction === other(faction)) return 150;
  return 100;
}

function spinalMainForceBonus(world: World, node: Structure, faction: Faction): number {
  const priority = spinalNodePriority(world, node, faction);
  if (priority === 300) return 120;
  if (priority === 200) return 80;
  if (priority === 150) return 50;
  return 0;
}

function createBallisticPlanState(source: Structure, target: Unit | Structure): BallisticPlanKeyState {
  return {
    sourceId: source.id,
    targetId: target.id,
    weaponId: 'batteryGun',
    deltaSCell: Math.round(deltaS(source.s, target.s) / BALLISTIC_GEOMETRY_QUANTUM),
    deltaZCell: Math.round((target.z - source.z) / BALLISTIC_GEOMETRY_QUANTUM),
  };
}

function ballisticPlanKey(plan: BallisticPlanKeyState): string {
  return `${plan.sourceId}:${plan.weaponId}:${plan.targetId}:${plan.deltaSCell}:${plan.deltaZCell}`;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function unitInterval(value: number): number {
  return clamp(nonNegative(value), 0, 1);
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function isReachable(world: World, from: AiPoint, target: AiPoint): boolean {
  return world.nav.directionAt(from.s, from.z, target.s, target.z).reachable;
}

function samePoint(a: AiPoint, b: AiPoint): boolean {
  return surfaceDist(a.s, a.z, b.s, b.z) < 1;
}

function isScenarioKnownEnemyBastion(structure: Structure, faction: Faction): boolean {
  if (structure.kind !== 'bastion' || structure.faction !== other(faction)) return false;
  const expectedS = structure.faction === Faction.Compact ? 0 : RING_CIRCUMFERENCE * 0.5;
  return Math.abs(deltaS(expectedS, structure.s)) < 1 && Math.abs(structure.z) < 1;
}

function clearAiOrder(unit: Unit): void {
  unit.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
  unit.targetId = 0;
  unit.buildTargetId = 0;
}
