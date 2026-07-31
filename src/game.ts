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
import { Faction, STRUCTURES, UNITS, type StructureKind } from '@sim/data';
import { World } from '@sim/world';
import { RenderAnchor } from '@render/anchor';
import { CameraRig } from '@render/cameraRig';
import { EntityRenderer } from '@render/entityRenderer';
import { Effects } from '@render/effects';
import { Hud } from '@ui/hud';
import { Markers } from '@render/markers';

export const PLAYER: Faction = Faction.Compact;

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

  private acc = 0;
  private readonly _ray = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();
  private readonly _v = new THREE.Vector3();
  private readonly _prevAnchor = new THREE.Vector3();

  constructor(
    seed: number,
    private readonly anchor: RenderAnchor,
    private readonly rig: CameraRig,
    difficulty: Difficulty = 'veteran',
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
      this.anchor.set(s, z);
    };
  }

  get objects(): THREE.Object3D[] {
    return [this.entities.object, this.effects.object, this.markers.object];
  }

  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    // Fixed-timestep simulation. Capped so that a long stall (an alt-tab, a
    // shader compile) cannot trigger a death spiral of catch-up ticks.
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 6) {
      this.world.step();
      this.ai.update(this.world, SIM_DT);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    const events = this.world.drainEvents();
    this.effects.consume(events, this.world, this.anchor);
    this.effects.update(dt, this.world, this.anchor, this.rig.camera);
    if (this.effects.shake > 0) this.rig.addShake(this.effects.shake);

    this.entities.update(this.world, this.anchor, time);
    this.markers.update(this.world, this.anchor, this.selection, this.cursor, this.hud.placing, PLAYER);
    this.hud.update(dt, this.world, PLAYER, this.selection, this.rig.s, this.rig.z);

    // Drop dead entities from the selection so the panel does not show ghosts.
    for (const id of [...this.selection]) {
      if (!this.world.unitById(id) && !this.world.structureById(id)) this.selection.delete(id);
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
      const r = STRUCTURES[st.kind].radius + 4;
      const d = surfaceDist(st.s, st.z, s, z);
      if (d < r && d < bestD) {
        bestD = d;
        best = st.id;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

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

  /** Right-click: move, attack, or assist, depending on what is under it. */
  issueOrder(s: number, z: number, attackMove: boolean): void {
    const targetId = this.pickEntity(s, z);
    const targetUnit = targetId ? this.world.unitById(targetId) : undefined;
    const targetStruct = targetId ? this.world.structureById(targetId) : undefined;
    const targetFaction = targetUnit?.faction ?? targetStruct?.faction ?? -1;
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
    const kind = this.hud.placing;
    if (!kind) return false;
    const site = this.world.tryPlaceStructure(PLAYER, kind, s, z);
    if (!site) {
      this.hud.alert(
        this.world.players[PLAYER].salvage < (STRUCTURES[kind].cost.salvage ?? 0)
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
    this.hud.placing = kind;
  }

  dispose(): void {
    this.hud.root.remove();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
