/**
 * The game simulation.
 *
 * Runs on a fixed 30 Hz timestep, entirely in surface space (arc length `s`,
 * axial `z`). It never imports Three.js and never touches the DOM: the renderer
 * reads state and drains an event queue, and that one-way flow is what keeps
 * the simulation reproducible.
 *
 * Entities are plain objects in stable-ordered arrays rather than a
 * struct-of-arrays ECS. At a few hundred entities the cache-locality argument
 * does not pay for the loss of clarity, and stable iteration order gives us the
 * determinism the architecture actually needs.
 */

import {
  ATMOSPHERE_HEIGHT,
  RING_CIRCUMFERENCE,
  RING_HALF_WIDTH,
  SIM_DT,
} from '@core/constants';
import { deltaS, surfaceDist, surfaceDistSq, wrapS } from '@core/ringMath';
import { Rng } from '@core/rng';
import type { Terrain } from '@gen/terrain';
import {
  BASE_ENERGY,
  canFactionFieldUnit,
  COMMAND_PER_NODE,
  DAMAGE_TABLE,
  DOMINANCE_PER_ALIGNED_PAIR_PER_SEC,
  Faction,
  FIRING_REVEAL_TIME,
  MATCH_TIME_LIMIT,
  other,
  STARTING_COMMAND,
  STARTING_SALVAGE,
  SPINAL_CAPTURE_ENDPOINT_EPSILON,
  SPINAL_CAPTURE_QUERY_RADIUS,
  SPINAL_CAPTURE_RADIUS,
  SPINAL_CAPTURE_RATE_PER_UNIT,
  SPINAL_CAPTURE_STRENGTH_CAP,
  STRUCTURES,
  UNITS,
  WEAPONS,
  WRECK_HP_MULTIPLIER,
  WRECK_LIFETIME,
  effectiveStructureStats,
  effectiveUnitStats,
  type StructureKind,
  type UnitKind,
  type WeaponDef,
} from './data';
import { ABILITIES, createAbilityState, type AbilityState } from './abilities';
import {
  directionalReachProfile,
  inertialToRing,
  isWithinDragAimEnvelope,
  launchToInertial,
  sampleTrajectory,
  solveAim,
  stepWithDrag,
  trajectoryImpact,
  type BallisticState,
  type DirectionalReachProfile,
  type RingPoint,
  type RingVelocity,
  type TrajectoryWork,
  type TrajectorySample,
} from './ballistics';
import { SurfaceNav, type NavDirection } from './nav';

const BALLISTIC_COEFFICIENT = 4000;
const WEAPON_POWER_PULSE_TICKS = Math.round(1 / SIM_DT);
const WRECK_COVER_MAX_DISTANCE = 260;
const WRECK_COVER_RADIUS_MULTIPLIER = 1.1;
const WRECK_COVER_HEIGHT_MULTIPLIER = 0.5;
const BALLISTIC_FAILURE_CACHE_LIMIT = 2_048;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type OrderKind = 'idle' | 'move' | 'attack' | 'attackMove' | 'build' | 'capture';

export interface Order {
  kind: OrderKind;
  s: number;
  z: number;
  targetId: number;
  /** For build orders. */
  structure?: StructureKind;
}

export interface Unit {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: UnitKind;
  s: number;
  z: number;
  prevS: number;
  prevZ: number;
  /** Facing; 0 is spinward. */
  yaw: number;
  prevYaw: number;
  /** Where the torso is aiming, tracked separately so legs and guns differ. */
  aimYaw: number;
  prevAimYaw: number;
  speed: number;
  hp: number;
  maxHp: number;
  vision: number;
  buildDuration: number;
  salvageCost: number;
  order: Order;
  /** Per-weapon cooldown timers. */
  cd: number[];
  /** Remaining shots in the current burst, per weapon. */
  burst: number[];
  burstTimer: number[];
  targetId: number;
  /** Seconds left of being visible to the enemy after firing. */
  revealed: number;
  /** Distance walked, drives the procedural gait phase in the renderer. */
  gait: number;
  /** Optional player aim command while directly piloting this unit. */
  manualAimYaw: number | null;
  /** Set while building; counts down the structure's build time. */
  buildTimer: number;
  buildTargetId: number;
  ability: AbilityState | null;
  cloaked: boolean;
  stationaryTime: number;
  damageState: 0 | 1 | 2;
  /** Recomputed from current state every tick; never multiplied in place. */
  speedMultiplier: number;
}

export interface Structure {
  id: number;
  alive: boolean;
  faction: Faction | -1;
  kind: StructureKind;
  s: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  vision: number;
  buildDuration: number;
  salvageCost: number;
  /** 0..1. Below 1 the structure is a construction site and does not function. */
  progress: number;
  cd: number[];
  burst: number[];
  burstTimer: number[];
  targetId: number;
  revealed: number;
  /** Production queue of unit kinds. */
  queue: UnitKind[];
  queueTimer: number;
  /** Capture progress for neutral nodes, -1..1 (negative = Compact). */
  capture: number;
}

export interface Projectile {
  id: number;
  alive: boolean;
  faction: Faction;
  /** Inertial-frame flight state; see ballistics.ts. */
  st: BallisticState;
  /** Cached ring-space position, refreshed each tick. */
  p: RingPoint;
  weapon: string;
  ballistic: boolean;
  flightMode: 'direct' | 'ballistic' | 'cruise' | 'chord';
  /** For direct fire, the entity being tracked. */
  targetId: number;
  life: number;
  /** Predicted impact, so the UI can telegraph it. */
  impactS: number;
  impactZ: number;
  /** Set by interceptors. */
  doomed: boolean;
  sourceS: number;
  sourceZ: number;
}

export interface Wreck {
  id: number;
  alive: boolean;
  faction: Faction;
  kind: UnitKind;
  s: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  lifetime: number;
}

export interface DamageSourceContext {
  s: number;
  z: number;
  projectileId?: number;
}

export interface Deposit {
  s: number;
  z: number;
  /** Remaining salvage. Finite, so the map forces expansion. */
  amount: number;
  claimedBy: number;
}

export interface SpinalPair {
  id: string;
  members: [number, number];
}

export type SimEventKind =
  | 'weaponFired'
  | 'impact'
  | 'unitDied'
  | 'structureDied'
  | 'structureComplete'
  | 'unitComplete'
  | 'intercepted'
  | 'footfall'
  | 'nodeCaptured'
  | 'nodeNeutralized'
  | 'alignmentStarted'
  | 'alignmentBroken'
  | 'damageStateChanged';

export interface SimEvent {
  kind: SimEventKind;
  s: number;
  z: number;
  h: number;
  faction: Faction | -1;
  /** Meaning depends on the event: blast scale, weapon id index, etc. */
  scale: number;
  id: number;
  weapon?: string;
  entityKind?: UnitKind | StructureKind;
  sourceFaction?: Faction;
  actorId?: number;
  projectileId?: number;
  pairId?: string;
}

export const DEPOSIT_PLACEMENT_RADIUS = 70;

export interface PlayerState {
  salvage: number;
  /** Command points spent on fielded mechs. */
  commandUsed: number;
  commandCap: number;
  energyProduced: number;
  energyDrawn: number;
  weaponEnergyLoad: number;
  weaponEnergySchedule: number[];
  dominance: number;
  /** Structures that exist, so the build bar can gate on prerequisites. */
  unlocked: Set<StructureKind>;
}

export type MatchStatus = 'running' | 'completed';

export interface WorldPlayerPersistenceState {
  salvage: number;
  commandUsed: number;
  commandCap: number;
  energyProduced: number;
  energyDrawn: number;
  /** One-second transient power draw from accepted weapon engagements. */
  weaponEnergyLoad: number;
  /** Ring buffer of pulse loads expiring on each future simulation tick. */
  weaponEnergySchedule: number[];
  dominance: number;
  unlocked: StructureKind[];
}

export interface WorldPersistenceState {
  worldSeed: number;
  terrainSeed: number;
  tick: number;
  time: number;
  rngState: number;
  nextId: number;
  timeLimit: number;
  victoryArmed: boolean;
  lastBastionAggressor: Faction | null;
  result: {
    status: MatchStatus;
    winner: Faction | null;
    endReason: string;
  };
  players: [WorldPlayerPersistenceState, WorldPlayerPersistenceState];
  units: Unit[];
  structures: Structure[];
  projectiles: Projectile[];
  deposits: Deposit[];
  wreckages: Wreck[];
  spinalPairs: SpinalPair[];
}

interface BallisticSource {
  ent: Unit | Structure;
  faction: Faction;
  s: number;
  z: number;
  isUnit: boolean;
  weapon: WeaponDef;
  weaponIndex: number;
}

interface BallisticPlan {
  from: RingPoint;
  velocity: { vt: number; vh: number; vz: number };
  flightTime: number;
  path: TrajectorySample[];
  flightMode: 'ballistic' | 'cruise' | 'chord';
}

export type BallisticFireReason =
  | 'match-ended'
  | 'invalid-source'
  | 'longbow-not-deployed'
  | 'longbow-transitioning'
  | 'reloading'
  | 'insufficient-power'
  | 'outside-sensor-range'
  | 'sensor-los-blocked'
  | 'no-ballistic-solution'
  | 'success';

interface BallisticFireDetails {
  remainingSeconds?: number;
  requiredPower?: number;
  availablePower?: number;
  sensorCoverage?: boolean;
  exactLineOfSight?: boolean;
  /** Normalized coordinates inspected by the authoritative command boundary. */
  targetS?: number;
  targetZ?: number;
  /** Projectile created by a successful authoritative fire command. */
  projectileId?: number;
}

export type BallisticFireResult = BallisticFireDetails & (
  | { ok: true; reason: 'success' }
  | { ok: false; reason: Exclude<BallisticFireReason, 'success'> }
);

export interface BallisticFireInspection {
  result: BallisticFireResult;
  trajectory: readonly TrajectorySample[] | null;
}

interface BallisticAssessment {
  result: BallisticFireResult;
  source: BallisticSource | null;
  plan: BallisticPlan | null;
}

type IndexedEntity = Unit | Structure | Wreck;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly nav: SurfaceNav;
  worldSeed: number;
  terrainSeed: number;

  units: Unit[] = [];
  structures: Structure[] = [];
  projectiles: Projectile[] = [];
  wreckages: Wreck[] = [];
  deposits: Deposit[] = [];
  spinalPairs: SpinalPair[] = [];

  players: Record<Faction, PlayerState>;

  time = 0;
  tick = 0;
  status: MatchStatus = 'running';
  /** The winner of a completed win, or null for a draw/running match. */
  winner: Faction | null = null;
  endReason = '';
  private victoryArmed = false;
  private lastBastionAggressor: Faction | null = null;

  /** Drained by the renderer and audio each frame. */
  events: SimEvent[] = [];

  private nextId = 1;
  /** Coarse spatial buckets, rebuilt each tick, to keep targeting linear-ish. */
  private static readonly BUCKET = 220;
  private readonly bucketCols = Math.floor(RING_CIRCUMFERENCE / World.BUCKET) + 1;
  private readonly bucketRows = Math.floor((RING_HALF_WIDTH * 2) / World.BUCKET) + 1;
  private readonly radiusOneBucketIndices = this.createRadiusOneBucketIndices();
  private readonly buckets: Array<number[] | undefined> = Array.from({
    length: this.bucketCols * this.bucketRows,
  });
  private readonly usedBuckets: number[] = [];
  private readonly nearbyCache: Array<number[] | undefined> = [];
  private readonly nearbyCacheGeneration: number[] = [];
  private readonly emptyNearby: readonly number[] = [];
  private bucketGeneration = 0;
  private bucketsDirty = true;
  private readonly entityBucketById = new Map<number, number>();
  /** Derived O(1) lookup index. Stable arrays remain authoritative and serialized. */
  private readonly entitiesById = new Map<number, IndexedEntity>();
  private readonly navDirection: NavDirection = { ds: 0, dz: 0, reachable: false };
  private readonly ballisticPlanningWork: TrajectoryWork = {
    trajectoryEvaluations: 0,
    integrationSteps: 0,
    fullTrajectoryBuilds: 0,
    storedTrajectorySamples: 0,
    failedPlanCacheHits: 0,
  };
  private readonly failedBallisticGeometry = new Map<string, true>();
  private readonly directionalReachProfiles = new Map<string, DirectionalReachProfile>();
  private visibilityTick = -1;
  private readonly visibleEntities: Record<Faction, Map<number, boolean>> = {
    [Faction.Compact]: new Map(),
    [Faction.Choir]: new Map(),
  };

  constructor(terrain: Terrain, seed: number, private timeLimit = MATCH_TIME_LIMIT) {
    validateSeed(seed, 'World seed');
    this.terrain = terrain;
    this.worldSeed = seed;
    this.terrainSeed = resolveTerrainSeed(terrain, seed);
    this.rng = new Rng(seed);
    this.nav = new SurfaceNav(terrain);
    this.players = {
      [Faction.Compact]: newPlayer(),
      [Faction.Choir]: newPlayer(),
    };
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /** Lay out the standard two-player match. */
  setup(): void {
    const C = RING_CIRCUMFERENCE;

    // Bases on opposite sides, so neither starts with the antispinward
    // artillery advantage over the other.
    this.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    this.spawnStructure(Faction.Choir, 'bastion', C * 0.5, 0, 1);

    for (let i = 0; i < 3; i++) {
      this.spawnUnit(Faction.Compact, 'engineer', wrapS(-60 + i * 30), 50);
      this.spawnUnit(Faction.Choir, 'engineer', wrapS(C * 0.5 - 60 + i * 30), -50);
    }

    // Neutral capture points at the quarter marks, plus two mid-field.
    const quarter = this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.25, 0, 1);
    const threeQuarter = this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.75, 0, 1);
    const upperRim = this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.125, RING_HALF_WIDTH * 0.6, 1);
    const lowerRim = this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.625, -RING_HALF_WIDTH * 0.6, 1);
    this.setSpinalPairs([
      { id: 'standard-axis', members: [quarter.id, threeQuarter.id] },
      { id: 'standard-rim', members: [upperRim.id, lowerRim.id] },
    ]);

    // Salvage deposits: a guaranteed pair near each base, the rest contested.
    const depositAt = (s: number, z: number, amount: number): void => {
      this.deposits.push({ s: wrapS(s), z, amount, claimedBy: 0 });
    };
    for (const base of [0, C * 0.5]) {
      depositAt(base + 190, 150, 9000);
      depositAt(base - 190, -150, 9000);
      depositAt(base + 40, -320, 7000);
    }
    for (let i = 0; i < 16; i++) {
      const s = this.rng.range(0, C);
      const z = this.rng.range(-RING_HALF_WIDTH * 0.8, RING_HALF_WIDTH * 0.8);
      // Keep the contested fields away from the starting bases.
      const d = Math.min(Math.abs(deltaS(0, s)), Math.abs(deltaS(C * 0.5, s)));
      if (d < 700) continue;
      depositAt(s, z, this.rng.range(4500, 11000));
    }

    this.recomputeCommandCaps();
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  spawnUnit(faction: Faction, kind: UnitKind, s: number, z: number): Unit {
    if (!canFactionFieldUnit(faction, kind)) {
      throw new Error(`${UNITS[kind].name} is not available to faction ${faction}`);
    }
    const def = UNITS[kind];
    const effective = effectiveUnitStats(faction, kind);
    const u: Unit = {
      id: this.nextId++,
      alive: true,
      faction,
      kind,
      s: wrapS(s),
      z: clampAxial(z),
      prevS: wrapS(s),
      prevZ: clampAxial(z),
      yaw: faction === Faction.Compact ? 0 : Math.PI,
      prevYaw: faction === Faction.Compact ? 0 : Math.PI,
      aimYaw: 0,
      prevAimYaw: 0,
      speed: 0,
      hp: effective.maxHp,
      maxHp: effective.maxHp,
      vision: effective.vision,
      buildDuration: effective.buildDuration,
      salvageCost: effective.salvageCost,
      order: { kind: 'idle', s: 0, z: 0, targetId: 0 },
      cd: def.weapons.map(() => 0),
      burst: def.weapons.map(() => 0),
      burstTimer: def.weapons.map(() => 0),
      targetId: 0,
      revealed: 0,
      gait: 0,
      manualAimYaw: null,
      buildTimer: 0,
      buildTargetId: 0,
      ability: createAbilityState(kind),
      cloaked: false,
      stationaryTime: 0,
      damageState: 0,
      speedMultiplier: 1,
    };
    this.units.push(u);
    this.entitiesById.set(u.id, u);
    this.bucketsDirty = true;
    this.clearVisibilityCache();
    if (def.cost.command) this.players[faction].commandUsed += def.cost.command;
    return u;
  }

  spawnStructure(
    faction: Faction | -1,
    kind: StructureKind,
    s: number,
    z: number,
    progress: number,
  ): Structure {
    const def = STRUCTURES[kind];
    const effective = effectiveStructureStats(faction, kind);
    const st: Structure = {
      id: this.nextId++,
      alive: true,
      faction,
      kind,
      s: wrapS(s),
      z: clampAxial(z),
      yaw: faction === Faction.Choir ? Math.PI : 0,
      hp: effective.maxHp * (progress < 1 ? 0.25 : 1),
      maxHp: effective.maxHp,
      vision: effective.vision,
      buildDuration: effective.buildDuration,
      salvageCost: effective.salvageCost,
      progress,
      cd: def.weapons.map(() => 0),
      burst: def.weapons.map(() => 0),
      burstTimer: def.weapons.map(() => 0),
      targetId: 0,
      revealed: 0,
      queue: [],
      queueTimer: 0,
      capture: kind === 'spinalNode' && faction >= 0
        ? faction === Faction.Compact ? -1 : 1
        : 0,
    };
    this.structures.push(st);
    this.entitiesById.set(st.id, st);
    this.bucketsDirty = true;
    this.clearVisibilityCache();
    if (faction >= 0 && progress >= 1) this.players[faction as Faction].unlocked.add(kind);
    if (kind === 'bastion') {
      const compact = this.structures.some(
        (structure) => structure.alive && structure.kind === 'bastion' && structure.faction === Faction.Compact,
      );
      const choir = this.structures.some(
        (structure) => structure.alive && structure.kind === 'bastion' && structure.faction === Faction.Choir,
      );
      this.victoryArmed ||= compact && choir;
    }
    return st;
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  unitById(id: number): Unit | undefined {
    const entity = this.entitiesById.get(id);
    return entity?.alive && 'order' in entity ? entity : undefined;
  }

  get ballisticWork(): Readonly<TrajectoryWork> {
    return this.ballisticPlanningWork;
  }

  structureById(id: number): Structure | undefined {
    const entity = this.entitiesById.get(id);
    return entity?.alive && 'progress' in entity ? entity : undefined;
  }

  wreckById(id: number): Wreck | undefined {
    const entity = this.entitiesById.get(id);
    return entity?.alive && !('order' in entity) && !('progress' in entity) ? entity : undefined;
  }

  /** Position of any entity, or null if it is gone. */
  positionOf(id: number): { s: number; z: number; h: number } | null {
    const u = this.unitById(id);
    if (u) return { s: u.s, z: u.z, h: this.terrain.heightAt(u.s, u.z) + UNITS[u.kind].height * 0.5 };
    const st = this.structureById(id);
    if (st) {
      return { s: st.s, z: st.z, h: this.terrain.heightAt(st.s, st.z) + STRUCTURES[st.kind].height * 0.4 };
    }
    const wreck = this.wreckById(id);
    if (wreck) {
      return {
        s: wreck.s,
        z: wreck.z,
        h: this.terrain.heightAt(wreck.s, wreck.z) + UNITS[wreck.kind].height * 0.25,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------------

  step(): void {
    if (this.status === 'completed') return;
    const dt = SIM_DT;
    for (const unit of this.units) {
      if (!unit.alive) continue;
      unit.prevS = unit.s;
      unit.prevZ = unit.z;
      unit.prevYaw = unit.yaw;
      unit.prevAimYaw = unit.aimYaw;
    }
    this.time += dt;
    this.tick++;

    this.rebuildBuckets();
    this.stepEconomy(dt);
    this.stepProduction(dt);
    this.stepUnits(dt);
    this.stepStructures(dt);
    this.stepProjectiles(dt);
    this.stepWrecks(dt);
    this.stepCapture(dt);
    this.stepCleanup();
    this.stepVictory();
  }

  // ---- Spatial index ------------------------------------------------------

  private bucketIndex(s: number, z: number): number {
    const bs = Math.floor(s / World.BUCKET);
    const bz = Math.floor((z + RING_HALF_WIDTH) / World.BUCKET);
    return bs * this.bucketRows + bz;
  }

  private rebuildBuckets(): void {
    if (!this.bucketsDirty && !this.hasEntityChangedBucket()) return;
    this.bucketGeneration++;
    for (const index of this.usedBuckets) this.buckets[index]!.length = 0;
    this.usedBuckets.length = 0;
    const add = (s: number, z: number, id: number): void => {
      const index = this.bucketIndex(s, z);
      let arr = this.buckets[index];
      if (!arr) {
        arr = [];
        this.buckets[index] = arr;
      }
      if (arr.length === 0) this.usedBuckets.push(index);
      arr.push(id);
      this.entityBucketById.set(id, index);
    };
    for (const u of this.units) if (u.alive) add(u.s, u.z, u.id);
    for (const s of this.structures) if (s.alive) add(s.s, s.z, s.id);
    for (const wreck of this.wreckages) if (wreck.alive) add(wreck.s, wreck.z, wreck.id);
    this.bucketsDirty = false;
  }

  private hasEntityChangedBucket(): boolean {
    for (const unit of this.units) {
      if (unit.alive && this.entityBucketById.get(unit.id) !== this.bucketIndex(unit.s, unit.z)) return true;
    }
    for (const structure of this.structures) {
      if (structure.alive && this.entityBucketById.get(structure.id) !== this.bucketIndex(structure.s, structure.z)) return true;
    }
    for (const wreck of this.wreckages) {
      if (wreck.alive && this.entityBucketById.get(wreck.id) !== this.bucketIndex(wreck.s, wreck.z)) return true;
    }
    return false;
  }

  /** Ids near a point. Approximate: returns everything in the 3x3 bucket block. */
  private nearby(s: number, z: number, radius: number): readonly number[] {
    const r = Math.ceil(radius / World.BUCKET);
    const bs = ((Math.floor(s / World.BUCKET) % this.bucketCols) + this.bucketCols) % this.bucketCols;
    const bz = Math.floor((z + RING_HALF_WIDTH) / World.BUCKET);
    if (bz < 0 || bz >= this.bucketRows) return this.emptyNearby;
    const bucketCount = this.bucketCols * this.bucketRows;
    const cacheKey = r * bucketCount + bs * this.bucketRows + bz;
    let cached = this.nearbyCache[cacheKey];
    if (this.nearbyCacheGeneration[cacheKey] === this.bucketGeneration) {
      return cached ?? this.emptyNearby;
    }
    if (!cached) {
      cached = [];
      this.nearbyCache[cacheKey] = cached;
    } else {
      cached.length = 0;
    }
    if (r === 1) {
      const offset = (bs * this.bucketRows + bz) * 9;
      for (let index = offset; index < offset + 9; index++) {
        const bucketIndex = this.radiusOneBucketIndices[index]!;
        if (bucketIndex < 0) continue;
        const arr = this.buckets[bucketIndex];
        if (arr) for (const id of arr) cached.push(id);
      }
    } else {
      for (let dz = -r; dz <= r; dz++) {
        const row = bz + dz;
        if (row < 0 || row >= this.bucketRows) continue;
        for (let ds = -r; ds <= r; ds++) {
          const col = (((bs + ds) % this.bucketCols) + this.bucketCols) % this.bucketCols;
          const arr = this.buckets[col * this.bucketRows + row];
          if (arr) for (const id of arr) cached.push(id);
        }
      }
    }
    this.nearbyCacheGeneration[cacheKey] = this.bucketGeneration;
    return cached;
  }

  private createRadiusOneBucketIndices(): Int32Array {
    const indices = new Int32Array(this.bucketCols * this.bucketRows * 9);
    indices.fill(-1);
    for (let col = 0; col < this.bucketCols; col++) {
      for (let row = 0; row < this.bucketRows; row++) {
        let offset = (col * this.bucketRows + row) * 9;
        for (let dz = -1; dz <= 1; dz++) {
          const neighborRow = row + dz;
          for (let ds = -1; ds <= 1; ds++) {
            if (neighborRow >= 0 && neighborRow < this.bucketRows) {
              const neighborCol = (col + ds + this.bucketCols) % this.bucketCols;
              indices[offset] = neighborCol * this.bucketRows + neighborRow;
            }
            offset++;
          }
        }
      }
    }
    return indices;
  }

  // ---- Economy ------------------------------------------------------------

  private stepEconomy(dt: number): void {
    for (const f of [Faction.Compact, Faction.Choir]) {
      const p = this.players[f];
      const expiryIndex = this.tick % WEAPON_POWER_PULSE_TICKS;
      p.weaponEnergyLoad = Math.max(0, p.weaponEnergyLoad - p.weaponEnergySchedule[expiryIndex]!);
      p.weaponEnergySchedule[expiryIndex] = 0;
      p.energyProduced = BASE_ENERGY;
      p.energyDrawn = p.weaponEnergyLoad;
    }

    for (const st of this.structures) {
      if (!st.alive || st.faction < 0 || st.progress < 1) continue;
      const def = STRUCTURES[st.kind];
      const p = this.players[st.faction as Faction];

      if (def.energy > 0) {
        // Solar output tracks the shadow squares exactly, using the same
        // function the renderer uses, so what the player sees is what they get.
        const mul = def.solar ? this.daylightAt(st.s) : 1;
        p.energyProduced += def.energy * mul;
      } else {
        p.energyDrawn += -def.energy;
      }

      if (def.salvageRate) {
        const dep = this.depositAt(st.s, st.z);
        if (dep && dep.amount > 0) {
          const rate = def.salvageRate * dt;
          const taken = Math.min(rate, dep.amount);
          dep.amount -= taken;
          p.salvage += taken;
        }
      }
    }

    for (const u of this.units) {
      if (!u.alive) continue;
      const def = UNITS[u.kind];
      if (def.upkeep) this.players[u.faction].energyDrawn += def.upkeep;
    }

    // Ability energy is rate draw, not a stockpile. Stable unit order decides
    // which active abilities remain admitted when production is oversubscribed.
    for (const u of this.units) {
      if (!u.alive || !u.ability?.active) continue;
      const rate = ABILITIES[u.ability.id].energyPerSecond;
      if (rate <= 0) continue;
      const player = this.players[u.faction];
      if (player.energyDrawn + rate <= player.energyProduced + 1e-9) {
        player.energyDrawn += rate;
      } else {
        this.deactivateUnitAbility(u, true);
      }
    }
  }

  /** Direct sunlight fraction at an arc position. Mirrors the render side. */
  daylightAt(s: number): number {
    const theta = (s / RING_CIRCUMFERENCE) * Math.PI * 2;
    return shadowFactorSim(theta, this.time);
  }

  /** 1 when power is sufficient, dropping toward 0 during a brownout.
   *  Weapons and radar degrade rather than switching off, which is far less
   *  frustrating than a hard cliff. */
  powerRatio(f: Faction): number {
    const p = this.players[f];
    if (p.energyDrawn <= p.energyProduced) return 1;
    return Math.max(0.3, p.energyProduced / Math.max(p.energyDrawn, 0.001));
  }

  activateAbility(unitId: number, active = true): boolean {
    if (this.status === 'completed') return false;
    const unit = this.unitById(unitId);
    if (!unit?.ability || unit.ability.id === 'cloak' || unit.ability.active === active) return false;
    if (!active) {
      this.deactivateUnitAbility(unit, false);
      return true;
    }
    if (unit.ability.cooldown > 0) return false;
    const def = ABILITIES[unit.ability.id];
    if (def.energyPerSecond > 0 && !this.hasAbilityPower(unit.faction, def.energyPerSecond)) return false;
    unit.ability.active = true;
    if (unit.ability.id === 'siegeMode') {
      unit.ability.transitionTimer = ABILITIES.siegeMode.transitionDuration;
      unit.speed = 0;
    }
    this.refreshSpeedMultiplier(unit);
    return true;
  }

  private hasAbilityPower(faction: Faction, additionalRate: number): boolean {
    const { produced, drawn } = this.instantaneousEnergy(faction);
    return drawn + additionalRate <= produced + 1e-9;
  }

  private instantaneousEnergy(faction: Faction): { produced: number; drawn: number } {
    let produced = BASE_ENERGY;
    let drawn = this.players[faction].weaponEnergyLoad;
    for (const structure of this.structures) {
      if (!structure.alive || structure.progress < 1 || structure.faction !== faction) continue;
      const def = STRUCTURES[structure.kind];
      if (def.energy > 0) produced += def.energy * (def.solar ? this.daylightAt(structure.s) : 1);
      else drawn += -def.energy;
    }
    for (const unit of this.units) {
      if (!unit.alive || unit.faction !== faction) continue;
      drawn += UNITS[unit.kind].upkeep ?? 0;
      if (unit.ability?.active) drawn += ABILITIES[unit.ability.id].energyPerSecond;
    }
    return { produced, drawn };
  }

  private hasWeaponPower(faction: Faction, weapon: WeaponDef): boolean {
    const cost = weapon.energyPerShot ?? 0;
    if (cost <= 0) return true;
    const { produced, drawn } = this.instantaneousEnergy(faction);
    return drawn + cost <= produced + 1e-9;
  }

  private weaponPowerStatus(faction: Faction, weapon: WeaponDef): { required: number; available: number } {
    const { produced, drawn } = this.instantaneousEnergy(faction);
    return {
      required: weapon.energyPerShot ?? 0,
      available: Math.max(0, produced - drawn),
    };
  }

  private consumeWeaponPower(faction: Faction, weapon: WeaponDef): boolean {
    const cost = weapon.energyPerShot ?? 0;
    if (cost <= 0) return true;
    const { produced, drawn } = this.instantaneousEnergy(faction);
    const player = this.players[faction];
    player.energyProduced = produced;
    player.energyDrawn = drawn;
    if (drawn + cost > produced + 1e-9) return false;
    player.weaponEnergyLoad += cost;
    player.weaponEnergySchedule[this.tick % WEAPON_POWER_PULSE_TICKS]! += cost;
    player.energyDrawn += cost;
    return true;
  }

  private deactivateUnitAbility(unit: Unit, forced: boolean): void {
    const ability = unit.ability;
    if (!ability?.active) return;
    ability.active = false;
    const def = ABILITIES[ability.id];
    if (forced || def.cooldownAfterDeactivation > 0) {
      ability.cooldown = Math.max(ability.cooldown, def.cooldownAfterDeactivation);
    }
    if (ability.id === 'siegeMode') {
      ability.transitionTimer = ABILITIES.siegeMode.transitionDuration;
      unit.speed = 0;
    }
    this.refreshSpeedMultiplier(unit);
  }

  depositAt(s: number, z: number): Deposit | undefined {
    for (const d of this.deposits) {
      if (surfaceDistSq(d.s, d.z, s, z) < DEPOSIT_PLACEMENT_RADIUS ** 2) return d;
    }
    return undefined;
  }

  isDepositAvailable(deposit: Deposit): boolean {
    if (deposit.amount <= 0) return false;
    if (deposit.claimedBy === 0) return true;
    return !this.structureById(deposit.claimedBy)?.alive;
  }

  /** Rebuild command capacity from authoritative completed structure state. */
  recomputeCommandCaps(): void {
    for (const f of [Faction.Compact, Faction.Choir]) {
      this.players[f].commandCap = STARTING_COMMAND;
    }
    for (const st of this.structures) {
      if (st.alive && st.progress >= 1 && st.kind === 'spinalNode' && st.faction >= 0) {
        this.players[st.faction as Faction].commandCap += COMMAND_PER_NODE;
      }
    }
  }

  setSpinalPairs(pairs: readonly SpinalPair[]): void {
    const canonical = pairs.map((pair) => ({
      id: validateSpinalPairId(pair.id),
      members: [...pair.members].sort((a, b) => a - b) as [number, number],
    })).sort((a, b) => a.id.localeCompare(b.id));
    const pairIds = new Set<string>();
    const memberIds = new Set<number>();
    for (const pair of canonical) {
      if (pairIds.has(pair.id)) throw new Error(`Duplicate Spinal pair id: ${pair.id}`);
      pairIds.add(pair.id);
      if (pair.members.length !== 2 || pair.members[0] === pair.members[1]) {
        throw new Error(`Spinal pair ${pair.id} must contain two distinct members`);
      }
      for (const memberId of pair.members) {
        if (!Number.isSafeInteger(memberId) || memberId <= 0) {
          throw new Error(`Spinal pair ${pair.id} has an invalid member id`);
        }
        if (memberIds.has(memberId)) throw new Error(`Spinal Node ${memberId} belongs to more than one pair`);
        const member = this.structureById(memberId);
        if (!member) throw new Error(`Spinal pair ${pair.id} references a missing or non-live member ${memberId}`);
        if (member.kind !== 'spinalNode') throw new Error(`Spinal pair ${pair.id} member ${memberId} is not a Spinal Node`);
        if (member.progress < 1) throw new Error(`Spinal pair ${pair.id} member ${memberId} is unfinished`);
        memberIds.add(memberId);
      }
    }
    this.spinalPairs = canonical;
  }

  spinalPairForNode(nodeId: number): SpinalPair | undefined {
    return this.spinalPairs.find((pair) => pair.members[0] === nodeId || pair.members[1] === nodeId);
  }

  spinalPairMate(nodeId: number): Structure | undefined {
    const pair = this.spinalPairForNode(nodeId);
    if (!pair) return undefined;
    return this.structureById(pair.members[0] === nodeId ? pair.members[1] : pair.members[0]);
  }

  spinalAlignmentOwner(pair: SpinalPair): Faction | null {
    const first = this.structureById(pair.members[0]);
    const second = this.structureById(pair.members[1]);
    if (!first || !second || first.kind !== 'spinalNode' || second.kind !== 'spinalNode' ||
        first.progress < 1 || second.progress < 1 || first.faction < 0 || first.faction !== second.faction) {
      return null;
    }
    return first.faction as Faction;
  }

  alignedPairCount(faction: Faction): number {
    return this.spinalPairs.reduce(
      (count, pair) => count + Number(this.spinalAlignmentOwner(pair) === faction),
      0,
    );
  }

  visibleAlignedPairCount(viewer: Faction): number {
    return this.spinalPairs.reduce((count, pair) => {
      const owner = this.spinalAlignmentOwner(pair);
      if (owner === null) return count;
      if (owner === viewer) return count + 1;
      return pair.members.every((id) => this.isEntityVisible(viewer, id)) ? count + 1 : count;
    }, 0);
  }

  // ---- Production ---------------------------------------------------------

  private stepProduction(dt: number): void {
    for (const st of this.structures) {
      if (!st.alive || st.faction < 0 || st.progress < 1 || st.queue.length === 0) continue;
      const kind = st.queue[0]!;
      const def = UNITS[kind];
      const effective = effectiveUnitStats(st.faction as Faction, kind);
      const player = this.players[st.faction as Faction];
      if ((def.cost.command ?? 0) + player.commandUsed > player.commandCap) continue;
      // Production slows during a brownout instead of stalling outright.
      st.queueTimer += dt * this.powerRatio(st.faction as Faction);
      if (st.queueTimer >= effective.buildDuration) {
        st.queue.shift();
        st.queueTimer = 0;
        const forward = STRUCTURES[st.kind].radius + 16;
        const lateral = ((this.nextId % 7) - 3) * (UNITS[kind].radius * 2.2);
        const outS = st.s + Math.cos(st.yaw) * forward - Math.sin(st.yaw) * lateral;
        const outZ = st.z + Math.sin(st.yaw) * forward + Math.cos(st.yaw) * lateral;
        const unit = this.spawnUnit(st.faction as Faction, kind, outS, clampAxial(outZ));
        this.emit('unitComplete', outS, clampAxial(outZ), 0, st.faction, 1, unit.id, undefined, kind);
      }
    }
  }

  /** Queue a unit if it can be afforded. Returns false if it cannot. */
  tryQueueUnit(structureId: number, kind: UnitKind): boolean {
    if (this.status === 'completed') return false;
    const st = this.structureById(structureId);
    if (!st || st.faction < 0 || st.progress < 1) return false;
    if (!STRUCTURES[st.kind].produces?.includes(kind)) return false;
    const f = st.faction as Faction;
    if (!canFactionFieldUnit(f, kind)) return false;
    const p = this.players[f];
    const def = UNITS[kind];
    const cost = effectiveUnitStats(f, kind).salvageCost;
    if (p.salvage < cost) return false;
    if (def.cost.command && p.commandUsed + this.queuedCommand(f) + def.cost.command > p.commandCap) return false;
    p.salvage -= cost;
    st.queue.push(kind);
    return true;
  }

  /** Place a construction site. Returns the structure, or null if invalid. */
  tryPlaceStructure(f: Faction, kind: StructureKind, s: number, z: number): Structure | null {
    if (this.status === 'completed') return null;
    const def = STRUCTURES[kind];
    const p = this.players[f];
    const cost = effectiveStructureStats(f, kind).salvageCost;
    if (def.neutral) return null;
    if (p.salvage < cost) return null;
    if (!this.canPlace(f, kind, s, z)) return null;
    p.salvage -= cost;
    const st = this.spawnStructure(f, kind, s, z, 0);
    if (def.needsDeposit) {
      const d = this.depositAt(s, z);
      if (d) d.claimedBy = st.id;
    }
    return st;
  }

  canPlace(f: Faction, kind: StructureKind, s: number, z: number): boolean {
    if (this.status === 'completed') return false;
    const def = STRUCTURES[kind];
    if (def.requires && !this.players[f].unlocked.has(def.requires)) return false;
    if (!this.terrain.isBuildable(s, z)) return false;
    if (def.needsDeposit) {
      const d = this.depositAt(s, z);
      if (!d || !this.isDepositAvailable(d)) return false;
    }
    // No overlapping footprints.
    for (const o of this.structures) {
      if (!o.alive) continue;
      const min = def.radius + STRUCTURES[o.kind].radius + 6;
      if (surfaceDist(o.s, o.z, s, z) < min) return false;
    }
    // Must be within reach of something you already own, so bases grow rather
    // than teleporting across the map.
    let anchored = false;
    for (const o of this.structures) {
      if (o.alive && o.progress >= 1 && o.faction === f && surfaceDist(o.s, o.z, s, z) < 420) {
        anchored = true;
        break;
      }
    }
    return anchored;
  }

  /** Command points already committed to production queues. */
  queuedCommand(faction: Faction): number {
    let total = 0;
    for (const structure of this.structures) {
      if (!structure.alive || structure.faction !== faction) continue;
      for (const kind of structure.queue) total += UNITS[kind].cost.command ?? 0;
    }
    return total;
  }

  // ---- Units --------------------------------------------------------------

  private stepUnits(dt: number): void {
    for (const u of this.units) {
      if (!u.alive) continue;
      const def = UNITS[u.kind];
      u.revealed = Math.max(0, u.revealed - dt);
      if (u.ability) {
        u.ability.cooldown = Math.max(0, u.ability.cooldown - dt);
        const wasTransitioning = u.ability.transitionTimer > 0;
        const remainingTransition = u.ability.transitionTimer - dt;
        u.ability.transitionTimer = remainingTransition <= 1e-9 ? 0 : remainingTransition;
        if (wasTransitioning && u.ability.transitionTimer === 0 && u.ability.id === 'siegeMode') {
          this.refreshSpeedMultiplier(u);
        }
      }
      this.updateDamageState(u);

      for (let i = 0; i < def.weapons.length; i++) {
        const weapon = WEAPONS[def.weapons[i]!]!;
        if (weapon.kind === 'interceptor') {
          u.cd[i] = Math.max(0, u.cd[i]! - dt);
          this.runInterceptor(u, weapon, i, u.faction, u.s, u.z);
        }
      }

      // --- Construction ----------------------------------------------------
      if (u.order.kind === 'build' && u.buildTargetId) {
        const site = this.structureById(u.buildTargetId);
        if (!site || site.progress >= 1) {
          u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          u.buildTargetId = 0;
        } else if (
          surfaceDistSq(u.s, u.z, site.s, site.z) < (STRUCTURES[site.kind].radius + 24) ** 2
        ) {
          site.progress = Math.min(1, site.progress + dt / site.buildDuration);
          site.hp = site.maxHp * (0.25 + 0.75 * site.progress);
          if (site.progress >= 1) {
            this.players[site.faction as Faction].unlocked.add(site.kind);
            this.recomputeCommandCaps();
            this.emit('structureComplete', site.s, site.z, 0, site.faction, 1, site.id, undefined, site.kind);
            u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
            u.buildTargetId = 0;
          }
          this.faceToward(u, site.s, site.z, dt, def.turnRate);
          u.speed = 0;
          continue;
        } else {
          this.moveToward(u, site.s, site.z, dt, def);
          continue;
        }
      }

      // --- Target acquisition ----------------------------------------------
      if (def.weapons.length > 0) {
        const maxRange = this.bestRange(def.weapons, u);
        const ballisticOnly = def.weapons.every((weaponId) => WEAPONS[weaponId]?.kind === 'ballistic');
        const canAutoAcquire = !ballisticOnly || u.order.kind === 'attack' || u.order.kind === 'attackMove';
        if (!canAutoAcquire) {
          // Ballistic-only units reserve idle shots for explicit ground commands.
          u.targetId = 0;
        } else if (u.order.kind === 'attack' && u.order.targetId) {
          if (this.isValidTarget(u.faction, u.order.targetId, u.s, u.z, maxRange)) {
            u.targetId = u.order.targetId;
          } else {
            u.targetId = 0;
            u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          }
        } else if (!u.targetId || !this.isValidTarget(u.faction, u.targetId, u.s, u.z, maxRange)) {
          u.targetId = this.findTarget(u.faction, u.s, u.z, maxRange, u.kind);
        }
      }

      // --- Movement ---------------------------------------------------------
      const tgt = u.targetId ? this.positionOf(u.targetId) : null;
      let moved = false;
      const immobilized = this.isSiegeImmobilized(u);

      if (immobilized) {
        u.speed = 0;
      } else if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
        const d = surfaceDist(u.s, u.z, u.order.s, u.order.z);
        if (d < 14) {
          u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          u.speed = 0;
        } else {
          // On attack-move, stop to shoot anything in range.
          const engaged =
            u.order.kind === 'attackMove' && tgt !== null &&
            this.canEngageTarget(u, def.weapons, tgt, 0.85);
          if (!engaged) {
            this.moveToward(u, u.order.s, u.order.z, dt, def);
            moved = true;
          }
        }
      } else if (u.order.kind === 'attack' && tgt) {
        // Ballistic reach is directional on the ring. A nominal-range check can
        // park artillery in geometry where no trajectory exists, retrying the
        // expensive solver forever. Keep closing until at least one weapon can
        // actually engage from this position.
        if (!this.canEngageTarget(u, def.weapons, tgt, 0.8)) {
          this.moveToward(u, tgt.s, tgt.z, dt, def);
          moved = true;
        }
      }
      if (!moved) u.speed = Math.max(0, u.speed - dt * 40);

      // --- Aim and fire ------------------------------------------------------
      if (tgt) {
        const ds = deltaS(u.s, tgt.s);
        const dz = tgt.z - u.z;
        const want = Math.atan2(dz, ds);
        u.aimYaw = turnToward(u.aimYaw, want, def.turnRate * 1.9 * dt);
        if (!moved && !immobilized) this.faceToward(u, tgt.s, tgt.z, dt, def.turnRate);
        this.fireWeapons(u, def.weapons, tgt, dt, u.faction, u.s, u.z, true);
      } else {
        for (let i = 0; i < u.cd.length; i++) {
          if (WEAPONS[def.weapons[i]!]!.kind !== 'interceptor') {
            u.cd[i] = Math.max(0, u.cd[i]! - dt);
          }
        }
        u.aimYaw = turnToward(u.aimYaw, u.manualAimYaw ?? u.yaw, def.turnRate * dt);
      }

      u.gait += u.speed * dt;
      this.updateCloak(u, dt);
    }

    this.separateUnits(dt);
    for (const unit of this.units) {
      if (!unit.alive || unit.ability?.id !== 'cloak') continue;
      if (surfaceDist(unit.prevS, unit.prevZ, unit.s, unit.z) > 1e-6) this.breakCloak(unit);
    }
  }

  private bestRange(weapons: string[], ent?: Unit | Structure): number {
    let r = 0;
    for (const w of weapons) {
      if (WEAPONS[w]!.kind !== 'interceptor') {
        r = Math.max(r, this.weaponRange(ent, WEAPONS[w]!));
      }
    }
    return r || 60;
  }

  private canEngageTarget(
    ent: Unit | Structure,
    weapons: readonly string[],
    target: { s: number; z: number },
    rangeScale: number,
  ): boolean {
    const distanceSquared = surfaceDistSq(ent.s, ent.z, target.s, target.z);
    for (const weaponId of weapons) {
      const weapon = WEAPONS[weaponId]!;
      if (weapon.kind === 'interceptor') continue;
      const range = this.weaponRange(ent, weapon) * rangeScale;
      if (distanceSquared > range * range) continue;
      if (
        weapon.kind !== 'ballistic' ||
        this.isBallisticTargetWithinReachEnvelope(
          ent.id,
          target.s,
          target.z,
          ent.faction as Faction,
          weaponId,
        )
      ) return true;
    }
    return false;
  }

  effectiveWeaponRange(entityId: number, weaponId: string): number {
    const ent = this.unitById(entityId) ?? this.structureById(entityId);
    const weapon = WEAPONS[weaponId];
    if (!ent || !weapon) return 0;
    return this.weaponRange(ent, weapon);
  }

  effectiveWeaponCooldown(entityId: number, weaponId: string): number {
    const ent = this.unitById(entityId) ?? this.structureById(entityId);
    const weapon = WEAPONS[weaponId];
    if (!ent || !weapon) return 0;
    return this.weaponCooldown(ent, weapon);
  }

  private weaponRange(ent: Unit | Structure | undefined, weapon: WeaponDef): number {
    return ent && 'ability' in ent && ent.ability?.id === 'siegeMode' && ent.ability.active
      ? weapon.range * ABILITIES.siegeMode.rangeMultiplier
      : weapon.range;
  }

  private weaponCooldown(ent: Unit | Structure, weapon: WeaponDef): number {
    return 'ability' in ent && ent.ability?.id === 'siegeMode' && ent.ability.active
      ? weapon.cooldown / ABILITIES.siegeMode.fireRateMultiplier
      : weapon.cooldown;
  }

  private moveToward(u: Unit, ts: number, tz: number, dt: number, def: (typeof UNITS)[UnitKind]): void {
    const ds = deltaS(u.s, ts);
    const dz = tz - u.z;
    const d = Math.hypot(ds, dz) || 1e-6;
    const nav = this.nav.directionAt(u.s, u.z, ts, tz, this.navDirection);
    const want = Math.atan2(nav.dz, nav.ds);
    u.yaw = turnToward(u.yaw, want, def.turnRate * dt);

    // Only move at full speed once roughly facing the right way; heavy mechs
    // therefore arc around rather than pivoting on the spot, which reads as
    // weight without any extra animation.
    const align = Math.max(0, Math.cos(angleDelta(u.yaw, want)));
    const slope = this.terrain.slopeAt(u.s, u.z);
    const slowdown = 1 / (1 + slope * 2.4);
    const target = nav.reachable ? def.speed * u.speedMultiplier * align * slowdown : 0;
    u.speed += (target - u.speed) * Math.min(1, dt * 3.5);

    const step = Math.min(u.speed * dt, d);
    const nextS = wrapS(u.s + Math.cos(u.yaw) * step);
    const nextZ = clampAxial(u.z + Math.sin(u.yaw) * step);
    if (this.nav.segmentPassable(u.s, u.z, nextS, nextZ)) {
      u.s = nextS;
      u.z = nextZ;
      if (step > 1e-6) this.breakCloak(u);
    } else {
      u.speed = 0;
    }
  }

  private faceToward(u: Unit, ts: number, tz: number, dt: number, rate: number): void {
    const want = Math.atan2(tz - u.z, deltaS(u.s, ts));
    u.yaw = turnToward(u.yaw, want, rate * dt);
  }

  /** Push overlapping units apart so they do not stack into one pile. */
  private separateUnits(dt: number): void {
    for (const a of this.units) {
      if (!a.alive) continue;
      const ra = UNITS[a.kind].radius;
      const near = this.nearby(a.s, a.z, 40);
      for (const id of near) {
        if (id <= a.id) continue;
        const entity = this.entitiesById.get(id);
        if (!entity?.alive || !('order' in entity)) continue;
        const b = entity;
        const rb = UNITS[b.kind].radius;
        const min = ra + rb;
        const ds = deltaS(a.s, b.s);
        const dz = b.z - a.z;
        const d = Math.hypot(ds, dz);
        if (d > min) continue;
        if (d < 1e-4) {
          const angle = ((a.id * 73856093 + b.id * 19349663) >>> 0) * (Math.PI * 2 / 0xffffffff);
          const push = min * 0.08 * Math.min(1, dt * 14);
          const ps = Math.cos(angle) * push;
          const pz = Math.sin(angle) * push;
          a.s = wrapS(a.s - ps);
          a.z = clampAxial(a.z - pz);
          b.s = wrapS(b.s + ps);
          b.z = clampAxial(b.z + pz);
          continue;
        }
        const push = ((min - d) / d) * 0.5 * Math.min(1, dt * 14);
        a.s = wrapS(a.s - ds * push);
        a.z = clampAxial(a.z - dz * push);
        b.s = wrapS(b.s + ds * push);
        b.z = clampAxial(b.z + dz * push);
      }
    }
  }

  // ---- Targeting ----------------------------------------------------------

  private isValidTarget(f: Faction, id: number, s: number, z: number, range: number): boolean {
    const target = this.entitiesById.get(id);
    if (!target?.alive || target.faction === f || target.faction < 0) return false;
    return surfaceDistSq(s, z, target.s, target.z) <= range * range && this.isEntityVisible(f, id);
  }

  /** Nearest enemy in range. Prefers units over buildings. */
  private findTarget(f: Faction, s: number, z: number, range: number, attackerKind?: UnitKind): number {
    const near = this.nearby(s, z, range);
    let best = 0;
    let bestScore = Infinity;
    for (const id of near) {
      const entity = this.entitiesById.get(id);
      if (!entity?.alive || entity.faction === f || entity.faction < 0) continue;
      const d = surfaceDist(s, z, entity.s, entity.z);
      if (d > range || !this.isEntityVisible(f, id)) continue;
      // Buildings are shot only once nothing living is in reach.
      let score = d + ('order' in entity ? 0 : 'progress' in entity ? range * 0.9 : range * 1.2);
      if (attackerKind === 'needle' && 'order' in entity) {
        if (entity.kind === 'engineer') score -= range * 0.9;
        else if (entity.kind === 'longbow') score -= range * 0.7;
        else if (entity.kind === 'wisp') score -= range * 0.6;
      }
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  // ---- Firing -------------------------------------------------------------

  previewBallistic(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): TrajectorySample[] | null {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    if (this.status === 'completed') return null;
    const source = this.ballisticSource(sourceId, faction, weaponId);
    if (!source) return null;
    const sensor = this.sensorStatusAt(faction, targetS, targetZ);
    if (source.weapon.flightMode !== 'chord' && !sensor.nominal) return null;
    return this.planBallistic(source, targetS, targetZ)?.path ?? null;
  }

  inspectBallisticCommand(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): BallisticFireInspection {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    const assessment = this.assessBallisticCommand(sourceId, targetS, targetZ, faction, weaponId);
    let plan = assessment.plan;
    if (
      !plan && assessment.source &&
      assessment.result.reason !== 'outside-sensor-range' &&
      assessment.result.reason !== 'no-ballistic-solution' &&
      (assessment.source.weapon.flightMode === 'chord' || assessment.result.sensorCoverage === true)
    ) {
      plan = this.planBallistic(assessment.source, targetS, targetZ);
    }
    return {
      result: withBallisticTarget(assessment.result, targetS, targetZ),
      trajectory: plan?.path ?? null,
    };
  }

  /** Dynamic command authority without trajectory integration. */
  preflightBallisticCommand(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): BallisticFireResult {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    const assessment = this.assessBallisticCommand(
      sourceId,
      targetS,
      targetZ,
      faction,
      weaponId,
      false,
      true,
    );
    return withBallisticTarget(assessment.result, targetS, targetZ);
  }

  queryBallisticCommand(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): BallisticFireResult {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    return withBallisticTarget(
      this.assessBallisticCommand(sourceId, targetS, targetZ, faction, weaponId).result,
      targetS,
      targetZ,
    );
  }

  /** Capability check used by player-facing ground-target commands. */
  canCommandBallistic(sourceId: number, faction: Faction, weaponId?: string): boolean {
    const source = this.ballisticSource(sourceId, faction, weaponId);
    return source !== null && this.canCommandBallisticSource(source);
  }

  private canCommandBallisticSource(source: BallisticSource): boolean {
    if (!source.isUnit) return true;
    const unit = source.ent as Unit;
    return unit.kind === 'longbow' &&
      unit.ability?.id === 'siegeMode' && unit.ability.active && unit.ability.transitionTimer === 0;
  }

  /** Cached level-ground envelope for UI only; live targeting remains authoritative. */
  directionalBallisticReach(
    sourceId: number,
    faction: Faction,
    weaponId?: string,
  ): DirectionalReachProfile | null {
    const source = this.ballisticSource(sourceId, faction, weaponId);
    if (!source || source.weapon.flightMode === 'cruise' || source.weapon.flightMode === 'chord') return null;
    const muzzleHeight = source.isUnit
      ? UNITS[(source.ent as Unit).kind].height * 0.62
      : STRUCTURES[(source.ent as Structure).kind].height * 0.7;
    const speed = source.weapon.launchSpeed ?? 120;
    const key = `${source.weapon.id}:${speed}:${muzzleHeight}`;
    const cached = this.directionalReachProfiles.get(key);
    if (cached) return cached;
    const profile = directionalReachProfile({ s: 0, h: muzzleHeight, z: 0 }, speed);
    this.directionalReachProfiles.set(key, profile);
    return profile;
  }

  private isSiegeImmobilized(unit: Unit): boolean {
    return unit.ability?.id === 'siegeMode' && (unit.ability.active || unit.ability.transitionTimer > 0);
  }

  private refreshSpeedMultiplier(unit: Unit): void {
    let multiplier = unit.damageState === 2 ? 0.8 : 1;
    if (unit.ability?.id === 'shieldWall' && unit.ability.active) {
      multiplier *= ABILITIES.shieldWall.speedMultiplier;
    }
    if (this.isSiegeImmobilized(unit)) multiplier = 0;
    unit.speedMultiplier = multiplier;
  }

  private updateDamageState(unit: Unit): void {
    if (!UNITS[unit.kind].isMech) return;
    const ratio = unit.hp / Math.max(1, unit.maxHp);
    const next: 0 | 1 | 2 = ratio < 0.33 ? 2 : ratio < 0.66 ? 1 : 0;
    if (next === unit.damageState) return;
    unit.damageState = next;
    this.refreshSpeedMultiplier(unit);
    this.emit('damageStateChanged', unit.s, unit.z, 0, unit.faction, next, unit.id);
  }

  private updateCloak(unit: Unit, dt: number): void {
    if (unit.ability?.id !== 'cloak') return;
    if (unit.speed > 0.05) {
      this.breakCloak(unit);
      return;
    }
    unit.stationaryTime += dt;
    if (unit.stationaryTime + 1e-9 >= ABILITIES.cloak.stationaryDelay) {
      if (unit.cloaked && unit.ability.active) return;
      unit.ability.active = true;
      unit.cloaked = true;
      this.clearVisibilityCache();
    }
  }

  private breakCloak(unit: Unit): void {
    if (unit.ability?.id !== 'cloak') return;
    unit.stationaryTime = 0;
    if (!unit.cloaked && !unit.ability.active) return;
    unit.cloaked = false;
    unit.ability.active = false;
    unit.revealed = Math.max(unit.revealed, ABILITIES.cloak.breakRevealTime);
    this.clearVisibilityCache();
  }

  fireBallisticCommand(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): BallisticFireResult {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    return this.fireBallisticCommandNormalized(sourceId, targetS, targetZ, faction, weaponId);
  }

  private fireBallisticCommandNormalized(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): BallisticFireResult {
    const assessment = this.assessBallisticCommand(sourceId, targetS, targetZ, faction, weaponId, true);
    if (!assessment.result.ok || !assessment.source) {
      return withBallisticTarget(assessment.result, targetS, targetZ);
    }
    const source = assessment.source;
    let plan = assessment.plan;
    const blindChord = source.weapon.flightMode === 'chord' && !assessment.result.exactLineOfSight;
    const spread = blindChord ? 80 : 0;
    const rngState = spread > 0 ? this.rng.snapshot() : null;
    const actualS = spread > 0 ? wrapS(targetS + this.rng.gaussian() * spread) : targetS;
    const actualZ = spread > 0 ? clampAxial(targetZ + this.rng.gaussian() * spread) : targetZ;
    if (spread > 0) {
      plan = this.planBallistic(source, actualS, actualZ);
      if (!plan) {
        this.rng.restore(rngState!);
        return withBallisticTarget({
          ok: false,
          reason: 'no-ballistic-solution',
          sensorCoverage: assessment.result.sensorCoverage,
          exactLineOfSight: assessment.result.exactLineOfSight,
        }, targetS, targetZ);
      }
    }
    if (!plan) {
      return withBallisticTarget({ ok: false, reason: 'no-ballistic-solution' }, targetS, targetZ);
    }
    if (!this.consumeWeaponPower(faction, source.weapon)) {
      if (rngState !== null) this.rng.restore(rngState);
      const power = this.weaponPowerStatus(faction, source.weapon);
      return withBallisticTarget({
        ok: false,
        reason: 'insufficient-power',
        requiredPower: power.required,
        availablePower: power.available,
        sensorCoverage: assessment.result.sensorCoverage,
        exactLineOfSight: assessment.result.exactLineOfSight,
      }, targetS, targetZ);
    }

    source.ent.cd[source.weaponIndex] =
      this.weaponCooldown(source.ent, source.weapon) / Math.max(0.35, this.powerRatio(faction));
    const projectileId = this.commitBallistic(source, plan);
    return withBallisticTarget({ ...assessment.result, projectileId }, targetS, targetZ);
  }

  fireBallisticAt(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): boolean {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    return this.fireBallisticCommandNormalized(sourceId, targetS, targetZ, faction, weaponId).ok;
  }

  private assessBallisticCommand(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
    deferBlindChordPlan = false,
    skipPlan = false,
  ): BallisticAssessment {
    if (this.status === 'completed') {
      return { result: { ok: false, reason: 'match-ended' }, source: null, plan: null };
    }
    const source = this.ballisticSource(sourceId, faction, weaponId);
    if (!source) {
      return { result: { ok: false, reason: 'invalid-source' }, source: null, plan: null };
    }
    const sensor = this.sensorStatusAt(faction, targetS, targetZ);
    const sensorDetails = {
      sensorCoverage: sensor.nominal,
      exactLineOfSight: sensor.exactLineOfSight,
    };
    if (source.isUnit && (source.ent as Unit).kind === 'longbow') {
      const ability = (source.ent as Unit).ability;
      if ((ability?.transitionTimer ?? 0) > 0) {
        return {
          result: {
            ok: false,
            reason: 'longbow-transitioning',
            remainingSeconds: ability!.transitionTimer,
            ...sensorDetails,
          },
          source,
          plan: null,
        };
      }
      if (!ability?.active) {
        return {
          result: { ok: false, reason: 'longbow-not-deployed', ...sensorDetails },
          source,
          plan: null,
        };
      }
    }
    const cooldown = source.ent.cd[source.weaponIndex] ?? 0;
    if (cooldown > 0) {
      return {
        result: { ok: false, reason: 'reloading', remainingSeconds: cooldown, ...sensorDetails },
        source,
        plan: null,
      };
    }
    const power = this.weaponPowerStatus(faction, source.weapon);
    if (power.available + 1e-9 < power.required) {
      return {
        result: {
          ok: false,
          reason: 'insufficient-power',
          requiredPower: power.required,
          availablePower: power.available,
          ...sensorDetails,
        },
        source,
        plan: null,
      };
    }
    if (source.weapon.flightMode !== 'chord') {
      if (!sensor.nominal) {
        return {
          result: { ok: false, reason: 'outside-sensor-range', ...sensorDetails },
          source,
          plan: null,
        };
      }
      if (!sensor.exactLineOfSight) {
        return {
          result: { ok: false, reason: 'sensor-los-blocked', ...sensorDetails },
          source,
          plan: null,
        };
      }
    }
    if (deferBlindChordPlan && source.weapon.flightMode === 'chord' && !sensor.exactLineOfSight) {
      return {
        result: { ok: true, reason: 'success', ...sensorDetails },
        source,
        plan: null,
      };
    }
    if (skipPlan) {
      return {
        result: { ok: true, reason: 'success', ...sensorDetails },
        source,
        plan: null,
      };
    }
    const plan = this.planBallistic(source, targetS, targetZ);
    if (!plan) {
      return {
        result: { ok: false, reason: 'no-ballistic-solution', ...sensorDetails },
        source,
        plan: null,
      };
    }
    return {
      result: { ok: true, reason: 'success', ...sensorDetails },
      source,
      plan,
    };
  }

  isBallisticTargetWithinReachEnvelope(
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weaponId?: string,
  ): boolean {
    ({ targetS, targetZ } = normalizeBallisticTarget(targetS, targetZ));
    const source = this.ballisticSource(sourceId, faction, weaponId);
    if (!source || source.weapon.flightMode === 'cruise' || source.weapon.flightMode === 'chord') {
      return source !== null;
    }
    const groundH = this.terrain.heightAt(source.s, source.z);
    const sourceHeight = source.isUnit
      ? UNITS[(source.ent as Unit).kind].height
      : STRUCTURES[(source.ent as Structure).kind].height;
    const from: RingPoint = {
      s: source.s,
      h: groundH + sourceHeight * (source.isUnit ? 0.62 : 0.7),
      z: source.z,
    };
    const to: RingPoint = { s: targetS, h: this.terrain.heightAt(targetS, targetZ), z: targetZ };
    return isWithinDragAimEnvelope(
      from,
      to,
      this.time,
      source.weapon.launchSpeed ?? 120,
      60,
    );
  }

  private ballisticSource(sourceId: number, faction: Faction, weaponId?: string): BallisticSource | null {
    const unit = this.unitById(sourceId);
    const structure = unit ? undefined : this.structureById(sourceId);
    const ent = unit ?? structure;
    if (!ent || ent.faction !== faction || (structure && structure.progress < 1)) return null;
    const weapons = unit ? UNITS[unit.kind].weapons : STRUCTURES[structure!.kind].weapons;
    const weaponIndex = weaponId
      ? weapons.findIndex((id) => id === weaponId && WEAPONS[id]!.kind === 'ballistic')
      : weapons.findIndex((id) => WEAPONS[id]!.kind === 'ballistic');
    if (weaponIndex < 0) return null;
    const weapon = WEAPONS[weapons[weaponIndex]!]!;
    if (weapon.flightMode === 'chord' && structure?.kind !== 'silo') return null;
    return {
      ent,
      faction,
      s: ent.s,
      z: ent.z,
      isUnit: Boolean(unit),
      weapon,
      weaponIndex,
    };
  }

  private planBallistic(source: BallisticSource, targetS: number, targetZ: number): BallisticPlan | null {
    const groundH = this.terrain.heightAt(source.s, source.z);
    const sourceHeight = source.isUnit
      ? UNITS[(source.ent as Unit).kind].height
      : STRUCTURES[(source.ent as Structure).kind].height;
    const from: RingPoint = {
      s: source.s,
      h: groundH + sourceHeight * (source.isUnit ? 0.62 : 0.7),
      z: source.z,
    };
    if (source.weapon.flightMode === 'cruise') {
      return this.planCruise(source.weapon, from, targetS, targetZ);
    }
    if (source.weapon.flightMode === 'chord') {
      return this.planChord(source.weapon, from, targetS, targetZ);
    }
    const to: RingPoint = {
      s: targetS,
      h: this.terrain.heightAt(targetS, targetZ),
      z: targetZ,
    };
    const failureKey = this.ballisticFailureKey(source, to);
    if (this.failedBallisticGeometry.has(failureKey)) {
      this.ballisticPlanningWork.failedPlanCacheHits++;
      return null;
    }
    const solution = solveAim(from, to, this.time, {
      speed: source.weapon.launchSpeed ?? 120,
      lofted: true,
      maxFlightTime: 60,
      groundAt: (s, z) => this.terrain.heightAt(s, z),
      ballisticCoefficient: BALLISTIC_COEFFICIENT,
      work: this.ballisticPlanningWork,
    });
    if (!solution) {
      if (this.failedBallisticGeometry.size >= BALLISTIC_FAILURE_CACHE_LIMIT) {
        const oldest = this.failedBallisticGeometry.keys().next().value;
        if (oldest !== undefined) this.failedBallisticGeometry.delete(oldest);
      }
      this.failedBallisticGeometry.set(failureKey, true);
      return null;
    }
    const path = solution.path ?? sampleTrajectory(from, solution.velocity, this.time, {
      maxTime: solution.flightTime + 8,
      dt: SIM_DT,
      ballisticCoefficient: BALLISTIC_COEFFICIENT,
      groundAt: (s, z) => this.terrain.heightAt(s, z),
      stopOnImpact: true,
      work: this.ballisticPlanningWork,
    });
    return {
      from,
      velocity: solution.velocity,
      flightTime: solution.flightTime,
      path,
      flightMode: 'ballistic',
    };
  }

  private ballisticFailureKey(source: BallisticSource, target: RingPoint): string {
    // Rotating-frame dynamics and static terrain are time invariant for identical
    // absolute endpoints. Exact coordinates avoid changing moving-target decisions.
    return `${source.ent.id}:${source.weapon.id}:${source.s}:${source.z}:${target.s}:${target.h}:${target.z}`;
  }

  private planChord(
    weapon: WeaponDef,
    from: RingPoint,
    targetS: number,
    targetZ: number,
  ): BallisticPlan | null {
    const desiredS = targetS;
    const desiredZ = targetZ;
    let aimS = desiredS;
    let aimZ = desiredZ;
    let finalVelocity: RingVelocity | null = null;
    let finalImpact: TrajectorySample | null = null;
    for (let iteration = 0; iteration < 6; iteration++) {
      const solution = solveAim(
        from,
        { s: aimS, h: this.terrain.heightAt(aimS, aimZ), z: aimZ },
        this.time,
        { speed: weapon.launchSpeed ?? 400, lofted: true, maxFlightTime: 120 },
      );
      if (!solution) return null;
      const impact = trajectoryImpact(from, solution.velocity, this.time, {
        maxTime: solution.flightTime + 8,
        dt: SIM_DT,
        ballisticCoefficient: weapon.ballisticCoefficient ?? BALLISTIC_COEFFICIENT,
        groundAt: (s, z) => this.terrain.heightAt(s, z),
        stopOnImpact: true,
        work: this.ballisticPlanningWork,
      });
      finalVelocity = solution.velocity;
      finalImpact = impact;
      const missS = deltaS(desiredS, impact.s);
      const missZ = impact.z - desiredZ;
      if (Math.hypot(missS, missZ) < 2) break;
      aimS = wrapS(aimS - missS);
      aimZ = clampAxial(aimZ - missZ);
    }
    if (!finalVelocity || !finalImpact) return null;
    const path = sampleTrajectory(from, finalVelocity, this.time, {
      maxTime: finalImpact.t + 8,
      dt: SIM_DT,
      ballisticCoefficient: weapon.ballisticCoefficient ?? BALLISTIC_COEFFICIENT,
      groundAt: (s, z) => this.terrain.heightAt(s, z),
      stopOnImpact: true,
      work: this.ballisticPlanningWork,
    });
    return {
      from,
      velocity: finalVelocity,
      flightTime: finalImpact.t,
      path,
      flightMode: 'chord',
    };
  }

  private planCruise(
    weapon: WeaponDef,
    from: RingPoint,
    targetS: number,
    targetZ: number,
  ): BallisticPlan {
    const ds = deltaS(from.s, targetS);
    const dz = targetZ - from.z;
    const distance = Math.hypot(ds, dz);
    const speed = weapon.launchSpeed ?? 55;
    const altitude = weapon.cruiseAltitude ?? 50;
    const steps = Math.max(1, Math.ceil(distance / (speed * SIM_DT)));
    const path: TrajectorySample[] = [{ ...from, t: 0 }];
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const s = wrapS(from.s + ds * ratio);
      const z = from.z + dz * ratio;
      const floor = this.terrain.heightAt(s, z);
      path.push({ s, z, h: step === steps ? floor : floor + altitude, t: step * SIM_DT });
    }
    return {
      from,
      velocity: { vt: 0, vh: 0, vz: 0 },
      flightTime: steps * SIM_DT,
      path,
      flightMode: 'cruise',
    };
  }

  private commitBallistic(source: BallisticSource, plan: BallisticPlan): number {
    const impact = plan.path[plan.path.length - 1]!;
    const projectileId = this.nextId++;
    source.ent.revealed = Math.max(source.ent.revealed, FIRING_REVEAL_TIME);
    if (source.isUnit) this.breakCloak(source.ent as Unit);
    this.clearVisibilityCache();
    this.emit(
      'weaponFired',
      source.s,
      source.z,
      plan.from.h,
      source.faction,
      source.weapon.muzzleFlashScale ?? 1,
      source.ent.id,
      source.weapon.id,
      undefined,
      undefined,
      undefined,
      projectileId,
    );
    this.projectiles.push({
      id: projectileId,
      alive: true,
      faction: source.faction,
      st: launchToInertial(plan.from, plan.velocity, this.time),
      p: { ...plan.from },
      weapon: source.weapon.id,
      ballistic: true,
      flightMode: plan.flightMode,
      targetId: source.ent.id,
      life: Math.max(plan.flightTime + 8, impact.t + 1),
      impactS: impact.s,
      impactZ: impact.z,
      doomed: false,
      sourceS: source.s,
      sourceZ: source.z,
    });
    return projectileId;
  }

  private fireWeapons(
    ent: Unit | Structure,
    weapons: string[],
    tgt: { s: number; z: number; h: number },
    dt: number,
    faction: Faction,
    s: number,
    z: number,
    isUnit: boolean,
  ): void {
    const power = this.powerRatio(faction);

    for (let i = 0; i < weapons.length; i++) {
      const w = WEAPONS[weapons[i]!]!;

      // Interceptors are handled against projectiles, not units.
      if (w.kind === 'interceptor') {
        if (!isUnit) {
          ent.cd[i] = Math.max(0, (ent.cd[i] ?? 0) - dt);
          this.runInterceptor(ent, w, i, faction, s, z);
        }
        continue;
      }
      ent.cd[i] = Math.max(0, (ent.cd[i] ?? 0) - dt);

      // A cooling weapon cannot change firing state. Bursts remain range- and
      // envelope-gated exactly as before because their timer is independent.
      if ((ent.burst[i] ?? 0) <= 0 && ent.cd[i]! > 0) continue;

      const range = this.weaponRange(ent, w);
      if (surfaceDistSq(s, z, tgt.s, tgt.z) > range * range) continue;
      if (
        w.kind === 'ballistic' &&
        !this.isBallisticTargetWithinReachEnvelope(ent.id, tgt.s, tgt.z, faction, w.id)
      ) continue;

      // Mid-burst?
      if ((ent.burst[i] ?? 0) > 0) {
        ent.burstTimer[i] = (ent.burstTimer[i] ?? 0) - dt;
        if (ent.burstTimer[i]! <= 0) {
          if (this.launch(ent, w, faction, s, z, tgt, isUnit)) {
            ent.burst[i] = ent.burst[i]! - 1;
            ent.burstTimer[i] = w.burstDelay ?? 0.1;
          } else {
            ent.burst[i] = 0;
          }
        }
        continue;
      }

      if (ent.cd[i]! > 0) continue;
      if (this.launch(ent, w, faction, s, z, tgt, isUnit)) {
        ent.cd[i] = this.weaponCooldown(ent, w) / Math.max(0.35, power);
        if (w.burst && w.burst > 1) {
          ent.burst[i] = w.burst - 1;
          ent.burstTimer[i] = w.burstDelay ?? 0.1;
        }
      } else if (w.kind === 'ballistic') {
        // A conservative envelope can still contain terrain-blocked or
        // drag-unsolved shots. Back off briefly instead of solving the same
        // impossible geometry on every 30 Hz tick.
        ent.cd[i] = Math.max(ent.cd[i] ?? 0, 1);
      }
    }
  }

  private launch(
    ent: Unit | Structure,
    w: WeaponDef,
    faction: Faction,
    s: number,
    z: number,
    tgt: { s: number; z: number; h: number },
    isUnit: boolean,
  ): boolean {
    if (!this.hasWeaponPower(faction, w)) return false;
    const groundH = this.terrain.heightAt(s, z);
    const muzzleH = groundH + (isUnit ? UNITS[(ent as Unit).kind].height * 0.62 : STRUCTURES[(ent as Structure).kind].height * 0.7);

    if (w.kind === 'ballistic') {
      const source: BallisticSource = {
        ent,
        faction,
        s,
        z,
        isUnit,
        weapon: w,
        weaponIndex: 0,
      };
      const plan = this.planBallistic(source, tgt.s, tgt.z);
      if (!plan) return false;
      if (!this.consumeWeaponPower(faction, w)) return false;
      this.commitBallistic(source, plan);
      return true;
    }

    if (!this.consumeWeaponPower(faction, w)) return false;
    this.emit('weaponFired', s, z, muzzleH, faction, w.muzzleFlashScale ?? 1, ent.id, w.id);
    if (isUnit) this.breakCloak(ent as Unit);

    // Direct fire: a fast tracer that leads its target.
    const speed = w.projectileSpeed ?? 400;
    const flight = surfaceDist(s, z, tgt.s, tgt.z) / speed;
    const spread = ((w.spread ?? 0) * Math.PI) / 180;
    const jitterS = this.rng.gaussian() * spread * 60;
    const jitterZ = this.rng.gaussian() * spread * 60;

    const aimS = wrapS(tgt.s + jitterS);
    const aimZ = clampAxial(tgt.z + jitterZ);
    const ds = deltaS(s, aimS);
    const dz = aimZ - z;
    const dh = tgt.h - muzzleH;
    const dist = Math.hypot(ds, dz) || 1e-6;

    const from: RingPoint = { s, h: muzzleH, z };
    const st = launchToInertial(
      from,
      {
        vt: (ds / dist) * speed,
        vh: (dh / dist) * speed + (flight * 3),
        vz: (dz / dist) * speed,
      },
      this.time,
    );
    this.projectiles.push({
      id: this.nextId++,
      alive: true,
      faction,
      st,
      p: { s, h: muzzleH, z },
      weapon: w.id,
      ballistic: false,
      flightMode: 'direct',
      targetId: 0,
      life: Math.min(4, flight * 1.4 + 0.4),
      impactS: aimS,
      impactZ: aimZ,
      doomed: false,
      sourceS: s,
      sourceZ: z,
    });
    return true;
  }

  /** Interceptors shoot down incoming ballistic rounds inside their bubble. */
  private runInterceptor(
    ent: Unit | Structure,
    w: WeaponDef,
    i: number,
    faction: Faction,
    s: number,
    z: number,
  ): void {
    if (ent.cd[i]! > 0) return;
    const power = this.powerRatio(faction);
    const effectiveRange = w.range * (0.55 + power * 0.45);

    for (const pr of this.projectiles) {
      if (!pr.alive || pr.faction === faction || pr.doomed || !pr.ballistic) continue;
      // Chord shots cross the ring interior and re-enter too steeply and quickly
      // for terminal point defence. Their counterplay is the expensive,
      // counter-battery-visible Silo and midcourse Laser Grid coverage.
      if (pr.flightMode === 'chord') continue;
      const protectedImpact =
        'ability' in ent && ent.kind === 'aegis'
          ? this.aegisProtectsImpact(ent, pr.impactS, pr.impactZ)
          : surfaceDistSq(s, z, pr.impactS, pr.impactZ) <= effectiveRange * effectiveRange;
      if (!protectedImpact) continue;
      const engagementRange =
        'ability' in ent && ent.ability?.id === 'umbrella' && ent.ability.active
          ? effectiveRange + ABILITIES.umbrella.protectionRadius
          : effectiveRange;
      if (surfaceDistSq(s, z, pr.p.s, pr.p.z) > (engagementRange * 1.6) ** 2) continue;
      if (!this.consumeWeaponPower(faction, w)) return;
      pr.doomed = true;
      ent.cd[i] = this.weaponCooldown(ent, w) / power;
      this.emit('intercepted', pr.p.s, pr.p.z, pr.p.h, faction, 1, pr.id, pr.weapon, undefined, undefined, ent.id);
      break;
    }
  }

  private aegisProtectsImpact(aegis: Unit, impactS: number, impactZ: number): boolean {
    if (aegis.ability?.id !== 'umbrella' || !aegis.ability.active) {
      return surfaceDistSq(aegis.s, aegis.z, impactS, impactZ) <=
        ABILITIES.umbrella.baseProtectionRadius ** 2;
    }
    for (const unit of this.units) {
      if (!unit.alive || unit.faction !== aegis.faction) continue;
      if (surfaceDistSq(aegis.s, aegis.z, unit.s, unit.z) > ABILITIES.umbrella.protectionRadius ** 2) continue;
      if (surfaceDistSq(unit.s, unit.z, impactS, impactZ) <= (UNITS[unit.kind].radius + 20) ** 2) return true;
    }
    for (const structure of this.structures) {
      if (!structure.alive || structure.faction !== aegis.faction) continue;
      if (surfaceDistSq(aegis.s, aegis.z, structure.s, structure.z) > ABILITIES.umbrella.protectionRadius ** 2) {
        continue;
      }
      if (surfaceDistSq(structure.s, structure.z, impactS, impactZ) <= (STRUCTURES[structure.kind].radius + 20) ** 2) {
        return true;
      }
    }
    return false;
  }

  private runLaserGrid(grid: Structure, weapon: WeaponDef): void {
    if (grid.cd[0]! > 0 || this.powerRatio(grid.faction as Faction) < (weapon.minPowerRatio ?? 1)) return;
    const coverage = STRUCTURES.laserGrid.coverageArc ?? weapon.range;
    for (const projectile of this.projectiles) {
      if (!projectile.alive || projectile.doomed || projectile.faction === grid.faction || !projectile.ballistic) {
        continue;
      }
      if (projectile.flightMode === 'cruise') continue;
      if (projectile.flightMode === 'chord' && projectile.p.h > ATMOSPHERE_HEIGHT) continue;
      if (projectile.p.h < 200 || Math.abs(deltaS(grid.s, projectile.p.s)) > coverage) continue;
      if (!this.consumeWeaponPower(grid.faction as Faction, weapon)) return;
      projectile.doomed = true;
      grid.cd[0] = weapon.cooldown / this.powerRatio(grid.faction as Faction);
      this.emit(
        'intercepted', projectile.p.s, projectile.p.z, projectile.p.h,
        grid.faction, 1, projectile.id, projectile.weapon, undefined, undefined, grid.id,
      );
      break;
    }
  }

  // ---- Structures ---------------------------------------------------------

  private stepStructures(dt: number): void {
    for (const st of this.structures) {
      if (!st.alive || st.faction < 0 || st.progress < 1) continue;
      st.revealed = Math.max(0, st.revealed - dt);
      const def = STRUCTURES[st.kind];
      if (def.weapons.length === 0) continue;

      if (st.kind === 'laserGrid') {
        st.cd[0] = Math.max(0, st.cd[0]! - dt);
        this.runLaserGrid(st, WEAPONS.gridLaser);
        continue;
      }

      // The human player's Rocket Battery is ground-targeted explicitly. AI
      // batteries retain autonomous fire so the opponent can use the weapon.
      if (st.kind === 'rocketBattery' || st.kind === 'silo') {
        for (let i = 0; i < st.cd.length; i++) st.cd[i] = Math.max(0, st.cd[i]! - dt);
        continue;
      }

      const maxRange = this.bestRange(def.weapons, st);
      if (!st.targetId || !this.isValidTarget(st.faction as Faction, st.targetId, st.s, st.z, maxRange)) {
        st.targetId = this.findTarget(st.faction as Faction, st.s, st.z, maxRange);
      }
      const tgt = st.targetId ? this.positionOf(st.targetId) : null;
      if (tgt) {
        st.yaw = turnToward(st.yaw, Math.atan2(tgt.z - st.z, deltaS(st.s, tgt.s)), 1.4 * dt);
        this.fireWeapons(st, def.weapons, tgt, dt, st.faction as Faction, st.s, st.z, false);
      } else {
        for (let i = 0; i < st.cd.length; i++) {
          st.cd[i] = Math.max(0, st.cd[i]! - dt);
          // Interceptors still run with no unit target: they defend regardless.
          const w = WEAPONS[def.weapons[i]!]!;
          if (w.kind === 'interceptor') {
            this.runInterceptor(st, w, i, st.faction as Faction, st.s, st.z);
          }
        }
      }
    }
  }

  // ---- Projectiles --------------------------------------------------------

  private stepProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.life -= dt;

      if (pr.doomed) {
        pr.alive = false;
        this.emit('impact', pr.p.s, pr.p.z, pr.p.h, pr.faction, 0.6, pr.id, pr.weapon);
        continue;
      }
      if (pr.life <= 0) {
        pr.alive = false;
        continue;
      }

      // Sub-step fast rounds so they cannot tunnel through a target.
      const w = WEAPONS[pr.weapon]!;
      const substeps = pr.ballistic ? 1 : 3;
      const sdt = dt / substeps;
      let hit = false;

      if (pr.flightMode === 'cruise') {
        hit = this.stepCruiseProjectile(pr, w, dt);
      } else {
        for (let k = 0; k < substeps && !hit; k++) {
          stepWithDrag(pr.st, sdt, w.ballisticCoefficient ?? BALLISTIC_COEFFICIENT);
          inertialToRing(pr.st, pr.p);

          const floor = this.terrain.heightAt(pr.p.s, pr.p.z);
          if (pr.p.h <= floor) {
            pr.p.h = floor;
            hit = true;
            break;
          }

          // Direct-fire rounds hit the first thing they pass through.
          if (!pr.ballistic) {
            const near = this.nearby(pr.p.s, pr.p.z, 30);
            for (const id of near) {
              const u = this.unitById(id);
              const stx = u ? undefined : this.structureById(id);
              const wreck = u || stx ? undefined : this.wreckById(id);
              const of = u ? u.faction : stx ? stx.faction : wreck ? wreck.faction : -1;
              if (of === pr.faction || of < 0) continue;
              const ps = u ? u.s : stx ? stx.s : wreck!.s;
              const pz = u ? u.z : stx ? stx.z : wreck!.z;
              const rad = u
                ? UNITS[u.kind].radius
                : stx
                  ? STRUCTURES[stx.kind].radius
                  : UNITS[wreck!.kind].radius;
              const hgt = u
                ? UNITS[u.kind].height
                : stx
                  ? STRUCTURES[stx.kind].height
                  : UNITS[wreck!.kind].height * 0.5;
              const gh = this.terrain.heightAt(ps, pz);
              if (
                surfaceDist(pr.p.s, pr.p.z, ps, pz) < rad + 2 &&
                pr.p.h > gh - 2 &&
                pr.p.h < gh + hgt
              ) {
                this.applyDamage(id, w.damage, w.damageType, pr.faction, {
                  s: pr.sourceS,
                  z: pr.sourceZ,
                  projectileId: pr.id,
                });
                hit = true;
                break;
              }
            }
          }
        }
      }

      if (hit) {
        pr.alive = false;
        const splash = w.splash ?? 0;
        this.emit(
          'impact',
          pr.p.s,
          pr.p.z,
          pr.p.h,
          pr.faction,
          splash > 0 ? splash / 12 : 0.5,
          pr.id,
          pr.weapon,
        );
        if (splash > 0) this.applySplash(pr.p.s, pr.p.z, splash, w.damage, w.damageType, pr.faction);
      }
    }
  }

  private stepCruiseProjectile(projectile: Projectile, weapon: WeaponDef, dt: number): boolean {
    const ds = deltaS(projectile.p.s, projectile.impactS);
    const dz = projectile.impactZ - projectile.p.z;
    const remaining = Math.hypot(ds, dz);
    const travel = (weapon.launchSpeed ?? 55) * dt;
    if (remaining <= travel + 1e-9) {
      projectile.p.s = projectile.impactS;
      projectile.p.z = projectile.impactZ;
      projectile.p.h = this.terrain.heightAt(projectile.p.s, projectile.p.z);
      return true;
    }
    const ratio = travel / remaining;
    projectile.p.s = wrapS(projectile.p.s + ds * ratio);
    projectile.p.z += dz * ratio;
    projectile.p.h =
      this.terrain.heightAt(projectile.p.s, projectile.p.z) + (weapon.cruiseAltitude ?? 50);
    return false;
  }

  private applySplash(
    s: number,
    z: number,
    radius: number,
    damage: number,
    type: (typeof DAMAGE_TABLE)[keyof typeof DAMAGE_TABLE] extends never ? never : keyof typeof DAMAGE_TABLE,
    from: Faction,
  ): void {
    const near = this.nearby(s, z, radius + 40);
    for (const id of near) {
      const p = this.positionOf(id);
      if (!p) continue;
      const u = this.unitById(id);
      const st = u ? undefined : this.structureById(id);
      const wreck = u || st ? undefined : this.wreckById(id);
      const of = u ? u.faction : st ? st.faction : wreck ? wreck.faction : -1;
      if (of < 0 || of === from) continue;
      const d = surfaceDist(s, z, p.s, p.z);
      if (d > radius) continue;
      // Linear falloff; full damage inside the inner third.
      const falloff = 1 - Math.max(0, (d - radius * 0.33) / (radius * 0.67));
      this.applyDamage(id, damage * falloff, type, from, { s, z });
    }
  }

  applyDamage(
    id: number,
    amount: number,
    type: keyof typeof DAMAGE_TABLE,
    from: Faction,
    source?: DamageSourceContext,
  ): void {
    if (this.status === 'completed') return;
    const u = this.unitById(id);
    if (u) {
      const mul = DAMAGE_TABLE[type][UNITS[u.kind].armor];
      const shield = this.shieldDamageMultiplier(u, source);
      u.hp -= amount * mul * shield;
      this.updateDamageState(u);
      if (u.hp <= 0) this.killUnit(u, from);
      return;
    }
    const st = this.structureById(id);
    if (st) {
      const mul = DAMAGE_TABLE[type][STRUCTURES[st.kind].armor];
      st.hp -= amount * mul;
      if (st.hp <= 0) this.killStructure(st, from);
      return;
    }
    const wreck = this.wreckById(id);
    if (!wreck) return;
    wreck.hp -= amount;
    if (wreck.hp <= 0) {
      wreck.alive = false;
      this.bucketsDirty = true;
      this.clearVisibilityCache();
    }
  }

  private shieldDamageMultiplier(unit: Unit, source?: DamageSourceContext): number {
    if (unit.ability?.id !== 'shieldWall' || !unit.ability.active || !source) return 1;
    const sourceYaw = Math.atan2(source.z - unit.z, deltaS(unit.s, source.s));
    return Math.abs(angleDelta(unit.yaw, sourceYaw)) <= ABILITIES.shieldWall.forwardArc * 0.5
      ? ABILITIES.shieldWall.damageMultiplier
      : 1;
  }

  private killUnit(u: Unit, from: Faction): void {
    u.alive = false;
    this.bucketsDirty = true;
    this.clearVisibilityCache();
    const def = UNITS[u.kind];
    if (def.cost.command) {
      this.players[u.faction].commandUsed -= def.cost.command;
    }
    if (def.isMech) {
      const maxHp = Math.max(1, Math.round(u.maxHp * WRECK_HP_MULTIPLIER));
      const wreck: Wreck = {
        id: this.nextId++,
        alive: true,
        faction: u.faction,
        kind: u.kind,
        s: u.s,
        z: u.z,
        yaw: u.yaw,
        hp: maxHp,
        maxHp,
        lifetime: WRECK_LIFETIME,
      };
      this.wreckages.push(wreck);
      this.entitiesById.set(wreck.id, wreck);
    }
    this.emit(
      'unitDied',
      u.s,
      u.z,
      this.terrain.heightAt(u.s, u.z),
      u.faction,
      def.height / 8,
      u.id,
      undefined,
      u.kind,
      from,
    );
  }

  private killStructure(st: Structure, from: Faction): void {
    if (st.kind === 'spinalNode') {
      // Nodes are captured, never destroyed; knock it back to neutral instead.
      st.hp = st.maxHp * 0.35;
      st.capture = 0;
      if (st.faction >= 0) this.changeNodeOwner(st, -1);
      return;
    }
    st.alive = false;
    this.bucketsDirty = true;
    if (st.kind === 'bastion') this.lastBastionAggressor = from;
    this.clearVisibilityCache();
    const def = STRUCTURES[st.kind];
    // A fusion core going up is a genuine tactical event, not just a corpse.
    const blast = st.kind === 'fusionCore' ? 5 : def.radius / 8;
    this.emit(
      'structureDied',
      st.s,
      st.z,
      this.terrain.heightAt(st.s, st.z),
      st.faction,
      blast,
      st.id,
      undefined,
      st.kind,
      from,
    );
    if (st.kind === 'fusionCore') {
      this.applySplash(st.s, st.z, 120, 700, 'explosive', other(st.faction as Faction));
    }
    if (st.faction >= 0) {
      // Recompute unlocks: losing your only fabricator locks the tech again.
      const f = st.faction as Faction;
      this.players[f].unlocked.clear();
      for (const o of this.structures) {
        if (o.alive && o.faction === f && o.progress >= 1) this.players[f].unlocked.add(o.kind);
      }
    }
  }

  // ---- Capture ------------------------------------------------------------

  private stepWrecks(dt: number): void {
    for (const wreck of this.wreckages) {
      if (!wreck.alive) continue;
      wreck.lifetime = Math.max(0, wreck.lifetime - dt);
      if (wreck.lifetime <= 1e-9) {
        wreck.lifetime = 0;
        wreck.alive = false;
        this.bucketsDirty = true;
        this.clearVisibilityCache();
      }
    }
  }

  private stepCapture(dt: number): void {
    for (const st of this.structures) {
      if (!st.alive || st.kind !== 'spinalNode') continue;
      const near = this.nearby(st.s, st.z, SPINAL_CAPTURE_QUERY_RADIUS);

      let compact = 0;
      let choir = 0;
      for (const id of near) {
        const entity = this.entitiesById.get(id);
        if (!entity?.alive || !('order' in entity)) continue;
        const u = entity;
        if (surfaceDistSq(u.s, u.z, st.s, st.z) > SPINAL_CAPTURE_RADIUS * SPINAL_CAPTURE_RADIUS) continue;
        if (u.faction === Faction.Compact) compact++;
        else choir++;
      }

      const net = Math.sign(choir - compact) *
        Math.min(SPINAL_CAPTURE_STRENGTH_CAP, Math.abs(choir - compact));
      if (net === 0) continue;
      const delta = net * dt * SPINAL_CAPTURE_RATE_PER_UNIT;
      if (st.faction < 0) {
        st.capture = clamp(st.capture + delta, -1, 1);
        if (st.capture >= 1 - SPINAL_CAPTURE_ENDPOINT_EPSILON) {
          st.capture = 1;
          this.changeNodeOwner(st, Faction.Choir);
        } else if (st.capture <= -1 + SPINAL_CAPTURE_ENDPOINT_EPSILON) {
          st.capture = -1;
          this.changeNodeOwner(st, Faction.Compact);
        }
        continue;
      }
      const owner = st.faction as Faction;
      const friendlyPressure = owner === Faction.Compact ? net < 0 : net > 0;
      if (friendlyPressure) {
        st.capture = owner === Faction.Compact
          ? Math.max(-1, st.capture + delta)
          : Math.min(1, st.capture + delta);
      } else {
        st.capture = owner === Faction.Compact
          ? Math.min(0, st.capture + delta)
          : Math.max(0, st.capture + delta);
        if (Math.abs(st.capture) <= SPINAL_CAPTURE_ENDPOINT_EPSILON) {
          st.capture = 0;
          this.changeNodeOwner(st, -1);
        }
      }
    }

    this.players[Faction.Compact].dominance +=
      this.alignedPairCount(Faction.Compact) * DOMINANCE_PER_ALIGNED_PAIR_PER_SEC * dt;
    this.players[Faction.Choir].dominance +=
      this.alignedPairCount(Faction.Choir) * DOMINANCE_PER_ALIGNED_PAIR_PER_SEC * dt;
  }

  private changeNodeOwner(node: Structure, nextOwner: Faction | -1): void {
    if (node.kind !== 'spinalNode' || node.faction === nextOwner) return;
    const pair = this.spinalPairForNode(node.id);
    const oldAlignment = pair ? this.spinalAlignmentOwner(pair) : null;
    const previousOwner = node.faction;
    node.faction = nextOwner;
    const newAlignment = pair ? this.spinalAlignmentOwner(pair) : null;
    this.clearVisibilityCache();
    this.recomputeCommandCaps();
    if (oldAlignment !== null && oldAlignment !== newAlignment) {
      this.emit(
        'alignmentBroken', node.s, node.z, 0, oldAlignment, 1, node.id,
        undefined, 'spinalNode', undefined, undefined, undefined, pair!.id,
      );
    }
    if (nextOwner < 0) {
      this.emit('nodeNeutralized', node.s, node.z, 0, previousOwner, 1, node.id, undefined, 'spinalNode');
    } else {
      this.emit('nodeCaptured', node.s, node.z, 0, nextOwner, 1, node.id, undefined, 'spinalNode');
    }
    if (newAlignment !== null && oldAlignment !== newAlignment) {
      this.emit(
        'alignmentStarted', node.s, node.z, 0, newAlignment, 1, node.id,
        undefined, 'spinalNode', undefined, undefined, undefined, pair!.id,
      );
    }
  }

  // ---- Cleanup and victory ------------------------------------------------

  private stepCleanup(): void {
    // Compact the arrays occasionally rather than every tick; splicing during
    // iteration is the classic source of skipped entities.
    if (this.tick % 30 !== 0) return;
    this.units = this.units.filter((unit) => {
      if (!unit.alive) {
        this.entitiesById.delete(unit.id);
        this.entityBucketById.delete(unit.id);
      }
      return unit.alive;
    });
    this.structures = this.structures.filter((structure) => {
      if (!structure.alive) {
        this.entitiesById.delete(structure.id);
        this.entityBucketById.delete(structure.id);
      }
      return structure.alive;
    });
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.wreckages = this.wreckages.filter((wreck) => {
      if (!wreck.alive) {
        this.entitiesById.delete(wreck.id);
        this.entityBucketById.delete(wreck.id);
      }
      return wreck.alive;
    });
  }

  private stepVictory(): void {
    if (this.status === 'completed' || !this.victoryArmed) return;

    let compactBastion = false;
    let choirBastion = false;
    for (const st of this.structures) {
      if (!st.alive || st.kind !== 'bastion') continue;
      if (st.faction === Faction.Compact) compactBastion = true;
      if (st.faction === Faction.Choir) choirBastion = true;
    }
    if (!choirBastion && !compactBastion) {
      this.winner = this.lastBastionAggressor ?? this.tieBreakWinner();
      this.endReason = 'Both Bastions destroyed — last strike decides';
      this.status = 'completed';
    } else if (!choirBastion) {
      this.winner = Faction.Compact;
      this.endReason = 'Enemy Bastion destroyed';
      this.status = 'completed';
    } else if (!compactBastion) {
      this.winner = Faction.Choir;
      this.endReason = 'Your Bastion was destroyed';
      this.status = 'completed';
    } else if (this.time + SIM_DT * 1e-6 >= this.timeLimit) {
      const compact = this.players[Faction.Compact].dominance;
      const choir = this.players[Faction.Choir].dominance;
      this.winner = compact === choir
        ? null
        : compact > choir
          ? Faction.Compact
          : Faction.Choir;
      this.endReason = this.winner === null
        ? 'Time limit — equal Dominance draw'
        : 'Time limit — decided on Dominance';
      this.status = 'completed';
    }
  }

  private tieBreakWinner(): Faction {
    const compact = this.players[Faction.Compact];
    const choir = this.players[Faction.Choir];
    if (compact.dominance !== choir.dominance) {
      return compact.dominance > choir.dominance ? Faction.Compact : Faction.Choir;
    }
    const force = (faction: Faction): number => {
      let score = this.players[faction].salvage * 0.01;
      for (const unit of this.units) if (unit.alive && unit.faction === faction) score += unit.hp;
      for (const structure of this.structures) {
        if (structure.alive && structure.faction === faction) score += structure.hp;
      }
      return score;
    };
    const compactForce = force(Faction.Compact);
    const choirForce = force(Faction.Choir);
    if (compactForce !== choirForce) return compactForce > choirForce ? Faction.Compact : Faction.Choir;
    return this.rng.chance(0.5) ? Faction.Compact : Faction.Choir;
  }

  // ---- Events -------------------------------------------------------------

  private emit(
    kind: SimEventKind,
    s: number,
    z: number,
    h: number,
    faction: Faction | -1,
    scale: number,
    id: number,
    weapon?: string,
    entityKind?: UnitKind | StructureKind,
    sourceFaction?: Faction,
    actorId?: number,
    projectileId?: number,
    pairId?: string,
  ): void {
    this.events.push({
      kind, s, z, h, faction, scale, id, weapon, entityKind, sourceFaction, actorId, projectileId, pairId,
    });
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  exportPersistenceState(): WorldPersistenceState {
    return {
      worldSeed: this.worldSeed,
      terrainSeed: this.terrainSeed,
      tick: this.tick,
      time: this.time,
      rngState: this.rng.snapshot(),
      nextId: this.nextId,
      timeLimit: this.timeLimit,
      victoryArmed: this.victoryArmed,
      lastBastionAggressor: this.lastBastionAggressor,
      result: {
        status: this.status,
        winner: this.winner,
        endReason: this.endReason,
      },
      players: [
        snapshotPlayer(this.players[Faction.Compact]),
        snapshotPlayer(this.players[Faction.Choir]),
      ],
      units: this.units.map((unit) => ({
        ...unit,
        order: { ...unit.order },
        cd: [...unit.cd],
        burst: [...unit.burst],
        burstTimer: [...unit.burstTimer],
        ability: unit.ability ? { ...unit.ability } : null,
      })),
      structures: this.structures.map((structure) => ({
        ...structure,
        cd: [...structure.cd],
        burst: [...structure.burst],
        burstTimer: [...structure.burstTimer],
        queue: [...structure.queue],
      })),
      projectiles: this.projectiles.map((projectile) => ({
        ...projectile,
        st: { ...projectile.st },
        p: { ...projectile.p },
      })),
      deposits: this.deposits.map((deposit) => ({ ...deposit })),
      wreckages: this.wreckages.map((wreck) => ({ ...wreck })),
      spinalPairs: this.spinalPairs.map((pair) => ({ id: pair.id, members: [...pair.members] })),
    };
  }

  /** Replace authority from a state that has already passed snapshot validation. */
  restorePersistenceState(state: WorldPersistenceState): void {
    const suppliedTerrainSeed = resolveTerrainSeed(this.terrain, state.worldSeed);
    if (suppliedTerrainSeed !== state.terrainSeed) {
      throw new Error(`Terrain seed mismatch: save requires ${state.terrainSeed}, supplied ${suppliedTerrainSeed}`);
    }
    const players: Record<Faction, PlayerState> = {
      [Faction.Compact]: restorePlayer(state.players[Faction.Compact]),
      [Faction.Choir]: restorePlayer(state.players[Faction.Choir]),
    };
    const units = state.units.map((unit) => ({
      ...unit,
      order: { ...unit.order },
      cd: [...unit.cd],
      burst: [...unit.burst],
      burstTimer: [...unit.burstTimer],
      ability: unit.ability ? { ...unit.ability } : null,
    }));
    const structures = state.structures.map((structure) => ({
      ...structure,
      cd: [...structure.cd],
      burst: [...structure.burst],
      burstTimer: [...structure.burstTimer],
      queue: [...structure.queue],
    }));
    const projectiles = state.projectiles.map((projectile) => ({
      ...projectile,
      st: { ...projectile.st },
      p: { ...projectile.p },
    }));
    const deposits = state.deposits.map((deposit) => ({ ...deposit }));
    const wreckages = state.wreckages.map((wreck) => ({ ...wreck }));
    const spinalPairs = state.spinalPairs.map((pair) => ({
      id: pair.id,
      members: [...pair.members] as [number, number],
    }));

    this.rng.restore(state.rngState);
    this.worldSeed = state.worldSeed;
    this.terrainSeed = state.terrainSeed;
    this.tick = state.tick;
    this.time = state.time;
    this.nextId = state.nextId;
    this.timeLimit = state.timeLimit;
    this.victoryArmed = state.victoryArmed;
    this.lastBastionAggressor = state.lastBastionAggressor;
    this.status = state.result.status;
    this.winner = state.result.winner;
    this.endReason = state.result.endReason;
    this.players = players;
    this.units = units;
    this.structures = structures;
    this.projectiles = projectiles;
    this.deposits = deposits;
    this.wreckages = wreckages;
    this.rebuildEntityIndex();
    this.setSpinalPairs(spinalPairs);
    this.events = [];
    for (const index of this.usedBuckets) this.buckets[index]!.length = 0;
    this.usedBuckets.length = 0;
    this.bucketGeneration++;
    this.bucketsDirty = true;
    this.clearVisibilityCache();
    this.failedBallisticGeometry.clear();
  }

  private rebuildEntityIndex(): void {
    this.entitiesById.clear();
    this.entityBucketById.clear();
    for (const unit of this.units) {
      this.entitiesById.set(unit.id, unit);
    }
    for (const structure of this.structures) {
      this.entitiesById.set(structure.id, structure);
    }
    for (const wreck of this.wreckages) this.entitiesById.set(wreck.id, wreck);
  }

  /** Stable checksum for replay and determinism verification. */
  stateHash(): string {
    const state = JSON.stringify(this.exportPersistenceState());
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < state.length; i++) {
      hash ^= state.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  // ---- Vision -------------------------------------------------------------

  sensorPowerScale(faction: Faction): number {
    return 0.55 + this.powerRatio(faction) * 0.45;
  }

  effectiveSensorRange(entityId: number, faction: Faction): number {
    const unit = this.unitById(entityId);
    if (unit) return unit.faction === faction ? unit.vision * this.sensorPowerScale(faction) : 0;
    const structure = this.structureById(entityId);
    if (!structure || structure.faction !== faction || structure.progress < 1) return 0;
    return structure.vision * this.sensorPowerScale(faction);
  }

  hasExactSensorContactFrom(entityId: number, faction: Faction, s: number, z: number): boolean {
    const unit = this.unitById(entityId);
    if (!unit || unit.faction !== faction) return false;
    const range = unit.vision * this.sensorPowerScale(faction);
    return surfaceDistSq(unit.s, unit.z, s, z) < range * range &&
      this.hasLineOfSight(unit.s, unit.z, UNITS[unit.kind].height * 0.8, s, z);
  }

  sensorStatusAt(faction: Faction, s: number, z: number): {
    nominal: boolean;
    exactLineOfSight: boolean;
  } {
    const scale = this.sensorPowerScale(faction);
    let nominal = false;
    for (const unit of this.units) {
      if (!unit.alive || unit.faction !== faction) continue;
      if (surfaceDistSq(unit.s, unit.z, s, z) >= (unit.vision * scale) ** 2) continue;
      nominal = true;
      if (this.hasLineOfSight(unit.s, unit.z, UNITS[unit.kind].height * 0.8, s, z)) {
        return { nominal: true, exactLineOfSight: true };
      }
    }
    for (const structure of this.structures) {
      if (!structure.alive || structure.faction !== faction || structure.progress < 1) continue;
      if (surfaceDistSq(structure.s, structure.z, s, z) >= (structure.vision * scale) ** 2) continue;
      nominal = true;
      if (this.hasLineOfSight(
        structure.s,
        structure.z,
        STRUCTURES[structure.kind].height * 0.8,
        s,
        z,
      )) return { nominal: true, exactLineOfSight: true };
    }
    return { nominal, exactLineOfSight: false };
  }

  /**
   * Can `faction` see this point? Artillery needs a spotter, so this gates
   * both rendering and the AI's targeting.
   */
  isVisible(faction: Faction, s: number, z: number): boolean {
    return this.sensorStatusAt(faction, s, z).exactLineOfSight;
  }

  isEntityVisible(faction: Faction, id: number): boolean {
    if (this.visibilityTick !== this.tick) this.clearVisibilityCache();
    const cached = this.visibleEntities[faction].get(id);
    if (cached !== undefined) return cached;
    const unit = this.unitById(id);
    if (unit) {
      const visible =
        unit.faction === faction ||
        unit.revealed > 0 ||
         (unit.cloaked
           ? this.hasCloakProximityReveal(faction, unit)
           : this.isVisible(faction, unit.s, unit.z));
      this.visibleEntities[faction].set(id, visible);
      return visible;
    }
    const structure = this.structureById(id);
    if (structure) {
      const visible =
        structure.faction < 0 ||
        structure.faction === faction ||
        structure.revealed > 0 ||
        this.isVisible(faction, structure.s, structure.z);
      this.visibleEntities[faction].set(id, visible);
      return visible;
    }
    const wreck = this.wreckById(id);
    if (wreck) {
      const visible = wreck.faction === faction || this.isVisible(faction, wreck.s, wreck.z);
      this.visibleEntities[faction].set(id, visible);
      return visible;
    }
    return false;
  }

  private hasCloakProximityReveal(faction: Faction, cloaked: Unit): boolean {
    for (const unit of this.units) {
      if (!unit.alive || unit.faction !== faction) continue;
      if (surfaceDistSq(unit.s, unit.z, cloaked.s, cloaked.z) <= ABILITIES.cloak.detectionRadius ** 2) {
        return true;
      }
    }
    return false;
  }

  isProjectileVisible(faction: Faction, projectile: Projectile): boolean {
    return (
      projectile.faction === faction ||
      (projectile.flightMode === 'chord' && projectile.p.h > ATMOSPHERE_HEIGHT) ||
      (projectile.targetId !== 0 && this.isEntityVisible(faction, projectile.targetId)) ||
      this.isVisible(faction, projectile.p.s, projectile.p.z) ||
      (projectile.ballistic && this.isVisible(faction, projectile.impactS, projectile.impactZ))
    );
  }

  private clearVisibilityCache(): void {
    this.visibleEntities[Faction.Compact].clear();
    this.visibleEntities[Faction.Choir].clear();
    this.visibilityTick = this.tick;
  }

  private hasLineOfSight(fromS: number, fromZ: number, eyeHeight: number, toS: number, toZ: number): boolean {
    const ds = deltaS(fromS, toS);
    const dz = toZ - fromZ;
    const distance = Math.hypot(ds, dz);
    const steps = Math.ceil(distance / 4);
    if (steps <= 1) return true;
    const fromHeight = this.terrain.heightAt(fromS, fromZ) + eyeHeight;
    const toHeight = this.terrain.heightAt(toS, toZ) + 3;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const s = wrapS(fromS + ds * t);
      const z = fromZ + dz * t;
      const sightHeight = fromHeight + (toHeight - fromHeight) * t;
      if (this.terrain.heightAt(s, z) + 2 > sightHeight) return false;
    }
    for (const wreck of this.wreckages) {
      if (!wreck.alive) continue;
      const radius = UNITS[wreck.kind].radius * WRECK_COVER_RADIUS_MULTIPLIER;
      if (surfaceDistSq(wreck.s, wreck.z, toS, toZ) <= radius * radius) continue;
      const wreckS = deltaS(fromS, wreck.s);
      const wreckZ = wreck.z - fromZ;
      const along = (wreckS * ds + wreckZ * dz) / (distance * distance);
      if (along <= 0 || along >= 1) continue;
      if (Math.hypot(wreckS, wreckZ) > WRECK_COVER_MAX_DISTANCE) continue;
      if (Math.hypot(wreckS - ds * along, wreckZ - dz * along) > radius) continue;
      const sightHeight = fromHeight + (toHeight - fromHeight) * along;
      const coverTop = this.terrain.heightAt(wreck.s, wreck.z) +
        UNITS[wreck.kind].height * WRECK_COVER_HEIGHT_MULTIPLIER;
      if (coverTop > sightHeight) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newPlayer(): PlayerState {
  return {
    salvage: STARTING_SALVAGE,
    commandUsed: 0,
    commandCap: STARTING_COMMAND,
    energyProduced: BASE_ENERGY,
    energyDrawn: 0,
    weaponEnergyLoad: 0,
    weaponEnergySchedule: Array.from({ length: WEAPON_POWER_PULSE_TICKS }, () => 0),
    dominance: 0,
    unlocked: new Set<StructureKind>(),
  };
}

function snapshotPlayer(state: PlayerState): WorldPlayerPersistenceState {
  return {
    salvage: state.salvage,
    commandUsed: state.commandUsed,
    commandCap: state.commandCap,
    energyProduced: state.energyProduced,
    energyDrawn: state.energyDrawn,
    weaponEnergyLoad: state.weaponEnergyLoad,
    weaponEnergySchedule: [...state.weaponEnergySchedule],
    dominance: state.dominance,
    unlocked: [...state.unlocked].sort(),
  };
}

function restorePlayer(state: WorldPlayerPersistenceState): PlayerState {
  return {
    salvage: state.salvage,
    commandUsed: state.commandUsed,
    commandCap: state.commandCap,
    energyProduced: state.energyProduced,
    energyDrawn: state.energyDrawn,
    weaponEnergyLoad: state.weaponEnergyLoad,
    weaponEnergySchedule: [...state.weaponEnergySchedule],
    dominance: state.dominance,
    unlocked: new Set(state.unlocked),
  };
}

function clampAxial(z: number): number {
  const lim = RING_HALF_WIDTH - 40;
  return z < -lim ? -lim : z > lim ? lim : z;
}

function withBallisticTarget(result: BallisticFireResult, targetS: number, targetZ: number): BallisticFireResult {
  return { ...result, targetS, targetZ };
}

function normalizeBallisticTarget(targetS: number, targetZ: number): { targetS: number; targetZ: number } {
  return { targetS: wrapS(targetS), targetZ: clampAxial(targetZ) };
}

export function resolveTerrainSeed(terrain: Terrain, worldSeed: number): number {
  const seed = (terrain as unknown as { seed?: unknown }).seed;
  if (seed === undefined) return worldSeed;
  if (typeof seed !== 'number') throw new TypeError('Terrain seed must be a safe integer');
  validateSeed(seed, 'Terrain seed');
  return seed;
}

function validateSeed(seed: number, label: string): void {
  if (!Number.isSafeInteger(seed)) throw new TypeError(`${label} must be a safe integer`);
}

function validateSpinalPairId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 64 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) ||
    value === 'constructor' ||
    value === 'prototype'
  ) {
    throw new Error('Spinal pair id must be a safe non-empty symbolic id');
  }
  return value;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Signed shortest angular difference, in (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/**
 * Shadow-square occlusion, duplicated from the render side deliberately: the
 * simulation must not import anything from `@render`, and this is a handful of
 * lines of pure maths. The two are kept in step by `tests/sim/economy.test.ts`.
 */
const PANEL_COUNT = 5;
const PANEL_SPACING = (Math.PI * 2) / PANEL_COUNT;
const PANEL_HALF_SPAN = 0.19;
const PANEL_PHASE_OFFSET = PANEL_SPACING * 0.5;
const DAY_LEN = 420;
const MAX_OCC = 0.72;

export function shadowFactorSim(theta: number, t: number): number {
  const phase = (t / (DAY_LEN * PANEL_COUNT)) * Math.PI * 2 + PANEL_PHASE_OFFSET;
  let rel = (theta - phase) % PANEL_SPACING;
  if (rel < 0) rel += PANEL_SPACING;
  const d = Math.min(rel, PANEL_SPACING - rel);
  const t0 = PANEL_HALF_SPAN * 0.5;
  const t1 = PANEL_HALF_SPAN;
  const x = clamp((d - t0) / (t1 - t0), 0, 1);
  const smooth = x * x * (3 - 2 * x);
  return clamp(1 - (1 - smooth) * MAX_OCC, 0, 1);
}
