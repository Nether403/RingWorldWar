/**
 * The game: simulation, rendering and player input, wired together.
 *
 * Runs the simulation on a fixed 30 Hz accumulator regardless of frame rate,
 * so the game plays identically on a 60 Hz laptop and a 240 Hz monitor.
 */

import * as THREE from 'three';
import { RING_HALF_WIDTH, RING_RADIUS, SIM_DT } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { createTerrain, type Terrain } from '@gen/terrain';
import { AiOpponent, type Difficulty } from '@ai/opponent';
import { deserializeGameSave, serializeGameSave } from './gameSave';
import {
  effectiveStructureStats,
  Faction,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
} from '@sim/data';
import { World, type BallisticFireResult, type SimEvent, type Unit } from '@sim/world';
import type { TrajectorySample } from '@sim/ballistics';
import { RenderAnchor } from '@render/anchor';
import { CameraRig } from '@render/cameraRig';
import { EntityRenderer } from '@render/entityRenderer';
import { Effects } from '@render/effects';
import { isPresentationEventVisible } from '@render/presentationEvents';
import { ballisticFireMessage, Hud } from '@ui/hud';
import { Markers } from '@render/markers';
import {
  MissionController,
  type MissionBindings,
  type BreakLineBindings,
  type CounterfireBindings,
  type SignalInSpineBindings,
  type MissionHudModel,
  type MissionDebriefModel,
  type MissionId,
  type MissionSnapshot,
} from './tutorial/mission';
import type { NarrativeHudModel } from './tutorial/narrative';
import type { VoiceUnitRef } from './audio/voiceDirector';

export const PLAYER: Faction = Faction.Compact;
export const SAVE_SLOT_KEY = 'ring-world-war/save-slot';
const MAX_PENDING_PRESENTATION_EVENTS = 4_096;

export interface SaveActionResult {
  ok: boolean;
  message: string;
}

export type PlayerVoiceAction =
  | { kind: 'selection'; faction: Faction; units: readonly VoiceUnitRef[] }
  | { kind: 'order'; faction: Faction; units: readonly VoiceUnitRef[]; order: 'move' | 'attack' };

export class Game {
  readonly world: World;
  readonly terrain: Terrain;
  readonly entities: EntityRenderer;
  readonly effects: Effects;
  readonly markers: Markers;
  readonly hud: Hud;
  private ai: AiOpponent;
  private aiEnabled = true;
  private mission: MissionController | null = null;
  private readonly presentationEvents: SimEvent[] = [];
  onPresentationEvents: ((events: readonly SimEvent[]) => void) | null = null;
  onTransientReset: (() => void) | null = null;
  onPlayerVoiceAction: ((action: PlayerVoiceAction) => void) | null = null;

  selection = new Set<number>();
  /** Ground point under the cursor, in surface coordinates. */
  cursor = { s: 0, z: 0, valid: false };
  trajectoryPreview: TrajectorySample[] | null = null;
  artilleryResult: BallisticFireResult | null = null;
  private artillerySourceId = 0;
  private artilleryWeaponId = '';
  private directUnitId = 0;
  private readonly controlGroups = new Map<number, number[]>();
  private previewDirty = false;
  private previewCooldown = 0;
  private artilleryInspection: {
    targetS: number;
    targetZ: number;
    sourceS: number;
    sourceZ: number;
    geometryChecked: boolean;
    geometryValid: boolean;
  } | null = null;
  /** Duration of the most recent fixed simulation step, excluding AI work. */
  simStepMs = 0;

  private acc = 0;
  private readonly _ray = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();
  private readonly _v = new THREE.Vector3();

  constructor(
    private readonly seed: number,
    private readonly anchor: RenderAnchor,
    private readonly rig: CameraRig,
    private readonly difficulty: Difficulty = 'veteran',
  ) {
    this.terrain = createTerrain(seed);
    this.world = new World(this.terrain, seed);
    this.world.setup();
    this.ai = new AiOpponent(Faction.Choir, difficulty, seed);

    this.entities = new EntityRenderer(seed);
    this.effects = new Effects(seed);
    this.markers = new Markers();
    this.hud = new Hud();
    this.entities.onFootfall = (event) => {
      this.effects.footfall(event, this.anchor, this.rig.s, this.rig.z);
      this.onPresentationEvents?.([event]);
    };

    this.hud.onMinimapPointer = (s, z) => this.updateCursor(s, z);
    this.hud.onMinimapCamera = (s, z) => this.rig.setFocus(s, z);
    this.hud.onMinimapPrimary = (s, z) => {
      if (this.artilleryTargeting) this.fireArtilleryTarget(s, z);
      else this.rig.setFocus(s, z);
    };
    this.hud.onMinimapSecondary = (s, z, attackMove) => {
      if (this.artilleryTargeting) this.cancelArtilleryTarget();
      else this.issueOrder(s, z, attackMove);
    };
    this.hud.onMinimapMove = (s, z, attackMove) => this.issueOrder(s, z, attackMove);
    this.hud.onMinimapCancel = () => {
      if (!this.artilleryTargeting) return false;
      this.cancelArtilleryTarget();
      return true;
    };
    this.hud.onArtilleryTarget = (sourceId, weaponId) => this.beginArtilleryTarget(sourceId, weaponId);
    this.hud.onAbilityToggle = (unitId) => this.toggleAbility(unitId);
    this.hud.onBuildRequest = (kind) => this.setBuild(kind);
    this.hud.onNarrativeAcknowledge = () => this.acknowledgeNarrative();
  }

  get objects(): THREE.Object3D[] {
    return [this.entities.object, this.effects.object, this.markers.object];
  }

  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.previewCooldown = Math.max(0, this.previewCooldown - dt);
    // Fixed-timestep simulation. Capped so that a long stall (an alt-tab, a
    // shader compile) cannot trigger a death spiral of catch-up ticks.
    this.acc += dt;
    let steps = 0;
    let simStepTotal = 0;
    while (this.acc >= SIM_DT && steps < 6) {
      simStepTotal += this.fixedSimulationStep();
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps > 0) this.simStepMs = simStepTotal / steps;
    if (steps === 6) this.acc = 0;

    this.updatePresentation(dt, time);
  }

  /** Advances render-only state without stepping authoritative simulation. */
  updatePresentation(dt: number, time: number): void {
    this.refreshArtilleryInspection();

    const events = this.presentationEvents.splice(0);
    this.effects.consume(events, this.world, this.anchor, PLAYER, this.rig.s, this.rig.z, true);
    this.entities.consumePresentation(events, time);
    this.hud.consumePresentation(events);
    this.onPresentationEvents?.(events);
    this.entities.update(this.world, this.anchor, time, PLAYER, this.acc / SIM_DT);
    this.effects.update(dt, this.world, this.anchor, PLAYER, this.rig.camera);
    if (this.effects.shake > 0) this.rig.addShake(this.effects.shake);
    this.markers.update(
      this.world,
      this.anchor,
      this.selection,
      this.cursor,
      this.hud.placing,
      PLAYER,
      this.trajectoryPreview,
      this.artilleryTargeting,
      this.artilleryResult,
      this.rig.camera,
    );
    // Drop dead entities before HUD rendering so selection never shows ghosts.
    for (const id of [...this.selection]) {
      if (!this.world.unitById(id) && !this.world.structureById(id)) this.selection.delete(id);
    }
    this.hud.update(
      dt,
      this.world,
      PLAYER,
      this.selection,
      this.rig.s,
      this.rig.z,
      this.artilleryTargeting,
      this.artilleryResult,
      this.mission?.hudModel() ?? null,
      this.mission?.debriefModel() ?? null,
      this.mission?.narrativeHudModel() ?? null,
      this.directControlActive,
    );
  }

  /** Advances the same fixed simulation/controller step used by update(). */
  stepSimulationExactlyOnce(): void {
    this.fixedSimulationStep();
  }

  private fixedSimulationStep(): number {
    if (this.mission?.narrativeBlocksSimulation) return 0;
    const stepStart = performance.now();
    this.world.step();
    const elapsed = performance.now() - stepStart;
    if (this.aiEnabled) this.ai.update(this.world, SIM_DT);
    const events = this.world.drainEvents();
    this.mission?.advanceTick(this.world, events);
    for (const event of events) {
      if (isPresentationEventVisible(event, this.world, PLAYER)) this.presentationEvents.push(event);
    }
    if (this.presentationEvents.length > MAX_PENDING_PRESENTATION_EVENTS) {
      this.presentationEvents.splice(0, this.presentationEvents.length - MAX_PENDING_PRESENTATION_EVENTS);
    }
    return elapsed;
  }

  setAiEnabled(enabled: boolean): void {
    this.aiEnabled = enabled;
  }

  get isAiEnabled(): boolean {
    return this.aiEnabled;
  }

  startMission(id: 'first-contact', bindings: MissionBindings): void;
  startMission(id: 'break-the-line', bindings: BreakLineBindings): void;
  startMission(id: 'counterfire', bindings: CounterfireBindings): void;
  startMission(id: 'a-signal-in-the-spine', bindings: SignalInSpineBindings): void;
  startMission(
    id: MissionId,
    bindings: MissionBindings | BreakLineBindings | CounterfireBindings | SignalInSpineBindings,
  ): void {
    const started = id === 'first-contact'
      ? MissionController.start(id, this.world.tick, bindings as MissionBindings)
      : id === 'break-the-line'
        ? MissionController.start(id, this.world.tick, bindings as BreakLineBindings)
        : id === 'counterfire'
          ? MissionController.start(id, this.world.tick, bindings as CounterfireBindings)
          : MissionController.start(id, this.world.tick, bindings as SignalInSpineBindings);
    this.mission = MissionController.fromSnapshot(started.snapshot(), this.world);
    this.hud.invalidate();
  }

  get missionSnapshot(): MissionSnapshot | null {
    return this.mission?.snapshot() ?? null;
  }

  get missionHudModel(): MissionHudModel | null {
    return this.mission?.hudModel() ?? null;
  }

  get missionDebriefModel(): MissionDebriefModel | null {
    return this.mission?.debriefModel() ?? null;
  }

  get narrativeHudModel(): NarrativeHudModel | null {
    return this.mission?.narrativeHudModel() ?? null;
  }

  acknowledgeNarrative(): void {
    this.mission?.acknowledgeNarrative();
  }

  /** Called after the anchor re-bases, so render-space effects follow it. */
  onRebase(previousS: number, previousZ: number): void {
    this.effects.rebase(previousS, previousZ, this.anchor);
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  /**
   * Where does the cursor ray meet the ground?
   *
   * Solved analytically against the ring cylinder rather than by raycasting the
   * terrain mesh, which has around a million triangles. Two refinement passes
   * account for terrain height: intersect the cylinder, sample the height
   * there, then re-intersect a cylinder of that adjusted radius.
   */
  pickGround(ndcX: number, ndcY: number, camera: THREE.Camera): { s: number; z: number } | null {
    this._ndc.set(ndcX, ndcY);
    this._ray.setFromCamera(this._ndc, camera);
    const o = this._ray.ray.origin;
    const d = this._ray.ray.direction;

    let radius = RING_RADIUS;
    let hit: { s: number; z: number } | null = null;

    for (let pass = 0; pass < 3; pass++) {
      // Intersect with the cylinder x^2 + (y - R)^2 = radius^2.
      const ax = o.x;
      const ay = o.y - RING_RADIUS;
      const dx = d.x;
      const dy = d.y;

      const A = dx * dx + dy * dy;
      const B = 2 * (ax * dx + ay * dy);
      const C = ax * ax + ay * ay - radius * radius;
      if (Math.abs(A) < 1e-9) return hit;
      const disc = B * B - 4 * A * C;
      if (disc < 0) return hit;

      const sq = Math.sqrt(disc);
      const t0 = (-B - sq) / (2 * A);
      const t1 = (-B + sq) / (2 * A);
      // The camera is inside the ring, so we want the first forward crossing.
      const t = t0 > 0.5 ? t0 : t1;
      if (t <= 0.5) return hit;

      this._v.copy(d).multiplyScalar(t).add(o);
      const ring = this.anchor.toRing(this._v);
      if (Math.abs(ring.z) > RING_HALF_WIDTH) return hit;

      hit = { s: ring.s, z: ring.z };
      // Refine: the true surface is at R minus the terrain height here.
      radius = RING_RADIUS - this.terrain.heightAt(ring.s, ring.z);
    }
    return hit;
  }

  /** The entity under the cursor, preferring units over structures. */
  pickEntity(s: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    for (const u of this.world.units) {
      if (!u.alive) continue;
      if (!this.world.isEntityVisible(PLAYER, u.id)) continue;
      const r = UNITS[u.kind].radius + 6;
      const d = surfaceDist(u.s, u.z, s, z);
      if (d < r && d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    if (best) return best;
    for (const st of this.world.structures) {
      if (!st.alive) continue;
      if (!this.world.isEntityVisible(PLAYER, st.id)) continue;
      const r = STRUCTURES[st.kind].radius + 4;
      const d = surfaceDist(st.s, st.z, s, z);
      if (d < r && d < bestD) {
        bestD = d;
        best = st.id;
      }
    }
    if (best) return best;
    for (const wreck of this.world.wreckages) {
      if (!wreck.alive || !this.world.isEntityVisible(PLAYER, wreck.id)) continue;
      const d = surfaceDist(wreck.s, wreck.z, s, z);
      if (d < UNITS[wreck.kind].radius + 4 && d < bestD) {
        bestD = d;
        best = wreck.id;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  get artilleryTargeting(): boolean {
    return this.artillerySourceId !== 0;
  }

  get artilleryWeapon(): string | null {
    return this.artilleryWeaponId || null;
  }

  get directControlActive(): boolean {
    return this.directUnitId !== 0;
  }

  enterDirectControl(): boolean {
    if (this.world.status === 'completed') return false;
    if (this.selection.size !== 1) return false;
    const id = this.selection.values().next().value as number | undefined;
    const unit = id ? this.world.unitById(id) : undefined;
    if (!unit || unit.faction !== PLAYER || !UNITS[unit.kind].isMech) return false;
    this.cancelArtilleryTarget();
    this.hud.placing = null;
    this.directUnitId = unit.id;
    this.rig.enterDirect();
    this.rig.followDirect(unit.s, unit.z, unit.yaw);
    this.hud.alert(`Piloting ${UNITS[unit.kind].name} — WASD move, click attack, Esc tactical`);
    return true;
  }

  updateDirectControl(forward: number, right: number): void {
    if (this.world.status === 'completed') return;
    if (!this.directUnitId) return;
    const unit = this.world.unitById(this.directUnitId);
    if (!unit) {
      this.exitDirectControl();
      return;
    }

    const length = Math.hypot(forward, right);
    if (length > 0) {
      const f = forward / length;
      const r = right / length;
      const c = Math.cos(this.rig.yaw);
      const sn = Math.sin(this.rig.yaw);
      const ds = f * c - r * sn;
      const dz = f * sn + r * c;
      unit.order = {
        kind: 'move',
        s: wrapS(unit.s + ds * 90),
        z: clamp(unit.z + dz * 90, -RING_HALF_WIDTH + 60, RING_HALF_WIDTH - 60),
        targetId: 0,
      };
    } else if (unit.order.kind === 'move') {
      unit.order = { kind: 'idle', s: unit.s, z: unit.z, targetId: 0 };
    }
    if (this.cursor.valid) {
      unit.manualAimYaw = Math.atan2(this.cursor.z - unit.z, deltaS(unit.s, this.cursor.s));
    }
    this.rig.followDirect(unit.s, unit.z, unit.yaw);
  }

  directAttack(s: number, z: number): void {
    if (this.world.status === 'completed') return;
    if (!this.directUnitId) return;
    const targetId = this.pickEntity(s, z);
    const targetUnit = targetId ? this.world.unitById(targetId) : undefined;
    const targetStructure = targetId ? this.world.structureById(targetId) : undefined;
    const targetWreck = targetId ? this.world.wreckById(targetId) : undefined;
    const targetFaction = targetUnit?.faction ?? targetStructure?.faction ?? targetWreck?.faction ?? -1;
    const unit = this.world.unitById(this.directUnitId);
    if (!unit || targetFaction < 0 || targetFaction === PLAYER) return;
    unit.order = { kind: 'attack', s, z, targetId };
    unit.targetId = targetId;
    this.emitVoiceOrder([unit], 'attack');
  }

  exitDirectControl(): void {
    if (!this.directUnitId) return;
    const unit = this.world.unitById(this.directUnitId);
    if (unit) {
      unit.manualAimYaw = null;
      this.rig.setFocus(unit.s, unit.z);
    }
    this.directUnitId = 0;
    this.rig.exitDirect();
    this.hud.alert('Tactical control restored');
  }

  beginArtilleryTarget(sourceId: number, weaponId?: string): void {
    if (this.world.status === 'completed') return;
    const unit = this.world.unitById(sourceId);
    const structure = unit ? undefined : this.world.structureById(sourceId);
    const source = unit ?? structure;
    if (!source || source.faction !== PLAYER) return;
    const weapons = unit ? UNITS[unit.kind].weapons : STRUCTURES[structure!.kind].weapons;
    const selectedWeapon = weaponId ?? weapons.find((id) => WEAPONS[id]?.kind === 'ballistic');
    if (!selectedWeapon || !weapons.includes(selectedWeapon)) return;
    if (WEAPONS[selectedWeapon]?.kind !== 'ballistic') return;
    this.hud.placing = null;
    this.artillerySourceId = sourceId;
    this.artilleryWeaponId = selectedWeapon;
    this.trajectoryPreview = null;
    this.artilleryResult = null;
    this.artilleryInspection = null;
    this.previewDirty = true;
    this.previewCooldown = 0;
    this.hud.alert(
      WEAPONS[selectedWeapon]?.flightMode === 'chord'
        ? 'Choose a target - Chord Shot can blind-fire anywhere on the ring'
        : 'Choose a target - trajectory is a preview; sensor and firing checks remain authoritative',
    );
    if (this.cursor.valid) this.updateCursor(this.cursor.s, this.cursor.z);
  }

  updateCursor(s: number, z: number): void {
    const nextS = wrapS(s);
    const nextZ = clamp(z, -RING_HALF_WIDTH + 40, RING_HALF_WIDTH - 40);
    const moved = !this.cursor.valid || this.cursor.s !== nextS || this.cursor.z !== nextZ;
    this.cursor.s = nextS;
    this.cursor.z = nextZ;
    this.cursor.valid = true;
    if (this.artillerySourceId && moved) {
      this.trajectoryPreview = null;
      this.artilleryResult = null;
      this.artilleryInspection = null;
      this.previewDirty = true;
    }
  }

  invalidateCursor(): void {
    if (!this.cursor.valid) return;
    this.cursor.valid = false;
    if (!this.artillerySourceId) return;
    this.trajectoryPreview = null;
    this.artilleryResult = null;
    this.artilleryInspection = null;
    this.previewDirty = true;
  }

  fireArtilleryTarget(s: number, z: number): boolean {
    if (!this.artillerySourceId) return false;
    this.updateCursor(s, z);
    const weaponId = this.artilleryWeaponId;
    const preflight = this.world.preflightBallisticCommand(
      this.artillerySourceId,
      this.cursor.s,
      this.cursor.z,
      PLAYER,
      weaponId,
    );
    if (!preflight.ok) {
      this.artilleryResult = preflight;
      this.previewDirty = true;
      this.hud.alert(ballisticFireMessage(preflight));
      return false;
    }
    const result = this.world.fireBallisticCommand(
      this.artillerySourceId,
      this.cursor.s,
      this.cursor.z,
      PLAYER,
      weaponId,
    );
    this.artilleryResult = result;
    const blindFire = WEAPONS[weaponId]?.flightMode === 'chord';
    this.hud.alert(
      result.ok
        ? blindFire ? 'Chord Shot away' : 'Rocket away'
        : ballisticFireMessage(result),
    );
    if (result.ok) {
      const voiceUnit = this.world.unitById(this.artillerySourceId);
      this.mission?.observePlayerAction({
        kind: 'artillery-fired',
        sourceId: this.artillerySourceId,
        weaponId,
        projectileId: result.projectileId,
        targetS: this.cursor.s,
        targetZ: this.cursor.z,
      }, this.world);
      if (voiceUnit) this.emitVoiceOrder([voiceUnit], 'attack');
      this.cancelArtilleryTarget();
    }
    else this.previewDirty = true;
    return result.ok;
  }

  cancelArtilleryTarget(): void {
    this.artillerySourceId = 0;
    this.artilleryWeaponId = '';
    this.trajectoryPreview = null;
    this.artilleryResult = null;
    this.artilleryInspection = null;
    this.previewDirty = false;
  }

  private refreshArtilleryInspection(): void {
    if (!this.artillerySourceId) return;
    const source = this.world.positionOf(this.artillerySourceId);
    if (this.world.status === 'completed' || !source) {
      this.cancelArtilleryTarget();
      return;
    }
    if (!this.cursor.valid) return;

    const cached = this.artilleryInspection;
    const sameCoordinates = cached !== null &&
      cached.targetS === this.cursor.s && cached.targetZ === this.cursor.z &&
      cached.sourceS === source.s && cached.sourceZ === source.z;
    if (!sameCoordinates && cached) {
      this.trajectoryPreview = null;
      this.artilleryResult = null;
      this.artilleryInspection = null;
      this.previewDirty = true;
    }

    const preflight = this.world.preflightBallisticCommand(
      this.artillerySourceId,
      this.cursor.s,
      this.cursor.z,
      PLAYER,
      this.artilleryWeaponId,
    );
    if (sameCoordinates) {
      if (preflight.sensorCoverage === false) {
        this.trajectoryPreview = null;
        this.artilleryInspection = null;
        this.artilleryResult = preflight;
        this.previewDirty = true;
        return;
      } else if (!preflight.ok) {
        this.artilleryResult = preflight;
      } else if (cached.geometryValid) {
        this.artilleryResult = preflight;
      } else if (cached.geometryChecked) {
        this.artilleryResult = {
          ...preflight,
          ok: false,
          reason: 'no-ballistic-solution',
        };
      } else {
        this.artilleryResult = null;
        this.previewDirty = true;
      }
    }

    if (!this.previewDirty || this.previewCooldown > 0) return;
    const inspection = this.world.inspectBallisticCommand(
      this.artillerySourceId,
      this.cursor.s,
      this.cursor.z,
      PLAYER,
      this.artilleryWeaponId,
    );
    const trajectory = inspection.trajectory as TrajectorySample[] | null;
    const geometryChecked = trajectory !== null ||
      inspection.result.reason === 'no-ballistic-solution' ||
      (inspection.result.reason !== 'outside-sensor-range' &&
        (WEAPONS[this.artilleryWeaponId]?.flightMode === 'chord' || inspection.result.sensorCoverage === true));
    this.trajectoryPreview = trajectory;
    this.artilleryResult = inspection.result;
    this.artilleryInspection = {
      targetS: this.cursor.s,
      targetZ: this.cursor.z,
      sourceS: source.s,
      sourceZ: source.z,
      geometryChecked,
      geometryValid: trajectory !== null,
    };
    this.previewDirty = false;
    this.previewCooldown = 0.1;
  }

  toggleSelectedAbility(): boolean {
    if (this.selection.size !== 1) return false;
    const unitId = this.selection.values().next().value as number | undefined;
    return unitId ? this.toggleAbility(unitId) : false;
  }

  private toggleAbility(unitId: number): boolean {
    const unit = this.world.unitById(unitId);
    const ability = unit?.ability;
    if (!unit || unit.faction !== PLAYER || !ability || ability.id === 'cloak') return false;
    const next = !ability.active;
    const changed = this.world.activateAbility(unit.id, next);
    if (changed) {
      this.hud.command(`${abilityName(ability.id)} ${next ? 'active' : 'stowed'}`);
      this.hud.invalidate();
      if (this.artillerySourceId === unit.id && this.cursor.valid) this.previewDirty = true;
    } else if (ability.cooldown > 0) {
      this.hud.alert(`${abilityName(ability.id)} cooldown: ${ability.cooldown.toFixed(1)}s`);
    } else {
      this.hud.alert(`Cannot activate ${abilityName(ability.id)} - check power and transition state`);
    }
    return changed;
  }

  selectAt(s: number, z: number, additive: boolean): void {
    const id = this.pickEntity(s, z);
    if (!additive) this.selection.clear();
    if (id) {
      const u = this.world.unitById(id);
      const st = this.world.structureById(id);
      // Only the player's own things, and only visible enemies, can be selected.
      if ((u && u.faction === PLAYER) || (st && st.faction === PLAYER)) {
        this.selection.add(id);
      }
    }
    this.observeSelection();
  }

  selectBox(s0: number, z0: number, s1: number, z1: number, additive: boolean): void {
    if (!additive) this.selection.clear();
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    // Compare arc positions through deltaS so a box that crosses the seam works.
    const mid = wrapS(s0 + deltaS(s0, s1) * 0.5);
    const half = Math.abs(deltaS(s0, s1)) * 0.5;

    let found = false;
    for (const u of this.world.units) {
      if (!u.alive || u.faction !== PLAYER) continue;
      if (Math.abs(deltaS(mid, u.s)) > half) continue;
      if (u.z < lo || u.z > hi) continue;
      this.selection.add(u.id);
      found = true;
    }
    // A box that caught nothing selects the structure under it instead, which
    // is what players expect from a small accidental drag.
    if (!found) this.selectAt(s1, z1, additive);
    else this.observeSelection();
  }

  selectAllCombat(): void {
    this.selection.clear();
    for (const u of this.world.units) {
      if (u.alive && u.faction === PLAYER && UNITS[u.kind].isMech) this.selection.add(u.id);
    }
    this.observeSelection();
  }

  setControlGroup(index: number): void {
    const ids = [...this.selection].filter((id) => {
      const unit = this.world.unitById(id);
      const structure = unit ? undefined : this.world.structureById(id);
      return unit?.faction === PLAYER || structure?.faction === PLAYER;
    });
    this.controlGroups.set(index, ids);
    this.hud.alert(`Control group ${index} set — ${ids.length} selected`);
  }

  recallControlGroup(index: number): void {
    const ids = this.controlGroups.get(index);
    if (!ids) return;
    this.cancelArtilleryTarget();
    this.hud.placing = null;
    this.selection.clear();
    for (const id of ids) {
      if (this.world.unitById(id) || this.world.structureById(id)) this.selection.add(id);
    }
    this.observeSelection();
    const first = this.selection.values().next().value as number | undefined;
    if (first) {
      const position = this.world.positionOf(first);
      if (position) this.rig.setFocus(position.s, position.z);
    }
  }

  /** Right-click: move, attack, or assist, depending on what is under it. */
  issueOrder(s: number, z: number, attackMove: boolean): void {
    if (this.world.status === 'completed' || this.directControlActive || this.hud.blocksGameplayInput) return;
    this.cancelArtilleryTarget();
    const targetId = this.pickEntity(s, z);
    const targetUnit = targetId ? this.world.unitById(targetId) : undefined;
    const targetStruct = targetId ? this.world.structureById(targetId) : undefined;
    const targetWreck = targetId ? this.world.wreckById(targetId) : undefined;
    const targetFaction = targetUnit?.faction ?? targetStruct?.faction ?? targetWreck?.faction ?? -1;
    const hostile = targetId !== 0 && targetFaction >= 0 && targetFaction !== PLAYER;

    // Spread the group out around the destination so they do not all pile onto
    // one point and shove each other.
    const members = [...this.selection]
      .map((id) => this.world.unitById(id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.faction === PLAYER);

    const cols = Math.ceil(Math.sqrt(members.length));
    members.forEach((u, i) => {
      if (hostile) {
        u.order = { kind: 'attack', s, z, targetId };
        u.targetId = targetId;
        return;
      }
      // Assist: an engineer told to click a construction site joins the build.
      if (
        UNITS[u.kind].canBuild &&
        targetStruct &&
        targetStruct.faction === PLAYER &&
        targetStruct.progress < 1
      ) {
        u.order = { kind: 'build', s: targetStruct.s, z: targetStruct.z, targetId: targetStruct.id };
        u.buildTargetId = targetStruct.id;
        return;
      }
      const gx = (i % cols) - (cols - 1) / 2;
      const gz = Math.floor(i / cols) - (cols - 1) / 2;
      const spacing = UNITS[u.kind].radius * 3.2;
      u.order = {
        kind: attackMove ? 'attackMove' : 'move',
        s: wrapS(s + gx * spacing),
        z: clamp(z + gz * spacing, -RING_HALF_WIDTH + 60, RING_HALF_WIDTH - 60),
        targetId: 0,
      };
      u.buildTargetId = 0;
    });
    if (members.length > 0) {
      this.hud.command(hostile
        ? `Focus fire — ${members.length} unit${members.length === 1 ? '' : 's'}`
        : `${attackMove ? 'Attack move' : 'Move'} — ${members.length} unit${members.length === 1 ? '' : 's'}`);
      this.emitVoiceOrder(members, hostile || attackMove ? 'attack' : 'move');
    }
  }

  /** Try to place the structure the player is holding. */
  tryBuild(s: number, z: number): boolean {
    if (this.world.status === 'completed') return false;
    const kind = this.hud.placing;
    if (!kind) return false;
    const site = this.world.tryPlaceStructure(PLAYER, kind, s, z);
    if (!site) {
      this.hud.alert(
        this.world.players[PLAYER].salvage < effectiveStructureStats(PLAYER, kind).salvageCost
          ? 'Not enough salvage'
          : 'Cannot build there',
      );
      return false;
    }
    // Send every selected engineer to work on it.
    let sent = 0;
    const builders: Unit[] = [];
    for (const id of this.selection) {
      const u = this.world.unitById(id);
      if (!u || u.faction !== PLAYER || !UNITS[u.kind].canBuild) continue;
      u.order = { kind: 'build', s, z, targetId: site.id };
      u.buildTargetId = site.id;
      sent++;
      builders.push(u);
    }
    if (sent === 0) {
      // Nothing selected can build it: grab the nearest idle engineer.
      let best: ReturnType<World['unitById']> = undefined;
      let bestD = Infinity;
      for (const u of this.world.units) {
        if (!u.alive || u.faction !== PLAYER || !UNITS[u.kind].canBuild) continue;
        const d = surfaceDist(u.s, u.z, s, z);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) {
        best.order = { kind: 'build', s, z, targetId: site.id };
        best.buildTargetId = site.id;
        builders.push(best);
      }
    }
    this.hud.placing = null;
    this.hud.command(`${STRUCTURES[kind].name} placed`);
    this.emitVoiceOrder(builders, 'move');
    return true;
  }

  canBuildHere(s: number, z: number): boolean {
    const kind = this.hud.placing;
    if (!kind) return false;
    return this.world.canPlace(PLAYER, kind, s, z);
  }

  setBuild(kind: StructureKind | null): void {
    if (this.world.status === 'completed' || this.directControlActive) return;
    if (kind) this.cancelArtilleryTarget();
    this.hud.placing = kind;
    this.hud.command(kind ? `Build mode — ${STRUCTURES[kind].name}` : 'Build mode cancelled');
  }

  cancelInteractions(): void {
    if (this.directControlActive) this.exitDirectControl();
    this.cancelArtilleryTarget();
    this.hud.placing = null;
    this.selection.clear();
    this.hud.hideSelectionRectangle();
    this.hud.invalidate();
  }

  saveGame(): SaveActionResult {
    try {
      const inactivePlayerController = new AiOpponent(PLAYER, this.difficulty, this.seed);
      const serialized = serializeGameSave(
        this.world,
        [inactivePlayerController, this.ai],
        this.aiEnabled,
        this.mission?.snapshot() ?? null,
      );
      localStorage.setItem(SAVE_SLOT_KEY, serialized);
      this.hud.alert('Game saved');
      return { ok: true, message: 'Game saved to this browser' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hud.alert('Save failed');
      return { ok: false, message: `Could not save: ${message}` };
    }
  }

  loadGame(): SaveActionResult {
    try {
      const saved = localStorage.getItem(SAVE_SLOT_KEY);
      if (!saved) return { ok: false, message: 'Could not load: no saved game in this browser' };

      // Deserialize the complete session first. Only after world and both AI
      // controllers pass validation do we replace any live authority.
      const session = deserializeGameSave(saved, this.terrain);
      const opponent = session.controllers.find(
        (controller) => controller.exportPersistenceState().faction === Faction.Choir,
      );
      if (!opponent) throw new Error('save has no Choir controller');

      this.world.restorePersistenceState(session.world.exportPersistenceState());
      this.ai = opponent;
      this.aiEnabled = session.aiEnabled;
      this.mission = session.mission;
      this.resetTransientState();
      this.hud.alert('Game loaded');
      return { ok: true, message: 'Game loaded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hud.alert('Load rejected');
      return { ok: false, message: `Could not load: ${message}` };
    }
  }

  private resetTransientState(): void {
    this.selection.clear();
    this.controlGroups.clear();
    this.cancelArtilleryTarget();
    this.hud.placing = null;
    this.hud.invalidate();
    this.cursor.valid = false;
    this.directUnitId = 0;
    this.rig.exitDirect();
    this.acc = 0;
    this.previewCooldown = 0;
    this.presentationEvents.length = 0;
    this.entities.resetTransientState();
    this.effects.resetTransientState();
    this.hud.resetTransientState();
    this.onTransientReset?.();
  }

  private observeSelection(): void {
    this.mission?.observePlayerAction({
      kind: 'selection-changed',
      selectedIds: [...this.selection],
    }, this.world);
    const units = [...this.selection]
      .map((id) => this.world.unitById(id))
      .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit && unit.faction === PLAYER))
      .map((unit) => ({ id: unit.id, kind: unit.kind }));
    if (units.length > 0) this.onPlayerVoiceAction?.({ kind: 'selection', faction: PLAYER, units });
  }

  private emitVoiceOrder(units: readonly Unit[], order: 'move' | 'attack'): void {
    if (units.length === 0) return;
    this.onPlayerVoiceAction?.({
      kind: 'order',
      faction: PLAYER,
      units: units.map((unit) => ({ id: unit.id, kind: unit.kind })),
      order,
    });
  }

  dispose(): void {
    this.onPresentationEvents = null;
    this.onTransientReset = null;
    this.onPlayerVoiceAction = null;
    this.entities.onFootfall = null;
    this.entities.dispose();
    this.effects.dispose();
    this.markers.dispose();
    this.hud.dispose();
    this.presentationEvents.length = 0;
    this.selection.clear();
    this.controlGroups.clear();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function abilityName(id: NonNullable<World['units'][number]['ability']>['id']): string {
  switch (id) {
    case 'shieldWall': return 'Shield Wall';
    case 'siegeMode': return 'Siege Mode';
    case 'umbrella': return 'Umbrella';
    case 'cloak': return 'Cloak';
  }
}
