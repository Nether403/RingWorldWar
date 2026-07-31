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
  RING_CIRCUMFERENCE,
  RING_HALF_WIDTH,
  SIM_DT,
} from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { Rng } from '@core/rng';
import type { Terrain } from '@gen/terrain';
import {
  BASE_ENERGY,
  COMMAND_PER_NODE,
  DAMAGE_TABLE,
  DOMINANCE_PER_NODE_PER_SEC,
  Faction,
  FIRING_REVEAL_TIME,
  MATCH_TIME_LIMIT,
  other,
  STARTING_COMMAND,
  STARTING_SALVAGE,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
  type UnitKind,
  type WeaponDef,
} from './data';
import {
  inertialToRing,
  launchToInertial,
  solveAim,
  stepWithDrag,
  type BallisticState,
  type RingPoint,
} from './ballistics';

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
  /** Facing; 0 is spinward. */
  yaw: number;
  /** Where the torso is aiming, tracked separately so legs and guns differ. */
  aimYaw: number;
  speed: number;
  hp: number;
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
  /** Set while building; counts down the structure's build time. */
  buildTimer: number;
  buildTargetId: number;
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
  /** For direct fire, the entity being tracked. */
  targetId: number;
  life: number;
  /** Predicted impact, so the UI can telegraph it. */
  impactS: number;
  impactZ: number;
  /** Set by interceptors. */
  doomed: boolean;
}

export interface Deposit {
  s: number;
  z: number;
  /** Remaining salvage. Finite, so the map forces expansion. */
  amount: number;
  claimedBy: number;
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
  | 'nodeCaptured';

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
}

export interface PlayerState {
  salvage: number;
  /** Command points spent on fielded mechs. */
  commandUsed: number;
  commandCap: number;
  energyProduced: number;
  energyDrawn: number;
  dominance: number;
  /** Structures that exist, so the build bar can gate on prerequisites. */
  unlocked: Set<StructureKind>;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  readonly terrain: Terrain;
  readonly rng: Rng;

  units: Unit[] = [];
  structures: Structure[] = [];
  projectiles: Projectile[] = [];
  deposits: Deposit[] = [];

  players: Record<Faction, PlayerState>;

  time = 0;
  tick = 0;
  /** null while the match is running. */
  winner: Faction | null = null;
  endReason = '';

  /** Drained by the renderer and audio each frame. */
  events: SimEvent[] = [];

  private nextId = 1;
  /** Coarse spatial buckets, rebuilt each tick, to keep targeting linear-ish. */
  private buckets = new Map<number, number[]>();
  private static readonly BUCKET = 220;

  constructor(terrain: Terrain, seed: number) {
    this.terrain = terrain;
    this.rng = new Rng(seed);
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
    for (const frac of [0.25, 0.75]) {
      this.spawnStructure(-1 as Faction, 'spinalNode', C * frac, 0, 1);
    }
    this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.125, RING_HALF_WIDTH * 0.6, 1);
    this.spawnStructure(-1 as Faction, 'spinalNode', C * 0.625, -RING_HALF_WIDTH * 0.6, 1);

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
    const def = UNITS[kind];
    const u: Unit = {
      id: this.nextId++,
      alive: true,
      faction,
      kind,
      s: wrapS(s),
      z: clampAxial(z),
      yaw: faction === Faction.Compact ? 0 : Math.PI,
      aimYaw: 0,
      speed: 0,
      hp: def.hp,
      order: { kind: 'idle', s: 0, z: 0, targetId: 0 },
      cd: def.weapons.map(() => 0),
      burst: def.weapons.map(() => 0),
      burstTimer: def.weapons.map(() => 0),
      targetId: 0,
      revealed: 0,
      gait: 0,
      buildTimer: 0,
      buildTargetId: 0,
    };
    this.units.push(u);
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
    const st: Structure = {
      id: this.nextId++,
      alive: true,
      faction,
      kind,
      s: wrapS(s),
      z: clampAxial(z),
      yaw: faction === Faction.Choir ? Math.PI : 0,
      hp: def.hp * (progress < 1 ? 0.25 : 1),
      progress,
      cd: def.weapons.map(() => 0),
      burst: def.weapons.map(() => 0),
      burstTimer: def.weapons.map(() => 0),
      targetId: 0,
      revealed: 0,
      queue: [],
      queueTimer: 0,
      capture: 0,
    };
    this.structures.push(st);
    if (faction >= 0 && progress >= 1) this.players[faction as Faction].unlocked.add(kind);
    return st;
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  unitById(id: number): Unit | undefined {
    for (const u of this.units) if (u.id === id && u.alive) return u;
    return undefined;
  }

  structureById(id: number): Structure | undefined {
    for (const s of this.structures) if (s.id === id && s.alive) return s;
    return undefined;
  }

  /** Position of any entity, or null if it is gone. */
  positionOf(id: number): { s: number; z: number; h: number } | null {
    const u = this.unitById(id);
    if (u) return { s: u.s, z: u.z, h: this.terrain.heightAt(u.s, u.z) + UNITS[u.kind].height * 0.5 };
    const st = this.structureById(id);
    if (st) {
      return { s: st.s, z: st.z, h: this.terrain.heightAt(st.s, st.z) + STRUCTURES[st.kind].height * 0.4 };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------------

  step(): void {
    const dt = SIM_DT;
    this.time += dt;
    this.tick++;

    this.rebuildBuckets();
    this.stepEconomy(dt);
    this.stepProduction(dt);
    this.stepUnits(dt);
    this.stepStructures(dt);
    this.stepProjectiles(dt);
    this.stepCapture(dt);
    this.stepCleanup();
    this.stepVictory();
  }

  // ---- Spatial index ------------------------------------------------------

  private bucketKey(s: number, z: number): number {
    const bs = Math.floor(s / World.BUCKET);
    const bz = Math.floor((z + RING_HALF_WIDTH) / World.BUCKET);
    return bs * 1000 + bz;
  }

  private rebuildBuckets(): void {
    this.buckets.clear();
    const add = (s: number, z: number, id: number): void => {
      const k = this.bucketKey(s, z);
      let arr = this.buckets.get(k);
      if (!arr) {
        arr = [];
        this.buckets.set(k, arr);
      }
      arr.push(id);
    };
    for (const u of this.units) if (u.alive) add(u.s, u.z, u.id);
    for (const s of this.structures) if (s.alive) add(s.s, s.z, s.id);
  }

  /** Ids near a point. Approximate: returns everything in the 3x3 bucket block. */
  private nearby(s: number, z: number, radius: number, out: number[]): void {
    out.length = 0;
    const r = Math.ceil(radius / World.BUCKET);
    const bs = Math.floor(s / World.BUCKET);
    const bz = Math.floor((z + RING_HALF_WIDTH) / World.BUCKET);
    const span = Math.floor(RING_CIRCUMFERENCE / World.BUCKET) + 1;
    for (let dz = -r; dz <= r; dz++) {
      for (let ds = -r; ds <= r; ds++) {
        const k = (((bs + ds) % span) + span) % span * 1000 + (bz + dz);
        const arr = this.buckets.get(k);
        if (arr) for (const id of arr) out.push(id);
      }
    }
  }

  // ---- Economy ------------------------------------------------------------

  private stepEconomy(dt: number): void {
    for (const f of [Faction.Compact, Faction.Choir]) {
      const p = this.players[f];
      p.energyProduced = BASE_ENERGY;
      p.energyDrawn = 0;
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

  depositAt(s: number, z: number): Deposit | undefined {
    for (const d of this.deposits) if (surfaceDist(d.s, d.z, s, z) < 70) return d;
    return undefined;
  }

  private recomputeCommandCaps(): void {
    for (const f of [Faction.Compact, Faction.Choir]) {
      this.players[f].commandCap = STARTING_COMMAND;
    }
    for (const st of this.structures) {
      if (st.alive && st.kind === 'spinalNode' && st.faction >= 0) {
        this.players[st.faction as Faction].commandCap += COMMAND_PER_NODE;
      }
    }
  }

  // ---- Production ---------------------------------------------------------

  private stepProduction(dt: number): void {
    for (const st of this.structures) {
      if (!st.alive || st.faction < 0 || st.progress < 1 || st.queue.length === 0) continue;
      const kind = st.queue[0]!;
      const def = UNITS[kind];
      // Production slows during a brownout instead of stalling outright.
      st.queueTimer += dt * this.powerRatio(st.faction as Faction);
      if (st.queueTimer >= def.buildTime) {
        st.queue.shift();
        st.queueTimer = 0;
        const outS = st.s + Math.cos(st.yaw) * (STRUCTURES[st.kind].radius + 16);
        const outZ = st.z + Math.sin(st.yaw) * (STRUCTURES[st.kind].radius + 16);
        this.spawnUnit(st.faction as Faction, kind, outS, clampAxial(outZ));
        this.emit('unitComplete', outS, clampAxial(outZ), 0, st.faction, 1, st.id);
      }
    }
  }

  /** Queue a unit if it can be afforded. Returns false if it cannot. */
  tryQueueUnit(structureId: number, kind: UnitKind): boolean {
    const st = this.structureById(structureId);
    if (!st || st.faction < 0 || st.progress < 1) return false;
    if (!STRUCTURES[st.kind].produces?.includes(kind)) return false;
    const f = st.faction as Faction;
    const p = this.players[f];
    const def = UNITS[kind];
    const cost = def.cost.salvage ?? 0;
    if (p.salvage < cost) return false;
    if (def.cost.command && p.commandUsed + def.cost.command > p.commandCap) return false;
    p.salvage -= cost;
    st.queue.push(kind);
    return true;
  }

  /** Place a construction site. Returns the structure, or null if invalid. */
  tryPlaceStructure(f: Faction, kind: StructureKind, s: number, z: number): Structure | null {
    const def = STRUCTURES[kind];
    const p = this.players[f];
    if (def.neutral) return null;
    if (p.salvage < (def.cost.salvage ?? 0)) return null;
    if (!this.canPlace(f, kind, s, z)) return null;
    p.salvage -= def.cost.salvage ?? 0;
    const st = this.spawnStructure(f, kind, s, z, 0);
    if (def.needsDeposit) {
      const d = this.depositAt(s, z);
      if (d) d.claimedBy = st.id;
    }
    return st;
  }

  canPlace(f: Faction, kind: StructureKind, s: number, z: number): boolean {
    const def = STRUCTURES[kind];
    if (!this.terrain.isBuildable(s, z)) return false;
    if (def.needsDeposit) {
      const d = this.depositAt(s, z);
      if (!d || d.amount <= 0) return false;
      if (d.claimedBy !== 0 && this.structureById(d.claimedBy)) return false;
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
      if (o.alive && o.faction === f && surfaceDist(o.s, o.z, s, z) < 420) {
        anchored = true;
        break;
      }
    }
    return anchored;
  }

  // ---- Units --------------------------------------------------------------

  private stepUnits(dt: number): void {
    const near: number[] = [];

    for (const u of this.units) {
      if (!u.alive) continue;
      const def = UNITS[u.kind];
      if (u.revealed > 0) u.revealed -= dt;

      // --- Construction ----------------------------------------------------
      if (u.order.kind === 'build' && u.buildTargetId) {
        const site = this.structureById(u.buildTargetId);
        if (!site || site.progress >= 1) {
          u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          u.buildTargetId = 0;
        } else if (surfaceDist(u.s, u.z, site.s, site.z) < STRUCTURES[site.kind].radius + 24) {
          const sdef = STRUCTURES[site.kind];
          site.progress = Math.min(1, site.progress + dt / sdef.buildTime);
          site.hp = sdef.hp * (0.25 + 0.75 * site.progress);
          if (site.progress >= 1) {
            this.players[site.faction as Faction].unlocked.add(site.kind);
            this.recomputeCommandCaps();
            this.emit('structureComplete', site.s, site.z, 0, site.faction, 1, site.id);
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
        const maxRange = Math.max(...def.weapons.map((w) => WEAPONS[w]!.range));
        if (u.order.kind === 'attack' && u.order.targetId) {
          u.targetId = u.order.targetId;
          if (!this.positionOf(u.targetId)) {
            u.targetId = 0;
            u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          }
        } else if (!u.targetId || !this.isValidTarget(u.faction, u.targetId, u.s, u.z, maxRange)) {
          u.targetId = this.findTarget(u.faction, u.s, u.z, maxRange, near);
        }
      }

      // --- Movement ---------------------------------------------------------
      const tgt = u.targetId ? this.positionOf(u.targetId) : null;
      let moved = false;

      if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
        const d = surfaceDist(u.s, u.z, u.order.s, u.order.z);
        if (d < 14) {
          u.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
          u.speed = 0;
        } else {
          // On attack-move, stop to shoot anything in range.
          const engaged =
            u.order.kind === 'attackMove' && tgt !== null &&
            surfaceDist(u.s, u.z, tgt.s, tgt.z) < this.bestRange(def.weapons) * 0.85;
          if (!engaged) {
            this.moveToward(u, u.order.s, u.order.z, dt, def);
            moved = true;
          }
        }
      } else if (u.order.kind === 'attack' && tgt) {
        // Close to within 80% of range, then hold.
        const d = surfaceDist(u.s, u.z, tgt.s, tgt.z);
        const want = this.bestRange(def.weapons) * 0.8;
        if (d > want) {
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
        if (!moved) this.faceToward(u, tgt.s, tgt.z, dt, def.turnRate);
        this.fireWeapons(u, def.weapons, tgt, dt, u.faction, u.s, u.z, true);
      } else {
        for (let i = 0; i < u.cd.length; i++) u.cd[i] = Math.max(0, u.cd[i]! - dt);
        u.aimYaw = turnToward(u.aimYaw, u.yaw, def.turnRate * dt);
      }

      u.gait += u.speed * dt;
    }

    this.separateUnits(dt);
  }

  private bestRange(weapons: string[]): number {
    let r = 0;
    for (const w of weapons) r = Math.max(r, WEAPONS[w]!.range);
    return r || 60;
  }

  /**
   * Steering. Deliberately simple: head for the goal, slide along steep ground
   * rather than pathing around it. The map is open enough that full pathfinding
   * would add a lot of machinery for very little behavioural difference.
   */
  private moveToward(u: Unit, ts: number, tz: number, dt: number, def: (typeof UNITS)[UnitKind]): void {
    const ds = deltaS(u.s, ts);
    const dz = tz - u.z;
    const d = Math.hypot(ds, dz) || 1e-6;
    const want = Math.atan2(dz, ds);
    u.yaw = turnToward(u.yaw, want, def.turnRate * dt);

    // Only move at full speed once roughly facing the right way; heavy mechs
    // therefore arc around rather than pivoting on the spot, which reads as
    // weight without any extra animation.
    const align = Math.max(0, Math.cos(angleDelta(u.yaw, want)));
    const slope = this.terrain.slopeAt(u.s, u.z);
    const slowdown = 1 / (1 + slope * 2.4);
    const target = def.speed * align * slowdown;
    u.speed += (target - u.speed) * Math.min(1, dt * 3.5);

    const step = Math.min(u.speed * dt, d);
    u.s = wrapS(u.s + Math.cos(u.yaw) * step);
    u.z = clampAxial(u.z + Math.sin(u.yaw) * step);
  }

  private faceToward(u: Unit, ts: number, tz: number, dt: number, rate: number): void {
    const want = Math.atan2(tz - u.z, deltaS(u.s, ts));
    u.yaw = turnToward(u.yaw, want, rate * dt);
  }

  /** Push overlapping units apart so they do not stack into one pile. */
  private separateUnits(dt: number): void {
    const near: number[] = [];
    for (const a of this.units) {
      if (!a.alive) continue;
      const ra = UNITS[a.kind].radius;
      this.nearby(a.s, a.z, 40, near);
      for (const id of near) {
        if (id <= a.id) continue;
        const b = this.unitById(id);
        if (!b || !b.alive) continue;
        const rb = UNITS[b.kind].radius;
        const min = ra + rb;
        const ds = deltaS(a.s, b.s);
        const dz = b.z - a.z;
        const d = Math.hypot(ds, dz);
        if (d > min || d < 1e-4) continue;
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
    const p = this.positionOf(id);
    if (!p) return false;
    const u = this.unitById(id);
    const st = this.structureById(id);
    const of = u ? u.faction : st ? st.faction : -1;
    if (of === f || of < 0) return false;
    return surfaceDist(s, z, p.s, p.z) <= range;
  }

  /** Nearest enemy in range. Prefers units over buildings. */
  private findTarget(f: Faction, s: number, z: number, range: number, near: number[]): number {
    this.nearby(s, z, range, near);
    let best = 0;
    let bestScore = Infinity;
    for (const id of near) {
      const u = this.unitById(id);
      const st = u ? undefined : this.structureById(id);
      const of = u ? u.faction : st ? st.faction : -1;
      if (of === f || of < 0) continue;
      const ps = u ? u.s : st!.s;
      const pz = u ? u.z : st!.z;
      const d = surfaceDist(s, z, ps, pz);
      if (d > range) continue;
      // Buildings are shot only once nothing living is in reach.
      const score = d + (u ? 0 : range * 0.9);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  // ---- Firing -------------------------------------------------------------

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
      ent.cd[i] = Math.max(0, (ent.cd[i] ?? 0) - dt);

      // Interceptors are handled against projectiles, not units.
      if (w.kind === 'interceptor') {
        this.runInterceptor(ent, w, i, faction, s, z);
        continue;
      }

      const d = surfaceDist(s, z, tgt.s, tgt.z);
      if (d > w.range) continue;

      // Mid-burst?
      if ((ent.burst[i] ?? 0) > 0) {
        ent.burstTimer[i] = (ent.burstTimer[i] ?? 0) - dt;
        if (ent.burstTimer[i]! <= 0) {
          ent.burst[i] = ent.burst[i]! - 1;
          ent.burstTimer[i] = w.burstDelay ?? 0.1;
          this.launch(ent, w, faction, s, z, tgt, isUnit);
        }
        continue;
      }

      if (ent.cd[i]! > 0) continue;
      ent.cd[i] = w.cooldown / Math.max(0.35, power);
      if (w.burst && w.burst > 1) {
        ent.burst[i] = w.burst - 1;
        ent.burstTimer[i] = w.burstDelay ?? 0.1;
      }
      this.launch(ent, w, faction, s, z, tgt, isUnit);
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
  ): void {
    const groundH = this.terrain.heightAt(s, z);
    const muzzleH = groundH + (isUnit ? UNITS[(ent as Unit).kind].height * 0.62 : STRUCTURES[(ent as Structure).kind].height * 0.7);

    this.emit('weaponFired', s, z, muzzleH, faction, w.muzzleFlashScale ?? 1, ent.id, w.id);

    if (w.kind === 'ballistic') {
      // Firing artillery lights you up on the enemy's map for a few seconds.
      // That is what turns an artillery duel into a positioning game.
      ent.revealed = FIRING_REVEAL_TIME;

      const from: RingPoint = { s, h: muzzleH, z };
      const to: RingPoint = { s: tgt.s, h: this.terrain.heightAt(tgt.s, tgt.z), z: tgt.z };
      const sol = solveAim(from, to, this.time, {
        speed: w.launchSpeed ?? 120,
        lofted: true,
        maxFlightTime: 60,
      });
      if (!sol) return; // Out of reach in this direction; the shot is skipped.

      const st = launchToInertial(from, sol.velocity, this.time);
      this.projectiles.push({
        id: this.nextId++,
        alive: true,
        faction,
        st,
        p: { s, h: muzzleH, z },
        weapon: w.id,
        ballistic: true,
        targetId: 0,
        life: sol.flightTime + 6,
        impactS: to.s,
        impactZ: to.z,
        doomed: false,
      });
      return;
    }

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
      targetId: 0,
      life: Math.min(4, flight * 1.4 + 0.4),
      impactS: aimS,
      impactZ: aimZ,
      doomed: false,
    });
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
    if (this.powerRatio(faction) < 0.5) return;

    for (const pr of this.projectiles) {
      if (!pr.alive || pr.faction === faction || pr.doomed || !pr.ballistic) continue;
      // Only worth intercepting things heading for something we care about.
      if (surfaceDist(s, z, pr.impactS, pr.impactZ) > w.range) continue;
      if (surfaceDist(s, z, pr.p.s, pr.p.z) > w.range * 1.6) continue;
      pr.doomed = true;
      ent.cd[i] = w.cooldown;
      this.emit('intercepted', pr.p.s, pr.p.z, pr.p.h, faction, 1, pr.id);
      break;
    }
  }

  // ---- Structures ---------------------------------------------------------

  private stepStructures(dt: number): void {
    const near: number[] = [];
    for (const st of this.structures) {
      if (!st.alive || st.faction < 0 || st.progress < 1) continue;
      if (st.revealed > 0) st.revealed -= dt;
      const def = STRUCTURES[st.kind];
      if (def.weapons.length === 0) continue;

      const maxRange = Math.max(...def.weapons.map((w) => WEAPONS[w]!.range));
      if (!st.targetId || !this.isValidTarget(st.faction as Faction, st.targetId, st.s, st.z, maxRange)) {
        st.targetId = this.findTarget(st.faction as Faction, st.s, st.z, maxRange, near);
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
    const near: number[] = [];

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

      for (let k = 0; k < substeps && !hit; k++) {
        stepWithDrag(pr.st, sdt, pr.ballistic ? 900 : 4000);
        inertialToRing(pr.st, pr.p);

        const floor = this.terrain.heightAt(pr.p.s, pr.p.z);
        if (pr.p.h <= floor) {
          pr.p.h = floor;
          hit = true;
          break;
        }

        // Direct-fire rounds hit the first thing they pass through.
        if (!pr.ballistic) {
          this.nearby(pr.p.s, pr.p.z, 30, near);
          for (const id of near) {
            const u = this.unitById(id);
            const stx = u ? undefined : this.structureById(id);
            const of = u ? u.faction : stx ? stx.faction : -1;
            if (of === pr.faction || of < 0) continue;
            const ps = u ? u.s : stx!.s;
            const pz = u ? u.z : stx!.z;
            const rad = u ? UNITS[u.kind].radius : STRUCTURES[stx!.kind].radius;
            const hgt = u ? UNITS[u.kind].height : STRUCTURES[stx!.kind].height;
            const gh = this.terrain.heightAt(ps, pz);
            if (
              surfaceDist(pr.p.s, pr.p.z, ps, pz) < rad + 2 &&
              pr.p.h > gh - 2 &&
              pr.p.h < gh + hgt
            ) {
              this.applyDamage(id, w.damage, w.damageType, pr.faction);
              hit = true;
              break;
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

  private applySplash(
    s: number,
    z: number,
    radius: number,
    damage: number,
    type: (typeof DAMAGE_TABLE)[keyof typeof DAMAGE_TABLE] extends never ? never : keyof typeof DAMAGE_TABLE,
    from: Faction,
  ): void {
    const near: number[] = [];
    this.nearby(s, z, radius + 40, near);
    for (const id of near) {
      const p = this.positionOf(id);
      if (!p) continue;
      const u = this.unitById(id);
      const st = u ? undefined : this.structureById(id);
      const of = u ? u.faction : st ? st.faction : -1;
      if (of < 0 || of === from) continue;
      const d = surfaceDist(s, z, p.s, p.z);
      if (d > radius) continue;
      // Linear falloff; full damage inside the inner third.
      const falloff = 1 - Math.max(0, (d - radius * 0.33) / (radius * 0.67));
      this.applyDamage(id, damage * falloff, type, from);
    }
  }

  applyDamage(id: number, amount: number, type: keyof typeof DAMAGE_TABLE, from: Faction): void {
    const u = this.unitById(id);
    if (u) {
      const mul = DAMAGE_TABLE[type][UNITS[u.kind].armor];
      u.hp -= amount * mul;
      if (u.hp <= 0) this.killUnit(u);
      return;
    }
    const st = this.structureById(id);
    if (st) {
      const mul = DAMAGE_TABLE[type][STRUCTURES[st.kind].armor];
      st.hp -= amount * mul;
      if (st.hp <= 0) this.killStructure(st, from);
    }
  }

  private killUnit(u: Unit): void {
    u.alive = false;
    const def = UNITS[u.kind];
    if (def.cost.command) {
      this.players[u.faction].commandUsed -= def.cost.command;
    }
    this.emit('unitDied', u.s, u.z, this.terrain.heightAt(u.s, u.z), u.faction, def.height / 8, u.id);
  }

  private killStructure(st: Structure, from: Faction): void {
    if (st.kind === 'spinalNode') {
      // Nodes are captured, never destroyed; knock it back to neutral instead.
      st.hp = STRUCTURES.spinalNode.hp * 0.35;
      st.faction = -1;
      st.capture = 0;
      this.recomputeCommandCaps();
      return;
    }
    st.alive = false;
    const def = STRUCTURES[st.kind];
    // A fusion core going up is a genuine tactical event, not just a corpse.
    const blast = st.kind === 'fusionCore' ? 5 : def.radius / 8;
    this.emit('structureDied', st.s, st.z, this.terrain.heightAt(st.s, st.z), st.faction, blast, st.id);
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
    void from;
  }

  // ---- Capture ------------------------------------------------------------

  private stepCapture(dt: number): void {
    const near: number[] = [];
    for (const st of this.structures) {
      if (!st.alive || st.kind !== 'spinalNode') continue;
      this.nearby(st.s, st.z, 130, near);

      let compact = 0;
      let choir = 0;
      for (const id of near) {
        const u = this.unitById(id);
        if (!u || !u.alive) continue;
        if (surfaceDist(u.s, u.z, st.s, st.z) > 110) continue;
        if (u.faction === Faction.Compact) compact++;
        else choir++;
      }

      // Contested nodes freeze; a lone unit takes about twenty seconds.
      const net = Math.sign(choir - compact) * Math.min(3, Math.abs(choir - compact));
      if (net !== 0) {
        st.capture = clamp(st.capture + net * dt * 0.05, -1, 1);
        const owner: Faction | -1 =
          st.capture >= 1 ? Faction.Choir : st.capture <= -1 ? Faction.Compact : st.faction;
        if (owner !== st.faction) {
          st.faction = owner;
          this.recomputeCommandCaps();
          this.emit('nodeCaptured', st.s, st.z, 0, owner, 1, st.id);
        }
      }
    }

    // Dominance: whoever holds more nodes accrues score. This is the anti-stall
    // valve -- turtling forever loses on the clock.
    let cCount = 0;
    let hCount = 0;
    for (const st of this.structures) {
      if (st.alive && st.kind === 'spinalNode') {
        if (st.faction === Faction.Compact) cCount++;
        else if (st.faction === Faction.Choir) hCount++;
      }
    }
    this.players[Faction.Compact].dominance += cCount * DOMINANCE_PER_NODE_PER_SEC * dt;
    this.players[Faction.Choir].dominance += hCount * DOMINANCE_PER_NODE_PER_SEC * dt;
  }

  // ---- Cleanup and victory ------------------------------------------------

  private stepCleanup(): void {
    // Compact the arrays occasionally rather than every tick; splicing during
    // iteration is the classic source of skipped entities.
    if (this.tick % 30 !== 0) return;
    this.units = this.units.filter((u) => u.alive);
    this.structures = this.structures.filter((s) => s.alive);
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private stepVictory(): void {
    if (this.winner !== null) return;

    let compactBastion = false;
    let choirBastion = false;
    for (const st of this.structures) {
      if (!st.alive || st.kind !== 'bastion') continue;
      if (st.faction === Faction.Compact) compactBastion = true;
      if (st.faction === Faction.Choir) choirBastion = true;
    }
    if (!choirBastion) {
      this.winner = Faction.Compact;
      this.endReason = 'Enemy Bastion destroyed';
    } else if (!compactBastion) {
      this.winner = Faction.Choir;
      this.endReason = 'Your Bastion was destroyed';
    } else if (this.time >= MATCH_TIME_LIMIT) {
      const c = this.players[Faction.Compact].dominance;
      const h = this.players[Faction.Choir].dominance;
      this.winner = c >= h ? Faction.Compact : Faction.Choir;
      this.endReason = 'Time limit — decided on Dominance';
    }
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
  ): void {
    this.events.push({ kind, s, z, h, faction, scale, id, weapon });
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- Vision -------------------------------------------------------------

  /**
   * Can `faction` see this point? Artillery needs a spotter, so this gates
   * both rendering and the AI's targeting.
   */
  isVisible(faction: Faction, s: number, z: number): boolean {
    for (const u of this.units) {
      if (!u.alive || u.faction !== faction) continue;
      if (surfaceDist(u.s, u.z, s, z) < UNITS[u.kind].vision) return true;
    }
    for (const st of this.structures) {
      if (!st.alive || st.faction !== faction || st.progress < 1) continue;
      if (surfaceDist(st.s, st.z, s, z) < STRUCTURES[st.kind].vision) return true;
    }
    return false;
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
    dominance: 0,
    unlocked: new Set<StructureKind>(),
  };
}

function clampAxial(z: number): number {
  const lim = RING_HALF_WIDTH - 40;
  return z < -lim ? -lim : z > lim ? lim : z;
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
