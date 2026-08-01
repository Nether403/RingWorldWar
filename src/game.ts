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
import { deserializeMatchSession, serializeMatchSession } from '@headless/session';
import {
  effectiveStructureStats,
  Faction,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
} from '@sim/data';
import { World } from '@sim/world';
import type { TrajectorySample } from '@sim/ballistics';
import { RenderAnchor } from '@render/anchor';
import { CameraRig } from '@render/cameraRig';
import { EntityRenderer } from '@render/entityRenderer';
import { Effects } from '@render/effects';
import { Hud } from '@ui/hud';
import { Markers } from '@render/markers';

export const PLAYER: Faction = Faction.Compact;
export const SAVE_SLOT_KEY = 'ring-world-war/save-slot';

export interface SaveActionResult {
  ok: boolean;
  message: string;
}

export class Game {
  readonly world: World;
  readonly terrain: Terrain;
  readonly entities: EntityRenderer;
  readonly effects: Effects;
  readonly markers: Markers;
  readonly hud: Hud;
  private ai: AiOpponent;

  selection = new Set<number>();
  /** Ground point under the cursor, in surface coordinates. */
  cursor = { s: 0, z: 0, valid: false };
  trajectoryPreview: TrajectorySample[] | null = null;
  private artillerySourceId = 0;
  private artilleryWeaponId = '';
  private directUnitId = 0;
  private readonly controlGroups = new Map<number, number[]>();
  private previewDirty = false;
  private previewCooldown = 0;
  /** Duration of the most recent fixed simulation step, excluding AI work. */
  simStepMs = 0;

  private acc = 0;
  private readonly _ray = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();
  private readonly _v = new THREE.Vector3();
  private readonly _prevAnchor = new THREE.Vector3();

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

    this.hud.onMinimapClick = (s, z) => {
      this.rig.setFocus(s, z);
    };
    this.hud.onArtilleryTarget = (sourceId, weaponId) => this.beginArtilleryTarget(sourceId, weaponId);
    this.hud.onAbilityToggle = (unitId) => this.toggleAbility(unitId);
    this.hud.onBuildRequest = (kind) => this.setBuild(kind);
  }

  get objects(): THREE.Object3D[] {
    return [this.entities.object, this.effects.object, this.markers.object];
  }

  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.previewCooldown = Math.max(0, this.previewCooldown - dt);
    if (this.artillerySourceId && this.cursor.valid && this.previewDirty && this.previewCooldown === 0) {
      this.trajectoryPreview = this.world.previewBallistic(
        this.artillerySourceId,
        this.cursor.s,
        this.cursor.z,
        PLAYER,
        this.artilleryWeaponId,
      );
      this.previewDirty = false;
      this.previewCooldown = 0.1;
    }
    // Fixed-timestep simulation. Capped so that a long stall (an alt-tab, a
    // shader compile) cannot trigger a death spiral of catch-up ticks.
    this.acc += dt;
    let steps = 0;
    let simStepTotal = 0;
    while (this.acc >= SIM_DT && steps < 6) {
      const stepStart = performance.now();
      this.world.step();
      simStepTotal += performance.now() - stepStart;
      this.ai.update(this.world, SIM_DT);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps > 0) this.simStepMs = simStepTotal / steps;
    if (steps === 6) this.acc = 0;

    const events = this.world.drainEvents();
    this.effects.consume(events, this.world, this.anchor, PLAYER);
    this.effects.update(dt, this.world, this.anchor, PLAYER, this.rig.camera);
    if (this.effects.shake > 0) this.rig.addShake(this.effects.shake);

    this.entities.update(this.world, this.anchor, time, PLAYER, this.acc / SIM_DT);
    this.markers.update(
      this.world,
      this.anchor,
      this.selection,
      this.cursor,
      this.hud.placing,
      PLAYER,
      this.trajectoryPreview,
      this.artilleryTargeting,
      this.rig.camera,
    );
    this.hud.update(dt, this.world, PLAYER, this.selection, this.rig.s, this.rig.z);

    // Drop dead entities from the selection so the panel does not show ghosts.
    for (const id of [...this.selection]) {
      if (!this.world.unitById(id) && !this.world.structureById(id)) this.selection.delete(id);
    }
    if (this.artillerySourceId && !this.world.structureById(this.artillerySourceId)) {
      this.cancelArtilleryTarget();
    }
  }

  /** Called after the anchor re-bases, so render-space effects follow it. */
  onRebase(previousS: number, previousZ: number): void {
    // Where the old origin now sits in the new frame.
    this.anchor.toVector(previousS, 0, previousZ, this._prevAnchor);
    this.effects.rebase(this._prevAnchor);
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
    const source = this.world.structureById(sourceId);
    if (!source || source.faction !== PLAYER) return;
    const selectedWeapon = weaponId ?? STRUCTURES[source.kind].weapons.find((id) => WEAPONS[id]?.kind === 'ballistic');
    if (!selectedWeapon || !STRUCTURES[source.kind].weapons.includes(selectedWeapon)) return;
    if (WEAPONS[selectedWeapon]?.kind !== 'ballistic') return;
    this.hud.placing = null;
    this.artillerySourceId = sourceId;
    this.artilleryWeaponId = selectedWeapon;
    this.trajectoryPreview = null;
    this.previewDirty = true;
    this.hud.alert(
      WEAPONS[selectedWeapon]?.flightMode === 'chord'
        ? 'Choose a target - Chord Shot can blind-fire anywhere on the ring'
        : 'Choose a spotted target - antispinward carries farther; click to fire',
    );
    if (this.cursor.valid) this.updateCursor(this.cursor.s, this.cursor.z);
  }

  updateCursor(s: number, z: number): void {
    this.cursor.s = s;
    this.cursor.z = z;
    this.cursor.valid = true;
    if (this.artillerySourceId) this.previewDirty = true;
  }

  fireArtilleryTarget(s: number, z: number): boolean {
    if (!this.artillerySourceId) return false;
    const weaponId = this.artilleryWeaponId;
    const fired = this.world.fireBallisticAt(this.artillerySourceId, s, z, PLAYER, weaponId);
    const blindFire = WEAPONS[weaponId]?.flightMode === 'chord';
    this.hud.alert(
      fired
        ? blindFire ? 'Chord Shot away' : 'Rocket away'
        : blindFire
          ? 'Target unreachable or launcher reloading'
          : 'Target unreachable, unspotted, or launcher reloading',
    );
    if (fired) this.cancelArtilleryTarget();
    return fired;
  }

  cancelArtilleryTarget(): void {
    this.artillerySourceId = 0;
    this.artilleryWeaponId = '';
    this.trajectoryPreview = null;
    this.previewDirty = false;
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
      this.hud.alert(`${abilityName(ability.id)} ${next ? 'activated' : 'deactivated'}`);
      this.hud.invalidate();
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
  }

  selectAllCombat(): void {
    this.selection.clear();
    for (const u of this.world.units) {
      if (u.alive && u.faction === PLAYER && UNITS[u.kind].isMech) this.selection.add(u.id);
    }
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
    const first = this.selection.values().next().value as number | undefined;
    if (first) {
      const position = this.world.positionOf(first);
      if (position) this.rig.setFocus(position.s, position.z);
    }
  }

  /** Right-click: move, attack, or assist, depending on what is under it. */
  issueOrder(s: number, z: number, attackMove: boolean): void {
    if (this.world.status === 'completed') return;
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
    for (const id of this.selection) {
      const u = this.world.unitById(id);
      if (!u || u.faction !== PLAYER || !UNITS[u.kind].canBuild) continue;
      u.order = { kind: 'build', s, z, targetId: site.id };
      u.buildTargetId = site.id;
      sent++;
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
      }
    }
    this.hud.placing = null;
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
  }

  cancelInteractions(): void {
    if (this.directControlActive) this.exitDirectControl();
    this.cancelArtilleryTarget();
    this.hud.placing = null;
    this.selection.clear();
    this.hud.invalidate();
  }

  saveGame(): SaveActionResult {
    try {
      const inactivePlayerController = new AiOpponent(PLAYER, this.difficulty, this.seed);
      const serialized = serializeMatchSession(this.world, [inactivePlayerController, this.ai]);
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
      const session = deserializeMatchSession(saved, this.terrain);
      const opponent = session.controllers.find(
        (controller) => controller.exportPersistenceState().faction === Faction.Choir,
      );
      if (!opponent) throw new Error('save has no Choir controller');

      this.world.restorePersistenceState(session.world.exportPersistenceState());
      this.ai = opponent;
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
    this.entities.resetTransientState();
  }

  dispose(): void {
    this.hud.root.remove();
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
