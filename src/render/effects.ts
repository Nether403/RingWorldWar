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
import { RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import { Rng } from '@core/rng';
import { FACTION_COLOR, Faction, WEAPONS } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import type { RenderAnchor } from './anchor';

const MAX_TRAIL_POINTS = 90;
const MAX_TRAILS = 96;
const TRAIL_LIFE = 11;
const MAX_LIGHTS = 14;
const MAX_PUFFS = 900;

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

  private lights: THREE.PointLight[] = [];
  private lightLife: number[] = [];

  private rng: Rng;
  /** Peak brightness this frame, so the renderer can push bloom on big hits. */
  flash = 0;
  /** Camera shake requested this frame. */
  shake = 0;
  /** Drawing-buffer height, needed to size point sprites in world units. */
  viewportHeight = 800;

  private readonly _v = new THREE.Vector3();

  constructor(seed: number) {
    this.object.name = 'effects';
    this.rng = new Rng(seed ^ 0x7f7f);

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
            // Smoke expands and fades; sparks shrink and fade fast.
            float grow = aData.w < 0.5 ? (0.35 + t * 1.9) : (1.0 - t * 0.75);
            vAlpha = (1.0 - t) * (aData.w < 0.5 ? 0.5 : 1.0);
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
            // Soft-edged blob for smoke, tight core for sparks.
            float a = vKind < 0.5
              ? smoothstep(0.5, 0.05, r) * 0.85
              : smoothstep(0.5, 0.0, r);
            gl_FragColor = vec4(vColor, a * vAlpha);
          }
        `,
        vertexColors: true,
      }),
    );
    this.puffs.frustumCulled = false;
    this.object.add(this.puffs);

    // --- Pooled lights ---------------------------------------------------------
    // These stay VISIBLE for the lifetime of the game with intensity 0 when
    // idle. Three counts only visible lights, so toggling `visible` changes the
    // light count and invalidates every shader program in the scene -- which
    // shows up as a multi-frame stall, and a black screen, the first time
    // anything fires. Holding the count constant costs nothing and avoids it.
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 400, 2);
      l.visible = true;
      l.intensity = 0;
      this.lights.push(l);
      this.lightLife.push(0);
      this.object.add(l);
    }
  }

  // -------------------------------------------------------------------------

  /** Handle a batch of simulation events. */
  consume(events: SimEvent[], world: World, anchor: RenderAnchor): void {
    for (const e of events) {
      const near = Math.abs(deltaS(anchor.s, e.s)) < RING_CIRCUMFERENCE * 0.3;
      if (!near) continue;
      anchor.toVector(e.s, e.h, e.z, this._v);

      switch (e.kind) {
        case 'weaponFired': {
          const w = e.weapon ? WEAPONS[e.weapon] : undefined;
          const col = e.faction >= 0 ? FACTION_COLOR[e.faction as Faction] : 0xffffff;
          // Radii below are METRES. A muzzle flash is about a metre across.
          this.spawnBurst(this._v, 9 * e.scale, 0.22, col, 1, 0.9 * e.scale);
          this.addLight(this._v, col, 45 * e.scale, 0.07);
          if (w?.kind === 'ballistic') {
            this.spawnBurst(this._v, 14 * e.scale, 1.8, 0x6b6055, 0, 1.8 * e.scale);
          }
          break;
        }
        case 'impact': {
          const big = e.scale > 1.4;
          this.explosion(this._v, e.scale, big);
          break;
        }
        case 'unitDied': {
          this.explosion(this._v, Math.max(1.2, e.scale), true);
          break;
        }
        case 'structureDied': {
          this.explosion(this._v, Math.max(2.2, e.scale), true);
          this.shake = Math.max(this.shake, Math.min(9, e.scale * 1.7));
          break;
        }
        case 'intercepted': {
          this.spawnBurst(this._v, 18, 0.45, 0x9fe8ff, 1, 1.3);
          this.addLight(this._v, 0x9fe8ff, 120, 0.12);
          break;
        }
        default:
          break;
      }
    }
    void world;
  }

  private explosion(pos: THREE.Vector3, scale: number, big: boolean): void {
    // Blast radius in metres. A small shell is a couple of metres across; a
    // fusion core going up is thirty.
    const r = 2.2 + scale * 5.0;
    const spread = 6 + scale * 9;
    // Fireball, then smoke, then sparks. Layering three populations with
    // different lifetimes is what makes a blast read as an event rather than
    // as a single puff.
    this.spawnBurst(pos, spread * 0.6, 0.5, 0xffb347, 1, r * 0.55);
    this.spawnBurst(pos, spread * 0.8, 2.6 + scale, 0x4a4238, 0, r * 0.85);
    this.spawnBurst(pos, spread * 1.5, 0.9, 0xffd9a0, 1, r * 0.3);
    if (big) {
      this.spawnBurst(pos, spread * 0.4, 6 + scale * 2, 0x2e2a26, 0, r * 1.3);
    }
    // The flash itself: brief, bright, and physically a real light so that
    // nearby geometry is genuinely lit by the blast.
    this.addLight(pos, 0xffb066, 240 + scale * 340, 0.16 + scale * 0.05);
    this.flash = Math.max(this.flash, Math.min(1.2, scale * 0.35));
    this.shake = Math.max(this.shake, Math.min(7, scale * 1.1));
  }

  private addLight(pos: THREE.Vector3, color: number, intensity: number, life: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i]! > 0) continue;
      const l = this.lights[i]!;
      l.position.copy(pos);
      l.color.setHex(color);
      l.intensity = intensity;
      l.distance = 60 + intensity * 3;
      this.lightLife[i] = life;
      return;
    }
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
  ): void {
    const n = Math.min(26, 7 + Math.floor(size * 2.2));
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const idx = this.puffHead;
      this.puffHead = (this.puffHead + 1) % MAX_PUFFS;

      this.puffPos[idx * 3] = pos.x;
      this.puffPos[idx * 3 + 1] = pos.y;
      this.puffPos[idx * 3 + 2] = pos.z;

      // Random direction, biased upward relative to the local frame.
      const a = this.rng.range(0, Math.PI * 2);
      const e = this.rng.range(-0.3, 1.0);
      const sp = speed * this.rng.range(0.35, 1.0);
      this.puffVel[idx * 3] = Math.cos(a) * sp;
      this.puffVel[idx * 3 + 1] = e * sp;
      this.puffVel[idx * 3 + 2] = Math.sin(a) * sp;

      this.puffData[idx * 4] = 0;
      this.puffData[idx * 4 + 1] = life * this.rng.range(0.7, 1.3);
      this.puffData[idx * 4 + 2] = size * this.rng.range(0.6, 1.4);
      this.puffData[idx * 4 + 3] = kind;

      const v = this.rng.range(0.8, 1.2);
      this.puffColor[idx * 3] = c.r * v;
      this.puffColor[idx * 3 + 1] = c.g * v;
      this.puffColor[idx * 3 + 2] = c.b * v;
    }
  }

  // -------------------------------------------------------------------------

  update(dt: number, world: World, anchor: RenderAnchor, camera?: THREE.PerspectiveCamera): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shake = 0;

    if (camera) {
      const mat = this.puffs.material as THREE.ShaderMaterial;
      const h = (this.viewportHeight || 800) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      mat.uniforms.uProjScale!.value = h;
    }

    this.updateTrails(dt, world, anchor);
    this.updateTracers(world, anchor);
    this.updateParticles(dt);

    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i]! <= 0) continue;
      this.lightLife[i] = this.lightLife[i]! - dt;
      const l = this.lights[i]!;
      l.intensity *= Math.exp(-dt * 14);
      if (this.lightLife[i]! <= 0 || l.intensity < 0.5) {
        l.intensity = 0;
        this.lightLife[i] = 0;
      }
    }
  }

  private updateTrails(dt: number, world: World, anchor: RenderAnchor): void {
    // Attach a trail to every live ballistic round that does not have one.
    for (const pr of world.projectiles) {
      if (!pr.alive || !pr.ballistic) continue;
      let t = this.trails.find((x) => x.active && x.projectileId === pr.id);
      if (!t) {
        t = this.trails.find((x) => !x.active);
        if (!t) continue;
        t.active = true;
        t.projectileId = pr.id;
        t.count = 0;
        t.head = 0;
        t.life = TRAIL_LIFE;
        t.width = 1;
        t.color.setHex(FACTION_COLOR[pr.faction]);
      }
      // Append a sample.
      const i = t.head;
      t.s[i] = pr.p.s;
      t.h[i] = pr.p.h;
      t.z[i] = pr.p.z;
      t.age[i] = 0;
      t.head = (t.head + 1) % MAX_TRAIL_POINTS;
      t.count = Math.min(t.count + 1, MAX_TRAIL_POINTS);
      t.life = TRAIL_LIFE;
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
        const a = Math.max(0, 1 - t.age[i0]! / TRAIL_LIFE);
        const bright = a * a;
        const r = t.color.r * bright + 0.20 * a;
        const g = t.color.g * bright + 0.19 * a;
        const b = t.color.b * bright + 0.18 * a;
        for (let c = 0; c < 2; c++) {
          this.trailCol[v + c * 3] = r;
          this.trailCol[v + c * 3 + 1] = g;
          this.trailCol[v + c * 3 + 2] = b;
        }
        v += 6;
      }
    }
    this.zeroRest(this.trailPos, v);
    this.trailMesh.geometry.attributes.position!.needsUpdate = true;
    this.trailMesh.geometry.attributes.color!.needsUpdate = true;
  }

  private updateTracers(world: World, anchor: RenderAnchor): void {
    let v = 0;
    for (const pr of world.projectiles) {
      if (!pr.alive || pr.ballistic) continue;
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
    this.zeroRest(this.tracerPos, v);
    this.tracerMesh.geometry.attributes.position!.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color!.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < MAX_PUFFS; i++) {
      const life = this.puffData[i * 4 + 1]!;
      if (life <= 0) continue;
      const age = this.puffData[i * 4]! + dt;
      if (age >= life) {
        this.puffData[i * 4 + 1] = 0;
        continue;
      }
      this.puffData[i * 4] = age;

      const kind = this.puffData[i * 4 + 3]!;
      // Smoke slows and drifts up; sparks fall. Gravity is approximated as
      // local -y, which is correct wherever the camera actually is, because
      // the render frame is anchored to it.
      const drag = kind < 0.5 ? 1.6 : 0.6;
      const grav = kind < 0.5 ? 1.2 : -9.0;
      const k = Math.exp(-dt * drag);
      this.puffVel[i * 3] = this.puffVel[i * 3]! * k;
      this.puffVel[i * 3 + 1] = this.puffVel[i * 3 + 1]! * k + grav * dt;
      this.puffVel[i * 3 + 2] = this.puffVel[i * 3 + 2]! * k;

      this.puffPos[i * 3] = this.puffPos[i * 3]! + this.puffVel[i * 3]! * dt;
      this.puffPos[i * 3 + 1] = this.puffPos[i * 3 + 1]! + this.puffVel[i * 3 + 1]! * dt;
      this.puffPos[i * 3 + 2] = this.puffPos[i * 3 + 2]! + this.puffVel[i * 3 + 2]! * dt;
    }
    this.puffs.geometry.attributes.position!.needsUpdate = true;
    this.puffs.geometry.attributes.aData!.needsUpdate = true;
    this.puffs.geometry.attributes.color!.needsUpdate = true;
  }

  /** Particles live in render space, so they must shift when the anchor moves. */
  rebase(delta: THREE.Vector3): void {
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (this.puffData[i * 4 + 1]! <= 0) continue;
      this.puffPos[i * 3] = this.puffPos[i * 3]! + delta.x;
      this.puffPos[i * 3 + 1] = this.puffPos[i * 3 + 1]! + delta.y;
      this.puffPos[i * 3 + 2] = this.puffPos[i * 3 + 2]! + delta.z;
    }
    for (const l of this.lights) if (l.intensity > 0) l.position.add(delta);
  }

  private zeroRest(arr: Float32Array, from: number): void {
    if (from < arr.length) arr.fill(0, from);
  }
}

const TRACER_COLOR: Record<number, [number, number, number]> = {
  [Faction.Compact]: [3.0, 1.6, 0.5],
  [Faction.Choir]: [0.6, 2.4, 3.0],
};
