/**
 * Procedural hard-surface models.
 *
 * Every mech and building in the game is built here out of code. The style is
 * machined industrial sci-fi, which is the one look procedural generation is
 * genuinely good at: bevelled chassis blocks, inset panel lines, greebles
 * clustered at joints, and emissive strips in faction colour.
 *
 * Two techniques carry most of the result:
 *
 *   BEVELS. A cube reads as a cube. A cube with 5 cm chamfers on every edge
 *   catches a highlight along each one and reads as a machined part. It costs
 *   24 vertices instead of 8 and it is the cheapest realism available.
 *
 *   MASK CHANNELS. Each vertex carries `aMask`: 0 = hull, 1 = faction emissive,
 *   2 = dark recess, 3 = worn metal. One material reads it to paint both
 *   factions and all surface variation, so the entire army is a handful of
 *   draw calls with no textures at all.
 */

import * as THREE from 'three';
import { Rng } from '@core/rng';

export const MASK_HULL = 0;
export const MASK_EMISSIVE = 1;
export const MASK_RECESS = 2;
export const MASK_METAL = 3;

// ---------------------------------------------------------------------------
// Geometry building blocks
// ---------------------------------------------------------------------------

/** Accumulates triangles and produces one indexed BufferGeometry. */
class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private mask: number[] = [];
  private idx: number[] = [];

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Add a quad given four corners in CCW order. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    mask: number,
  ): void {
    const base = this.pos.length / 3;
    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _n.crossVectors(_e1, _e2).normalize();

    for (const [v, u, w] of [
      [a, 0, 0],
      [b, 1, 0],
      [c, 1, 1],
      [d, 0, 1],
    ] as const) {
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(u, w);
      this.mask.push(mask);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Append another builder's contents, transformed. */
  append(other: MeshBuilder, m: THREE.Matrix4): void {
    const base = this.pos.length / 3;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < other.pos.length; i += 3) {
      _v.set(other.pos[i]!, other.pos[i + 1]!, other.pos[i + 2]!).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(other.nrm[i]!, other.nrm[i + 1]!, other.nrm[i + 2]!)
        .applyMatrix3(_nm)
        .normalize();
      this.nrm.push(_v.x, _v.y, _v.z);
    }
    this.uv.push(...other.uv);
    this.mask.push(...other.mask);
    for (const t of other.idx) this.idx.push(base + t);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _m = new THREE.Matrix4();

export interface BlockSpec {
  size: [number, number, number];
  pos?: [number, number, number];
  /** Fraction of the smallest dimension chamfered off each edge, 0..0.35. */
  bevel?: number;
  /** Top face scale relative to the bottom, for wedge shapes. */
  taper?: number;
  /** Skew the top face along x/z, for leaning forms. */
  lean?: [number, number];
  mask?: number;
  /** Inset panel divisions on the four side faces. */
  panels?: number;
}

/**
 * A bevelled, optionally tapered box.
 *
 * Built as an explicit vertex ring rather than by CSG: two rectangles (bottom
 * and top), each inset by the bevel amount, plus chamfer bands between them.
 * Cheap, watertight, and the chamfers give every silhouette edge a highlight.
 */
function addBlock(mb: MeshBuilder, spec: BlockSpec): void {
  const [sx, sy, sz] = spec.size;
  const [px, py, pz] = spec.pos ?? [0, 0, 0];
  const taper = spec.taper ?? 1;
  const [lx, lz] = spec.lean ?? [0, 0];
  const mask = spec.mask ?? MASK_HULL;
  const b = Math.min(sx, sy, sz) * Math.min(spec.bevel ?? 0.12, 0.35);

  const hx = sx / 2;
  const hz = sz / 2;
  const txw = hx * taper;
  const tzw = hz * taper;

  // Four corner columns: [bottom-inset, bottom-full, top-full, top-inset]
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  const ring = (yOff: number, xw: number, zw: number, inset: number, ox: number, oz: number) =>
    corners.map(([cx, cz]) =>
      new THREE.Vector3(
        px + ox + cx * Math.max(xw - inset, 0.001),
        py + yOff,
        pz + oz + cz * Math.max(zw - inset, 0.001),
      ),
    );

  const r0 = ring(0, hx, hz, b, 0, 0); // bottom, inset
  const r1 = ring(b, hx, hz, 0, 0, 0); // bottom of the straight section
  const r2 = ring(sy - b, txw, tzw, 0, lx, lz); // top of the straight section
  const r3 = ring(sy, txw, tzw, b, lx, lz); // top, inset

  // Bottom cap, top cap.
  mb.quad(r0[3]!, r0[2]!, r0[1]!, r0[0]!, mask);
  mb.quad(r3[0]!, r3[1]!, r3[2]!, r3[3]!, mask);

  // Side bands: lower chamfer, main wall, upper chamfer.
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mb.quad(r0[i]!, r0[j]!, r1[j]!, r1[i]!, mask);
    mb.quad(r1[i]!, r1[j]!, r2[j]!, r2[i]!, mask);
    mb.quad(r2[i]!, r2[j]!, r3[j]!, r3[i]!, mask);
  }

  // Inset panel lines on the main wall: a recessed strip that catches shadow.
  const panels = spec.panels ?? 0;
  if (panels > 0) {
    const d = Math.min(sx, sz) * 0.035;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      for (let p = 1; p <= panels; p++) {
        const t = p / (panels + 1);
        const y0 = b + (sy - 2 * b) * t - d * 0.5;
        const y1 = y0 + d;
        const a0 = lerpV(r1[i]!, r2[i]!, (y0 - b) / Math.max(sy - 2 * b, 1e-4));
        const a1 = lerpV(r1[j]!, r2[j]!, (y0 - b) / Math.max(sy - 2 * b, 1e-4));
        const a2 = lerpV(r1[j]!, r2[j]!, (y1 - b) / Math.max(sy - 2 * b, 1e-4));
        const a3 = lerpV(r1[i]!, r2[i]!, (y1 - b) / Math.max(sy - 2 * b, 1e-4));
        // Pull the strip inward so it reads as a groove.
        const cx = px + lx * 0.5;
        const cz = pz + lz * 0.5;
        for (const v of [a0, a1, a2, a3]) {
          v.x += (cx - v.x) * 0.045;
          v.z += (cz - v.z) * 0.045;
        }
        mb.quad(a0, a1, a2, a3, MASK_RECESS);
      }
    }
  }
}

function lerpV(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  return new THREE.Vector3().lerpVectors(a, b, t);
}

/** Scatter small boxes over the top and sides of a volume. */
function addGreebles(
  mb: MeshBuilder,
  bounds: [number, number, number],
  origin: [number, number, number],
  count: number,
  rng: Rng,
): void {
  const [sx, sy, sz] = bounds;
  for (let i = 0; i < count; i++) {
    const w = rng.range(0.08, 0.26) * Math.min(sx, sz);
    const h = rng.range(0.04, 0.16) * sy;
    const onTop = rng.chance(0.45);
    if (onTop) {
      addBlock(mb, {
        size: [w, h, w * rng.range(0.6, 1.6)],
        pos: [
          origin[0] + rng.signed() * sx * 0.34,
          origin[1] + sy,
          origin[2] + rng.signed() * sz * 0.34,
        ],
        bevel: 0.2,
        mask: rng.chance(0.16) ? MASK_EMISSIVE : MASK_METAL,
      });
    } else {
      const side = rng.int(0, 1);
      const off = rng.chance(0.5) ? 1 : -1;
      addBlock(mb, {
        size: side === 0 ? [w * 0.4, h, w] : [w, h, w * 0.4],
        pos: [
          origin[0] + (side === 0 ? off * sx * 0.5 : rng.signed() * sx * 0.32),
          origin[1] + rng.range(0.15, 0.8) * sy,
          origin[2] + (side === 1 ? off * sz * 0.5 : rng.signed() * sz * 0.32),
        ],
        bevel: 0.22,
        mask: rng.chance(0.2) ? MASK_EMISSIVE : MASK_METAL,
      });
    }
  }
}

/** A cylinder, for pistons, barrels and masts. */
function addCylinder(
  mb: MeshBuilder,
  radius: number,
  height: number,
  pos: [number, number, number],
  segments: number,
  mask: number,
  topRadius = radius,
): void {
  const [px, py, pz] = pos;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    mb.quad(
      new THREE.Vector3(px + c0 * radius, py, pz + s0 * radius),
      new THREE.Vector3(px + c1 * radius, py, pz + s1 * radius),
      new THREE.Vector3(px + c1 * topRadius, py + height, pz + s1 * topRadius),
      new THREE.Vector3(px + c0 * topRadius, py + height, pz + s0 * topRadius),
      mask,
    );
    // Caps.
    mb.quad(
      new THREE.Vector3(px, py + height, pz),
      new THREE.Vector3(px + c0 * topRadius, py + height, pz + s0 * topRadius),
      new THREE.Vector3(px + c1 * topRadius, py + height, pz + s1 * topRadius),
      new THREE.Vector3(px, py + height, pz),
      mask,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared hull material
// ---------------------------------------------------------------------------

export interface HullUniforms {
  uFaction: { value: THREE.Color };
  uEmissive: { value: number };
  uDamage: { value: number };
  uTime: { value: number };
  uLowQuality: { value: number };
}

/**
 * One material for every mech and structure in the game.
 *
 * Reads `aMask` to pick a surface, then adds procedural wear: edge highlights
 * from the vertex normal, downward grime streaks, and a faction-coloured
 * emissive on the tagged faces. Extends MeshStandardMaterial so shadows, fog
 * and tone mapping keep working.
 */
export function makeHullMaterial(factionColor: number): {
  material: THREE.MeshStandardMaterial;
  uniforms: HullUniforms;
} {
  const uniforms: HullUniforms = {
    uFaction: { value: new THREE.Color(factionColor) },
    uEmissive: { value: 1 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uLowQuality: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    // Fully metallic surfaces go black without an environment map to reflect.
    // Backing off to a semi-metal keeps the diffuse term doing real work while
    // still catching a specular highlight along every chamfer.
    metalness: 0.35,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aMask;
         varying float vMask;
         varying vec3 vObjPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vMask = aMask;
         vObjPos = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uFaction;
         uniform float uEmissive;
         uniform float uDamage;
         uniform float uLowQuality;
         varying float vMask;
         varying vec3 vObjPos;
         float hs_hash(vec3 p) {
           p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
         }
         float hs_noise(vec3 p) {
           vec3 i = floor(p), f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(mix(hs_hash(i), hs_hash(i + vec3(1,0,0)), f.x),
                 mix(hs_hash(i + vec3(0,1,0)), hs_hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hs_hash(i + vec3(0,0,1)), hs_hash(i + vec3(1,0,1)), f.x),
                 mix(hs_hash(i + vec3(0,1,1)), hs_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        float m = vMask;
        // Machines are painted a mid grey, not black. Dark hulls look striking
        // in isolation and then disappear into terrain at RTS range, where the
        // player needs to identify a unit in well under a second.
        vec3 hull  = vec3(0.230, 0.238, 0.252);
        vec3 metal = vec3(0.330, 0.322, 0.305);
        vec3 recess = vec3(0.075, 0.080, 0.090);

        vec3 base = hull;
        base = mix(base, metal, step(2.5, m));
        base = mix(base, recess, step(1.5, m) * step(m, 2.5));
        if (uLowQuality > 0.5) {
          base *= 0.92 + clamp(vNormal.y, 0.0, 1.0) * 0.08;
          base = mix(base, base * vec3(0.42, 0.38, 0.36), uDamage * 0.75);
        } else {
          // Fine cast-metal grain, plus larger blotches of discoloration.
          float grain = hs_noise(vObjPos * 26.0);
          float blotch = hs_noise(vObjPos * 2.4);
          base *= 0.82 + 0.36 * grain;

          // Grime collects on upward faces and streaks down vertical ones.
          float up = clamp(vNormal.y, 0.0, 1.0);
          base = mix(base, base * vec3(0.72, 0.70, 0.66), up * 0.35 * (0.4 + blotch));
          float streak = hs_noise(vec3(vObjPos.x * 30.0, vObjPos.y * 2.5, vObjPos.z * 30.0));
          base *= 1.0 - (1.0 - up) * streak * 0.22;

          // Edge wear: bright bare metal where the chamfers face the light.
          float wear = smoothstep(0.55, 1.0, grain) * 0.35;
          base = mix(base, vec3(0.52, 0.50, 0.47), wear);
          base = mix(base, base * vec3(0.42, 0.38, 0.36), uDamage * (0.5 + 0.5 * blotch));
        }

        diffuseColor.rgb *= base;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         {
           if (uLowQuality > 0.5) roughnessFactor = 0.68 + uDamage * 0.2;
           else {
             float g = hs_noise(vObjPos * 18.0);
             roughnessFactor = clamp(roughness - g * 0.22 + uDamage * 0.25, 0.16, 1.0);
           }
           if (vMask > 1.5 && vMask < 2.5) roughnessFactor = 0.9;
         }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           // Faction strips. Pushed well above 1.0 so bloom picks them up --
           // this is the cheapest way to make a unit read as powered.
           float isEm = step(0.5, vMask) * step(vMask, 1.5);
            float flicker = uLowQuality > 0.5
              ? 1.0 - uDamage * 0.25
              : 1.0 - uDamage * 0.5 * step(0.5, hs_noise(vObjPos * 9.0));
            totalEmissiveRadiance += uFaction * isEm * uEmissive * 5.0 * flicker;
            // Exposed internals glow hot as damage rises.
            float internalGlow = uLowQuality > 0.5 ? 0.35 : step(0.6, hs_noise(vObjPos * 7.0));
            totalEmissiveRadiance += vec3(1.0, 0.28, 0.06) * uDamage * uDamage * 0.5 * internalGlow;
         }`,
      );
  };

  material.customProgramCacheKey = () => 'rww-hull-v1';
  return { material, uniforms };
}

// ---------------------------------------------------------------------------
// Mechs
// ---------------------------------------------------------------------------

export type MechClass = 'vanguard' | 'longbow' | 'wisp' | 'aegis';

export interface MechRig {
  parts: {
    pelvis: THREE.BufferGeometry;
    torso: THREE.BufferGeometry;
    upperLeg: THREE.BufferGeometry;
    lowerLeg: THREE.BufferGeometry;
    foot: THREE.BufferGeometry;
  };
  height: number;
  radius: number;
  /** Hip separation, half-width. */
  hipOffset: number;
  /** Hip height above the ground when standing. */
  hipHeight: number;
  legUpper: number;
  legLower: number;
  /** Muzzle offsets in torso-local space. */
  muzzles: THREE.Vector3[];
}

interface MechProfile {
  height: number;
  /** Torso width, depth, height as fractions of overall height. */
  torso: [number, number, number];
  legThick: number;
  hipFrac: number;
  greebles: number;
  shoulderSpan: number;
  /** Barrel length as a fraction of height. */
  barrel: number;
  barrelRadius: number;
  /** A tall dorsal mount, for the artillery walker. */
  dorsal?: boolean;
  /** A wide dish, for the anti-air platform. */
  dish?: boolean;
}

/**
 * Proportions are expressed as fractions of the mech's standing height, which
 * keeps the four classes consistent with each other and makes rescaling a class
 * a one-number change.
 *
 * The numbers matter more than they look. An early pass had torsos 0.44 of
 * height wide with shoulders on top of that, which made every mech as wide as
 * it was tall -- from the tactical camera they read as flat gun platforms
 * rather than as walking machines. Keeping the torso narrow and the legs long
 * is what makes the silhouette say "this thing walks".
 */
const PROFILES: Record<MechClass, MechProfile> = {
  // Hunched and heavy-shouldered. Reads as a wall, but still clearly bipedal.
  vanguard: {
    height: 11,
    torso: [0.30, 0.26, 0.30],
    legThick: 0.105,
    hipFrac: 0.5,
    greebles: 16,
    shoulderSpan: 0.15,
    barrel: 0.21,
    barrelRadius: 0.024,
  },
  // Tall and back-heavy with a long dorsal artillery mount.
  longbow: {
    height: 10,
    torso: [0.24, 0.28, 0.26],
    legThick: 0.080,
    hipFrac: 0.56,
    greebles: 12,
    shoulderSpan: 0.10,
    barrel: 0.16,
    barrelRadius: 0.020,
    dorsal: true,
  },
  // Small, lean, forward-leaning. Reads as fast even standing still.
  wisp: {
    height: 7,
    torso: [0.20, 0.26, 0.22],
    legThick: 0.058,
    hipFrac: 0.60,
    greebles: 7,
    shoulderSpan: 0.085,
    barrel: 0.17,
    barrelRadius: 0.015,
  },
  // Squat and broad with a prominent interceptor array.
  aegis: {
    height: 9,
    torso: [0.29, 0.27, 0.27],
    legThick: 0.098,
    hipFrac: 0.48,
    greebles: 13,
    shoulderSpan: 0.13,
    barrel: 0.15,
    barrelRadius: 0.021,
    dish: true,
  },
};

export function buildMech(cls: MechClass, seed: number): MechRig {
  const p = PROFILES[cls];
  const rng = new Rng(seed ^ 0x3ec4);
  const H = p.height;

  // Legs take roughly 60% of standing height, which is the single strongest
  // cue that a silhouette is a walker rather than a vehicle.
  const legUpper = H * 0.29;
  const legLower = H * 0.27;
  const footH = H * 0.045;
  const hipHeight = legUpper + legLower + footH;

  // ---- Pelvis -------------------------------------------------------------
  const pelvisMb = new MeshBuilder();
  const pw = H * p.torso[0] * 0.72;
  addBlock(pelvisMb, {
    size: [pw, H * 0.10, H * p.torso[1] * 0.7],
    pos: [0, -H * 0.05, 0],
    bevel: 0.22,
    panels: 1,
  });
  addGreebles(pelvisMb, [pw, H * 0.10, H * 0.16], [0, -H * 0.05, 0], 4, rng);

  // ---- Torso --------------------------------------------------------------
  const torsoMb = new MeshBuilder();
  const tw = H * p.torso[0];
  const td = H * p.torso[1];
  const th = H * p.torso[2];

  addBlock(torsoMb, {
    size: [tw, th, td],
    pos: [0, 0, 0],
    bevel: 0.16,
    taper: 0.88,
    lean: [0, cls === 'wisp' ? td * 0.10 : 0],
    panels: 2,
  });
  // Chest emissive band -- the strongest faction read on the silhouette.
  addBlock(torsoMb, {
    size: [tw * 0.42, th * 0.14, td * 1.03],
    pos: [0, th * 0.58, 0],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });
  // Cockpit / sensor head.
  addBlock(torsoMb, {
    size: [tw * 0.3, th * 0.30, td * 0.55],
    pos: [0, th * 0.92, td * 0.16],
    bevel: 0.3,
    taper: 0.7,
    mask: MASK_METAL,
  });
  addBlock(torsoMb, {
    size: [tw * 0.20, th * 0.09, td * 0.10],
    pos: [0, th * 1.06, td * 0.42],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });

  // Shoulders and weapons.
  const muzzles: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const sx = side * (tw * 0.5 + H * p.shoulderSpan * 0.5);
    addBlock(torsoMb, {
      size: [H * p.shoulderSpan, th * 0.62, td * 0.8],
      pos: [sx, th * 0.30, 0],
      bevel: 0.2,
      taper: 0.9,
      panels: 1,
    });
    addGreebles(torsoMb, [H * p.shoulderSpan, th * 0.6, td * 0.8], [sx, th * 0.3, 0], 3, rng);

    // Barrel, pointing forward (+z).
    const by = th * 0.42;
    const bl = H * p.barrel;
    const br = H * p.barrelRadius;
    _m.makeRotationX(Math.PI / 2);
    _m.setPosition(sx, by, td * 0.3);
    const barrel = new MeshBuilder();
    addCylinder(barrel, br, bl, [0, 0, 0], 8, MASK_METAL);
    addCylinder(barrel, br * 1.35, bl * 0.16, [0, bl * 0.84, 0], 8, MASK_HULL);
    torsoMb.append(barrel, _m);
    muzzles.push(new THREE.Vector3(sx, by, td * 0.3 + bl));
  }

  // Class silhouette features.
  if (p.dorsal) {
    // Long artillery tube angled up over the shoulder.
    const tube = new MeshBuilder();
    const tl = H * 0.72;
    addCylinder(tube, H * 0.045, tl, [0, 0, 0], 10, MASK_METAL);
    addCylinder(tube, H * 0.062, tl * 0.14, [0, tl * 0.86, 0], 10, MASK_HULL);
    _m.makeRotationX(-1.02);
    _m.setPosition(0, th * 0.75, -td * 0.22);
    torsoMb.append(tube, _m);
    muzzles.length = 0;
    muzzles.push(new THREE.Vector3(0, th * 0.75 + Math.cos(1.02) * tl, -td * 0.22 + Math.sin(1.02) * tl));
  }
  if (p.dish) {
    // Interceptor array: a stack of angled fins reads better at distance than
    // an actual dish, and costs a fraction of the triangles.
    for (let i = 0; i < 5; i++) {
      addBlock(torsoMb, {
        size: [tw * 0.9 - i * tw * 0.1, th * 0.035, td * 0.1],
        pos: [0, th * 0.72 + i * th * 0.09, -td * 0.34],
        bevel: 0.3,
        mask: i % 2 === 0 ? MASK_EMISSIVE : MASK_METAL,
      });
    }
  }
  addGreebles(torsoMb, [tw, th, td], [0, 0, 0], p.greebles, rng);

  // ---- Legs ---------------------------------------------------------------
  const lt = H * p.legThick;

  const upperMb = new MeshBuilder();
  addBlock(upperMb, {
    size: [lt, legUpper, lt * 1.15],
    pos: [0, -legUpper, 0],
    bevel: 0.22,
    taper: 0.86,
    panels: 1,
  });
  // Hydraulic actuator alongside the thigh.
  addCylinder(upperMb, lt * 0.18, legUpper * 0.8, [lt * 0.55, -legUpper * 0.9, 0], 6, MASK_METAL);
  addGreebles(upperMb, [lt, legUpper, lt], [0, -legUpper, 0], 3, rng);

  const lowerMb = new MeshBuilder();
  addBlock(lowerMb, {
    size: [lt * 0.85, legLower, lt],
    pos: [0, -legLower, 0],
    bevel: 0.24,
    taper: 1.14,
    panels: 1,
  });
  addBlock(lowerMb, {
    size: [lt * 0.3, legLower * 0.5, lt * 0.16],
    pos: [0, -legLower * 0.7, lt * 0.5],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });
  addGreebles(lowerMb, [lt, legLower, lt], [0, -legLower, 0], 2, rng);

  const footMb = new MeshBuilder();
  addBlock(footMb, {
    size: [lt * 1.25, footH, lt * 2.3],
    pos: [0, 0, lt * 0.35],
    bevel: 0.3,
    taper: 0.82,
    mask: MASK_METAL,
  });
  // Toe claws give the foot a readable footprint from above.
  for (const side of [-1, 0, 1]) {
    addBlock(footMb, {
      size: [lt * 0.3, footH * 0.7, lt * 0.5],
      pos: [side * lt * 0.42, 0, lt * 1.55],
      bevel: 0.3,
      mask: MASK_HULL,
    });
  }

  return {
    parts: {
      pelvis: pelvisMb.build(),
      torso: torsoMb.build(),
      upperLeg: upperMb.build(),
      lowerLeg: lowerMb.build(),
      foot: footMb.build(),
    },
    height: H,
    radius: Math.max(tw, H * p.hipFrac * 0.5) * 0.62,
    hipOffset: H * p.legThick * 2.6,
    hipHeight,
    legUpper,
    legLower,
    muzzles,
  };
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export type StructureKind =
  | 'bastion'
  | 'extractor'
  | 'solarArray'
  | 'fusionCore'
  | 'fabricator'
  | 'mechFoundry'
  | 'rocketBattery'
  | 'pointDefense'
  | 'laserGrid'
  | 'radarMast'
  | 'silo'
  | 'spinalNode';

export interface StructureModel {
  geometry: THREE.BufferGeometry;
  radius: number;
  height: number;
  muzzles: THREE.Vector3[];
}

export function buildStructure(kind: StructureKind, seed: number): StructureModel {
  const rng = new Rng(seed ^ 0x91a3);
  const mb = new MeshBuilder();
  const muzzles: THREE.Vector3[] = [];
  let radius = 10;
  let height = 12;

  /** Every building sits on the same chamfered plinth, which is most of what
   *  makes an ad-hoc collection of shapes read as one faction's architecture. */
  const plinth = (r: number, h: number): void => {
    addBlock(mb, { size: [r * 2, h, r * 2], pos: [0, 0, 0], bevel: 0.28, taper: 0.94, mask: MASK_METAL });
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      addBlock(mb, {
        size: [r * 0.22, h * 1.5, r * 0.22],
        pos: [dx * r * 0.82, 0, dz * r * 0.82],
        bevel: 0.3,
        mask: MASK_HULL,
      });
    }
  };

  switch (kind) {
    case 'bastion': {
      radius = 22;
      height = 34;
      plinth(radius, 4);
      addBlock(mb, { size: [30, 16, 30], pos: [0, 4, 0], bevel: 0.14, taper: 0.82, panels: 3 });
      addBlock(mb, { size: [18, 10, 18], pos: [0, 20, 0], bevel: 0.18, taper: 0.8, panels: 2 });
      addBlock(mb, { size: [20, 1.6, 20], pos: [0, 19, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Command spire.
      addCylinder(mb, 2.6, 12, [0, 30, 0], 8, MASK_METAL, 1.2);
      addBlock(mb, { size: [3, 2.4, 3], pos: [0, 41, 0], bevel: 0.3, mask: MASK_EMISSIVE });
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [5, 5, 7], pos: [side * 13, 20, 0], bevel: 0.22, mask: MASK_METAL });
        muzzles.push(new THREE.Vector3(side * 13, 23, 5));
      }
      addGreebles(mb, [30, 16, 30], [0, 4, 0], 22, rng);
      break;
    }
    case 'extractor': {
      radius = 11;
      height = 14;
      plinth(radius, 3);
      addBlock(mb, { size: [14, 7, 14], pos: [0, 3, 0], bevel: 0.18, taper: 0.85, panels: 2 });
      // Drill head and spoil chute.
      addCylinder(mb, 3.2, 9, [0, 9, 0], 10, MASK_METAL, 2.2);
      addCylinder(mb, 1.1, 5, [0, -4, 0], 8, MASK_RECESS);
      addBlock(mb, { size: [3, 1.2, 9], pos: [6, 6, 0], bevel: 0.3, mask: MASK_METAL });
      addBlock(mb, { size: [11, 0.9, 2], pos: [0, 9.6, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      addGreebles(mb, [14, 7, 14], [0, 3, 0], 10, rng);
      break;
    }
    case 'solarArray': {
      radius = 13;
      height = 8;
      plinth(6, 2);
      addCylinder(mb, 1.6, 4, [0, 2, 0], 8, MASK_METAL);
      // Three tilted collector panels.
      for (let i = 0; i < 3; i++) {
        const panel = new MeshBuilder();
        addBlock(panel, { size: [16, 0.5, 5.4], pos: [0, 0, 0], bevel: 0.3, mask: MASK_HULL });
        addBlock(panel, { size: [15, 0.3, 4.6], pos: [0, 0.5, 0], bevel: 0.3, mask: MASK_EMISSIVE });
        _m.makeRotationX(-0.42);
        _m.setPosition(0, 6, (i - 1) * 6);
        mb.append(panel, _m);
      }
      break;
    }
    case 'fusionCore': {
      radius = 12;
      height = 20;
      plinth(radius, 3);
      addCylinder(mb, 7, 13, [0, 3, 0], 12, MASK_HULL, 6);
      addCylinder(mb, 7.4, 1.4, [0, 9, 0], 12, MASK_EMISSIVE);
      addCylinder(mb, 3.4, 6, [0, 16, 0], 10, MASK_METAL, 4.2);
      // Cooling stacks.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        addCylinder(mb, 1.1, 9, [Math.cos(a) * 8.2, 3, Math.sin(a) * 8.2], 6, MASK_METAL);
      }
      addGreebles(mb, [14, 13, 14], [0, 3, 0], 12, rng);
      break;
    }
    case 'fabricator': {
      radius = 14;
      height = 15;
      plinth(radius, 3);
      addBlock(mb, { size: [20, 9, 15], pos: [0, 3, 0], bevel: 0.16, taper: 0.92, panels: 2 });
      addBlock(mb, { size: [21, 1.1, 3], pos: [0, 9, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Gantry arch over the output bay.
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [1.6, 10, 1.6], pos: [side * 8, 12, 9], bevel: 0.3, mask: MASK_METAL });
      }
      addBlock(mb, { size: [18, 1.4, 2.4], pos: [0, 21, 9], bevel: 0.3, mask: MASK_METAL });
      addGreebles(mb, [20, 9, 15], [0, 3, 0], 14, rng);
      break;
    }
    case 'mechFoundry': {
      radius = 18;
      height = 22;
      plinth(radius, 4);
      addBlock(mb, { size: [26, 13, 20], pos: [0, 4, 0], bevel: 0.14, taper: 0.9, panels: 3 });
      addBlock(mb, { size: [27, 1.4, 4], pos: [0, 13, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Assembly bay: a tall recessed slot, lit from within.
      addBlock(mb, { size: [11, 15, 3], pos: [0, 4, 10.5], bevel: 0.1, mask: MASK_RECESS });
      addBlock(mb, { size: [9.5, 13.5, 0.6], pos: [0, 4.6, 11.8], bevel: 0.2, mask: MASK_EMISSIVE });
      // Overhead crane rails.
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [2, 11, 22], pos: [side * 12, 17, 0], bevel: 0.24, mask: MASK_METAL });
      }
      addBlock(mb, { size: [26, 1.8, 3], pos: [0, 27, 4], bevel: 0.3, mask: MASK_METAL });
      addGreebles(mb, [26, 13, 20], [0, 4, 0], 20, rng);
      break;
    }
    case 'rocketBattery': {
      radius = 12;
      height = 16;
      plinth(radius, 3);
      addBlock(mb, { size: [15, 6, 13], pos: [0, 3, 0], bevel: 0.18, panels: 2 });
      // Elevated tube cluster, angled up.
      const cluster = new MeshBuilder();
      for (let i = 0; i < 6; i++) {
        const cx = ((i % 3) - 1) * 2.5;
        const cy = Math.floor(i / 3) * 2.5;
        addCylinder(cluster, 1.0, 11, [cx, cy, 0], 8, MASK_RECESS);
        addCylinder(cluster, 1.15, 1.2, [cx, cy + 9.8, 0], 8, MASK_METAL);
      }
      _m.makeRotationX(-0.86);
      _m.setPosition(0, 9, -1);
      mb.append(cluster, _m);
      addBlock(mb, { size: [15, 1.1, 2], pos: [0, 8.4, 5], bevel: 0.4, mask: MASK_EMISSIVE });
      muzzles.push(new THREE.Vector3(0, 17, 5));
      addGreebles(mb, [15, 6, 13], [0, 3, 0], 9, rng);
      break;
    }
    case 'pointDefense': {
      radius = 8;
      height = 12;
      plinth(7, 2.5);
      addCylinder(mb, 3.2, 4, [0, 2.5, 0], 10, MASK_HULL, 2.8);
      addBlock(mb, { size: [5.5, 3.4, 6], pos: [0, 6.5, 0], bevel: 0.2, taper: 0.85, mask: MASK_METAL });
      // Quad barrels.
      for (const dx of [-1.3, 1.3]) {
        for (const dy of [0, 1.3]) {
          const barrel = new MeshBuilder();
          addCylinder(barrel, 0.32, 6, [0, 0, 0], 6, MASK_METAL);
          _m.makeRotationX(Math.PI / 2 - 0.3);
          _m.setPosition(dx, 7.3 + dy, 2.4);
          mb.append(barrel, _m);
        }
      }
      addBlock(mb, { size: [5.8, 0.8, 1.4], pos: [0, 9.6, -1], bevel: 0.4, mask: MASK_EMISSIVE });
      muzzles.push(new THREE.Vector3(0, 8, 8));
      break;
    }
    case 'laserGrid': {
      radius = 10;
      height = 24;
      plinth(radius, 3);
      // Twin field pylons leave an unmistakable open gate silhouette. The
      // emitter bars are emissive so powered coverage reads at RTS distance.
      for (const side of [-1, 1]) {
        addBlock(mb, {
          size: [3.2, 18, 4.2],
          pos: [side * 5.2, 3, 0],
          bevel: 0.2,
          taper: 0.82,
          panels: 3,
        });
        addCylinder(mb, 1.25, 4, [side * 5.2, 20.5, 0], 8, MASK_METAL, 0.7);
        addBlock(mb, {
          size: [2.2, 1.0, 5.2],
          pos: [side * 5.2, 18, 0],
          bevel: 0.3,
          mask: MASK_EMISSIVE,
        });
      }
      addBlock(mb, { size: [11.5, 1.2, 2.2], pos: [0, 15, 0], bevel: 0.3, mask: MASK_METAL });
      addBlock(mb, { size: [9.8, 0.55, 1.0], pos: [0, 16.2, 0], bevel: 0.35, mask: MASK_EMISSIVE });
      addGreebles(mb, [13, 18, 7], [0, 3, 0], 10, rng);
      muzzles.push(new THREE.Vector3(0, 19, 0));
      break;
    }
    case 'radarMast': {
      radius = 7;
      height = 28;
      plinth(6, 2.5);
      // Lattice mast: alternating offset blocks read as a truss for very few
      // triangles, and the silhouette is what matters at this distance.
      for (let i = 0; i < 9; i++) {
        const y = 2.5 + i * 2.6;
        const w = 3.4 - i * 0.18;
        addBlock(mb, {
          size: [w, 0.5, w],
          pos: [0, y, 0],
          bevel: 0.35,
          mask: MASK_METAL,
        });
        for (const [dx, dz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          addBlock(mb, {
            size: [0.42, 2.6, 0.42],
            pos: [dx * w * 0.42, y, dz * w * 0.42],
            bevel: 0.3,
            mask: MASK_HULL,
          });
        }
      }
      // Rotating dish assembly.
      addBlock(mb, { size: [9, 0.6, 5], pos: [0, 26, 0], bevel: 0.3, taper: 0.6, mask: MASK_HULL });
      addBlock(mb, { size: [8, 0.5, 4], pos: [0, 26.6, 0], bevel: 0.3, mask: MASK_EMISSIVE });
      addCylinder(mb, 0.3, 3, [0, 27.2, 0], 6, MASK_METAL);
      break;
    }
    case 'silo': {
      radius = 16;
      height = 30;
      plinth(radius, 4);
      // Armoured launch well with split blast doors and an exposed central
      // accelerator. It is deliberately tall and legible as an endgame target.
      addCylinder(mb, 10, 19, [0, 4, 0], 14, MASK_HULL, 8.5);
      addCylinder(mb, 5.2, 23, [0, 4, 0], 12, MASK_RECESS, 4.1);
      addCylinder(mb, 2.4, 20, [0, 7, 0], 10, MASK_METAL, 1.6);
      addCylinder(mb, 10.4, 1.3, [0, 13, 0], 14, MASK_EMISSIVE);
      for (const side of [-1, 1]) {
        addBlock(mb, {
          size: [8.2, 1.5, 18],
          pos: [side * 5.1, 23, 0],
          bevel: 0.18,
          lean: [side * 1.6, 0],
          mask: MASK_METAL,
          panels: 2,
        });
        addBlock(mb, {
          size: [1.1, 7, 2.2],
          pos: [side * 11.2, 8, 0],
          bevel: 0.3,
          mask: MASK_EMISSIVE,
        });
      }
      addGreebles(mb, [20, 19, 20], [0, 4, 0], 18, rng);
      muzzles.push(new THREE.Vector3(0, 29, 0));
      break;
    }
    case 'spinalNode': {
      radius = 15;
      height = 40;
      plinth(radius, 5);
      // A pre-existing megastructure fixture, not something either side built:
      // heavier, more monumental, and deliberately not in a faction style.
      addCylinder(mb, 9, 8, [0, 5, 0], 10, MASK_HULL, 7);
      addCylinder(mb, 4.5, 24, [0, 13, 0], 8, MASK_METAL, 3.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addBlock(mb, {
          size: [1.4, 20, 1.4],
          pos: [Math.cos(a) * 7, 12, Math.sin(a) * 7],
          bevel: 0.3,
          mask: MASK_HULL,
        });
      }
      addCylinder(mb, 6.5, 2.5, [0, 36, 0], 10, MASK_EMISSIVE, 5);
      addCylinder(mb, 2, 4, [0, 38.5, 0], 8, MASK_METAL, 0.6);
      addGreebles(mb, [18, 8, 18], [0, 5, 0], 14, rng);
      break;
    }
  }

  return { geometry: mb.build(), radius, height, muzzles };
}
