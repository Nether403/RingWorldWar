# Module Contracts

Contracts between the parts of the game that are built independently. If you are
implementing one of these modules, this file is the specification: match the
exported names and signatures exactly, because the integration code is written
against them and will not be adapted to fit.

## Ground rules for every module
- TypeScript, `strict` mode. No `any`. `npm run typecheck` must pass.
- **No external assets of any kind.** No image, audio, model, or font files.
  Everything is generated in code. This is the project's defining constraint.
- All randomness comes from `Rng` in `@core/rng`, seeded explicitly. Never
  `Math.random()`.
- Allocate nothing per frame in update paths. Pool and reuse.
- Only touch files inside the directories your module owns.
- Path aliases: `@core/*`, `@sim/*`, `@render/*`, `@gen/*`, `@ui/*`.

## Existing foundations you build on

### `@core/constants`
`RING_RADIUS` 3600, `RING_WIDTH` 4000, `RING_HALF_WIDTH` 2000,
`RING_CIRCUMFERENCE` ~22619, `SURFACE_GRAVITY` 6.0, `RING_OMEGA`, `RING_PERIOD`,
`SIM_DT`, `DAY_LENGTH`.

### `@core/ringMath`
`wrapS(s)`, `deltaS(a, b)` (shortest signed arc delta — use for ALL distance and
direction maths), `surfaceDist(s1, z1, s2, z2)`, `clampZ(z)`.

### `@core/rng`
`new Rng(seed)` with `.next()`, `.range(a, b)`, `.int(a, b)`, `.chance(p)`,
`.signed()`, `.gaussian()`, `.pick(arr)`, `.shuffle(arr)`, `.fork()`.

### `@gen/noise`
`new Noise(seed)` with `.noise2/.noise3/.fbm2/.fbm3/.ridged3/.billow3`,
plus `worley2`, `clamp`, `clamp01`, `lerp`, `smoothstep`, `smootherstep`, `remap`.

### `@gen/terrain`
`Terrain` with `.heightAt(s, z)`, `.slopeAt(s, z)`, `.normalAt(s, z, out)`,
`.isBuildable(s, z)`.

### `@render/anchor` — `RenderAnchor`
The floating origin. Ring space is `(s, h, z)`: arc length, height above the
floor, axial position. Render space is a local tangent frame: `+x` spinward,
`+y` up (toward the ring axis), `+z` axial.
- `anchor.toVector(s, h, z, outVec3)` — ring space to render space
- `anchor.orientation(s, yaw, outQuat)` — upright orientation at a surface point
- `anchor.upAt(s, outVec3)` — local up in render space

Anything placed in the world must go through the anchor. Never assume `+y` is up
globally; on the far side of the ring it points the other way.

## Coordinate conventions
- `s` — arc length around the ring, wraps at `RING_CIRCUMFERENCE`
- `z` — axial, in `[-2000, +2000]`
- `h` — height above the floor
- `yaw` — 0 points spinward, increases toward `+z`

## Faction colours
```ts
export const FACTION_COLOR = {
  compact: 0xf0821e, // Meridian Compact, amber
  choir:   0x3fd0e8, // Axiom Choir, cyan
} as const;
```
Only factions get saturated colour. Everything else stays desaturated so units
read instantly against terrain.

---

# Module A — Procedural hard-surface models
**Owns:** `src/gen/hardSurface.ts`, `src/gen/mechModels.ts`, `src/gen/structureModels.ts`, `src/dev/modelsDemo.ts`

Builds every mech and building in the game out of code. Style is machined
industrial sci-fi: bevelled chassis blocks, inset panel lines, greebles
clustered at joints and vents, hydraulic cylinders, emissive strips in faction
colour.

```ts
// hardSurface.ts -- the modelling toolkit
export interface BoxSpec {
  size: [number, number, number];
  pos?: [number, number, number];
  bevel?: number;          // metres chamfered off each edge
  taper?: number;          // 0..1, top face shrink
  panelDensity?: number;   // 0..1, inset panel lines on faces
  greeble?: number;        // 0..1, small scattered detail
  emissive?: boolean;      // tag faces for the faction emissive channel
}
/** Build one bevelled, panelled, greebled block. */
export function buildBlock(spec: BoxSpec, rng: Rng): THREE.BufferGeometry;
/** Merge parts into one indexed geometry with groups per material slot. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry;
/** Swept tube along a path, for piping and cabling. */
export function buildTube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry;
/** Hydraulic piston between two points. */
export function buildPiston(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry;

// mechModels.ts
export type MechClass = 'vanguard' | 'longbow' | 'wisp' | 'aegis';
export interface MechPartGeometries {
  /** Named sockets the animation layer will drive. All in metres, +y up,
   *  origin at the point where the part attaches to its parent. */
  pelvis: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  upperLegL: THREE.BufferGeometry; lowerLegL: THREE.BufferGeometry; footL: THREE.BufferGeometry;
  upperLegR: THREE.BufferGeometry; lowerLegR: THREE.BufferGeometry; footR: THREE.BufferGeometry;
  armL: THREE.BufferGeometry; armR: THREE.BufferGeometry;
  weaponL: THREE.BufferGeometry; weaponR: THREE.BufferGeometry;
}
export interface MechRig {
  geometries: MechPartGeometries;
  /** Attachment offsets, parent-local. */
  joints: {
    hipL: THREE.Vector3; hipR: THREE.Vector3;
    kneeL: THREE.Vector3; kneeR: THREE.Vector3;
    ankleL: THREE.Vector3; ankleR: THREE.Vector3;
    shoulderL: THREE.Vector3; shoulderR: THREE.Vector3;
    muzzleL: THREE.Vector3; muzzleR: THREE.Vector3;
    torso: THREE.Vector3; head: THREE.Vector3;
  };
  /** Overall standing height, metres. */
  height: number;
  /** Horizontal radius for selection and collision. */
  radius: number;
  /** Upper leg / lower leg lengths, for the IK solver. */
  legUpper: number; legLower: number;
}
export function buildMech(cls: MechClass, seed: number): MechRig;

// structureModels.ts
export type StructureKind =
  | 'bastion' | 'extractor' | 'solarArray' | 'fusionCore'
  | 'fabricator' | 'mechFoundry' | 'rocketBattery' | 'pointDefense'
  | 'radarMast' | 'spinalNode';
export interface StructureModel {
  geometry: THREE.BufferGeometry;
  /** Footprint radius on the ground, metres. */
  radius: number;
  height: number;
  /** Where projectiles leave, parent-local. Empty for non-combat buildings. */
  muzzles: THREE.Vector3[];
}
export function buildStructure(kind: StructureKind, seed: number): StructureModel;
```

Geometry requirements:
- Indexed, with `position`, `normal`, `uv`, and a `aMask` float attribute per
  vertex: `0` = base hull, `1` = faction-coloured emissive, `2` = dark recess.
  The shared material uses `aMask` to recolour per faction without needing
  separate meshes or textures.
- Origin at the attachment point, `+y` up, `+z` forward.
- Mech heights: vanguard 11 m, longbow 10 m, wisp 7 m, aegis 9 m.
- Provide LOD via a `detail` parameter internally: full greebles, then a
  greeble-free variant. Expose `buildMech(cls, seed)` returning full detail; add
  `buildMechLOD(cls, seed, level: 0 | 1 | 2)` alongside it.
- Budget: a mech under 25k triangles at LOD0, under 4k at LOD1, under 700 at LOD2.

Verify with `src/dev/modelsDemo.ts` exporting
`mountModelsDemo(scene: THREE.Scene): void` that lays every mech and structure
out on a grid so it can be inspected.

---

# Module B — VFX
**Owns:** `src/render/vfx/**`, `src/dev/vfxDemo.ts`

GPU-driven particles with procedurally generated sprite atlases (draw them into
an OffscreenCanvas at init — no image files).

```ts
export interface VfxSystem {
  readonly object: THREE.Object3D;   // add once to the scene
  update(dt: number, camera: THREE.Camera): void;
  /** Called when the floating origin moves; shift persistent effects by delta. */
  rebase(deltaRender: THREE.Vector3): void;

  explosion(pos: THREE.Vector3, scale: number, kind: 'small' | 'medium' | 'large' | 'nuclear'): void;
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale: number, color: number): void;
  impact(pos: THREE.Vector3, normal: THREE.Vector3, scale: number): void;
  dust(pos: THREE.Vector3, scale: number): void;
  /** Persistent rocket exhaust + contrail. Returns a handle. */
  beginTrail(color: number, width: number): number;
  updateTrail(handle: number, pos: THREE.Vector3): void;
  endTrail(handle: number): void;
  shieldHit(pos: THREE.Vector3, normal: THREE.Vector3, color: number): void;
  /** Brief additive light flash the renderer can read for bloom boost. */
  readonly flashIntensity: number;
  dispose(): void;
}
export function createVfx(seed: number): VfxSystem;
```

Notes that matter for how this looks:
- Explosions must include a real point light flash, an expanding shockwave ring,
  a fireball, debris, and a smoke column that lingers. The light flash is what
  makes an explosion feel like an explosion; do not skip it. Cap concurrent
  lights at 24 and pool them.
- Contrails must persist and disperse slowly. Rocket trails arcing across the
  sky are a core visual motif and also a gameplay tell about where fire came
  from, so they should last ~12 s and widen as they fade.
- Everything is additive or alpha-blended, depth-tested but not depth-writing.
- Hard cap: 20k live particles, one draw call per blend mode.

Verify with `mountVfxDemo(scene: THREE.Scene, vfx: VfxSystem): void` that fires
each effect on a timer.

---

# Module C — Procedural audio
**Owns:** `src/audio/**`

WebAudio synthesis graphs. No sample files.

```ts
export type SfxName =
  | 'footfallHeavy' | 'footfallLight' | 'servo'
  | 'autocannon' | 'rocketLaunch' | 'rocketFlyby' | 'laser' | 'pointDefense'
  | 'explosionSmall' | 'explosionLarge' | 'shieldHit'
  | 'build' | 'complete' | 'select' | 'order' | 'alert' | 'unitLost';

export interface AudioEngine {
  /** Must be called from a user gesture; browsers block audio otherwise. */
  resume(): Promise<void>;
  /** distance in metres; the engine applies delay, low-pass and reverb send. */
  play(name: SfxName, opts?: { distance?: number; gain?: number; pitch?: number }): void;
  /** 0 = calm, 1 = heavy combat. Drives the generative score. */
  setTension(v: number): void;
  setMasterVolume(v: number): void;
  setMuted(m: boolean): void;
  update(dt: number): void;
  dispose(): void;
}
export function createAudio(seed: number): AudioEngine;
```

What makes this sell scale: distant sounds should arrive LATE (delay of
`distance / 340` seconds), low-passed, and with more reverb send. A far-off
explosion that flashes before you hear it does more for a sense of size than any
amount of visual work.

The score is generative: slow detuned pad chords over a harmonic progression,
with percussion and low brass entering as tension rises. It must never loop
audibly.

---

# Integration
The orchestrating agent owns `src/main.ts`, `src/sim/**` (except `ballistics.ts`
which exists), `src/ui/**`, and wiring. Do not edit those.

To see your work, add your demo module and run the dev server on your own port:
```
npm run dev -- --port 5181     # Module A
npm run dev -- --port 5182     # Module B
npm run dev -- --port 5183     # Module C
```
`src/main.ts` reads a `?demo=models|vfx|audio` query parameter and mounts the
corresponding demo, so you can inspect your module in isolation.

Screenshot it with:
```
node tools/shot.mjs --url "http://localhost:5181/?demo=models" --out output/playwright/models.jpg --wait 12
```
Then read the image back and iterate on it. Judge your own output visually — do
not assume it looks right because it compiles.

Do not run `git commit`. The orchestrator commits.
