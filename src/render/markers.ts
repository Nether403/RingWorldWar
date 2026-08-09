/**
 * World-space UI: selection rings, health bars, the build ghost, and incoming
 * impact warnings.
 *
 * All drawn as flat geometry that hugs the ground rather than as screen-space
 * overlays, because on a curved wrapped world a screen-space ring would detach
 * from its unit the moment the surface tilts away.
 *
 * Everything here lives in two pooled meshes and is rebuilt each frame, so the
 * count of markers has no effect on draw calls.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import { FACTION_COLOR, Faction, STRUCTURES, UNITS, type StructureKind } from '@sim/data';
import { DEPOSIT_PLACEMENT_RADIUS, type BallisticFireResult, type World } from '@sim/world';
import type { TrajectorySample } from '@sim/ballistics';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';
import type { RuntimeScenarioResolvedOpeningView } from '../scenario/worldFactory';

const MAX_RING_SEGMENTS = 3600;
const MAX_BAR_QUADS = 400;
const RING_STEPS = 24;
/** Markers beyond this arc distance are skipped -- see the note below. */
const MARKER_RANGE = 2600;

export class Markers {
  readonly object = new THREE.Group();

  private rings: THREE.LineSegments;
  private ringPos: Float32Array;
  private ringCol: Float32Array;

  private bars: THREE.Mesh;
  private barPos: Float32Array;
  private barCol: Float32Array;

  private readonly _v = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();

  constructor() {
    this.object.name = 'markers';
    this.object.renderOrder = 10;

    const rp = MAX_RING_SEGMENTS * 2 * 3;
    this.ringPos = new Float32Array(rp);
    this.ringCol = new Float32Array(rp);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(this.ringCol, 3));
    this.rings = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 10;
    this.object.add(this.rings);

    const bp = MAX_BAR_QUADS * 6 * 3;
    this.barPos = new Float32Array(bp);
    this.barCol = new Float32Array(bp);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.barPos, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(this.barCol, 3));
    this.bars = new THREE.Mesh(
      bg,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 11;
    this.object.add(this.bars);
  }

  update(
    world: World,
    anchor: RenderAnchor,
    selection: Set<number>,
    cursor: { s: number; z: number; valid: boolean },
    placing: StructureKind | null,
    player: Faction,
    trajectory: readonly TrajectorySample[] | null,
    directionalArtilleryTargeting: boolean,
    artilleryResult: BallisticFireResult | null,
    camera: THREE.Camera,
    openingGuidance: RuntimeScenarioResolvedOpeningView | null = null,
  ): void {
    let rv = 0;
    let bv = 0;

    const pushRingSeg = (
      s0: number,
      z0: number,
      s1: number,
      z1: number,
      h: number,
      r: number,
      g: number,
      b: number,
    ): void => {
      if (rv + 6 > this.ringPos.length) return;
      anchor.toVector(s0, world.terrain.heightAt(s0, z0) + h, z0, this._v);
      this.ringPos[rv] = this._v.x;
      this.ringPos[rv + 1] = this._v.y;
      this.ringPos[rv + 2] = this._v.z;
      anchor.toVector(s1, world.terrain.heightAt(s1, z1) + h, z1, this._v);
      this.ringPos[rv + 3] = this._v.x;
      this.ringPos[rv + 4] = this._v.y;
      this.ringPos[rv + 5] = this._v.z;
      for (let i = 0; i < 2; i++) {
        this.ringCol[rv + i * 3] = r;
        this.ringCol[rv + i * 3 + 1] = g;
        this.ringCol[rv + i * 3 + 2] = b;
      }
      rv += 6;
    };

    const pushAirSeg = (
      a: TrajectorySample,
      b: TrajectorySample,
      color: [number, number, number],
    ): void => {
      if (rv + 6 > this.ringPos.length) return;
      if (
        Math.abs(deltaS(anchor.s, a.s)) > MARKER_RANGE &&
        Math.abs(deltaS(anchor.s, b.s)) > MARKER_RANGE
      ) return;
      anchor.toVector(a.s, a.h, a.z, this._v);
      this.ringPos[rv] = this._v.x;
      this.ringPos[rv + 1] = this._v.y;
      this.ringPos[rv + 2] = this._v.z;
      anchor.toVector(b.s, b.h, b.z, this._v);
      this.ringPos[rv + 3] = this._v.x;
      this.ringPos[rv + 4] = this._v.y;
      this.ringPos[rv + 5] = this._v.z;
      for (let i = 0; i < 2; i++) {
        this.ringCol[rv + i * 3] = color[0];
        this.ringCol[rv + i * 3 + 1] = color[1];
        this.ringCol[rv + i * 3 + 2] = color[2];
      }
      rv += 6;
    };

    /** A circle on the surface, following the terrain so it never floats. */
    const circle = (
      cs: number,
      cz: number,
      radius: number,
      col: [number, number, number],
      dashed = false,
      height = 1.2,
    ): void => {
      for (let i = 0; i < RING_STEPS; i++) {
        if (dashed && i % 2 === 1) continue;
        const a0 = (i / RING_STEPS) * Math.PI * 2;
        const a1 = ((i + 1) / RING_STEPS) * Math.PI * 2;
        pushRingSeg(
          cs + Math.cos(a0) * radius,
          cz + Math.sin(a0) * radius,
          cs + Math.cos(a1) * radius,
          cz + Math.sin(a1) * radius,
          height,
          col[0],
          col[1],
          col[2],
        );
      }
    };

    let depositGuidanceCount = 0;
    if (placing === 'extractor') {
      for (const deposit of world.deposits) {
        if (!world.isDepositAvailable(deposit)) continue;
        if (!world.isVisible(player, deposit.s, deposit.z)) continue;
        if (Math.abs(deltaS(anchor.s, deposit.s)) > MARKER_RANGE) continue;
        circle(deposit.s, deposit.z, DEPOSIT_PLACEMENT_RADIUS, [1, 0.72, 0.18], false, 3.5);
        circle(deposit.s, deposit.z, 16, [1, 0.9, 0.42], true, 3.5);
        pushRingSeg(deposit.s - 24, deposit.z, deposit.s + 24, deposit.z, 3.5, 1, 0.9, 0.42);
        pushRingSeg(deposit.s, deposit.z - 24, deposit.s, deposit.z + 24, 3.5, 1, 0.9, 0.42);
        depositGuidanceCount++;
      }
    }
    this.object.userData.depositGuidanceCount = depositGuidanceCount;

    let openingDepositCount = 0;
    if (openingGuidance?.highlightDeposits) {
      for (const deposit of world.deposits) {
        if (!world.isDepositAvailable(deposit)) continue;
        if (!world.isVisible(player, deposit.s, deposit.z)) continue;
        if (Math.abs(deltaS(anchor.s, deposit.s)) > 500) continue;
        circle(deposit.s, deposit.z, 32, [1, 0.72, 0.18], true, 4);
        circle(deposit.s, deposit.z, 10, [1, 0.9, 0.42], false, 4);
        pushRingSeg(deposit.s - 18, deposit.z, deposit.s + 18, deposit.z, 4, 1, 0.9, 0.42);
        pushRingSeg(deposit.s, deposit.z - 18, deposit.s, deposit.z + 18, 4, 1, 0.9, 0.42);
        openingDepositCount++;
      }
    }
    this.object.userData.openingDepositCount = openingDepositCount;

    let openingGuidanceCount = 0;
    if (openingGuidance) {
      const context = openingGuidance.contextEntityIds
        .map((id) => world.unitById(id) ?? world.structureById(id))
        .filter((entity) => entity !== undefined);
      for (const entity of context) {
        const radius = 'progress' in entity
          ? STRUCTURES[entity.kind].radius * 1.45
          : UNITS[entity.kind].radius * 2.2;
        circle(entity.s, entity.z, radius, [1, 0.52, 0.16], true, 3.5);
        openingGuidanceCount++;
      }
      const pulse = 1 + Math.sin(world.time * 4) * 0.12;
      for (const id of openingGuidance.actionEntityIds) {
        const entity = world.unitById(id) ?? world.structureById(id);
        if (!entity) continue;
        const radius = ('progress' in entity ? STRUCTURES[entity.kind].radius : UNITS[entity.kind].radius) * 2.5;
        circle(entity.s, entity.z, Math.max(10, radius) * pulse, [0.25, 0.92, 1], false, 4.5);
        circle(entity.s, entity.z, Math.max(6, radius * 0.55), [0.75, 0.97, 1], true, 4.5);
        for (const origin of context) {
          pushRingSeg(origin.s, origin.z, entity.s, entity.z, 2.5, 0.22, 0.58, 0.66);
        }
        openingGuidanceCount++;
      }
    }
    this.object.userData.openingGuidanceCount = openingGuidanceCount;

    // --- Selection rings -----------------------------------------------------
    for (const id of selection) {
      const u = world.unitById(id);
      if (u) {
        if (Math.abs(deltaS(anchor.s, u.s)) > MARKER_RANGE) continue;
        circle(u.s, u.z, UNITS[u.kind].radius * 1.9, [0.35, 1.0, 0.55]);
        // A short line showing where it has been told to go.
        if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
          pushRingSeg(u.s, u.z, u.order.s, u.order.z, 2.5, 0.2, 0.7, 0.35);
          circle(u.order.s, u.order.z, 5, [0.2, 0.7, 0.35], true);
        }
        continue;
      }
      const st = world.structureById(id);
      if (st) circle(st.s, st.z, STRUCTURES[st.kind].radius * 1.25, [0.35, 1.0, 0.55]);
    }

    if (selection.size === 1) {
      const selectedId = selection.values().next().value as number | undefined;
      if (selectedId) {
        const unit = world.unitById(selectedId);
        const structure = unit ? undefined : world.structureById(selectedId);
        const sensor = unit ?? structure;
        const range = world.effectiveSensorRange(selectedId, player);
        if (sensor && range > 0 && Math.abs(deltaS(anchor.s, sensor.s)) <= MARKER_RANGE) {
          circle(sensor.s, sensor.z, range, [0.45, 0.82, 1], true);
        }
      }
    }

    // --- Neutral capture points -----------------------------------------------
    // Culled by arc distance: without this, a node on the far side of the ring
    // draws its capture circle across the sky, because the far side really is
    // up there and the projection is honest about it.
    for (const st of world.structures) {
      if (!st.alive || st.kind !== 'spinalNode') continue;
      if (Math.abs(deltaS(anchor.s, st.s)) > MARKER_RANGE) continue;
      const col: [number, number, number] =
        st.faction < 0
          ? [0.6, 0.66, 0.72]
          : st.faction === Faction.Compact
            ? [0.94, 0.51, 0.12]
            : [0.25, 0.82, 0.91];
      circle(st.s, st.z, 110, col, true);
    }

    // --- Incoming artillery warnings -----------------------------------------
    // Only for shells the player can actually see coming. This is the single
    // most important readability aid in the game: a shell lands 20+ seconds
    // after launch, and without a telegraph the player cannot react at all.
    for (const pr of world.projectiles) {
      if (!pr.alive || !pr.ballistic) continue;
      if (!world.isProjectileVisible(player, pr)) continue;
      if (Math.abs(deltaS(anchor.s, pr.impactS)) > MARKER_RANGE) continue;
      if (pr.faction === player) {
        circle(pr.impactS, pr.impactZ, 26, [0.35, 0.85, 0.5], true);
      } else if (world.isVisible(player, pr.impactS, pr.impactZ)) {
        const pulse = 0.55 + 0.45 * Math.sin(world.time * 9);
        circle(pr.impactS, pr.impactZ, 30, [1.0 * pulse, 0.18 * pulse, 0.12 * pulse]);
      }
    }

    // --- Player artillery trajectory -----------------------------------------
    this.object.userData.artilleryTargetDirection = directionalArtilleryTargeting && cursor.valid
      ? 'antispinward'
      : null;
    if (directionalArtilleryTargeting && cursor.valid) {
      const hasPreview = Boolean(trajectory && trajectory.length > 1);
      const resultMatchesCursor = artilleryResult?.targetS !== undefined &&
        artilleryResult.targetZ !== undefined &&
        Math.abs(deltaS(cursor.s, artilleryResult.targetS)) < 1e-6 &&
        Math.abs(cursor.z - artilleryResult.targetZ) < 1e-6;
      const canFire = artilleryResult?.ok === true && resultMatchesCursor;
      circle(cursor.s, cursor.z, 24, canFire ? [0.35, 1, 0.65] : [1, 0.56, 0.18], true);
      // Target-side orientation cue: the arrow always points toward the
      // favorable antispinward side, independent of trajectory validity.
      pushRingSeg(cursor.s + 34, cursor.z, cursor.s - 76, cursor.z, 2.2, 1, 0.72, 0.3);
      pushRingSeg(cursor.s - 76, cursor.z, cursor.s - 55, cursor.z - 14, 2.2, 1, 0.72, 0.3);
      pushRingSeg(cursor.s - 76, cursor.z, cursor.s - 55, cursor.z + 14, 2.2, 1, 0.72, 0.3);
      if (hasPreview && trajectory) {
        const previewColor: [number, number, number] = canFire ? [0.35, 1, 0.65] : [1, 0.62, 0.22];
        for (let i = 3; i < trajectory.length; i += 3) {
          pushAirSeg(trajectory[i - 3]!, trajectory[i]!, previewColor);
        }
        const last = trajectory.length - 1;
        const previous = last - (last % 3 || 3);
        if (previous >= 0 && previous !== last) {
          pushAirSeg(trajectory[previous]!, trajectory[last]!, previewColor);
        }
      }
    }

    // --- Build ghost ----------------------------------------------------------
    if (placing && cursor.valid) {
      const ok = world.canPlace(player, placing, cursor.s, cursor.z);
      const col: [number, number, number] = ok ? [0.35, 1.0, 0.55] : [1.0, 0.28, 0.2];
      const def = STRUCTURES[placing];
      circle(cursor.s, cursor.z, def.radius, col);
      circle(cursor.s, cursor.z, def.radius * 0.5, col, true);
      // Show the anchor radius so the player learns the build-range rule.
      circle(cursor.s, cursor.z, 6, col);
    }

    // --- Health bars ----------------------------------------------------------
    // Drawn only for damaged or selected things, so a healthy base is not a
    // wall of green bars.
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const pushBar = (
      s: number,
      z: number,
      h: number,
      frac: number,
      width: number,
      col: [number, number, number],
    ): void => {
      if (bv + 36 > this.barPos.length) return;
      anchor.toVector(s, h, z, this._v);
      const w = width;
      const t = 0.9;
      // Background then fill, both billboarded crudely along local x.
      const emit = (x0: number, x1: number, c: [number, number, number]): void => {
        const pts = [
          [x0, -t],
          [x1, -t],
          [x1, t],
          [x0, -t],
          [x1, t],
          [x0, t],
        ];
        for (const [dx, dy] of pts) {
          this.barPos[bv] = this._v.x + this._right.x * dx! + this._up.x * dy!;
          this.barPos[bv + 1] = this._v.y + this._right.y * dx! + this._up.y * dy!;
          this.barPos[bv + 2] = this._v.z + this._right.z * dx! + this._up.z * dy!;
          this.barCol[bv] = c[0];
          this.barCol[bv + 1] = c[1];
          this.barCol[bv + 2] = c[2];
          bv += 3;
        }
      };
      emit(-w, w, [0.05, 0.06, 0.08]);
      if (frac > 0) emit(-w, -w + 2 * w * frac, col);
      void col;
    };

    for (const u of world.units) {
      if (!u.alive) continue;
      if (!world.isEntityVisible(player, u.id)) continue;
      if (Math.abs(deltaS(anchor.s, u.s)) > 900) continue;
      const def = UNITS[u.kind];
      const frac = u.hp / u.maxHp;
      if (frac > 0.985 && !selection.has(u.id)) continue;
      const col: [number, number, number] =
        u.faction === player
          ? frac > 0.5
            ? [0.35, 0.92, 0.5]
            : frac > 0.25
              ? [0.95, 0.75, 0.3]
              : [1.0, 0.32, 0.22]
          : [1.0, 0.35, 0.28];
      pushBar(u.s, u.z, world.terrain.heightAt(u.s, u.z) + def.height * 1.15, frac, def.radius * 1.4, col);
    }

    for (const st of world.structures) {
      if (!st.alive || st.faction < 0) continue;
      if (!world.isEntityVisible(player, st.id)) continue;
      if (Math.abs(deltaS(anchor.s, st.s)) > 900) continue;
      const def = STRUCTURES[st.kind];
      const frac = st.hp / st.maxHp;
      if (frac > 0.985 && st.progress >= 1 && !selection.has(st.id)) continue;
      const col: [number, number, number] =
        st.progress < 1 ? [0.95, 0.7, 0.25] : frac > 0.5 ? [0.35, 0.92, 0.5] : [1.0, 0.32, 0.22];
      pushBar(
        st.s,
        st.z,
        world.terrain.heightAt(st.s, st.z) + def.height * 1.1,
        st.progress < 1 ? st.progress : frac,
        def.radius * 0.9,
        col,
      );
    }

    if (rv < this.ringPos.length) this.ringPos.fill(0, rv);
    if (bv < this.barPos.length) this.barPos.fill(0, bv);
    this.rings.geometry.attributes.position!.needsUpdate = true;
    this.rings.geometry.attributes.color!.needsUpdate = true;
    this.bars.geometry.attributes.position!.needsUpdate = true;
    this.bars.geometry.attributes.color!.needsUpdate = true;
    void RING_CIRCUMFERENCE;
    void FACTION_COLOR;
  }

  dispose(): void {
    disposeObject(this.object);
  }
}
