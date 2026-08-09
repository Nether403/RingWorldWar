/**
 * Projectiles, contrails and explosions.
 *
 * Contrails are the signature effect of this game and get the most attention.
 * Because artillery here flies in strongly curved, direction-dependent arcs,
 * the trail is how the player actually reads the physics -- and, since firing
 * reveals a launcher, it doubles as intelligence about where a shot came from.
 * They therefore persist for many seconds and disperse rather than snapping off.
 *
 * Explosions always include a real point light. A fireball sprite without a
 * light flash reads as a decal; with one, the whole scene registers the event.
 * Lights are pooled and hard-capped because they are the expensive part.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE, RING_RADIUS } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import { Rng } from '@core/rng';
import { FACTION_COLOR, Faction, WEAPONS } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';
import { combatPresentationKind, isPresentationEventEligible } from './presentationEvents';

const MAX_TRAIL_POINTS = 90;
const MAX_TRAILS = 96;
const TRAIL_LIFE = 11;
const MAX_LIGHTS = 14;
const MAX_PUFFS = 900;
const MAX_SCARS = 96;
const MAX_DEBRIS = 256;
const MAX_SMOKE_EMITTERS = 32;
const SCAR_SEGMENTS = 12;

interface Trail {
  active: boolean;
  projectileId: number;
  /** Ring-space samples, so the trail survives the floating origin moving. */
  s: Float32Array;
  h: Float32Array;
  z: Float32Array;
  age: Float32Array;
  count: number;
  head: number;
  color: THREE.Color;
  life: number;
  width: number;
  chord: boolean;
  maxLife: number;
}

interface Scar {
  active: boolean;
  s: number;
  z: number;
  radius: number;
  yaw: number;
  age: number;
  life: number;
  priority: number;
  color: number;
}

interface DebrisShard {
  active: boolean;
  s: number;
  z: number;
  h: number;
  vs: number;
  vz: number;
  vh: number;
  yaw: number;
  spin: number;
  scale: number;
  age: number;
  life: number;
  priority: number;
}

interface SmokeEmitter {
  active: boolean;
  s: number;
  z: number;
  scale: number;
  age: number;
  life: number;
  nextEmission: number;
  priority: number;
}

export class Effects {
  readonly object = new THREE.Group();

  private trails: Trail[] = [];
  private trailMesh: THREE.LineSegments;
  private trailPos: Float32Array;
  private trailCol: Float32Array;

  private tracerMesh: THREE.LineSegments;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;

  private puffs: THREE.Points;
  private puffPos: Float32Array;
  private puffData: Float32Array; // age, life, size, kind
  private puffVel: Float32Array;
  private puffColor: Float32Array;
  private puffHead = 0;
  private particleCap = MAX_PUFFS;

  private lights: THREE.PointLight[] = [];
  private lightLife: number[] = [];
  private lightPriority: number[] = [];

  private readonly scars: Scar[] = [];
  private readonly scarMesh: THREE.Mesh;
  private readonly scarPos: Float32Array;
  private readonly scarColor: Float32Array;
  private readonly scarAlpha: Float32Array;
  private scarCap = MAX_SCARS;

  private readonly debris: DebrisShard[] = [];
  private readonly debrisMesh: THREE.InstancedMesh;
  private debrisCap = MAX_DEBRIS;

  private readonly smokeEmitters: SmokeEmitter[] = [];
  private smokeEmitterCap = MAX_SMOKE_EMITTERS;

  private rng: Rng;
  private dustRng: Rng;
  /** Peak brightness this frame, so the renderer can push bloom on big hits. */
  flash = 0;
  /** Camera shake requested this frame. */
  shake = 0;
  /** Drawing-buffer height, needed to size point sprites in world units. */
  viewportHeight = 800;

  private readonly _v = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _m = new THREE.Matrix4();
  private readonly _scale = new THREE.Vector3();
  private readonly _color = new THREE.Color();
  private readonly _up = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();

  constructor(seed: number) {
    this.object.name = 'effects';
    this.rng = new Rng(seed ^ 0x7f7f);
    this.dustRng = new Rng(seed ^ 0x2d571);

    // --- Contrails ----------------------------------------------------------
    const tp = MAX_TRAILS * MAX_TRAIL_POINTS * 2 * 3;
    this.trailPos = new Float32Array(tp);
    this.trailCol = new Float32Array(tp);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailMesh = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      }),
    );
    this.trailMesh.name = 'effects:trails';
    this.trailMesh.frustumCulled = false;
    this.object.add(this.trailMesh);

    for (let i = 0; i < MAX_TRAILS; i++) {
      this.trails.push({
        active: false,
        projectileId: 0,
        s: new Float32Array(MAX_TRAIL_POINTS),
        h: new Float32Array(MAX_TRAIL_POINTS),
        z: new Float32Array(MAX_TRAIL_POINTS),
        age: new Float32Array(MAX_TRAIL_POINTS),
        count: 0,
        head: 0,
        color: new THREE.Color(),
        life: 0,
        width: 1,
        chord: false,
        maxLife: TRAIL_LIFE,
      });
    }

    // --- Tracers (direct fire) -----------------------------------------------
    const cp = 512 * 2 * 3;
    this.tracerPos = new Float32Array(cp);
    this.tracerCol = new Float32Array(cp);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracerMesh = new THREE.LineSegments(
      cg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.tracerMesh.name = 'effects:tracers';
    this.tracerMesh.frustumCulled = false;
    this.object.add(this.tracerMesh);

    // --- Particles ------------------------------------------------------------
    this.puffPos = new Float32Array(MAX_PUFFS * 3);
    this.puffVel = new Float32Array(MAX_PUFFS * 3);
    this.puffData = new Float32Array(MAX_PUFFS * 4);
    this.puffColor = new Float32Array(MAX_PUFFS * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.puffPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.puffColor, 3));
    pg.setAttribute('aData', new THREE.BufferAttribute(this.puffData, 4));

    this.puffs = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        uniforms: { uProjScale: { value: 800 } },
        vertexShader: /* glsl */ `
          attribute vec4 aData;   // age, life, radius(metres), kind
          uniform float uProjScale;
          varying vec3 vColor;
          varying float vAlpha;
          varying float vKind;
          void main() {
            float t = clamp(aData.x / max(aData.y, 0.001), 0.0, 1.0);
            vColor = color;
            vKind = aData.w;
            // 0 smoke, 1 sparks, 2 shockwave annulus, 3 dust.
            float grow = aData.w < 0.5 ? (0.35 + t * 1.9)
              : aData.w < 1.5 ? (1.0 - t * 0.75)
              : aData.w < 2.5 ? (0.3 + t * 2.4)
              : (0.45 + t * 1.45);
            vAlpha = (1.0 - t) * (aData.w < 0.5 ? 0.5 : aData.w < 1.5 ? 1.0 : 0.62);
            if (aData.y <= 0.0) vAlpha = 0.0;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // aData.z is a RADIUS IN METRES. uProjScale converts world size at
            // unit depth into pixels for the current viewport and field of
            // view, so a 3 m puff is 3 m across at every distance and zoom.
            // Treating that number as pixels instead -- which an earlier
            // version did -- makes a muzzle flash fill the screen when you
            // zoom in.
            gl_PointSize = clamp(aData.z * grow * uProjScale / max(-mv.z, 1.0), 1.0, 420.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          varying float vKind;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float r = length(d);
            if (r > 0.5 || vAlpha <= 0.001) discard;
            // Soft smoke/dust, tight sparks, or an expanding shockwave ring.
            float a = vKind < 0.5 ? smoothstep(0.5, 0.05, r) * 0.85
              : vKind < 1.5 ? smoothstep(0.5, 0.0, r)
              : vKind < 2.5
                ? smoothstep(0.5, 0.39, r) * smoothstep(0.28, 0.39, r)
                : smoothstep(0.5, 0.08, r) * 0.55;
            gl_FragColor = vec4(vColor, a * vAlpha);
          }
        `,
        vertexColors: true,
      }),
    );
    this.puffs.name = 'effects:puffs';
    this.puffs.frustumCulled = false;
    this.object.add(this.puffs);

    // --- Terrain-conforming scars -------------------------------------------
    const scarVertices = MAX_SCARS * SCAR_SEGMENTS * 3;
    this.scarPos = new Float32Array(scarVertices * 3);
    this.scarColor = new Float32Array(scarVertices * 3);
    this.scarAlpha = new Float32Array(scarVertices);
    const scarGeometry = new THREE.BufferGeometry();
    scarGeometry.setAttribute('position', new THREE.BufferAttribute(this.scarPos, 3).setUsage(THREE.DynamicDrawUsage));
    scarGeometry.setAttribute('color', new THREE.BufferAttribute(this.scarColor, 3).setUsage(THREE.DynamicDrawUsage));
    scarGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.scarAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    scarGeometry.setDrawRange(0, 0);
    this.scarMesh = new THREE.Mesh(scarGeometry, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexColors: true,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(vColor, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
    }));
    this.scarMesh.name = 'effects:scars';
    this.scarMesh.frustumCulled = false;
    this.object.add(this.scarMesh);
    for (let index = 0; index < MAX_SCARS; index++) {
      this.scars.push({ active: false, s: 0, z: 0, radius: 0, yaw: 0, age: 0, life: 0, priority: 0, color: 0 });
    }

    // --- Cosmetic debris ----------------------------------------------------
    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.8, 0),
      new THREE.MeshStandardMaterial({ color: 0x292b2c, roughness: 0.86, metalness: 0.48 }),
      MAX_DEBRIS,
    );
    this.debrisMesh.name = 'effects:debris';
    this.debrisMesh.count = 0;
    this.debrisMesh.castShadow = false;
    this.debrisMesh.receiveShadow = false;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.object.add(this.debrisMesh);
    for (let index = 0; index < MAX_DEBRIS; index++) {
      this.debris.push({ active: false, s: 0, z: 0, h: 0, vs: 0, vz: 0, vh: 0, yaw: 0, spin: 0, scale: 1, age: 0, life: 0, priority: 0 });
    }
    for (let index = 0; index < MAX_SMOKE_EMITTERS; index++) {
      this.smokeEmitters.push({ active: false, s: 0, z: 0, scale: 1, age: 0, life: 0, nextEmission: 0, priority: 0 });
    }

    // --- Pooled lights ---------------------------------------------------------
    // Quality changes may alter the visible pool size, but individual effects
    // only change intensity. This keeps shader variants stable during combat.
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 400, 2);
      l.visible = true;
      l.intensity = 0;
      this.lights.push(l);
      this.lightLife.push(0);
      this.lightPriority.push(0);
      this.object.add(l);
    }
    this.puffs.geometry.setDrawRange(0, 0);
    this.trailMesh.geometry.setDrawRange(0, 0);
    this.tracerMesh.geometry.setDrawRange(0, 0);
  }

  // -------------------------------------------------------------------------

  setParticleCap(cap: number): void {
    const next = Math.max(1, Math.min(MAX_PUFFS, Math.floor(cap)));
    if (next === this.particleCap) return;
    this.particleCap = next;
    this.puffs.geometry.setDrawRange(0, Math.min(this.puffs.geometry.drawRange.count, next));
    this.puffHead %= next;
    for (let i = next; i < MAX_PUFFS; i++) this.puffData[i * 4 + 1] = 0;
    this.puffs.geometry.attributes.aData!.needsUpdate = true;
  }

  setLightCap(cap: number): void {
    const next = Math.max(0, Math.min(MAX_LIGHTS, Math.floor(cap)));
    for (let i = 0; i < this.lights.length; i++) {
      const enabled = i < next;
      const light = this.lights[i]!;
      light.visible = enabled;
      if (!enabled) {
        light.intensity = 0;
        this.lightLife[i] = 0;
        this.lightPriority[i] = 0;
      }
    }
  }

  setAftermathCaps(scarCap: number, debrisCap: number, smokeEmitterCap: number): void {
    this.scars.sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || a.age - b.age);
    this.debris.sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || a.age - b.age);
    this.smokeEmitters.sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || a.age - b.age);
    this.scarCap = Math.max(0, Math.min(MAX_SCARS, Math.floor(scarCap)));
    this.debrisCap = Math.max(0, Math.min(MAX_DEBRIS, Math.floor(debrisCap)));
    this.smokeEmitterCap = Math.max(0, Math.min(MAX_SMOKE_EMITTERS, Math.floor(smokeEmitterCap)));
    for (let index = this.scarCap; index < MAX_SCARS; index++) this.scars[index]!.active = false;
    for (let index = this.debrisCap; index < MAX_DEBRIS; index++) this.debris[index]!.active = false;
    for (let index = this.smokeEmitterCap; index < MAX_SMOKE_EMITTERS; index++) this.smokeEmitters[index]!.active = false;
  }

  get aftermathMetrics(): { scars: number; debris: number; smokeEmitters: number } {
    return {
      scars: this.scars.slice(0, this.scarCap).filter((item) => item.active).length,
      debris: this.debris.slice(0, this.debrisCap).filter((item) => item.active).length,
      smokeEmitters: this.smokeEmitters.slice(0, this.smokeEmitterCap).filter((item) => item.active).length,
    };
  }

  // -------------------------------------------------------------------------

  /** Handle a batch of simulation events. */
  consume(
    events: readonly SimEvent[],
    world: World,
    anchor: RenderAnchor,
    viewer: Faction,
    listenerS = anchor.s,
    listenerZ = anchor.z,
    visibilityPrevalidated = false,
  ): void {
    this.shake = 0;
    const eligibleEvents = visibilityPrevalidated
      ? events
      : events.filter((event) => isPresentationEventEligible(event, world, anchor.s, viewer));
    const deathEvents = eligibleEvents.filter((event) => event.kind === 'unitDied' || event.kind === 'structureDied');
    const recentImpacts = eligibleEvents
      .filter((event) => event.kind === 'impact' && !(event.weapon === 'chordShot' && event.scale <= 0.7))
      .map((event) => ({ s: event.s, z: event.z, scale: event.scale, strategic: event.weapon === 'chordShot' }));
    for (const e of eligibleEvents) {
      anchor.toVector(e.s, e.h, e.z, this._v);
      anchor.upAt(e.s, this._up);
      const shakeAttenuation = distanceAttenuation(surfaceDist(listenerS, listenerZ, e.s, e.z), 700);

      const presentationKind = combatPresentationKind(e);
      if (presentationKind === 'chordLaunch') {
        this.spawnBurst(this._v, 42, 2.4, 0xfff4d7, 1, 5.5, this.rng, this._up);
        this.spawnBurst(this._v, 24, 4.5, 0x4e4a45, 0, 7.5, this.rng, this._up);
        this.addLight(this._v, 0xfff4d7, 1_800, 0.45, 4);
        this.flash = Math.max(this.flash, 1.2);
        continue;
      }
      if (presentationKind === 'chordImpact') {
        // Intercept cleanup emits a small follow-up impact for the same weapon.
        if (e.scale <= 0.7) continue;
        this.addScar(e, 5, 0x171513, 75);
        this.spawnDebris(e, 18, 5);
        this.addSmokeEmitter(e, 5, 44);
        this.explosion(this._v, Math.max(5.2, e.scale), true, shakeAttenuation, this._up);
        this.addLight(this._v, 0xffffff, 2_600, 0.7, 5);
        this.flash = Math.max(this.flash, 1.8);
        continue;
      }

      switch (e.kind) {
        case 'weaponFired': {
          const w = e.weapon ? WEAPONS[e.weapon] : undefined;
          const col = e.faction >= 0 ? FACTION_COLOR[e.faction as Faction] : 0xffffff;
          // Radii below are METRES. A muzzle flash is about a metre across.
          this.spawnBurst(this._v, 9 * e.scale, 0.22, col, 1, 0.9 * e.scale, this.rng, this._up);
          this.addLight(this._v, col, 45 * e.scale, 0.07, 0);
          if (w?.kind === 'ballistic') {
            this.spawnBurst(this._v, 14 * e.scale, 1.8, 0x6b6055, 0, 1.8 * e.scale, this.rng, this._up);
          }
          break;
        }
        case 'impact': {
          const big = e.scale > 1.4;
          const ownedByDeath = deathEvents.some((death) =>
            surfaceDist(death.s, death.z, e.s, e.z) <= 8 + e.scale * 4);
          if (ownedByDeath) break;
          const explosive = e.weapon ? WEAPONS[e.weapon]?.damageType === 'explosive' : false;
          this.addScar(e, big ? 2 : 1, explosive ? 0x221d18 : 0x292827, big ? 65 : 42);
          if (explosive || big) this.spawnDebris(e, Math.min(10, 3 + Math.ceil(e.scale * 2)), big ? 2 : 1);
          if (big) this.addSmokeEmitter(e, 2, 18 + e.scale * 3);
          this.explosion(this._v, e.scale, big, shakeAttenuation, this._up);
          break;
        }
        case 'unitDied': {
          const covered = recentImpacts.some((impact) => impact.strategic &&
            surfaceDist(impact.s, impact.z, e.s, e.z) <= 8 + impact.scale * 4);
          if (!covered) {
            this.addScar(e, 3, 0x211b17, 72);
            this.spawnDebris(e, Math.min(12, 5 + Math.ceil(e.scale * 3)), 3);
            this.addSmokeEmitter(e, 3, 24);
            this.explosion(this._v, Math.max(1.2, e.scale), true, shakeAttenuation, this._up);
          }
          break;
        }
        case 'structureDied': {
          const priority = e.scale >= 5 ? 5 : 4;
          const covered = recentImpacts.some((impact) => impact.strategic &&
            surfaceDist(impact.s, impact.z, e.s, e.z) <= 10 + impact.scale * 4);
          if (!covered) {
            this.addScar(e, priority, 0x171513, e.scale >= 5 ? 95 : 82);
            this.spawnDebris(e, Math.min(18, 8 + Math.ceil(e.scale * 2)), priority);
            this.addSmokeEmitter(e, priority, e.scale >= 5 ? 42 : 32);
            this.explosion(this._v, Math.max(2.2, e.scale), true, shakeAttenuation, this._up);
          }
          this.shake = Math.max(this.shake, Math.min(9, e.scale * 1.7) * shakeAttenuation);
          break;
        }
        case 'intercepted': {
          this.spawnBurst(this._v, 18, 0.45, 0x9fe8ff, 1, 1.3, this.rng, this._up);
          this.addLight(this._v, 0x9fe8ff, 120, 0.12, 1);
          break;
        }
        default:
          break;
      }
    }
    void world;
  }

  footfall(event: SimEvent, anchor: RenderAnchor, listenerS: number, listenerZ: number): void {
    anchor.toVector(event.s, event.h, event.z, this._v);
    anchor.upAt(event.s, this._up);
    this.spawnBurst(this._v, 2.5 * event.scale, 0.8, 0x8f7960, 3, 0.65 * event.scale, this.dustRng, this._up);
    const attenuation = distanceAttenuation(surfaceDist(listenerS, listenerZ, event.s, event.z), 130);
    this.shake = Math.max(this.shake, event.scale * 0.18 * attenuation);
  }

  private addScar(event: SimEvent, priority: number, color: number, life: number): void {
    if (this.scarCap <= 0) return;
    let slot = -1;
    for (let index = 0; index < this.scarCap; index++) {
      const scar = this.scars[index]!;
      if (!scar.active) { slot = index; break; }
      if (slot < 0 || scar.priority < this.scars[slot]!.priority ||
          scar.priority === this.scars[slot]!.priority && scar.age > this.scars[slot]!.age) slot = index;
    }
    if (slot < 0 || this.scars[slot]!.active && this.scars[slot]!.priority > priority) return;
    const scar = this.scars[slot]!;
    scar.active = true;
    scar.s = event.s;
    scar.z = event.z;
    scar.radius = Math.max(2.5, 3.5 + event.scale * 5.5);
    scar.yaw = hashUnit(event.id, priority) * Math.PI * 2;
    scar.age = 0;
    scar.life = life;
    scar.priority = priority;
    scar.color = color;
  }

  private spawnDebris(event: SimEvent, count: number, priority: number): void {
    if (this.debrisCap <= 0) return;
    let created = 0;
    while (created < count) {
      let slot = -1;
      for (let index = 0; index < this.debrisCap; index++) {
        const shard = this.debris[index]!;
        if (!shard.active) { slot = index; break; }
        if (slot < 0 || shard.priority < this.debris[slot]!.priority ||
            shard.priority === this.debris[slot]!.priority && shard.age > this.debris[slot]!.age) slot = index;
      }
      if (slot < 0 || this.debris[slot]!.active && this.debris[slot]!.priority > priority) break;
      const shard = this.debris[slot]!;
      const phase = hashUnit(event.id, created + 31) * Math.PI * 2;
      const speed = 5 + event.scale * (4 + hashUnit(event.id, created + 71) * 5);
      shard.active = true;
      shard.s = event.s;
      shard.z = event.z;
      shard.h = Math.max(0.5, event.h + event.scale * 0.7);
      shard.vs = Math.cos(phase) * speed;
      shard.vz = Math.sin(phase) * speed;
      shard.vh = 6 + event.scale * 4 + hashUnit(event.id, created + 101) * 8;
      shard.yaw = phase;
      shard.spin = (hashUnit(event.id, created + 131) * 2 - 1) * 7;
      shard.scale = 0.35 + hashUnit(event.id, created + 151) * Math.min(2.2, 0.5 + event.scale * 0.35);
      shard.age = 0;
      shard.life = 2.2 + hashUnit(event.id, created + 181) * 2.2;
      shard.priority = priority;
      created++;
    }
  }

  private addSmokeEmitter(event: SimEvent, priority: number, life: number): void {
    if (this.smokeEmitterCap <= 0) return;
    let slot = -1;
    for (let index = 0; index < this.smokeEmitterCap; index++) {
      const emitter = this.smokeEmitters[index]!;
      if (!emitter.active) { slot = index; break; }
      if (slot < 0 || emitter.priority < this.smokeEmitters[slot]!.priority ||
          emitter.priority === this.smokeEmitters[slot]!.priority && emitter.age > this.smokeEmitters[slot]!.age) slot = index;
    }
    if (slot < 0 || this.smokeEmitters[slot]!.active && this.smokeEmitters[slot]!.priority > priority) return;
    const emitter = this.smokeEmitters[slot]!;
    emitter.active = true;
    emitter.s = event.s;
    emitter.z = event.z;
    emitter.scale = Math.max(0.8, event.scale);
    emitter.age = 0;
    emitter.life = life;
    emitter.nextEmission = 0;
    emitter.priority = priority;
  }

  private explosion(
    pos: THREE.Vector3,
    scale: number,
    big: boolean,
    shakeAttenuation: number,
    up: THREE.Vector3,
  ): void {
    // Blast radius in metres. A small shell is a couple of metres across; a
    // fusion core going up is thirty.
    const r = 2.2 + scale * 5.0;
    const spread = 6 + scale * 9;
    // Fireball, then smoke, then sparks. Layering three populations with
    // different lifetimes is what makes a blast read as an event rather than
    // as a single puff.
    this.spawnBurst(pos, spread * 0.6, 0.5, 0xffb347, 1, r * 0.55, this.rng, up);
    this.spawnBurst(pos, spread * 0.8, 2.6 + scale, 0x4a4238, 0, r * 0.85, this.rng, up);
    this.spawnBurst(pos, spread * 1.5, 0.9, 0xffd9a0, 1, r * 0.3, this.rng, up);
    if (big) {
      this.spawnBurst(pos, spread * 0.4, 6 + scale * 2, 0x2e2a26, 0, r * 1.3, this.rng, up);
    }
    this.spawnParticle(pos, up, 0, 0.7 + scale * 0.08, 0xe8c7a1, 2, r * 1.8);
    // The flash itself: brief, bright, and physically a real light so that
    // nearby geometry is genuinely lit by the blast.
    this.addLight(pos, 0xffb066, 240 + scale * 340, 0.16 + scale * 0.05, big ? 3 : 2);
    this.flash = Math.max(this.flash, Math.min(1.2, scale * 0.35));
    this.shake = Math.max(this.shake, Math.min(7, scale * 1.1) * shakeAttenuation);
  }

  private addLight(pos: THREE.Vector3, color: number, intensity: number, life: number, priority: number): void {
    let slot = -1;
    for (let i = 0; i < this.lights.length; i++) {
      if (!this.lights[i]!.visible) continue;
      if (this.lightLife[i]! <= 0) { slot = i; break; }
      if (slot < 0 || this.lightPriority[i]! < this.lightPriority[slot]!) slot = i;
    }
    if (slot < 0 || this.lightLife[slot]! > 0 && this.lightPriority[slot]! >= priority) return;
    const light = this.lights[slot]!;
    light.position.copy(pos);
    light.color.setHex(color);
    light.intensity = intensity;
    light.distance = 60 + intensity * 3;
    this.lightLife[slot] = life;
    this.lightPriority[slot] = priority;
  }

  /**
   * @param speed initial particle speed, m/s
   * @param size  particle RADIUS in metres
   */
  private spawnBurst(
    pos: THREE.Vector3,
    speed: number,
    life: number,
    color: number,
    kind: number,
    size: number,
    rng = this.rng,
    up = WORLD_UP,
  ): void {
    const n = Math.min(26, 7 + Math.floor(size * 2.2));
    const c = this._color.setHex(color);
    for (let i = 0; i < n; i++) {
      const idx = this.puffHead;
      this.puffHead = (this.puffHead + 1) % this.particleCap;

      this.puffPos[idx * 3] = pos.x;
      this.puffPos[idx * 3 + 1] = pos.y;
      this.puffPos[idx * 3 + 2] = pos.z;

      // Random direction in the event's local tangent frame, biased upward.
      const a = rng.range(0, Math.PI * 2);
      const e = rng.range(-0.3, 1.0);
      const sp = speed * rng.range(0.35, 1.0);
      this._tangent.crossVectors(AXIAL, up).normalize();
      this.puffVel[idx * 3] = (this._tangent.x * Math.cos(a) + AXIAL.x * Math.sin(a) + up.x * e) * sp;
      this.puffVel[idx * 3 + 1] = (this._tangent.y * Math.cos(a) + AXIAL.y * Math.sin(a) + up.y * e) * sp;
      this.puffVel[idx * 3 + 2] = (this._tangent.z * Math.cos(a) + AXIAL.z * Math.sin(a) + up.z * e) * sp;

      this.puffData[idx * 4] = 0;
      this.puffData[idx * 4 + 1] = life * rng.range(0.7, 1.3);
      this.puffData[idx * 4 + 2] = size * rng.range(0.6, 1.4);
      this.puffData[idx * 4 + 3] = kind;

      const v = rng.range(0.8, 1.2);
      this.puffColor[idx * 3] = c.r * v;
      this.puffColor[idx * 3 + 1] = c.g * v;
      this.puffColor[idx * 3 + 2] = c.b * v;
    }
  }

  private spawnParticle(
    pos: THREE.Vector3,
    up: THREE.Vector3,
    speed: number,
    life: number,
    color: number,
    kind: number,
    size: number,
  ): void {
    const idx = this.puffHead;
    this.puffHead = (this.puffHead + 1) % this.particleCap;
    this.puffPos[idx * 3] = pos.x;
    this.puffPos[idx * 3 + 1] = pos.y;
    this.puffPos[idx * 3 + 2] = pos.z;
    this.puffVel[idx * 3] = up.x * speed;
    this.puffVel[idx * 3 + 1] = up.y * speed;
    this.puffVel[idx * 3 + 2] = up.z * speed;
    this.puffData[idx * 4] = 0;
    this.puffData[idx * 4 + 1] = life;
    this.puffData[idx * 4 + 2] = size;
    this.puffData[idx * 4 + 3] = kind;
    const c = this._color.setHex(color);
    this.puffColor[idx * 3] = c.r;
    this.puffColor[idx * 3 + 1] = c.g;
    this.puffColor[idx * 3 + 2] = c.b;
  }

  // -------------------------------------------------------------------------

  update(
    dt: number,
    world: World,
    anchor: RenderAnchor,
    viewer: Faction,
    camera?: THREE.PerspectiveCamera,
  ): void {
    this.flash = Math.max(0, this.flash - dt * 3);

    if (camera) {
      const mat = this.puffs.material as THREE.ShaderMaterial;
      const h = (this.viewportHeight || 800) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      mat.uniforms.uProjScale!.value = h;
    }

    this.updateTrails(dt, world, anchor, viewer);
    this.updateTracers(world, anchor, viewer);
    this.updateScars(dt, world, anchor);
    this.updateDebris(dt, world, anchor);
    this.updateSmokeEmitters(dt, world, anchor);
    this.updateParticles(dt);

    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i]! <= 0) continue;
      this.lightLife[i] = this.lightLife[i]! - dt;
      const l = this.lights[i]!;
      l.intensity *= Math.exp(-dt * 14);
      if (this.lightLife[i]! <= 0 || l.intensity < 0.5) {
        l.intensity = 0;
        this.lightLife[i] = 0;
        this.lightPriority[i] = 0;
      }
    }
  }

  private updateTrails(dt: number, world: World, anchor: RenderAnchor, viewer: Faction): void {
    // Attach a trail to every live ballistic round that does not have one.
    for (const pr of world.projectiles) {
      if (!pr.alive || !pr.ballistic) continue;
      if (!world.isProjectileVisible(viewer, pr)) continue;
      let t = this.trails.find((x) => x.active && x.projectileId === pr.id);
      if (!t) {
        t = this.trails.find((x) => !x.active);
        if (!t) continue;
        t.active = true;
        t.projectileId = pr.id;
        t.count = 0;
        t.head = 0;
        t.chord = pr.flightMode === 'chord';
        t.maxLife = t.chord ? 18 : TRAIL_LIFE;
        t.life = t.maxLife;
        t.width = t.chord ? 2.4 : 1;
        t.color.setHex(t.chord ? 0xfff3dc : FACTION_COLOR[pr.faction]);
      }
      // Append a sample.
      if (t.count > 0) {
        const previous = (t.head - 1 + MAX_TRAIL_POINTS) % MAX_TRAIL_POINTS;
        const moved = Math.abs(deltaS(t.s[previous]!, pr.p.s)) +
          Math.abs(t.h[previous]! - pr.p.h) + Math.abs(t.z[previous]! - pr.p.z);
        if (moved < 0.04) {
          t.life = t.maxLife;
          continue;
        }
      }
      const i = t.head;
      t.s[i] = pr.p.s;
      t.h[i] = pr.p.h;
      t.z[i] = pr.p.z;
      t.age[i] = 0;
      t.head = (t.head + 1) % MAX_TRAIL_POINTS;
      t.count = Math.min(t.count + 1, MAX_TRAIL_POINTS);
      t.life = t.maxLife;
    }

    // Age out trails whose projectile is gone.
    for (const t of this.trails) {
      if (!t.active) continue;
      const stillFlying = world.projectiles.some((p) => p.alive && p.id === t.projectileId);
      if (!stillFlying) {
        t.life -= dt;
        if (t.life <= 0) t.active = false;
      }
      for (let i = 0; i < MAX_TRAIL_POINTS; i++) t.age[i] = t.age[i]! + dt;
    }

    // Rebuild the line buffer.
    let v = 0;
    for (const t of this.trails) {
      if (!t.active || t.count < 2) continue;
      for (let k = 0; k < t.count - 1; k++) {
        const i0 = (t.head - t.count + k + MAX_TRAIL_POINTS * 2) % MAX_TRAIL_POINTS;
        const i1 = (i0 + 1) % MAX_TRAIL_POINTS;
        if (v + 6 > this.trailPos.length) break;

        anchor.toVector(t.s[i0]!, t.h[i0]!, t.z[i0]!, this._v);
        this.trailPos[v] = this._v.x;
        this.trailPos[v + 1] = this._v.y;
        this.trailPos[v + 2] = this._v.z;
        anchor.toVector(t.s[i1]!, t.h[i1]!, t.z[i1]!, this._v);
        this.trailPos[v + 3] = this._v.x;
        this.trailPos[v + 4] = this._v.y;
        this.trailPos[v + 5] = this._v.z;

        // Fade along the trail's own age: the head is bright, the tail is smoke.
        const a = Math.max(0, 1 - t.age[i0]! / t.maxLife);
        const bright = a * a;
        const boost = t.chord ? 1.9 : 1;
        const r = (t.color.r * bright + 0.20 * a) * boost;
        const g = (t.color.g * bright + 0.19 * a) * boost;
        const b = (t.color.b * bright + 0.18 * a) * boost;
        for (let c = 0; c < 2; c++) {
          this.trailCol[v + c * 3] = r;
          this.trailCol[v + c * 3 + 1] = g;
          this.trailCol[v + c * 3 + 2] = b;
        }
        v += 6;
      }
    }
    this.trailMesh.geometry.setDrawRange(0, v / 3);
    this.trailMesh.geometry.attributes.position!.needsUpdate = true;
    this.trailMesh.geometry.attributes.color!.needsUpdate = true;
  }

  private updateTracers(world: World, anchor: RenderAnchor, viewer: Faction): void {
    let v = 0;
    for (const pr of world.projectiles) {
      if (!pr.alive || pr.ballistic) continue;
      if (!world.isProjectileVisible(viewer, pr)) continue;
      if (Math.abs(deltaS(anchor.s, pr.p.s)) > RING_CIRCUMFERENCE * 0.3) continue;
      if (v + 6 > this.tracerPos.length) break;

      // Draw the round as a short streak along its own velocity, which reads
      // far better than a point and costs the same.
      anchor.toVector(pr.p.s, pr.p.h, pr.p.z, this._v);
      this.tracerPos[v] = this._v.x;
      this.tracerPos[v + 1] = this._v.y;
      this.tracerPos[v + 2] = this._v.z;

      const sp = 14;
      const vx = pr.st.VX;
      const vy = pr.st.VY;
      const vz = pr.st.VZ;
      const len = Math.hypot(vx, vy, vz) || 1;
      this.tracerPos[v + 3] = this._v.x - (vx / len) * sp;
      this.tracerPos[v + 4] = this._v.y - (vy / len) * sp;
      this.tracerPos[v + 5] = this._v.z - (vz / len) * sp;

      const c = TRACER_COLOR[pr.faction]!;
      this.tracerCol[v] = c[0];
      this.tracerCol[v + 1] = c[1];
      this.tracerCol[v + 2] = c[2];
      this.tracerCol[v + 3] = c[0] * 0.15;
      this.tracerCol[v + 4] = c[1] * 0.15;
      this.tracerCol[v + 5] = c[2] * 0.15;
      v += 6;
    }
    this.tracerMesh.geometry.setDrawRange(0, v / 3);
    this.tracerMesh.geometry.attributes.position!.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color!.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.particleCap; i++) {
      const life = this.puffData[i * 4 + 1]!;
      if (life <= 0) continue;
      const age = this.puffData[i * 4]! + dt;
      if (age >= life) {
        this.puffData[i * 4 + 1] = 0;
        continue;
      }
      this.puffData[i * 4] = age;

      const kind = this.puffData[i * 4 + 3]!;
      // Initial velocity is emitted in the event's local ring frame. Do not add
      // camera-anchor Y gravity afterward: distant local up can point elsewhere.
      // Physical falling fragments use the ring-space debris pool below.
      const drag = kind < 0.5 ? 1.6 : kind < 1.5 ? 0.6 : kind < 2.5 ? 8 : 2.4;
      const grav = 0;
      const k = Math.exp(-dt * drag);
      this.puffVel[i * 3] = this.puffVel[i * 3]! * k;
      this.puffVel[i * 3 + 1] = this.puffVel[i * 3 + 1]! * k + grav * dt;
      this.puffVel[i * 3 + 2] = this.puffVel[i * 3 + 2]! * k;

      this.puffPos[i * 3] = this.puffPos[i * 3]! + this.puffVel[i * 3]! * dt;
      this.puffPos[i * 3 + 1] = this.puffPos[i * 3 + 1]! + this.puffVel[i * 3 + 1]! * dt;
      this.puffPos[i * 3 + 2] = this.puffPos[i * 3 + 2]! + this.puffVel[i * 3 + 2]! * dt;
      if (write !== i) this.copyParticle(i, write);
      write++;
    }
    for (let i = write; i < this.particleCap; i++) this.puffData[i * 4 + 1] = 0;
    this.puffHead = write % this.particleCap;
    this.puffs.geometry.setDrawRange(0, write);
    this.puffs.geometry.attributes.position!.needsUpdate = true;
    this.puffs.geometry.attributes.aData!.needsUpdate = true;
    this.puffs.geometry.attributes.color!.needsUpdate = true;
  }

  private updateScars(dt: number, world: World, anchor: RenderAnchor): void {
    let vertex = 0;
    for (let index = 0; index < this.scarCap; index++) {
      const scar = this.scars[index]!;
      if (!scar.active) continue;
      scar.age += dt;
      if (scar.age >= scar.life) {
        scar.active = false;
        continue;
      }
      if (Math.abs(deltaS(anchor.s, scar.s)) > RING_CIRCUMFERENCE * 0.3) continue;
      const fadeIn = Math.min(1, scar.age * 4);
      const fadeOut = Math.min(1, (scar.life - scar.age) / 8);
      const alpha = Math.min(fadeIn, fadeOut) * (scar.priority >= 4 ? 0.76 : 0.58);
      this._color.setHex(scar.color);
      const centerH = world.terrain.heightAt(scar.s, scar.z) + 0.08;
      for (let segment = 0; segment < SCAR_SEGMENTS; segment++) {
        const a0 = scar.yaw + (segment / SCAR_SEGMENTS) * Math.PI * 2;
        const a1 = scar.yaw + ((segment + 1) / SCAR_SEGMENTS) * Math.PI * 2;
        vertex = this.writeScarVertex(vertex, anchor, scar.s, centerH, scar.z, alpha);
        const s0 = wrapS(scar.s + Math.cos(a0) * scar.radius);
        const z0 = scar.z + Math.sin(a0) * scar.radius * 0.78;
        vertex = this.writeScarVertex(vertex, anchor, s0, world.terrain.heightAt(s0, z0) + 0.09, z0, alpha * 0.12);
        const s1 = wrapS(scar.s + Math.cos(a1) * scar.radius);
        const z1 = scar.z + Math.sin(a1) * scar.radius * 0.78;
        vertex = this.writeScarVertex(vertex, anchor, s1, world.terrain.heightAt(s1, z1) + 0.09, z1, alpha * 0.12);
      }
    }
    this.scarMesh.geometry.setDrawRange(0, vertex);
    this.scarMesh.geometry.attributes.position!.needsUpdate = true;
    this.scarMesh.geometry.attributes.color!.needsUpdate = true;
    this.scarMesh.geometry.attributes.aAlpha!.needsUpdate = true;
  }

  private writeScarVertex(
    vertex: number,
    anchor: RenderAnchor,
    s: number,
    h: number,
    z: number,
    alpha: number,
  ): number {
    anchor.toVector(s, h, z, this._v);
    const offset = vertex * 3;
    this.scarPos[offset] = this._v.x;
    this.scarPos[offset + 1] = this._v.y;
    this.scarPos[offset + 2] = this._v.z;
    this.scarColor[offset] = this._color.r;
    this.scarColor[offset + 1] = this._color.g;
    this.scarColor[offset + 2] = this._color.b;
    this.scarAlpha[vertex] = alpha;
    return vertex + 1;
  }

  private updateDebris(dt: number, world: World, anchor: RenderAnchor): void {
    this.debrisMesh.count = 0;
    for (let index = 0; index < this.debrisCap; index++) {
      const shard = this.debris[index]!;
      if (!shard.active) continue;
      shard.age += dt;
      if (shard.age >= shard.life) {
        shard.active = false;
        continue;
      }
      shard.s = wrapS(shard.s + shard.vs * dt);
      shard.z += shard.vz * dt;
      shard.h += shard.vh * dt;
      shard.vh -= 9.8 * dt;
      shard.vs *= Math.exp(-dt * 0.6);
      shard.vz *= Math.exp(-dt * 0.6);
      const ground = world.terrain.heightAt(shard.s, shard.z) + 0.2;
      if (shard.h < ground) {
        shard.h = ground;
        shard.vs *= 0.35;
        shard.vz *= 0.35;
        shard.vh = Math.abs(shard.vh) * 0.18;
      }
      if (Math.abs(deltaS(anchor.s, shard.s)) > RING_CIRCUMFERENCE * 0.3) continue;
      anchor.toVector(shard.s, shard.h, shard.z, this._v);
      anchor.orientation(shard.s, shard.yaw + shard.spin * shard.age, this._q);
      this._scale.setScalar(shard.scale);
      this._m.compose(this._v, this._q, this._scale);
      this.debrisMesh.setMatrixAt(this.debrisMesh.count++, this._m);
    }
    if (this.debrisMesh.count > 0) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  private updateSmokeEmitters(dt: number, world: World, anchor: RenderAnchor): void {
    let liveParticles = this.liveParticleCount();
    const immediateReserve = Math.max(16, Math.floor(this.particleCap * 0.25));
    for (let index = 0; index < this.smokeEmitterCap; index++) {
      const emitter = this.smokeEmitters[index]!;
      if (!emitter.active) continue;
      emitter.age += dt;
      emitter.nextEmission -= dt;
      if (emitter.age >= emitter.life) {
        emitter.active = false;
        continue;
      }
      if (emitter.nextEmission > 0 || Math.abs(deltaS(anchor.s, emitter.s)) > RING_CIRCUMFERENCE * 0.3) continue;
      if (liveParticles >= this.particleCap - immediateReserve) {
        emitter.nextEmission = 0.2;
        continue;
      }
      const ground = world.terrain.heightAt(emitter.s, emitter.z);
      anchor.toVector(emitter.s, ground + 0.8, emitter.z, this._v);
      anchor.upAt(emitter.s, this._up);
      this.spawnParticle(this._v, this._up, 1.2 + emitter.scale * 0.35, 5 + emitter.scale * 0.7, 0x373432, 0, 1.4 + emitter.scale * 0.65);
      liveParticles++;
      emitter.nextEmission = Math.max(0.24, 0.9 / Math.sqrt(emitter.scale));
    }
  }

  private liveParticleCount(): number {
    let live = 0;
    for (let index = 0; index < this.particleCap; index++) {
      if (this.puffData[index * 4 + 1]! > 0) live++;
    }
    return live;
  }

  private copyParticle(from: number, to: number): void {
    for (let component = 0; component < 3; component++) {
      this.puffPos[to * 3 + component] = this.puffPos[from * 3 + component]!;
      this.puffVel[to * 3 + component] = this.puffVel[from * 3 + component]!;
      this.puffColor[to * 3 + component] = this.puffColor[from * 3 + component]!;
    }
    for (let component = 0; component < 4; component++) {
      this.puffData[to * 4 + component] = this.puffData[from * 4 + component]!;
    }
  }

  /** Reconstruct render-space transients exactly after the tangent frame moves. */
  rebase(previousS: number, previousZ: number, anchor: RenderAnchor): void {
    const angle = deltaS(anchor.s, previousS) / RING_RADIUS;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let i = 0; i < this.particleCap; i++) {
      if (this.puffData[i * 4 + 1]! <= 0) continue;
      const x = this.puffPos[i * 3]!;
      const y = this.puffPos[i * 3 + 1]!;
      const radial = RING_RADIUS - y;
      const s = previousS + Math.atan2(x, radial) * RING_RADIUS;
      const h = RING_RADIUS - Math.hypot(x, radial);
      const z = this.puffPos[i * 3 + 2]! + previousZ;
      anchor.toVector(s, h, z, this._v);
      this.puffPos[i * 3] = this._v.x;
      this.puffPos[i * 3 + 1] = this._v.y;
      this.puffPos[i * 3 + 2] = this._v.z;
      const vx = this.puffVel[i * 3]!;
      const vy = this.puffVel[i * 3 + 1]!;
      this.puffVel[i * 3] = vx * cosine - vy * sine;
      this.puffVel[i * 3 + 1] = vx * sine + vy * cosine;
    }
    for (const light of this.lights) {
      if (light.intensity <= 0) continue;
      const radial = RING_RADIUS - light.position.y;
      const s = previousS + Math.atan2(light.position.x, radial) * RING_RADIUS;
      const h = RING_RADIUS - Math.hypot(light.position.x, radial);
      anchor.toVector(s, h, light.position.z + previousZ, light.position);
    }
    this.puffs.geometry.attributes.position!.needsUpdate = true;
  }

  resetTransientState(): void {
    for (const trail of this.trails) {
      trail.active = false;
      trail.count = 0;
      trail.head = 0;
      trail.life = 0;
    }
    this.puffData.fill(0);
    this.puffHead = 0;
    this.trailMesh.geometry.setDrawRange(0, 0);
    this.tracerMesh.geometry.setDrawRange(0, 0);
    this.puffs.geometry.setDrawRange(0, 0);
    this.scarMesh.geometry.setDrawRange(0, 0);
    this.debrisMesh.count = 0;
    for (const scar of this.scars) scar.active = false;
    for (const shard of this.debris) shard.active = false;
    for (const emitter of this.smokeEmitters) emitter.active = false;
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i]!.intensity = 0;
      this.lightLife[i] = 0;
      this.lightPriority[i] = 0;
    }
    this.flash = 0;
    this.shake = 0;
    this.puffs.geometry.attributes.aData!.needsUpdate = true;
  }

  dispose(): void {
    disposeObject(this.object);
  }

}

const TRACER_COLOR: Record<number, [number, number, number]> = {
  [Faction.Compact]: [3.0, 1.6, 0.5],
  [Faction.Choir]: [0.6, 2.4, 3.0],
};

const AXIAL = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function distanceAttenuation(distance: number, range: number): number {
  const ratio = distance / range;
  return 1 / (1 + ratio * ratio);
}

function hashUnit(id: number, salt: number): number {
  let value = (Math.imul(id, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}
