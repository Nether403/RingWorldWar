/**
 * Draws units and structures.
 *
 * Everything is instanced: one InstancedMesh per (part, faction) for mechs and
 * per (kind, faction) for buildings. A mech contributes eight instances across
 * five meshes, so a hundred-mech battle still costs a few dozen draw calls.
 *
 * Mech locomotion is fully procedural -- there are no keyframes anywhere in the
 * project. A phase clock drives an alternating gait; feet are planted onto the
 * terrain by raycast and the knee is resolved with a two-bone analytic IK
 * solver; the body bobs and rolls in response to which foot is loaded. This is
 * not a shortcut around authored animation, it is the better answer here: it
 * adapts to arbitrary slope and speed for free, which a wrapped curved world
 * demands, and it is where nearly all of the sense of weight comes from.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import {
  buildMech,
  buildStructure,
  makeHullMaterial,
  type MechClass,
  type MechRig,
  type StructureModel,
} from '@gen/models';
import {
  FACTION_COLOR,
  Faction,
  STRUCTURES,
  UNITS,
  type StructureKind,
} from '@sim/data';
import type { World } from '@sim/world';
import type { RenderAnchor } from './anchor';

const MECH_CLASSES: MechClass[] = ['vanguard', 'longbow', 'wisp', 'aegis'];
const PART_NAMES = ['pelvis', 'torso', 'upperLeg', 'lowerLeg', 'foot'] as const;
type PartName = (typeof PART_NAMES)[number];

const MAX_PER_BUCKET = 128;

interface FactionMaterials {
  material: THREE.MeshStandardMaterial;
  uniforms: ReturnType<typeof makeHullMaterial>['uniforms'];
}

export class EntityRenderer {
  readonly object = new THREE.Group();

  private rigs = new Map<MechClass, MechRig>();
  private structureModels = new Map<StructureKind, StructureModel>();
  private mats: FactionMaterials[] = [];
  /** key: `${cls}|${part}|${faction}` */
  private mechMeshes = new Map<string, THREE.InstancedMesh>();
  /** key: `${kind}|${faction}` */
  private structMeshes = new Map<string, THREE.InstancedMesh>();
  private counts = new Map<string, number>();

  /** Engineers are drawn as a simple hull rather than as a walker. */
  private engineerGeo: THREE.BufferGeometry;
  private engineerMeshes: THREE.InstancedMesh[] = [];

  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _m = new THREE.Matrix4();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  private readonly _basis = new THREE.Matrix4();

  /** Per-unit foot state, keyed by unit id, so gait is continuous over time. */
  private feet = new Map<number, FootState>();

  constructor(seed: number) {
    this.object.name = 'entities';

    for (const f of [Faction.Compact, Faction.Choir]) {
      this.mats[f] = makeHullMaterial(FACTION_COLOR[f]);
    }
    // A third, desaturated material for neutral structures.
    this.mats[2] = makeHullMaterial(0x8fa0b0);

    for (const cls of MECH_CLASSES) {
      const rig = buildMech(cls, seed + cls.length * 7919);
      this.rigs.set(cls, rig);
      for (const part of PART_NAMES) {
        for (const f of [Faction.Compact, Faction.Choir]) {
          const mesh = new THREE.InstancedMesh(rig.parts[part], this.mats[f]!.material, MAX_PER_BUCKET);
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.count = 0;
          this.mechMeshes.set(`${cls}|${part}|${f}`, mesh);
          this.object.add(mesh);
        }
      }
    }

    const kinds: StructureKind[] = [
      'bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator',
      'mechFoundry', 'rocketBattery', 'pointDefense', 'radarMast', 'spinalNode',
    ];
    for (const kind of kinds) {
      const model = buildStructure(kind, seed + kind.length * 104729);
      this.structureModels.set(kind, model);
      for (let f = 0; f < 3; f++) {
        const mesh = new THREE.InstancedMesh(model.geometry, this.mats[f]!.material, 64);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        this.structMeshes.set(`${kind}|${f}`, mesh);
        this.object.add(mesh);
      }
    }

    // Engineers: a small hovering hull, visually distinct from the mechs.
    this.engineerGeo = buildStructure('pointDefense', seed).geometry.clone();
    this.engineerGeo.scale(0.28, 0.28, 0.28);
    for (const f of [Faction.Compact, Faction.Choir]) {
      const mesh = new THREE.InstancedMesh(this.engineerGeo, this.mats[f]!.material, MAX_PER_BUCKET);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      this.engineerMeshes[f] = mesh;
      this.object.add(mesh);
    }
  }

  /** Footprint radius, so the UI can size selection rings correctly. */
  structureRadius(kind: StructureKind): number {
    return this.structureModels.get(kind)?.radius ?? STRUCTURES[kind].radius;
  }

  update(world: World, anchor: RenderAnchor, time: number, viewer: Faction, alpha: number): void {
    this.counts.clear();

    for (const m of this.mechMeshes.values()) m.count = 0;
    for (const m of this.structMeshes.values()) m.count = 0;
    for (const m of this.engineerMeshes) if (m) m.count = 0;

    this.drawStructures(world, anchor, viewer);
    this.drawUnits(world, anchor, time, viewer, alpha);

    for (const m of this.mechMeshes.values()) if (m.count > 0) m.instanceMatrix.needsUpdate = true;
    for (const m of this.structMeshes.values()) if (m.count > 0) m.instanceMatrix.needsUpdate = true;
    for (const m of this.engineerMeshes) if (m && m.count > 0) m.instanceMatrix.needsUpdate = true;

    // Prune foot state for units that no longer exist, so the map cannot grow
    // without bound over a long match.
    if (world.tick % 120 === 0) {
      const live = new Set(world.units.filter((u) => u.alive).map((u) => u.id));
      for (const id of this.feet.keys()) if (!live.has(id)) this.feet.delete(id);
    }
  }

  // -------------------------------------------------------------------------

  private drawStructures(world: World, anchor: RenderAnchor, viewer: Faction): void {
    for (const st of world.structures) {
      if (!st.alive) continue;
      if (!world.isEntityVisible(viewer, st.id)) continue;
      // Cull by arc distance: anything more than a quarter of the way round is
      // both tiny and behind the far-side haze.
      if (Math.abs(deltaS(anchor.s, st.s)) > RING_CIRCUMFERENCE * 0.3) continue;

      const f = st.faction < 0 ? 2 : (st.faction as number);
      const mesh = this.structMeshes.get(`${st.kind}|${f}`);
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;

      const ground = world.terrain.heightAt(st.s, st.z);
      anchor.toVector(st.s, ground, st.z, this._v);
      anchor.orientation(st.s, st.yaw, this._q);

      // Construction sites rise out of the ground as they complete, which
      // communicates progress without needing a progress bar in the world.
      const grow = st.progress >= 1 ? 1 : 0.25 + 0.75 * st.progress;
      this._scale.set(1, grow, 1);
      this._m.compose(this._v, this._q, this._scale);
      mesh.setMatrixAt(mesh.count++, this._m);
    }
  }

  private drawUnits(world: World, anchor: RenderAnchor, time: number, viewer: Faction, alpha: number): void {
    for (const u of world.units) {
      if (!u.alive) continue;
      if (!world.isEntityVisible(viewer, u.id)) continue;
      const s = wrapLerp(u.prevS, u.s, alpha);
      const z = THREE.MathUtils.lerp(u.prevZ, u.z, alpha);
      const yaw = angleLerp(u.prevYaw, u.yaw, alpha);
      const aimYaw = angleLerp(u.prevAimYaw, u.aimYaw, alpha);
      if (Math.abs(deltaS(anchor.s, s)) > RING_CIRCUMFERENCE * 0.3) continue;

      const def = UNITS[u.kind];
      const ground = world.terrain.heightAt(s, z);

      if (!def.isMech) {
        const mesh = this.engineerMeshes[u.faction];
        if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;
        // Engineers hover, with a slight bob so they never look parked.
        const bob = Math.sin(time * 2.4 + u.id) * 0.35;
        anchor.toVector(s, ground + 3 + bob, z, this._v);
        anchor.orientation(s, yaw, this._q);
        this._scale.set(1, 1, 1);
        this._m.compose(this._v, this._q, this._scale);
        mesh.setMatrixAt(mesh.count++, this._m);
        continue;
      }

      this.drawMech(u.kind as MechClass, u, world, anchor, ground, time, s, z, yaw, aimYaw);
    }
  }

  /**
   * Place one mech's parts.
   *
   * Works in the mech's own local frame (x = right, y = up, z = forward), then
   * composes that with the ring orientation at the end. Doing the animation in
   * a flat local frame and only meeting the ring's curvature once is what keeps
   * the walk cycle from having to know anything about the world's shape.
   */
  private drawMech(
    cls: MechClass,
    u: World['units'][number],
    world: World,
    anchor: RenderAnchor,
    ground: number,
    time: number,
    s: number,
    z: number,
    yaw: number,
    aimYaw: number,
  ): void {
    const rig = this.rigs.get(cls);
    if (!rig) return;
    const f = u.faction as number;

    let fs = this.feet.get(u.id);
    if (!fs) {
      fs = { phase: 0, plant: [0, 0], lift: [0, 0], stride: [0, 0] };
      this.feet.set(u.id, fs);
    }

    // --- Gait clock ---------------------------------------------------------
    // Phase advances with distance travelled, not with time, so the stride
    // length stays constant and the feet never skate.
    const strideLen = rig.height * 0.55;
    fs.phase = (u.gait / strideLen) % 1;
    const moving = u.speed > 0.3;

    // Each leg is half a cycle out of phase.
    const legPhase = [fs.phase, (fs.phase + 0.5) % 1];

    // Body bob: two dips per full cycle, one per footfall.
    const bob = moving ? Math.sin(fs.phase * Math.PI * 4) * rig.height * 0.012 : 0;
    // Idle sway, so a standing mech is never perfectly still.
    const idleSway = Math.sin(time * 0.9 + u.id * 1.7) * rig.height * 0.004;
    // Roll toward the loaded leg, and lean into acceleration.
    const roll = moving ? Math.sin(fs.phase * Math.PI * 2) * 0.045 : 0;
    const lean = (u.speed / Math.max(UNITS[u.kind].speed, 1)) * 0.09;

    const hipY = rig.hipHeight + bob + idleSway;

    // Terrain under each foot, so the mech stands correctly on a slope.
    const slopeFwd =
      (world.terrain.heightAt(s + Math.cos(yaw) * 6, z + Math.sin(yaw) * 6) -
        world.terrain.heightAt(s - Math.cos(yaw) * 6, z - Math.sin(yaw) * 6)) /
      12;
    const pitch = Math.atan(slopeFwd) * 0.8 + lean;

    // --- Build the local-to-render transform --------------------------------
    anchor.toVector(s, ground, z, this._v);
    anchor.orientation(s, yaw, this._q);
    this._basis.compose(this._v, this._q, ONE);

    const push = (part: PartName, local: THREE.Matrix4): void => {
      const mesh = this.mechMeshes.get(`${cls}|${part}|${f}`);
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) return;
      _tmp.multiplyMatrices(this._basis, local);
      mesh.setMatrixAt(mesh.count++, _tmp);
    };

    // --- Pelvis and torso ----------------------------------------------------
    _local.makeRotationX(pitch);
    _rot.makeRotationZ(roll);
    _local.premultiply(_rot);
    _local.setPosition(0, hipY, 0);
    push('pelvis', _local);

    // The torso yaws independently of the legs, so a mech can walk one way and
    // shoot another. That single detail does more for the sense of a piloted
    // machine than any amount of extra geometry.
    const torsoYaw = angleWrap(aimYaw - yaw);
    _local.makeRotationY(torsoYaw);
    _rot.makeRotationX(pitch * 0.6);
    _local.premultiply(_rot);
    _rot.makeRotationZ(roll * 0.5);
    _local.premultiply(_rot);
    _local.setPosition(0, hipY + rig.height * 0.045, 0);
    push('torso', _local);

    // --- Legs ----------------------------------------------------------------
    for (let leg = 0; leg < 2; leg++) {
      const side = leg === 0 ? -1 : 1;
      const p = legPhase[leg]!;
      const hipX = side * rig.hipOffset * 0.5;

      // Stance for the first 60% of the cycle, swing for the rest. A longer
      // stance than swing is what makes a walk read as heavy rather than mincing.
      const stance = p < 0.6;
      let footFwd: number;
      let footUp: number;
      if (!moving) {
        footFwd = 0;
        footUp = 0;
      } else if (stance) {
        // Planted: slides backward relative to the body at walking speed.
        const t = p / 0.6;
        footFwd = strideLen * (0.5 - t);
        footUp = 0;
      } else {
        // Swinging: arcs forward and lifts.
        const t = (p - 0.6) / 0.4;
        footFwd = strideLen * (-0.5 + t);
        footUp = Math.sin(t * Math.PI) * rig.height * 0.09;
      }

      // Ground height under this foot, in local forward/side coordinates.
      const fs2 = s + Math.cos(yaw) * footFwd - Math.sin(yaw) * hipX;
      const fz2 = z + Math.sin(yaw) * footFwd + Math.cos(yaw) * hipX;
      const footGround = world.terrain.heightAt(fs2, fz2) - ground;
      const footY = footGround + footUp;

      // Two-bone IK: given hip and foot positions, find the knee. Solved
      // analytically in the plane containing both, which is exact and has no
      // iteration cost.
      const hipLocalY = hipY;
      const dy = hipLocalY - footY;
      const dz = -footFwd;
      const dist = Math.min(Math.hypot(dy, dz), (rig.legUpper + rig.legLower) * 0.995);
      const a = rig.legUpper;
      const b = rig.legLower;
      // Angle at the hip between the leg line and the upper bone.
      const cosHip = clampN((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
      const hipToFoot = Math.atan2(dz, dy);
      const hipAngle = hipToFoot - Math.acos(cosHip);
      const cosKnee = clampN((a * a + b * b - dist * dist) / (2 * a * b), -1, 1);
      // Knees bend backwards on these machines, so the sign is inverted.
      const kneeAngle = Math.PI - Math.acos(cosKnee);

      // Upper leg: rotate about x from the hip.
      _local.makeRotationX(-hipAngle);
      _local.setPosition(hipX, hipLocalY, 0);
      push('upperLeg', _local);

      // Lower leg: hangs off the knee.
      const kneeY = hipLocalY - Math.cos(hipAngle) * a;
      const kneeZ = Math.sin(hipAngle) * a;
      _local.makeRotationX(-(hipAngle - kneeAngle));
      _local.setPosition(hipX, kneeY, kneeZ);
      push('lowerLeg', _local);

      // Foot: flat to the ground, not to the shin.
      _local.makeRotationX(Math.atan(slopeFwd));
      _local.setPosition(hipX, footY, footFwd);
      push('foot', _local);
    }
  }

  /** Damage tint for a faction's whole army. Cheap stand-in until per-unit. */
  setDamage(faction: Faction, v: number): void {
    const m = this.mats[faction];
    if (m) m.uniforms.uDamage.value = v;
  }

  setEmissive(v: number): void {
    for (const m of this.mats) if (m) m.uniforms.uEmissive.value = v;
  }
}

interface FootState {
  phase: number;
  plant: [number, number];
  lift: [number, number];
  stride: [number, number];
}

const ONE = new THREE.Vector3(1, 1, 1);
const _local = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleWrap(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  else if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function angleLerp(from: number, to: number, alpha: number): number {
  return from + angleWrap(to - from) * alpha;
}

function wrapLerp(from: number, to: number, alpha: number): number {
  let s = from + deltaS(from, to) * alpha;
  s %= RING_CIRCUMFERENCE;
  return s < 0 ? s + RING_CIRCUMFERENCE : s;
}
