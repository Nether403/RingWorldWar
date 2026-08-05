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
import { ABILITIES } from '@sim/abilities';
import {
  FACTION_COLOR,
  Faction,
  STRUCTURES,
  UNITS,
  WRECK_LIFETIME,
  type StructureKind,
} from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';

const MECH_CLASSES: MechClass[] = ['vanguard', 'longbow', 'wisp', 'aegis', 'bulwark', 'needle'];
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
  private factionRigs = new Map<string, MechRig>();
  private structureModels = new Map<StructureKind, StructureModel>();
  private mats: FactionMaterials[] = [];
  private cloakMats: FactionMaterials[] = [];
  /** key: `${cls}|${part}|${faction}` */
  private mechMeshes = new Map<string, THREE.InstancedMesh>();
  /** key: `${kind}|${faction}` */
  private structMeshes = new Map<string, THREE.InstancedMesh>();
  /** Owner-only translucent Wisp parts. */
  private cloakMeshes = new Map<string, THREE.InstancedMesh>();
  private wreckMeshes = new Map<MechClass, THREE.InstancedMesh>();
  private abilityMeshes = new Map<string, THREE.InstancedMesh>();
  private damageMeshes = new Map<1 | 2, THREE.InstancedMesh>();
  /** Fixed-capacity state buckets reset and uploaded together each frame. */
  private presentationMeshes: THREE.InstancedMesh[] = [];
  private counts = new Map<string, number>();

  /** Engineers are drawn as a simple hull rather than as a walker. */
  private engineerMeshes: THREE.InstancedMesh[] = [];

  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _m = new THREE.Matrix4();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  private readonly _basis = new THREE.Matrix4();
  private readonly _terrainNormal = new THREE.Vector3();
  private readonly _terrainQ = new THREE.Quaternion();
  private readonly _terrainS = new THREE.Vector3();
  private readonly _terrainZ = new THREE.Vector3();
  private readonly _ringUp = new THREE.Vector3();

  /** Per-unit render state, keyed by unit id, so gait is continuous over time. */
  private feet = new Map<number, FootState>();
  private recoil = new Map<number, RecoilState>();
  onFootfall: ((event: SimEvent) => void) | null = null;

  constructor(seed: number) {
    this.object.name = 'entities';

    for (const f of [Faction.Compact, Faction.Choir]) {
      this.mats[f] = makeHullMaterial(FACTION_COLOR[f], f === Faction.Compact ? -1 : 1);
    }
    // A third, desaturated material for neutral structures.
    this.mats[2] = makeHullMaterial(0x8fa0b0);

    for (const cls of MECH_CLASSES) {
      const rigSeed = seed + cls.length * 7919;
      for (const f of [Faction.Compact, Faction.Choir]) {
        const rig = buildMech(cls, rigSeed, f === Faction.Compact ? 'compact' : 'choir');
        if (f === Faction.Compact) this.rigs.set(cls, rig);
        this.factionRigs.set(`${cls}|${f}`, rig);
        for (const part of PART_NAMES) {
          const geometry = withInstanceDamage(rig.parts[part], MAX_PER_BUCKET);
          const mesh = new THREE.InstancedMesh(geometry, this.mats[f]!.material, MAX_PER_BUCKET);
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.count = 0;
          this.mechMeshes.set(`${cls}|${part}|${f}`, mesh);
          this.object.add(mesh);
        }
      }

      const wreckRig = this.rigs.get(cls)!;
      const wreck = new THREE.InstancedMesh(
        wreckRig.parts.torso,
        new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9, metalness: 0.18 }),
        MAX_PER_BUCKET,
      );
      wreck.name = `wreck:${cls}`;
      wreck.frustumCulled = false;
      wreck.castShadow = true;
      wreck.receiveShadow = true;
      wreck.count = 0;
      this.wreckMeshes.set(cls, wreck);
      this.presentationMeshes.push(wreck);
      this.object.add(wreck);
    }

    // Cloaked scouts need separate material buckets because opacity cannot vary
    // per instance on the shared hull material without another shader channel.
    for (const f of [Faction.Compact, Faction.Choir]) {
      const cloak = makeHullMaterial(FACTION_COLOR[f], f === Faction.Compact ? -1 : 1);
      this.cloakMats[f] = cloak;
      cloak.material.transparent = true;
      cloak.material.opacity = 0.28;
      cloak.material.depthWrite = false;
      cloak.uniforms.uEmissive.value = 0.45;
      for (const cls of ['wisp', 'needle'] as const) {
        const rig = this.factionRigs.get(`${cls}|${f}`)!;
        for (const part of PART_NAMES) {
          const geometry = withInstanceDamage(rig.parts[part].clone(), MAX_PER_BUCKET);
          const mesh = new THREE.InstancedMesh(geometry, cloak.material, MAX_PER_BUCKET);
          mesh.name = `cloak:${cls}:${part}:${f}`;
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.count = 0;
          this.cloakMeshes.set(`${cls}|${part}|${f}`, mesh);
          this.presentationMeshes.push(mesh);
          this.object.add(mesh);
        }
      }
    }

    const kinds: StructureKind[] = [
      'bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator',
      'mechFoundry', 'rocketBattery', 'pointDefense', 'laserGrid', 'radarMast',
      'silo', 'spinalNode',
    ];
    for (const kind of kinds) {
      const modelSeed = seed + kind.length * 104729;
      const baseModel = buildStructure(kind, modelSeed);
      this.structureModels.set(kind, baseModel);
      for (let f = 0; f < 3; f++) {
        const model = kind === 'spinalNode' || f === 2
          ? baseModel
          : buildStructure(kind, modelSeed, f === Faction.Compact ? 'compact' : 'choir');
        // Ownership changes command authority, not the inherited Node's visual culture.
        const geometry = withInstanceDamage(f === 0 ? model.geometry : model.geometry.clone(), 64);
        const materialIndex = kind === 'spinalNode' ? 2 : f;
        const mesh = new THREE.InstancedMesh(geometry, this.mats[materialIndex]!.material, 64);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.name = `structure:${kind}:${f}`;
        this.structMeshes.set(`${kind}|${f}`, mesh);
        this.object.add(mesh);
      }
    }

    this.createPresentationBuckets();

    // Engineers: a small hovering hull, visually distinct from the mechs.
    for (const f of [Faction.Compact, Faction.Choir]) {
      const geometry = buildStructure(
        'pointDefense', seed, f === Faction.Compact ? 'compact' : 'choir',
      ).geometry;
      geometry.scale(0.28, 0.28, 0.28);
      withInstanceDamage(geometry, MAX_PER_BUCKET);
      const mesh = new THREE.InstancedMesh(geometry, this.mats[f]!.material, MAX_PER_BUCKET);
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
    for (const materials of [this.mats, this.cloakMats]) {
      for (const entry of materials) if (entry) entry.uniforms.uTime.value = time;
    }

    for (const m of this.mechMeshes.values()) m.count = 0;
    for (const m of this.structMeshes.values()) m.count = 0;
    for (const m of this.engineerMeshes) if (m) m.count = 0;
    for (const m of this.presentationMeshes) m.count = 0;

    this.drawStructures(world, anchor, viewer);
    this.drawWrecks(world, anchor, viewer);
    this.drawUnits(world, anchor, time, viewer, alpha);

    for (const m of this.mechMeshes.values()) if (m.count > 0) markInstanceUpdates(m);
    for (const m of this.structMeshes.values()) if (m.count > 0) markInstanceUpdates(m);
    for (const m of this.engineerMeshes) if (m && m.count > 0) markInstanceUpdates(m);
    for (const m of this.presentationMeshes) if (m.count > 0) markInstanceUpdates(m);

    // Prune foot state for units that no longer exist, so the map cannot grow
    // without bound over a long match.
    if (world.tick % 120 === 0) {
      const live = new Set(world.units.filter((u) => u.alive).map((u) => u.id));
      for (const id of this.feet.keys()) if (!live.has(id)) this.feet.delete(id);
      for (const [id, state] of this.recoil) {
        if (!live.has(id) || time - state.startedAt > 2) this.recoil.delete(id);
      }
    }
  }

  // -------------------------------------------------------------------------

  private createPresentationBuckets(): void {
    const shieldGeometry = new THREE.PlaneGeometry(16, 9);
    const coverageGeometry = new THREE.RingGeometry(0.965, 1, 64);
    coverageGeometry.rotateX(-Math.PI / 2);
    const siegeGeometry = new THREE.RingGeometry(0.68, 1, 32);
    siegeGeometry.rotateX(-Math.PI / 2);

    for (const f of [Faction.Compact, Faction.Choir]) {
      const color = FACTION_COLOR[f];
      const definitions: Array<[string, THREE.BufferGeometry, number]> = [
        ['shieldWall', shieldGeometry, 0.36],
        ['umbrella', coverageGeometry, 0.2],
        ['siegeMode', siegeGeometry, 0.68],
      ];
      for (const [ability, geometry, opacity] of definitions) {
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_PER_BUCKET);
        mesh.name = `ability:${ability}:${f}`;
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.abilityMeshes.set(`${ability}|${f}`, mesh);
        this.presentationMeshes.push(mesh);
        this.object.add(mesh);
      }
    }

    const damageGeometry = new THREE.OctahedronGeometry(0.7, 0);
    for (const state of [1, 2] as const) {
      const material = new THREE.MeshBasicMaterial({
        color: state === 1 ? 0xffad42 : 0xff3f27,
        transparent: true,
        opacity: state === 1 ? 0.75 : 0.95,
        depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(damageGeometry, material, MAX_PER_BUCKET * 2);
      mesh.name = `damage:${state}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.damageMeshes.set(state, mesh);
      this.presentationMeshes.push(mesh);
      this.object.add(mesh);
    }
  }

  consumePresentation(events: readonly SimEvent[], time: number): void {
    for (const event of events) {
      if (event.kind !== 'weaponFired') continue;
      this.recoil.set(event.id, {
        startedAt: time,
        strength: Math.min(1, 0.35 + Math.max(0.2, event.scale) * 0.24),
      });
    }
  }

  private drawWrecks(world: World, anchor: RenderAnchor, viewer: Faction): void {
    for (const wreck of world.wreckages) {
      if (!wreck.alive || !UNITS[wreck.kind].isMech) continue;
      if (!world.isEntityVisible(viewer, wreck.id)) continue;
      if (Math.abs(deltaS(anchor.s, wreck.s)) > RING_CIRCUMFERENCE * 0.3) continue;
      const mesh = this.wreckMeshes.get(wreck.kind as MechClass);
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;

      const ground = world.terrain.heightAt(wreck.s, wreck.z);
      anchor.toVector(wreck.s, ground + 0.8, wreck.z, this._v);
      anchor.orientation(wreck.s, wreck.yaw, this._q);
      const normalStep = 4;
      const sampleS = wreck.s + normalStep;
      const sampleZ = wreck.z + normalStep;
      anchor.toVector(sampleS, world.terrain.heightAt(sampleS, wreck.z) + 0.8, wreck.z, this._terrainS).sub(this._v);
      anchor.toVector(wreck.s, world.terrain.heightAt(wreck.s, sampleZ) + 0.8, sampleZ, this._terrainZ).sub(this._v);
      this._terrainNormal.crossVectors(this._terrainZ, this._terrainS).normalize();
      anchor.upAt(wreck.s, this._ringUp);
      this._terrainQ.setFromUnitVectors(this._ringUp, this._terrainNormal);
      this._q.premultiply(this._terrainQ);
      this._basis.compose(this._v, this._q, ONE);

      const finalDecay = clampN(wreck.lifetime / Math.min(8, WRECK_LIFETIME), 0.16, 1);
      const wreckAge = Math.max(0, WRECK_LIFETIME - wreck.lifetime);
      const fallDuration = 0.75;
      const fallProgress = smoothstepN(0, fallDuration, wreckAge);
      const targetFall = Math.PI * (0.42 + ((wreck.id * 37) % 17) / 170);
      const settleAge = wreckAge - fallDuration;
      const settle = settleAge >= 0 && settleAge < 1.2
        ? Math.sin(settleAge * 17) * Math.exp(-settleAge * 5) * 0.055
        : 0;
      _local.makeRotationZ(targetFall * fallProgress + settle);
      _rot.makeRotationY(((wreck.id * 97) % 360) * (Math.PI / 180));
      _local.premultiply(_rot);
      _local.scale(this._scale.set(finalDecay, finalDecay, finalDecay));
      _local.setPosition(0, -0.5 * (1 - finalDecay) - fallProgress * 0.25, 0);
      _tmp.multiplyMatrices(this._basis, _local);
      mesh.setMatrixAt(mesh.count++, _tmp);
    }
  }

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
      const index = mesh.count++;
      setInstanceDamage(mesh, index, st.id, st.hp, st.maxHp);
      mesh.setMatrixAt(index, this._m);
    }
  }

  private drawUnits(world: World, anchor: RenderAnchor, time: number, viewer: Faction, alpha: number): void {
    for (const u of world.units) {
      if (!u.alive) continue;
      const def = UNITS[u.kind];
      if (!world.isEntityVisible(viewer, u.id)) {
        this.synchronizePresentationBaseline(u, def.isMech);
        continue;
      }
      const s = wrapLerp(u.prevS, u.s, alpha);
      const z = THREE.MathUtils.lerp(u.prevZ, u.z, alpha);
      const yaw = angleLerp(u.prevYaw, u.yaw, alpha);
      const aimYaw = angleLerp(u.prevAimYaw, u.aimYaw, alpha);
      const tickDistance = Math.hypot(deltaS(u.prevS, u.s), u.z - u.prevZ);
      const gait = Math.max(0, u.gait - tickDistance * (1 - alpha));
      if (Math.abs(deltaS(anchor.s, s)) > RING_CIRCUMFERENCE * 0.3) {
        this.synchronizePresentationBaseline(u, def.isMech);
        continue;
      }

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
        const index = mesh.count++;
        setInstanceDamage(mesh, index, u.id, u.hp, u.maxHp);
        mesh.setMatrixAt(index, this._m);
        continue;
      }

      this.drawMech(
        u.kind as MechClass,
        u,
        world,
        anchor,
        ground,
        time,
        s,
        z,
        yaw,
        aimYaw,
        gait,
        u.cloaked && u.faction === viewer,
      );
      this.drawUnitState(u, anchor, ground, time, s, z, yaw);
    }
  }

  dispose(): void {
    disposeObject(this.object);
    this.onFootfall = null;
    this.rigs.clear();
    this.factionRigs.clear();
    this.structureModels.clear();
    this.mats.length = 0;
    this.cloakMats.length = 0;
    this.mechMeshes.clear();
    this.structMeshes.clear();
    this.cloakMeshes.clear();
    this.wreckMeshes.clear();
    this.abilityMeshes.clear();
    this.damageMeshes.clear();
    this.presentationMeshes.length = 0;
    this.engineerMeshes.length = 0;
    this.counts.clear();
    this.feet.clear();
    this.recoil.clear();
  }

  private drawUnitState(
    u: World['units'][number],
    anchor: RenderAnchor,
    ground: number,
    time: number,
    s: number,
    z: number,
    yaw: number,
  ): void {
    const def = UNITS[u.kind];
    anchor.toVector(s, ground, z, this._v);
    anchor.orientation(s, yaw, this._q);
    this._basis.compose(this._v, this._q, ONE);

    const place = (mesh: THREE.InstancedMesh | undefined, local: THREE.Matrix4): void => {
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) return;
      _tmp.multiplyMatrices(this._basis, local);
      mesh.setMatrixAt(mesh.count++, _tmp);
    };

    if (u.ability?.id === 'shieldWall' && u.ability.active) {
      const pulse = 1 + Math.sin(time * 4 + u.id) * 0.035;
      _local.makeScale(pulse, pulse, pulse);
      _local.setPosition(0, def.height * 0.48, def.radius * 1.7);
      place(this.abilityMeshes.get(`shieldWall|${u.faction}`), _local);
    }
    if (u.ability?.id === 'umbrella' && u.ability.active) {
      const radius = ABILITIES.umbrella.protectionRadius;
      _local.makeScale(radius, radius, radius);
      _local.setPosition(0, 0.8, 0);
      place(this.abilityMeshes.get(`umbrella|${u.faction}`), _local);
    }
    if (u.ability?.id === 'siegeMode' && (u.ability.active || u.ability.transitionTimer > 0)) {
      const transition = u.ability.transitionTimer / ABILITIES.siegeMode.transitionDuration;
      const radius = def.radius * (1.45 + transition * 0.35 + Math.sin(time * 5) * 0.04);
      _local.makeScale(radius, radius, radius);
      _local.setPosition(0, 0.65, 0);
      place(this.abilityMeshes.get(`siegeMode|${u.faction}`), _local);
    }

    const damageState = u.damageState;
    if (damageState === 1 || damageState === 2) {
      const size = (damageState === 2 ? 1.25 : 0.9) * (1 + Math.sin(time * 7 + u.id) * 0.12);
      _local.makeScale(size, size, size);
      _local.setPosition(0, def.height * 1.12, 0);
      place(this.damageMeshes.get(damageState), _local);
    }
  }

  private synchronizePresentationBaseline(u: World['units'][number], isMech: boolean): void {
    if (!isMech) return;
    const rig = this.rigs.get(u.kind as MechClass);
    if (!rig) return;
    const strideLen = rig.height * 0.55;
    const footfallIndex = Math.floor(u.gait / (strideLen * 0.5));
    const state = this.feet.get(u.id) ?? {
      phase: 0,
      lastFootfall: footfallIndex,
      wasMoving: u.speed > 0.3,
      settleStartedAt: -Infinity,
    };
    state.phase = (u.gait / strideLen) % 1;
    state.lastFootfall = footfallIndex;
    state.wasMoving = u.speed > 0.3;
    state.settleStartedAt = -Infinity;
    this.feet.set(u.id, state);
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
    gait: number,
    cloakedForViewer: boolean,
  ): void {
    const rig = this.rigs.get(cls);
    if (!rig) return;
    const f = u.faction as number;

    let fs = this.feet.get(u.id);
    if (!fs) {
      fs = { phase: 0, lastFootfall: -1, wasMoving: u.speed > 0.3, settleStartedAt: -Infinity };
      this.feet.set(u.id, fs);
    }

    // --- Gait clock ---------------------------------------------------------
    // Phase advances with distance travelled, not with time, so the stride
    // length stays constant and the feet never skate.
    const strideLen = rig.height * 0.55;
    fs.phase = (gait / strideLen) % 1;
    const moving = u.speed > 0.3;
    const footfallIndex = Math.floor(gait / (strideLen * 0.5));
    const contactCounts: [number, number] = [0, 0];
    if (fs.lastFootfall < 0 || !moving) {
      fs.lastFootfall = footfallIndex;
    } else if (footfallIndex > fs.lastFootfall) {
      const last = Math.min(footfallIndex, fs.lastFootfall + 4);
      for (let index = fs.lastFootfall + 1; index <= last; index++) contactCounts[index & 1]++;
      fs.lastFootfall = footfallIndex;
    }
    if (fs.wasMoving && !moving) fs.settleStartedAt = time;
    else if (moving) fs.settleStartedAt = -Infinity;
    fs.wasMoving = moving;

    // Each leg is half a cycle out of phase.
    const legPhase = [fs.phase, (fs.phase + 0.5) % 1];

    // Body bob: two dips per full cycle, one per footfall.
    const bob = moving ? Math.sin(fs.phase * Math.PI * 4) * rig.height * 0.012 : 0;
    // Idle sway, so a standing mech is never perfectly still.
    const idleSway = Math.sin(time * 0.9 + u.id * 1.7) * rig.height * 0.004;
    // Roll toward the loaded leg, and lean into acceleration.
    const criticalSide = (u.id & 1) === 0 ? -1 : 1;
    const limp = u.damageState === 2 ? criticalSide * 0.045 : 0;
    const roll = (moving ? Math.sin(fs.phase * Math.PI * 2) * 0.045 : 0) + limp;
    const lean = (u.speed / Math.max(UNITS[u.kind].speed, 1)) * 0.09;

    const settleAge = time - fs.settleStartedAt;
    const settle = settleAge >= 0 && settleAge < 1.4
      ? Math.sin(settleAge * 15) * Math.exp(-settleAge * 5) * rig.height * 0.022
      : 0;
    const hipY = rig.hipHeight + bob + idleSway + settle;

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
      const mesh = cloakedForViewer
        ? this.cloakMeshes.get(`${cls}|${part}|${f}`)
        : this.mechMeshes.get(`${cls}|${part}|${f}`);
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) return;
      _tmp.multiplyMatrices(this._basis, local);
      const index = mesh.count++;
      setInstanceDamage(mesh, index, u.id, u.hp, u.maxHp);
      mesh.setMatrixAt(index, _tmp);
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
    const recoil = recoilAt(this.recoil.get(u.id), time);
    _local.makeRotationY(torsoYaw);
    _rot.makeRotationX(pitch * 0.6 - recoil * 0.11);
    _local.premultiply(_rot);
    _rot.makeRotationZ(roll * 0.5);
    _local.premultiply(_rot);
    _local.setPosition(0, hipY + rig.height * 0.045, -recoil * rig.height * 0.018);
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
      if (u.damageState === 2 && side === criticalSide) footUp *= 0.42;

      // Ground height under this foot, in local forward/side coordinates.
      const fs2 = s + Math.cos(yaw) * footFwd - Math.sin(yaw) * hipX;
      const fz2 = z + Math.sin(yaw) * footFwd + Math.cos(yaw) * hipX;
      const footGround = world.terrain.heightAt(fs2, fz2) - ground;
      const footY = footGround + footUp;
      for (let contact = 0; contact < contactCounts[leg]!; contact++) {
        this.onFootfall?.({
          kind: 'footfall',
          s: fs2,
          z: fz2,
          h: ground + footY,
          faction: u.faction,
          scale: clampN(rig.height / 9, 0.65, 1.8),
          id: u.id,
          entityKind: u.kind,
        });
      }

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

  resetTransientState(): void {
    this.feet.clear();
    this.recoil.clear();
    for (const mesh of this.presentationMeshes) mesh.count = 0;
  }

  setEmissive(v: number): void {
    for (const m of this.mats) if (m) m.uniforms.uEmissive.value = v;
  }

  setLowQuality(enabled: boolean): void {
    for (const materials of [this.mats, this.cloakMats]) {
      for (const m of materials) if (m) m.uniforms.uLowQuality.value = enabled ? 1 : 0;
    }
  }
}

interface FootState {
  phase: number;
  lastFootfall: number;
  wasMoving: boolean;
  settleStartedAt: number;
}

interface RecoilState {
  startedAt: number;
  strength: number;
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

function smoothstepN(edge0: number, edge1: number, value: number): number {
  const t = clampN((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function angleLerp(from: number, to: number, alpha: number): number {
  return from + angleWrap(to - from) * alpha;
}

function wrapLerp(from: number, to: number, alpha: number): number {
  let s = from + deltaS(from, to) * alpha;
  s %= RING_CIRCUMFERENCE;
  return s < 0 ? s + RING_CIRCUMFERENCE : s;
}

function recoilAt(state: RecoilState | undefined, time: number): number {
  if (!state) return 0;
  const age = Math.max(0, time - state.startedAt);
  return state.strength * Math.exp(-age * 8) * Math.max(0, Math.cos(age * 22));
}

function withInstanceDamage(geometry: THREE.BufferGeometry, capacity: number): THREE.BufferGeometry {
  geometry.setAttribute(
    'instanceDamage',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'instancePhase',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage),
  );
  return geometry;
}

function setInstanceDamage(mesh: THREE.InstancedMesh, index: number, id: number, hp: number, maxHp: number): void {
  const attribute = mesh.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute | undefined;
  if (!attribute) return;
  attribute.setX(index, clampN(1 - hp / Math.max(1, maxHp), 0, 1));
  const phase = mesh.geometry.getAttribute('instancePhase') as THREE.InstancedBufferAttribute | undefined;
  phase?.setX(index, (id * 0.61803398875) % 1);
}

function markInstanceUpdates(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  const damage = mesh.geometry.getAttribute('instanceDamage');
  if (damage) damage.needsUpdate = true;
  const phase = mesh.geometry.getAttribute('instancePhase');
  if (phase) phase.needsUpdate = true;
}
