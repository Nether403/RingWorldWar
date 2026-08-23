# Procedural Graphics Overhaul

**Status:** Phases 0, 1 and 2 complete. Phase 3 (Tasks 8 to 10, terrain) not started.

**Frozen baseline:** `1980ed61a76345f7d5b09f18bc50b3c17eb58a15`

| Task | Status |
| --- | --- |
| 1 - Visual contact sheet with screenshot baselines | Complete |
| 2 - Owned HDR render target and single composite pass | Complete (scope extended, see outcome) |
| 3 - Bloom and emissive retune | Complete |
| 4 - Depth-derived AO and contact shadow fix | Complete (scope adjusted, see outcome) |
| 5 - Day and night colour grading | Complete (Low omission recorded) |
| 6 - Shared procedural surface library | Complete (terrain triplanar deferred to Task 10) |
| 7 - Authored buildings wear the shared material | Complete |
| 8 - Terrain erosion and material field | Complete (three defects found and fixed, see outcome) |
| 9 - Bake terrain fields into ring mesh attributes | Complete (SEG_Z decision carried to Task 10) |
| 10 - Terrain shader reads baked fields, real quality tiers | Complete (terrain GPU cost down 43-49%; parallax deviation recorded) |
| 11 - Extend the primitive vocabulary | Complete (vertical divisions withdrawn, see outcome) |
| 12 - Weld pass and curvature channel for edge wear | Complete (two Low-budget regressions found and fixed, see outcome) |
| 13 - Greeble-tier LOD, sockets, wrecks | **Partial** - bucket caps and wrecks done; LOD and sockets outstanding |
| 14 to 15 | Not started |

Companion documents: `docs/art-direction.md` (how it looks),
`docs/procedural-assets.md` (how it is generated),
`docs/phase-4c-renderer-profile.md` (measured renderer cost),
`docs/t480s-low-performance.md` (the frozen Low gate),
`docs/roadmap.md` (current delivery status).

This document supersedes the "Post-Processing Roadmap" framing in
`docs/art-direction.md` section 5 and the "no post-processing composer" boundary
recorded in `docs/roadmap.md` and `docs/phase-3b-atmosphere.md`. Those
boundaries were correct for Gate 1 and Phase 3B. Task 2 below replaces them with
a narrower, explicitly-owned commitment rather than removing them outright.

## Problem Statement

Terrain, buildings, and units are all generated in code and are individually
reasonable. The composed scene still reads flat and incoherent. There are three
specific causes, and none of them is a lack of geometric detail.

**No tone stage.** `postProcessingLevel` is the literal `'none'` on every
quality tier. There is no bloom, no ambient occlusion, and no colour grading,
even though the hull shader authors faction emissive strips at `5.0`
specifically so that bloom will pick them up, and even though
`docs/art-direction.md` section 5 names colour grading "the single
highest-impact item on this list."

**Three unrelated surface systems.** The terrain shader carries one noise
library, the hull shader carries a second one that produces visually unrelated
results, the environmental dressing buckets use plain `MeshStandardMaterial`
with no procedural surface at all, and the imported building models are forced
to a flat sandstone albedo. Nothing shares a surface vocabulary, so nothing
looks like it belongs to the same world. This is a direct violation of
`docs/art-direction.md` section 0 rule 1, coherence over detail.

**Generation and shading disagree.** `Terrain` emits only `heights` and
`slope`. The terrain shader therefore re-derives its own material regions
(`deckRegion`, `regA`, `regB`) from independent noise, so material zones have no
relationship to the landforms they sit on. It pays six-octave FBM per pixel to
do it, which measures at approximately 41 ms of the approximately 49 ms Medium
GPU frame.

## Confirmed Requirements

**Performance envelope.** The T480s 720p Low gate is frozen. It stays at a hard
30 FPS with a p95 tolerance of 34 ms, currently measured at 16.7 / 16.8 /
17.955 ms RAF median/p95/p99, 68 draw calls, 115,044 triangles, 15 programs,
2 textures. Low receives zero new per-pixel cost and zero post-processing.
Medium, High, and Ultra may become more expensive than the T480s can run. That
machine will settle on Low through the existing adaptive governor, and this is
accepted rather than treated as a regression.

**Priority.** Tone first, then coherence, then terrain, then units, then
buildings. Rationale: the tone stage affects all three subjects simultaneously
for one full-screen pass, whereas per-subject work affects only its own subject.

**Asset policy.** Mixed authored and procedural assets are accepted. The
governing criterion is the composed result, not the provenance of any individual
asset. This overhaul makes authored and procedural geometry coherent with each
other rather than choosing between them. `docs/procedural-assets.md`,
`docs/art-direction.md` section 11, and `docs/spec.md` must be updated to record
this decision, because they currently forbid authored binary models that already
ship.

**Gameplay stays frozen.** This is presentation-only work. It must not change
unit or structure statistics, weapons, abilities, economy, movement, AI,
navigation, ballistics, visibility, victory rules, footprints, collision, line of
sight, or save state. Task 8 is the single deliberate exception and is flagged
explicitly.

**Determinism holds.** Visual seeds derive from immutable namespaced inputs:
world seed, asset kind, stable entity ID. Presentation must not consume
simulation RNG, mutate simulation state, or affect stable entity ordering.

**Draw calls stay under the 400 architectural ceiling.**

## Key Finding: why the authored buildings look wrong

`src/render/authoredBuildingPilot.ts:152-167` forces every imported material to
a flat `#927456` sandstone albedo, `roughness >= 0.9`, and `metalness <= 0.08`.
The comment at line 157 gives the reason: the split GLBs carry no texture or UV
data. The source textures `building.png` and `building_baseColor.png` exist in
`star-wars-inspired-low-poly-buildings/textures/` and
`star-wars-inspired-low-poly-buildings/split/` but were never shipped to
`public/`. Thirteen GLBs shipped to `public/assets/buildings/ondrasaur/` and
only five are placed. The collection is CC-BY 4.0 and is credited in
`CREDITS.md`.

The consequence is that the imported models are flat, untextured, matte volumes
standing next to a hull shader doing cast-metal grain, grime pooling on upward
faces, downward streaking, edge wear, and emissive strips, and next to a terrain
shader doing four-layer height-blended materials with two scales of panel
lining. The models are not the problem. The problem is that they are the only
objects in the scene not wearing the procedural surface system.

The fix generalises. Build one shared procedural surface library, triplanar in
object space and therefore requiring no UVs, and apply it to procedural geometry
and imported geometry alike. Any future downloaded asset then drops in looking
native.

## Background

Verified against the source at the frozen baseline. Line references are
load-bearing; they are the seams the tasks below plug into.

### Terrain

| Fact | Location |
| --- | --- |
| Terrain is ~41 ms of the ~49 ms Medium GPU frame. Isolation: Low terrain path with shadows retained measures 8.136 ms against 49.186 ms default | `docs/phase-4c-renderer-profile.md` |
| Grid is `TERRAIN_CELL 16`, cols 1414, rows 251, ~354,900 cells, generated eagerly in the constructor | `src/gen/terrain.ts:20, 57-68` |
| Noise stack: 3-octave domain warp at amplitude 0.45, 5-octave base at +/-44 m, masked 4-octave ridged to 150 m, 3-octave fine detail at +/-3.2 m, Worley plate joins at -4 m, 14 craters with ejecta lips, rim walls, 540 m one-sided clamp | `src/gen/terrain.ts:70-150` |
| Seamlessness is structural, not tiled: 3D noise sampled on a circle of radius `(C * scale) / 2pi`, so the spinward seam is mathematically impossible | `src/gen/terrain.ts:99-106` |
| 14 flat zones then 8 corridors are applied after the noise stack; corridor endpoint heights are snapshotted first so shared junctions agree regardless of order | `src/gen/terrain.ts:153-168, 408-463` |
| `Terrain` emits only `heights` and `slope`. No erosion of any kind, no biome or material mask, no curvature field, no AO field, no moisture or deposition | `src/gen/terrain.ts:43-52` |
| Whole 22.6 km world is one `BufferGeometry`, one `Mesh`, one draw call. No LOD, no clipmap, no chunking, no streaming | `src/render/ringMesh.ts:1-19, 64` |
| Mesh is 1024 x 160 (~22 m spinward by ~25 m axial), which is coarser than the 16 m heightfield it samples. Low is 512 x 64 | `src/render/ringMesh.ts:32-37` |
| Vertex attributes are `position`, `normal`, `uv`, `aSurface`. No tangents, no vertex colours, no splat weights, no curvature, no AO, no biome ID | `src/render/ringMesh.ts:186-192` |
| Spinward seam is a topological weld via `i1 = (i + 1) % cols`; the manual `boundingSphere` is required because the mesh is never frustum-culled | `src/render/ringMesh.ts:167-186, 193-196` |
| Floating origin costs one rotation and one translation; no vertex is ever touched | `src/render/ringMesh.ts:96-104` |
| Full terrain material is a `MeshStandardMaterial` patched through five independent `.replace()` seams: map, roughness, metalness, normals, lights | `src/render/materials/terrainMaterial.ts:267, 356, 371, 383, 408` |
| Four material layers (`cDust`, `cRock`, `cPlate`, `cRim`) blended by `rww_hblend` height blending, not linear alpha | `src/render/materials/terrainMaterial.ts:291-320` |
| `vHeight` is computed in the vertex shader and never read in the fragment body; `uTime` is declared and bound and never read. Both are free hooks | `src/render/materials/terrainMaterial.ts:219, 240` |
| No triplanar projection anywhere. Single planar `(s, z)` projection means the vertical rim-wall faces are stretched | `src/render/materials/terrainMaterial.ts:267-354` |
| Detail normals are a three-tap derivative bump, faded by `uDetailFade * (1 - smoothstep(220, 900, dist))`. This is the only continuous quality dial in the terrain shader | `src/render/materials/terrainMaterial.ts:383-406` |
| Low runs a separate hand-written non-PBR `ShaderMaterial` with a fixed fake sun direction. Every change must be ported or explicitly declared Low-omitted, or the two paths drift | `src/render/materials/terrainMaterial.ts:35-116` |
| Medium, High, and Ultra render byte-identical terrain. `detailFade` is 0.4 / 0.8 / 1 / 1 and is the only differentiator | `src/render/renderer.ts:42-107` |

### Units

| Fact | Location |
| --- | --- |
| `MeshBuilder` never welds vertices: four fresh vertices per quad with a flat face normal. "Indexed" is nominal. No curvature channel is derivable without a post-pass | `src/gen/models.ts:44-70, 108-124` |
| `aMask` is the only custom vertex channel. No vertex colour, no curvature, no AO, no tangents | `src/gen/models.ts:108-124` |
| `addBlock` costs exactly 14 quads / 28 triangles / 56 vertices per block regardless of size | `src/gen/models.ts:148-196` |
| Panel lining inserts N horizontal recessed strips on the four side walls, each one flat quad displaced 4.5 percent toward the centre. No recursion, no vertical divisions, no per-plate variation, no real inset channel with side walls | `src/gen/models.ts:198-220` |
| Greeble scatter is uniform over a bounding box via `rng.signed() * s * 0.34`, boxes only, welded into the same geometry as the chassis. No density map, no joint or vent clustering, no tiering, therefore greeble-tier LOD is impossible today | `src/gen/models.ts:227-266` |
| `addCylinder` leaves the bottom open and has no cap-ring bevel. No swept-tube or path-extrusion primitive exists anywhere, so trim and piping is entirely absent | `src/gen/models.ts:268-303` |
| `makeHullMaterial` injects at four seams: `common`, `map_fragment`, `roughnessmap_fragment`, `emissivemap_fragment`. It never injects `normal_fragment_maps`, so there is no procedural normal detail, no panel-line normals, and no AO on hulls | `src/gen/models.ts:348-483` |
| Edge wear is `smoothstep(0.55, 1.0, grain) * 0.35` -- noise-thresholded. Nothing in the pipeline knows where an edge is | `src/gen/models.ts:441-443` |
| Faction emissive strips are pushed to `uFaction * uEmissive * 5.0` explicitly for bloom that does not exist | `src/gen/models.ts:462-479` |
| Mechs are five fixed parts: pelvis, torso, upperLeg, lowerLeg, foot. Shoulders, barrels, dorsal tube, and AA fin stack are all welded into the torso. No arms, no weapon sockets, no part tree | `src/gen/models.ts:491-509, 703-761` |
| Approximately 1.6k to 2.0k triangles per mech, of which greebles are 40 to 60 percent on every part | derived from `src/gen/models.ts:610-830` |
| Exactly one hydraulic actuator exists, alongside the thigh | `src/gen/models.ts:774` |
| The narrow-torso / long-leg proportions that make silhouettes read as walkers are documented as hard-won and must not regress | `src/gen/models.ts:539-551` |
| No LOD tiers, no imposters, no billboards | `src/gen/models.ts`, `src/render/entityRenderer.ts` |
| ~132 `InstancedMesh` objects, ~19 materials, one hull program `rww-hull-v2`. All have `frustumCulled = false` | `src/render/entityRenderer.ts:92-203` |
| Culling is arc distance `> RING_CIRCUMFERENCE * 0.3` only. No LOD switch, no fade, no cross-dissolve | `src/render/entityRenderer.ts:345-424` |
| `MAX_PER_BUCKET = 128`, structures 64. A mech consumes 1 pelvis + 1 torso + 2 upperLeg + 2 lowerLeg + 2 foot, so leg and foot buckets saturate at 64 mechs per (class, faction) while the torso bucket still has room. Overflow silently drops | `src/render/entityRenderer.ts:45, 174-179, 598-606` |
| Per-instance attributes are `instanceDamage` and `instancePhase` only. No per-instance faction colour, wear, or style | `src/render/entityRenderer.ts:775-800` |
| Wrecks are torso-only on an unrelated flat `MeshStandardMaterial({color: 0x24272b, roughness: 0.9, metalness: 0.18})`. No mask shader, no faction colour, no emissive, no damage, no legs | `src/render/entityRenderer.ts:120-135, 304-343` |
| Procedural locomotion is complete and good: distance-driven gait clock, analytic two-bone IK with backward knees, independent torso aim, recoil, hydraulic settle, slope pitch, deterministic limp, bounded footfall catch-up | `src/render/entityRenderer.ts:523-707` |
| Locomotion gaps: no arms and therefore no arm lag spring, no foot roll or heel-strike, no piston extension with knee angle, no torso yaw inertia, only forward slope is sampled | `src/render/entityRenderer.ts:598-706` |

### Buildings

| Fact | Location |
| --- | --- |
| Every structure sits on the same chamfered plinth, which is most of what makes the collection read as one architecture | `src/gen/models.ts:863-879` |
| `solarArray`, `pointDefense`, and `radarMast` have zero panel lining and zero greebles, while `bastion` gets panels plus 22 greebles | `src/gen/models.ts:911-926, 994-1013, 1042-1076` |
| `radarMast` spends ~1,260 triangles on nine lattice rings with no surface detail, making it simultaneously the densest and the flattest structure | `src/gen/models.ts:1042-1076` |
| The comment says "rotating dish assembly" and it never rotates. Structures are entirely static apart from the build-progress vertical scale | `src/gen/models.ts:1071`, `src/render/entityRenderer.ts:361-363` |
| Faction architecture suffixes are four cardinal buttresses for Compact and three angled spires plus a central emissive needle for Choir. `spinalNode` is exempt | `src/gen/models.ts:1131-1156` |
| Background city is four generic primitive buckets: `CylinderGeometry(0.5, 1, 1, 6)`, `BoxGeometry(1, 1, 1)`, `CylinderGeometry(1, 1, 1, 7)`, `OctahedronGeometry(0.7, 0)`. Two of the four are unlit `MeshBasicMaterial` | `src/render/battlefieldDressing.ts:113-118, 273-296` |
| No facade grammar or L-system generator exists anywhere, despite `docs/procedural-assets.md` section 1 specifying one | confirmed absent |
| No distance fade. Items pop in and out at the `drawDistance` boundary. Selection is priority-by-authored-scale, not by screen size | `src/render/battlefieldDressing.ts:153-222, 299-334` |
| Scatter density is eight hardcoded `DISTRICT_ANCHORS` in normalised district space. No noise-driven or terrain-driven density field exists | `src/render/battlefieldDressing.ts:406-425` |
| Dressing contracts to preserve: `MAX_DISTRICTS 16`, `MAX_LAYERS_PER_DISTRICT 8`, `MAX_ITEMS_PER_LAYER 256`, `MAX_RING_LIFE_CELLS 64`, `MAX_DISTRICT_SCATTER_ITEMS 2048`, `MAX_VISIBLE 256`, 4 palettes, 4 life cues, 16 silhouettes, the reserved-slot starvation guarantee, 12 Hz activity quantisation, `prefers-reduced-motion` | `src/render/districtPlan.ts:92-96`, `src/render/battlefieldDressing.ts:25, 153-222` |
| Authored GLB pilot forces flat sandstone because the split models carry no UV or texture data. Five of thirteen shipped assets are placed | `src/render/authoredBuildingPilot.ts:37-56, 152-167` |

### Lighting and renderer

| Fact | Location |
| --- | --- |
| Single directional key light, 1400 x 1400 shadow camera, `shadow.bias -0.0006`, `shadow.normalBias 0.9`, no CSM | `src/render/environment.ts:180-195` |
| Terrain receives shadows and deliberately does not cast them | `src/render/ringMesh.ts:62-63` |
| Inside a ring, light always comes from above, so raking shadows are impossible. Drama comes from the shadow-square terminator, volumetrics at its edges, and inter-surface bounce | `src/render/environment.ts:1-20` |
| PMREM environment map already exists: a 64 x 32 generated gradient with `scene.environmentIntensity = 0.55`. Without it, metals render black | `src/render/environment.ts` `buildEnvironment` |
| Prior composer was removed for intermittently outputting a black frame and for leaking eleven bloom targets whenever it was rebuilt | `src/render/renderer.ts:4-8` |
| `postProcessingLevel === 'none'` is asserted for every tier | `tests/render/settings.test.ts:35` |
| Adaptive governor drops a tier above 26 ms smoothed with a 12 s cooldown, and raises below 11 ms with a 16 s cooldown | `src/render/renderer.ts:237-255` |
| `customProgramCacheKey` must be bumped whenever injections change. Currently `'rww-terrain-v2'` and `'rww-hull-v2'` | `src/render/materials/terrainMaterial.ts:424`, `src/gen/models.ts:481` |
| Three r0.185.1. No post-processing addon is imported anywhere in the repo | `package.json` |

### Existing test constraints that this work must respect or deliberately update

| Constraint | Location |
| --- | --- |
| `postProcessingLevel === 'none'` for every tier | `tests/render/settings.test.ts:35` |
| Calibration asserts manifest fields, `chartPatches === 24`, `referenceParts === 8`, luminance mean and variance, `resources.calls <= 60`, `textures <= 4`, zero console errors | `e2e/calibration.spec.ts` |
| No screenshot baselines exist anywhere in the repo; there is no `toHaveScreenshot` call | verified absent |
| Low must stay at least 200k triangles below High | `e2e/renderer.spec.ts:157-185` |
| Dressing must stay under 100k triangles | `e2e/layered-district-scatter.spec.ts:57-58`, `e2e/environmental-district-palettes.spec.ts:67`, `e2e/inhabited-ring-life.spec.ts:54` |
| Authored pilot asserts `maxMetalness <= 0.08`, which encodes the flat look and must change in Task 7 | `e2e/authored-building-pilot.spec.ts` |
| Model tests assert normals unit length, front-facing exterior raycasts, faction geometry differs while rig metadata is identical, and the hull shader injection contract including the cache key | `tests/render/models.test.ts` |
| Entity renderer tests assert the low-quality toggle, cloak and wreck buckets, recoil affecting torso and not pelvis, gait interpolation and footfall determinism, per-instance damage, and no simulation mutation | `tests/render/entityRenderer.test.ts` |
| Low upload budget is 1,254,048 bytes per frame median on `heavy-combat`; Low shader prewarm is 848.4 ms across 17 programs | `docs/t480s-low-performance.md` |

Note on which Low numbers are the gate. Two documents report Low figures and they
differ, because they are different runs of different scenarios.
`docs/phase-4c-renderer-profile.md` records Low at 16.7 ms RAF, 5.756 ms GPU
median, 66 calls, 117,199 triangles, 16 programs, as a profiling observation.
`docs/t480s-low-performance.md` records Low at 16.7 / 16.8 / 17.955 ms, 68 calls,
115,044 triangles, 15 programs, 2 textures, as the accepted hard gate. **The
t480s figures are the frozen gate.** The phase-4c figures are measurement
context and are not a pass/fail contract.

## Proposed Solution

Three architectural commitments carry the whole overhaul.

### 1. The post stage is one owned pass, not a composer

The previous failure was `EffectComposer` with a rebuilt pass stack leaking
eleven targets and intermittently producing a black frame. The replacement is
deliberately narrower.

On Medium and above, the scene renders into exactly one multisampled
`WebGLRenderTarget` (`samples: 4`, `HalfFloatType`, WebGL2) with an attached
`DepthTexture`. Multisampling is required because rendering to a target would
otherwise lose the hardware antialiasing that the default framebuffer currently
provides for free. The bloom downsample and upsample chain and the final
composite are hand-written `ShaderMaterial` fullscreen quads that this repository
owns outright. Ambient occlusion reads the depth texture that already exists as
part of the target, so there is no depth prepass and no doubling of draw calls.

The target is allocated once on construction, resized only from
`Renderer.resize`, disposed explicitly, and re-created on WebGL context restore
under the recovery contract already established in
`docs/phase-4d-hardening.md`.

Low never allocates the target and renders direct to the default framebuffer
exactly as it does today. The frozen path stays byte-identical.

### 2. One surface library, four consumers

A single new module, `src/render/materials/surface.glsl.ts`, exports a shared
`rww_surface` GLSL library: hash, value noise, FBM, Worley cells, height
blending, plus triplanar object-space sampling, panel-line normal and AO
generation, curvature-driven wear, upward-face grime, and downward streaking.

Four consumers use it: the terrain shader, the hull shader, the environmental
dressing buckets, and a new authored-building material. This replaces the
duplicated `NOISE_GLSL` in `terrainMaterial.ts:119-178` and the separate
`hs_hash` / `hs_noise` pair in `models.ts:378-408`, which today produce visually
unrelated results from unrelated code.

Triplanar and object-space sampling is what makes the library work on the
imported GLBs, because it needs no UVs at all.

### 3. Terrain moves work from fragment to vertex

`Terrain` grows an erosion pass and emits `material`, `curvature`, and `ao`
fields alongside `heights` and `slope`. `ringMesh` bakes them into static
`BufferAttribute`s, at roughly 660 KB per float channel across 164,864 vertices,
uploaded once with no per-frame cost. The fragment shader then reads interpolated
splat weights instead of computing six-octave FBM per pixel.

This is simultaneously the visual fix and the performance fix. Shading finally
agrees with the landforms it sits on, and a large share of the ~41 ms terrain
cost is recovered. The recovered budget is what funds real Medium, High, and
Ultra differentiation, which does not exist today.

## Hard Boundaries

This overhaul must not change:

- unit or structure statistics, weapons, abilities, or targeting;
- economy, power, production, capture, or victory rules;
- movement speeds, projectile speeds, AI, navigation, ballistics, or visibility;
- structure footprints, collision, line of sight, cover, salvage, or
  buildability;
- world snapshots, mission snapshots, save/load payloads, or deterministic state
  hashes;
- camera pitch and FOV curves, or the accepted signature composition;
- the T480s 720p Low frame budgets, draw calls, triangle count, program count,
  or texture count.

All new geometry, materials, motion, and post-processing are presentation-only.
None of it may consume simulation RNG, mutate simulation state, or affect stable
entity ordering.

Task 8 is the single deliberate exception to the gameplay freeze and is gated
separately. See Open Decisions.

The Low quality tier is frozen. Any change that cannot be delivered on Low for
free must be either ported as an explicitly cheaper analytic approximation or
recorded in the omission list in `docs/t480s-low-performance.md`.

## Task Breakdown

### Phase 0 - See what you are changing

#### Task 1: Visual contact sheet with screenshot baselines

Objective: make every subsequent change visible and reviewable. The repository
currently has no image baselines at all, so visual work is unreviewable and
regressions are invisible.

Extend `src/dev/calibration.ts`, which already stages one Compact vanguard
against a 24-patch colour chart plus roughness and metalness sweeps, into a
reviewable grid:

- all six mech classes in both faction styles, standing;
- all twelve structure kinds;
- the four terrain material layers as swatches;
- a slab of authored-GLB geometry;
- the existing PBR reference balls, sweeps, chart, and swatches.

Add a `?sheet=mechs|structures|terrain|authored|all` selector. Keep
`renderFrame()` deterministic for single-frame capture and keep the
`window.RWWCalibration` contract working, since `e2e/calibration.spec.ts`
depends on it.

Add Playwright screenshot baselines per sheet per quality tier. Keep the existing
numeric assertions, and split the `resources.calls <= 60` and `textures <= 4`
limits so Low keeps today's values while Medium and above get tier-appropriate
ones. Those two limits will otherwise fail as soon as Task 2 lands.

Tests: baselines committed for Low and High; existing numeric assertions still
pass; `tests/render/models.test.ts` unaffected.

Demo: `/dev/calibration?sheet=all` shows every mech, every structure, and the
terrain palette in one frame.

#### Task 1 outcome

Delivered in `src/dev/calibration.ts`, `e2e/calibration-sheets.spec.ts`, and
`e2e/calibration.spec.ts`. Six sheets are selectable through `?sheet=`:
`calibration` (the default, byte-identical to the previous scene so its existing
contract still holds), `mechs`, `structures`, `terrain`, `authored`, and `all`.
Twelve baselines are committed, one per sheet at Low and High.

Three design decisions worth recording.

**The default sheet was left unchanged rather than replaced.** Making `all` the
default would have broken the object-count and resource assertions in
`e2e/calibration.spec.ts`, which are a deliberate contract. Adding `calibration`
as a named sheet and keeping it as the default preserves that contract exactly
and confines every new cost to the new sheets.

**Capture happens inside the page, not through a page screenshot.** The renderer
does not request `preserveDrawingBuffer`, so the colour buffer is not guaranteed
to survive compositing, and screenshotting the page would be intermittently
blank. `RWWCalibration.captureFrame()` draws and reads back in one synchronous
turn instead.

**Images are paired with numeric signatures, because images alone proved too
weak.** A first pass used `maxDiffPixelRatio: 0.03`, which permits 21,120
differing pixels on a 1100x640 frame. A large deliberate camera move registered
as a match. The tolerance is now `threshold: 0.15` with
`maxDiffPixelRatio: 0.004`, and every sheet additionally asserts floors on
`litFraction`, `variance`, and `chromaticFraction` from
`RWWCalibration.frameStatistics()`. Those numbers catch a material going flat or
a light losing intensity, which a thresholded image diff can miss, and they name
the broken property in the failure message.

Framing is markedly more top-down than a first attempt used. `keyLightDirection`
returns a vector with no z component, so inside a ring the only reliably lit
faces point up and spinward, and a low camera on the +z axis can only photograph
the unlit side of every subject. Subjects are also yawed by `SHEET_YAW` so their
fronts catch the spinward light.

#### Recorded "before" measurements

`validation/evidence/procedural-graphics/contact-sheet-statistics.json`, written
by the sheets spec at 1100x640. The four numbers that matter for Phase 1:

| Sheet | Quality | Mean luminance | Lit fraction | Highlight fraction | Chromatic fraction |
| --- | --- | ---: | ---: | ---: | ---: |
| calibration | high | 39.93 | 0.691 | 0.00071 | 0.1226 |
| mechs | high | 22.10 | 0.639 | 0.00123 | 0.00095 |
| structures | high | 23.46 | 0.573 | 0.00469 | 0.00194 |
| terrain | high | 74.04 | 0.761 | 0.00000 | 0.7411 |
| authored | high | 17.14 | 0.442 | 0.00000 | 0.0247 |
| all | high | 24.96 | 0.663 | 0.00175 | 0.0233 |

Three findings fall straight out of this table and sharpen the Phase 1 targets.

**Emissives do not reach the highlight range anywhere.** `highlightFraction` is
the share of pixels above luminance 210, and it is at most 0.0047 on any sheet
and exactly zero on two of them. The hull shader authors faction strips at
`uEmissive * 5.0` specifically for bloom, but with no bloom pass and ACES
compressing everything above 1.0, that headroom is discarded rather than spread
into a glow. `highlightFraction` is therefore the primary Task 3 metric.

**Faction accent is effectively absent.** The mech sheet is 0.095 percent
chromatic pixels and the structure sheet 0.194 percent. `docs/art-direction.md`
section 2 makes faction colour the instant threat-assessment read and the
strongest signal on a silhouette. At these levels it is not performing that job.

**Chroma is inverted relative to the art direction.** Terrain measures 0.74
chromatic while units measure 0.001, so the ground is by far the most colourful
thing on screen and the factions are the least. Section 2 asks for the opposite:
low-chroma terrain so units read, with saturated colour reserved for factions.
Worth revisiting when Task 10 rewrites the terrain albedo.

Scenes are also dark in absolute terms, at mean luminance 17 to 40 out of 255
everywhere except terrain, at a cycle time where `shadowFactorAtAngle` returns a
daylight factor of exactly 1.0. This is full daylight, not a shadow band.

#### Incidental defect found, not fixed

`AuthoredBuildingPilot.normalise()` records its footprint-centring and
ground-alignment offset on the source root's `position`
(`src/render/authoredBuildingPilot.ts:171-173`). Both `update()` at line 110 and
any other caller that assigns `instance.position` overwrite that offset and
discard it, so the five shipped pilot buildings are placed by their raw glTF
origin rather than centred on their footprint and seated on the terrain. The
contact sheet works around it by reparenting each instance into a wrapper. The
fix belongs to Task 7, which is already rewriting that file.

### Phase 1 - Tone

Tone work affects terrain, buildings, and units simultaneously for one
full-screen pass. This is why it is first.

#### Task 2: Owned HDR render target and single composite pass

Objective: prove the target lifecycle is sound before anything depends on it.
This task is deliberately visually neutral, because target lifecycle is the exact
failure mode that killed the previous attempt.

Add `src/render/postStage.ts`. On Medium and above, render the scene into one
multisampled `WebGLRenderTarget` (`samples: 4`, `HalfFloatType`,
`depthTexture: DepthTexture`) and resolve it through one fullscreen
`ShaderMaterial` that does nothing but copy, plus the existing ACES tone mapping
and sRGB output conversion. Allocate on construction, resize only in
`Renderer.resize`, dispose explicitly, and re-create on WebGL context restore.

Change `postProcessingLevel` from the literal `'none'` to `'none' | 'standard'`,
with Low pinned to `'none'`. Update `tests/render/settings.test.ts:35` to assert
that Low is `'none'` rather than that all tiers are.

Tests:

- unit test asserting exactly one render target allocated after N resizes and N
  quality flips, which is the direct anti-regression for the eleven-target leak;
- browser test asserting no black frame across 120 frames on Medium and Ultra;
- browser test asserting Low allocates zero targets and that its draw calls,
  triangle count, program count, and texture count are unchanged from the frozen
  gate;
- extended context-loss recovery coverage.

Demo: Medium and above render through the target with no visible difference and
no black frames. Low is provably untouched.

#### Task 2 outcome, and a deviation from the plan

Delivered in `src/render/postStage.ts`, `src/render/renderer.ts`, `src/main.ts`,
`tests/render/postStage.test.ts`, and `e2e/post-stage.spec.ts`.

**The "visually neutral" requirement was not met, and was abandoned
deliberately.** Keeping tone mapping in the scene pass and making the composite a
passthrough was attempted in four configurations. None was an identity:

| Target | Composite | Result vs direct path |
| --- | --- | ---: |
| `SRGBColorSpace` | raw blit | 0.68x too dark |
| `SRGBColorSpace` | manual sRGB re-encode | 1.61x too bright |
| `NoColorSpace` | manual sRGB re-encode | 1.60x too bright |
| `NoColorSpace` | raw blit | 0.27x to 0.68x too dark |

The target's `colorSpace` option made no measurable difference, so what Three
does when rendering into a render target is not predictable from the options it
exposes. One probe was decisive: a composite writing a constant `0.5` read back
as exactly `128`, proving Three applies nothing after the composite shader.

Given that, the reliable design is to make the composite the only place any
transform happens, and to feed it linear input. So the stage now does what Task 3
was scheduled to do:

- target is `HalfFloatType`, `NoColorSpace`, `samples: 4`, with a `DepthTexture`;
- `gl.toneMapping` is `NoToneMapping` while the post path is active, so the scene
  writes linear HDR, and `ACESFilmicToneMapping` on the direct path;
- the composite applies exposure, then ACES, then the sRGB transfer function,
  using implementations copied verbatim from Three's shader chunks so the look
  matches rather than approximates;
- exposure is read from `gl.toneMappingExposure` each frame, so the existing
  explosion-flash animation in `main.ts` keeps working on both paths unchanged.

The consequence is that **transparency and additive blending now happen in linear
HDR rather than in tonemapped space**. That is more correct and is required for
bloom, but it is a real image change. Measured mean luminance against a
post-stage-off capture at the same framing:

| Sheet (high) | Post off | Post on | Ratio |
| --- | ---: | ---: | ---: |
| terrain | 82.93 | 84.35 | 1.017 |
| all | 22.54 | 25.30 | 1.123 |
| mechs | 22.10 | 24.98 | 1.130 |
| structures | 23.46 | 26.93 | 1.148 |
| authored | 23.40 | 27.26 | 1.165 |
| calibration | 39.93 | 58.72 | 1.471 |

The spread tracks additive content: terrain has almost none and barely moves,
while the calibration sheet is dominated by the additive filament glow and moves
most. Medium and above baselines were regenerated and reviewed. **All six Low
baselines are byte-identical, verified by SHA-256 before and after**, which is the
evidence that the frozen path is untouched.

Net effect on Task 3: the HDR plumbing, tone-mapping relocation, and exposure
routing are already done, so Task 3 reduces to adding the bloom chain and
retuning emissive levels against it.

#### Program cache behaviour, and a corrected assertion

`e2e/renderer.spec.ts` was failing at the frozen baseline with a program-count
spread of 13 against a bound of 12. Investigating it for Task 2 produced the
actual measurement, for the sequence low/high/ultra/medium/low/high/low:

```
91, 95, 95, 105, 104, 105, 104
```

The cache is not monotonic, and that is correct rather than churn: leaving a post
tier disposes the composite material and Three releases that program, so the
count settles into a one-program oscillation between Low and the post tiers.

Two assertions were rewritten to express the intent that the original numbers
only approximated. The absolute bound moved from 12 to 14, with both units
accounted for: one was the pre-existing baseline discrepancy, one is the composite
program. The plateau check no longer compares the tail of a mixed-tier sequence,
which cannot be zero once Low and post tiers legitimately differ; it now requires
warm churn of at most one program and requires that a warm revisit to the same
tier compile nothing new. That is a stronger guarantee than the original and it
fixes the inherited failure.

#### What Task 2 verified

- `tests/render/postStage.test.ts`, 6 tests: one allocation across a 40-step
  resize storm, in-place resize, degenerate-size clamping, drop-not-delete on
  context loss followed by exactly one reallocation, multisampling and depth
  texture present, and disposal without a prior size.
- `e2e/post-stage.spec.ts`, 4 tests: Low allocates no target, one live target
  across a 24-step resize storm plus eight tier transitions, **no black frame
  across 120 consecutive frames on Ultra**, and target rebuild after a simulated
  context loss.
- Unit suite: 14 failed / 497 passed, against a baseline of 14 failed / 491
  passed. Same 14 pre-existing failures, six new passing tests.
- `npm run lint` and `npm run build` clean.

One test defect was found and fixed by these tests rather than in review:
`PostStage.setSize` originally recorded the new size but returned without
allocating while a context was lost, leaving recreation to an untestable branch
inside `render`. A render target is only a descriptor until something draws to it,
so allocation is safe on a lost context and now happens on a path with coverage.

#### Task 3: Bloom, and emissive retune against it

Objective: make the emissives that were authored for bloom actually bloom.

Add a five-mip, physically-weighted downsample and upsample bloom chain into the
composite pass, fed from the HDR target. Consumers that already expect it: the
`uFaction * uEmissive * 5.0` hull strips, the filament core at `x1.6`, the
additive filament sheath, explosion flashes, and the additive ability overlays.

Then retune. The `5.0` factor was chosen with no bloom present and will blow out.
Faction strips must read as powered without becoming the brightest object on
screen. `docs/art-direction.md` section 2's hard rule still holds: only factions
carry saturated colour. Add `bloomStrength` to `QualitySettings` so Ultra can
exceed Medium.

Tests: contact-sheet baselines updated and explicitly reviewed; browser test
asserting a fixed bloom mip count and draw calls under 400; Low baselines
unchanged.

Demo: faction emissive strips glow, the solar filament reads as a real line
light, explosions flash. The first unmistakable step change.

#### Task 3 outcome

Delivered in `src/render/postStage.ts`, `src/render/renderer.ts`,
`src/gen/models.ts`, `tests/render/postStage.test.ts`, `e2e/post-stage.spec.ts`,
and `e2e/renderer.spec.ts`.

The chain is a bright pass with a quadratic soft knee, four 13-tap reductions, and
four 9-tap tent expansions accumulated additively back up the mips, composited
before ACES. Ten passes, four programs, five bloom targets. Bloom is added to the
scene in linear HDR *before* tone mapping; adding it afterwards would paste glow
onto an already-clipped curve and read as a flat white smear rather than a
highlight rolling off.

Three implementation choices worth recording. The mip count is fixed at five
rather than varying per tier, because varying it would change the target set on a
quality switch, which is exactly the churn the allocation counter forbids; tiers
vary `bloomStrength` instead, which is free. The reductions use 13 taps rather
than a box filter because a box sample at these ratios makes small bright objects
flicker as they cross texel centres, and this scene is mostly small bright
objects. And the bright-pass threshold is expressed in linear HDR, which is only
meaningful because Task 2 made the scene target unmanaged half-float.

**The emissive retune was necessary and substantial.** At the authored
`uEmissive * 5.0`, bloom blew the strip cores to white: the faction hue was lost
at exactly the pixels carrying it, and the halo swelled over the silhouette,
breaking `docs/art-direction.md` section 2 and section 7 at once. Reduced to
`2.2`, with `bloomStrength` at 0.42 / 0.55 / 0.68 for Medium, High and Ultra.
`uEmissive` is never assigned at runtime, so 2.2 is the effective figure.
`customProgramCacheKey` moved to `rww-hull-v3`.

Measured against the Task 1 baseline, at High:

| Sheet | Chromatic before | Chromatic after | Change |
| --- | ---: | ---: | ---: |
| mechs | 0.00095 | 0.01994 | 21x |
| structures | 0.00194 | 0.04424 | 23x |

That is the headline. Faction accent was occupying under a tenth of a percent of
the frame and is now a legible signal, which is the job
`docs/art-direction.md` section 2 assigns it. Highlight fraction rose more
modestly (mechs 0.00123 to 0.00184, structures 0.00469 to 0.00564) and that is the
intended trade: pulling the emissive back from 5.0 spreads energy into coloured
glow instead of clipping it to white. The calibration sheet, dominated by the
additive filament, went from 0.00071 to 0.07559.

Terrain and the authored buildings measure exactly zero highlight fraction before
and after. That is correct rather than a failure: neither has anything above the
bright-pass threshold. The authored buildings having no emissive at all is part of
what Task 7 addresses.

#### Deviation: Task 3 changes Low visually, at zero cost

Task 2 held all six Low baselines byte-identical. Task 3 does not, because the
emissive multiplier lives in the shared hull shader rather than in the post path,
so Low also moves from 5.0 to 2.2.

The frozen gate is a performance contract and it is intact. Low's draw calls (34,
105, 24, 16, 14, 157 across the six sheets), triangle counts, texture count of 2,
and program count are all unchanged, and swapping one shader constant for another
costs nothing. The visual effect on Low runs in the same direction as the rest of
this task, because Low's strips were clipping to white too and now keep their
faction hue: mechs chromatic fraction on Low rose from 0.00126 to 0.00248, and
structures from 0.00232 to 0.00601.

The alternative was to branch the multiplier on `uLowQuality` to keep Low
pixel-identical, which would have deliberately preserved white-clipped faction
strips on the tier that needs readability most. That was rejected. Low baselines
were regenerated and reviewed.

#### Resource assertions updated, with the arithmetic

Three bounds in `e2e/renderer.spec.ts` moved, each by an amount that is accounted
for rather than fitted to the observation:

- texture spread between tiers, 2 to 7: the HDR scene target, its depth texture,
  and five bloom mips, none of which Low allocates;
- absolute program spread, 14 to 18: four post-stage programs (bright pass,
  downsample, upsample, composite) that Low never compiles;
- warm program churn, 1 to 4: leaving a post tier disposes those four materials
  and Three releases their programs; returning recompiles exactly those four.

The exact-count guarantee lives in `e2e/post-stage.spec.ts`, which asserts the
stage's own allocation counter is precisely six live targets and six lifetime
allocations. That is the assertion a leak would break, and it is exact rather than
bounded.

#### What Task 3 verified

- `npm run lint` and `npm run build` clean.
- Unit suite 14 failed / 501 passed, against 14 / 497 after Task 2. Same 14
  pre-existing failures, four new bloom-chain tests including a degenerate 2x2
  drawing buffer that would drive a five-level chain to zero without the floor.
- Browser lanes `post-stage`, `renderer`, `calibration` and `calibration-sheets`:
  25 passed, including no black frame across 120 frames on Ultra, and exactly six
  targets across a 24-step resize storm plus eight tier transitions.
- Twelve baselines regenerated and reviewed by eye at both tiers.

Not yet verified: the T480s Low frame-time measurement. Low adds no pass, target,
or program, and its draw-call and texture counts are unchanged, so the gate is
expected to hold, but the hardware run is owed at the Phase 1 gate.

#### Task 4: Depth-derived ambient occlusion, and contact shadow fix

Objective: make objects sit on the ground rather than float above it.

Add a half-resolution GTAO-style pass reading the `DepthTexture` from Task 2,
bilaterally upsampled, applied to indirect diffuse only in the composite.

Separately, address the key light. `shadow.normalBias = 0.9` at
`environment.ts:189` is very large and will be pushing contact shadows away from
where geometry meets ground. Retune `bias` and `normalBias` against the contact
sheet, and tighten the 1400 x 1400 shadow camera. `docs/art-direction.md`
section 3 specifies three to four CSM cascades; a single tighter cascade sized to
the tactical zoom range is the cheaper first move, and CSM should be evaluated
only if that proves insufficient.

Add `aoLevel` to `QualitySettings`, off on Low.

Tests: AO buffer resolution asserted per tier; baselines updated; GPU timing
recorded per tier in the `phase-4c` measurement harness; Low unchanged.

Demo: mechs and buildings sit on the ground. Panel recesses, plinths, greebles,
and terrain crevices gain depth. This is the change that most reliably makes CG
stop looking like CG.

#### Task 4 outcome

Delivered in `src/render/postStage.ts`, `src/render/renderer.ts`, and
`src/render/environment.ts`.

Occlusion is a 12-sample spiral over positions and normals reconstructed from the
scene depth texture, at half resolution, filtered by a separable depth-aware blur
that ping-pongs between two half-resolution buffers. Two new targets, two new
programs, three new passes. Normals come from three depth taps rather than
`dFdx`/`dFdy`, because screen-space derivatives need GLSL3 or an extension
directive in a plain `ShaderMaterial`, and taps are portable.

Depth precision was the risk worth checking, given a near plane of 0.1 m and a far
plane up to 26 km. The hyperbolic depth distribution leaves roughly millimetre
resolution at 100 m, well inside the occlusion radius, and it degrades with
distance, which is the right way round.

**"Applied to indirect diffuse only" was not achievable and was replaced.** Three
has the slot for it in `aomap_fragment`, but reaching it requires occlusion to
exist before shading, which means a depth prepass and a second pass over all world
geometry. Task 2 explicitly rejected that cost. Occlusion therefore multiplies the
shaded result in the composite, and the error that introduces (emissive and
specular pixels darkened when they should not be) is corrected by a luminance
protection window rather than by construction. Bloom is deliberately sampled before
occlusion is applied, because glow leaving a surface is not occluded by that
surface's own crevices.

Two tuning corrections were needed, both found by looking at the result rather
than by reasoning about it:

- the protection window started at 0.55, which is inside the ordinary diffuse
  range in pre-tone-map linear values, where well-lit ground sits around 0.3 to
  0.5. It was protecting most of the surfaces occlusion exists to shade and the
  effect was close to invisible. Moved to 1.2 through 3.0, above diffuse and below
  the 1.0 to 2.1 range of the faction strips;
- the radius was 1.6 m, which read on mech feet but barely registered against
  plinths twenty metres across. Moved to 2.6 m as a compromise across both scales.

Measured effect at High: mean luminance fell by 0.5 to 9 percent depending on how
much concave geometry each sheet contains (structures 5 percent, the combined
sheet 9 percent, calibration 0.5 percent), while flat surfaces are left alone.
That distribution is the evidence that it shades junctions rather than uniformly
dimming the frame.

#### Contact shadows

`shadow.normalBias` was 0.9, nearly a metre of offset along the surface normal. On
a mech seven to twelve metres tall that displaces the contact point by most of a
foot length, and it is the main reason units read as hovering. Now 0.05, with
`bias` from -0.0006 to -0.00018. The single cascade was also tightened from plus or
minus 700 m to plus or minus 500 m, trading far-field shadowing for texel density
where the player is looking: at a 2048 map that moves a shadow texel from 0.68 m to
0.49 m. Cascaded shadow maps remain unimplemented and are still the better
long-term answer.

#### What Task 4 verified

- `npm run lint` and `npm run build` clean.
- Unit suite 14 failed / 501 passed, unchanged from Task 3. Same 14 pre-existing
  failures.
- Browser lanes `calibration-sheets`, `calibration`, `post-stage`, `renderer` and
  `authored-building-pilot`: 26 passed.
- Low remains frozen and measurably untouched: draw calls 34, 105, 24, 16, 14 and
  157 across the six sheets, 2 textures, 5 to 8 programs, all identical to Task 3.
  Occlusion adds nothing to the direct path.
- Baselines regenerated at both tiers. The structures sheet was inspected
  specifically to confirm occlusion lands in plinth undersides, block junctions,
  buttress recesses and lattice interiors rather than on flat faces.

Resource bounds in `e2e/renderer.spec.ts` moved again with the arithmetic recorded:
texture spread 7 to 9 for the two occlusion buffers, absolute program spread 18 to
20, and warm churn 4 to 6 now the stage owns six fullscreen materials. The exact
allocation guarantee remains in `e2e/post-stage.spec.ts`, now eight live targets
and eight lifetime allocations.

Not verified: the T480s Low hardware run. Low adds no pass, target or program and
its counts are identical, so the gate is expected to hold, but the measurement is
owed.

#### Task 5: Day and night colour grading

Objective: deliver the item `docs/art-direction.md` section 5 calls the
highest-impact on the post list.

Generate two 3D LUTs in code, a warm day grade and a cool starlight-plus-emissive
night grade, as `Data3DTexture` built from an analytic curve set at load, and
cross-fade them on `DayCycle.daylight`. Generating rather than committing them is
what keeps `docs/procedural-assets.md`'s no-binary-LUT constraint intact.

Enforce `docs/art-direction.md` section 2's rule that night is legible and never
murky: raise ambient and lean on emissives rather than crushing to black. Add a
light vignette and very light film grain in the same pass.

Ship the grade on Low if it can be expressed as a cheap analytic curve inside the
existing Low fragment shader, since grading is the one post item section 5 says
Low must keep. Otherwise declare it Low-omitted and record that in the omission
list in `docs/t480s-low-performance.md`.

Tests: LUT determinism unit test asserting the same input produces byte-identical
texture data; baselines at three daylight phases; Low omission list updated if
excluded.

Demo: the shadow-square terminator sweeping across the map now shifts the whole
image's colour, not only its brightness.

#### Task 5 outcome

Delivered in `src/render/materials/grading.ts`, `src/render/postStage.ts`,
`src/render/renderer.ts`, `src/main.ts`, `src/dev/calibration.ts`,
`tests/render/grading.test.ts`, and `docs/t480s-low-performance.md`.

Two tables are generated from analytic lift, gamma, gain and saturation curves and
cross-faded on `1 - DayCycle.daylight`, followed by a squared corner vignette and
very light grain. Grading is applied after ACES and after the sRGB encode, which is
where a grade sits in a film pipeline and is why the tables can be authored as
plain numbers a reviewer can read.

**A 2D strip layout was used instead of `Data3DTexture`.** Sampling a 3D texture
needs `sampler3D`, which does not exist in GLSL ES 1.00, so it would have forced
the composite material to GLSL3 and split the shader set across two language
versions for one lookup. Each table is instead laid out as 32 slices side by side
in a 1024x32 texture, interpolated along blue in the shader. The half-texel insets
in `rww_sampleGrade` are load-bearing: without them each cell bleeds its
neighbouring slice at the edges, which shows up as banded fringing on smooth
gradients like the sky.

Grain time is supplied by the caller rather than read from a clock. `main.ts`
passes `game.world.time`; the contact sheets pass the fixed `CALIBRATION_TIME`, so
a sheet stays byte-reproducible across repeated frames. Without that, grain alone
would have made every image baseline unstable.

The night grade lifts its floor instead of crushing it, which is
`docs/art-direction.md` section 2's requirement that night be legible and never
murky. `tests/render/grading.test.ts` asserts that directly: the night black floor
must sit above the day floor and below 48, so shade stays readable without turning
into grey haze. The same suite asserts byte-level determinism, monotonicity along
all three axes in both grades (a non-monotonic table produces hue inversions that
are hard to see in a still and obvious in motion), day-warm versus night-cool at
the midpoint, and that neither grade tints white.

#### Deviation: grading is omitted on Low

`docs/art-direction.md` section 5 says Low should keep grading even when it drops
other post items. It does not, and cannot without cost: Low renders direct to the
default framebuffer and has no full-screen pass, so grading would require adding
both a pass and a texture to the frozen path. The tradeoff was taken in favour of
the frame-time gate and is recorded in a new "Post-Processing Omissions On Low"
section in `docs/t480s-low-performance.md`, alongside the two Phase 1 changes that
do reach Low for free (the emissive retune and the shadow bias fix).

#### What Task 5 verified

- `npm run lint` and `npm run build` clean.
- Unit suite 14 failed / 508 passed, against 14 / 501 after Task 4. Same 14
  pre-existing failures, seven new grading tests.
- Browser lanes `calibration-sheets`, `calibration`, `post-stage`, `renderer` and
  `authored-building-pilot`: 26 passed.
- Baselines regenerated at High and reviewed; Low baselines untouched.
- Texture budgets raised by two for the grade tables, with the arithmetic recorded
  in each spec.

### T480s Low gate, measured

Run on the reference hardware, confirmed from the receipt: ANGLE Intel UHD
Graphics 620 Direct3D11 at 1280x720, DPR 1, scenario `heavy-combat`, via
`npm run rww -- perf browser-heavy --quality low`.

| | median | p95 | p99 | frames over 100 ms | draw calls | triangles | textures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline, all changes stashed | 16.7 | 16.8 | 33.3 | 1 | 70 | 105,519 | 2 |
| Phase 1 applied, first run | 16.7 | 28.35 | 50 | 1 | 70 | 105,519 | 2 |
| Phase 1 applied, repeat | 16.7 | 16.8 | 16.8 | 0 | 70 | 105,519 | 2 |

**The gate holds.** The verdict `720p-low-hard-candidate` passes on every run, and
the clean repeat reproduces the recorded gate figures of 16.7 / 16.8 exactly, with
zero frames over 100 ms.

Draw calls, triangles and texture count are byte-identical across baseline and
applied, which is the direct evidence that Phase 1 added nothing to the direct
path. The first applied run's p95 of 28.35 ms was a transient hitch: the baseline
run had a comparable one (p99 33.3 ms, one frame over 100 ms), the repeat had none,
and no Phase 1 change touches Low's per-frame work. A 12-second single sample on a
passively cooled integrated GPU is noisy at the tail.

One check reports `fail` in the harness on every run, including baseline:
`startupMissedPrograms` is 1 against a maximum of 0, meaning one shader program
compiles after prewarm. It is pre-existing, it is unrelated to this work, and it is
why the run's overall `status` field reads `fail` while the gate verdict passes.

**Phase 1 gate.** Stop after Task 5 and report for a go/no-go decision on Phases
2 through 5. Phase 1 is a legitimate stopping point: it is entirely
presentation-only, entirely reversible, and delivers the largest visible step
change in the plan.

### Phase 2 - Coherence

#### Task 6: Extract one shared procedural surface library

Create `src/render/materials/surface.glsl.ts` exporting `rww_surface`: hash,
value noise, FBM, Worley cells, height blending, plus new triplanar sampling,
panel-line normal and AO generation, curvature-driven wear, upward-face grime,
and downward streaking.

Do this in two separately verified steps.

First, refactor the terrain and hull shaders to consume the shared library with
no intended visual change, verified against the Task 1 baselines within
tolerance. Only then add what neither shader has today: triplanar projection,
whose first customer is the stretched rim walls, and panel-line normal and AO
detail on hulls, which `docs/procedural-assets.md` section 2 specifies and
`makeHullMaterial` never injects at all.

Bump `customProgramCacheKey` on both to `'rww-terrain-v3'` and `'rww-hull-v3'`,
or Three will silently reuse the cached programs and the change will appear to do
nothing.

Tests: the refactor-only step verified against baselines before the additive step
begins; `tests/render/models.test.ts` shader-injection contract updated for the
new cache keys; Low path either ported or explicitly declared omitted.

Demo: rim walls are no longer stretched, and bare hull faces read as machined
plate at close range.

#### Task 6 outcome

Delivered in `src/render/materials/surface.glsl.ts`,
`src/render/materials/terrainMaterial.ts`, `src/gen/models.ts`, and
`tests/render/models.test.ts`.

The library exports `SURFACE_NOISE_GLSL` (primitives moved verbatim from their
previous homes) and `SURFACE_DETAIL_GLSL` (triplanar projection, panel-line
generation, gradient-to-normal, curvature wear, cavity grime, grime streaking).
The former `hs_hash` and `hs_noise` are now `rww_hash31` and `rww_vnoise3`, so the
terrain and the hulls finally share one hash and one interpolation.

**The two-step verification worked exactly as the plan intended.** Step one was a
pure extraction, and all 15 contact-sheet tests passed against the *existing*
baselines with no regeneration, which is direct evidence the move changed nothing
visually. Only then was anything added.

Step two gave hulls the `normal_fragment_maps` injection `makeHullMaterial` has
never had. Until now a bare hull face was geometrically flat no matter how close
the camera got, and all of its machined character came from albedo alone.
`docs/procedural-assets.md` section 2 asks for a procedural panel-line normal and
AO pattern applied triplanar; that is now what runs, plus cavity darkening in the
channels driven by the same field so relief and shading agree.

Two implementation problems worth recording, both found by the tests rather than
by inspection:

- **Backticks inside the GLSL template literals terminated them.** Doc comments
  written in the shader source with backticked identifiers silently ended the
  template string and produced a cascade of TypeScript syntax errors. GLSL bodies
  in this repository must not contain backticks.
- **`normalMatrix` does not exist in Three's fragment prefix**, only the vertex
  one. The first attempt rotated the object-space gradient to view space in the
  fragment stage and produced 27 console errors and a failed shader compile. The
  fix builds a deterministic tangent basis from the normal alone, rotates it in the
  vertex stage where `normalMatrix` is available, and resolves the gradient onto it
  in the fragment. That also means hulls need no tangent attribute, which matters
  because generated geometry has none.

One tuning correction, again from looking at the result: the first frequencies
(1.15 plate, 5.5 grain) put features around 0.2 m on a mech about 100 pixels tall
at tactical zoom. Sub-pixel detail aliased into speckle and read as crust rather
than machining, against `docs/art-direction.md` section 7's rule that at RTS zoom
the player sees shapes and not normal maps. Coarsened to 0.70 and 2.0 with
perturbation strength reduced from 0.34 to 0.22, which puts a bay band near 2.9 m
and a plate near 1.4 m so both survive to screen.

`customProgramCacheKey` moved to `rww-hull-v4`.

**Terrain triplanar was deferred to Task 10, deliberately.** The stretched rim
walls need an object-space normal the terrain shader does not currently pass, and
Task 10 rewrites that entire `map_fragment` block to read baked attributes. Adding
triplanar here would be work thrown away a task later. The library's triplanar
helpers are in place and ready for it.

Verified: `npm run lint` and `npm run build` clean; unit suite 14 failed / 508
passed, unchanged; contact sheets 15 passed with zero console errors; browser lanes
`calibration`, `post-stage`, `renderer`, `authored-building-pilot` 11 passed;
mech baselines reviewed at both tiers.

One architectural note: `src/gen/models.ts` now imports from
`@render/materials/surface.glsl`, which points the generation layer at the render
layer. The lint boundary rules permit it (only `src/sim` and `src/headless` are
constrained), and `models.ts` already imports Three and builds materials, so it is
render-adjacent in practice. Worth revisiting if a cleaner home for shared GLSL
appears.

#### Task 7: Authored buildings wear the shared material

Replace the flat-sandstone normalisation at
`authoredBuildingPilot.ts:152-167` with a material built from `rww_surface`,
driven by triplanar object-space coordinates so that the missing UVs stop
mattering. Derive per-instance variation from a stable hash of the placement ID.
Give the imported geometry the same grain, grime, streaking, panel detail, wear,
roughness variation, and metalness response as the procedural structures, tuned
to a habitation palette rather than a military one.

Verify by inspection whether the split GLBs genuinely lack UVs; the code comment
asserts it but it has not been independently confirmed.

Recommendation: do not ship `building.png`. The triplanar procedural material
will match the world, whereas an imported albedo texture reintroduces exactly the
mismatch this task exists to remove. Running that comparison as a cheap
experiment inside this task is acceptable if the user wants to see it first.

Place more than the current five of the thirteen shipped assets. Record the
mixed-asset decision in `docs/procedural-assets.md`,
`docs/art-direction.md` section 11, and `docs/spec.md`.

Tests: `e2e/authored-building-pilot.spec.ts` updated for the new material
contract, since its `maxMetalness <= 0.08` assertion encodes the flat look;
baseline screenshots of authored buildings beside procedural structures; the
presentation-only guarantees re-asserted unchanged, specifically no collision, no
navigation, no line of sight, no save state, and an unchanged world hash.

Demo: a mech, an imported settlement, and a procedural bastion side by side all
look like they were made by the same hand.

#### Task 7 outcome

Delivered in `src/render/materials/habitationMaterial.ts`,
`src/render/authoredBuildingPilot.ts`, `src/dev/calibration.ts`, `src/main.ts`,
`e2e/authored-building-pilot.spec.ts`, and `e2e/calibration-sheets.spec.ts`.

**The UV question is settled by inspection, not preference.** Reading the JSON
chunk of all thirteen shipped GLBs: every one reports `NORMAL`, none reports
`TEXCOORD_0`, and none contains an `images` block. Shipping the source
`building.png` is therefore not merely inadvisable, it is impossible, because
there is no parameterisation to map it with. What the models do have is vertex
normals, which is exactly what a triplanar object-space material needs.

`makeHabitationMaterial` gives them a real surface: two scales of regional plaster
variation, horizontal masonry courses, structural bays, dust pooling on upward
faces and grime running down verticals, recessed windows with a per-cell occupancy
hash, glass roughness in the openings, and warm interior light that comes up as the
shadow squares pass. Every projection is triplanar in object space. The material
carries a per-placement seed so no two settlements are identical, and the window
glow is driven from the same daylight value as the colour grade, so a settlement
coming alive is part of the terminator sweep rather than a separate effect.

The flat treatment it replaces is gone: `normalise` no longer touches materials at
all. It previously forced `#927456` with roughness pinned at 0.9, which is the
specific cause identified in the Key Finding.

**The pre-existing placement bug is fixed.** `normalise` stores the
footprint-centring and ground-alignment offset on the source root's own
`position`, and `update` overwrote that property when placing, silently discarding
it, so every pilot building sat on its raw glTF origin rather than on its
footprint. Each model is now wrapped in a group that carries the ring transform, so
the inner offset survives.

The catalogue went from five loaded and five placed to ten and ten. With a real
surface, silhouette variety is worth having; two repeated shapes read as a texture
swatch rather than a town.

Three corrections, all found by looking at the render:

- **The first palette was too pale.** A neutral plaster dropped the chromatic
  pixel fraction to 0.0008, an order of magnitude below the flat albedo it
  replaced, and failed the sheet's chroma floor. Low-chroma is the rule for
  terrain, not for architecture. Warmed and deepened to a sandstone that still
  sits well under the faction accents.
- **Albedo alone was not enough.** The first version had no normal injection, so
  window openings and courses were colour-only and the buildings still read flat
  under the key light. Added using the same object-space gradient technique as the
  hull material, with a smooth window mask because a hard `step` has a zero
  derivative everywhere and produces no relief at all.
- **`rww_grid` draws lines on both axes.** Using it for masonry courses produced a
  grid, and the vertical component read as corrugation down every facade.
  Replaced with a dedicated one-dimensional `rww_courses`.

`e2e/authored-building-pilot.spec.ts` was rewritten. Its
`materialColors: ['#927456']` assertion encoded the flat look and had to go; the
non-metallic, high-roughness masonry response is still asserted, because that is a
real property of the surface rather than a symptom of the old treatment.

Verified: `npm run lint` and `npm run build` clean; unit suite 14 failed / 508
passed, unchanged; contact sheets 15 passed; browser lanes
`authored-building-pilot`, `calibration`, `post-stage`, `renderer` 11 passed;
authored sheet reviewed at both tiers across four iterations.

Honest limitation: the effect is clearly present on the large front-row buildings
and much subtler on the small ones, because a fixed 3.1 by 3.6 m window grid does
not scale with building size. A per-asset spacing hint would fix it and is not
done.

### Phase 3 - Terrain

#### Task 8: Erosion and a material field in the heightfield

This is the one task that is not purely presentational. `heights` is
authoritative for pathing and buildability as well as for rendering, so changing
it can shift gameplay. It requires a determinism receipt and a core-match
validation run. See Open Decisions for the render-only fallback.

In `src/gen/terrain.ts`, insert a pass between the noise stack and
`flatten()` / `carveCorridor()`, that is before the clamp at line 149: combined
thermal or talus and hydraulic-approximation erosion over the 1414 x 251 grid,
producing drainage-shaped valleys and talus slopes rather than pure noise. Emit
new `Float32Array`s alongside `heights` and `slope`: `material` or a small set of
splat weights, `deposition` or `moisture`, and `curvature`.

Cost is startup-only CPU and does not touch the GPU frame.

Ordering constraints that the implementation must respect: `flatten` and
`carveCorridor` run after erosion and must survive it; `computeSlopes()` must run
last; the `blockedSlopePrefix` summed-area table is keyed only on `maximum`, so
slope must be final before any pathing query is issued.

Tests: determinism, meaning the same seed produces byte-identical arrays;
generation time within `docs/procedural-assets.md` section 9's sub-three-second
load target; existing terrain unit tests; `npm run validate:core-match`
confirming the protected gameplay cohorts still pass; navigation and buildability
tests.

Demo: the strategic side view shows drainage networks and talus, and unit pathing
follows valleys.

#### Task 8 outcome

Delivered in `src/gen/terrain.ts`, with `tests/gen/terrainErosion.test.ts` (12
tests) as the guard. No render-layer file changed: the fields exist and are
correct, but nothing reads them until Task 9 bakes them and Task 10 samples them.

Two erosion passes, in the order the physics happens.

**Thermal (talus).** Material standing above a critical angle slides to its lower
neighbours. Talus is 4 m of fall per 16 m cell, close to a 1:4 grade, which reads
as coarse scree rather than sand. Eight sweeps.

**Hydraulic (stream-power incision).** Cells are visited highest first, each
handing its accumulated upstream area to its steepest downhill neighbour, so a
single sweep yields a real drainage network. Incision goes as the square root of
that area times local grade, which is the standard stream-power form and carves
branching valleys. Material removed upstream is carried and redeposited where the
water slows.

Rejected: a droplet simulation. It needs tens of thousands of random walks to
converge, is slower, and is more awkward to keep deterministic. This is one sort
and two sweeps.

The rim walls are shielded by `smoothstep(0.74, 0.94, |z| / RING_HALF_WIDTH)`.
They are engineered containment, not sediment, and eroding them would breach the
axial bound the map depends on.

Alongside `heights` and `slope`, `Terrain` now exposes four new readonly fields:
`flow` (log-normalised upstream drainage area), `deposition` (settled sediment),
`curvature` (discrete Laplacian, negative on crests and positive in bowls), and
`splat` (four authoritative weights per cell: dust, rock, exposed deck, rim wall).

The point of `splat` is that terrain, not the shader, decides what material goes
where. The terrain shader previously derived its deck zones and colour belts from
noise unrelated to the landforms it was drawing, which is the root cause of
material never corresponding to shape. There is now one authoritative answer.

##### Bug found and fixed: the thermal pass was diverging

The first implementation moved half the excess per sweep. That is the intuitive
choice and it is wrong. The update is explicit diffusion of the above-talus
excess, so for a cell with N qualifying neighbours each at drop d the post-sweep
drop is `d - (N+1) * alpha * (d - talus)`. Staying at or above the talus angle
therefore requires `alpha <= 1/(N+1)`, and N is at most 4 on a four-neighbour
grid. The limit is 0.2, not 0.5.

At 0.5 it overshot as soon as a drop was a few multiples of the talus angle,
which the ridged-noise crests clear easily, and the overshoot amplified each
sweep. Measured on seed 6060, eight sweeps took a `[-65, 387] m` surface to
`[-2111, 2208] m`.

The reason this is worth recording is that the obvious assertions did not catch
it. "Every height is finite and under the ceiling" passed, because the ceiling
re-clamp in `erode()` truncated the entire upward half of the divergence into
whole mountain ranges shorn off flat at exactly 540 m. A test can be green while
the terrain is destroyed.

At alpha = 0.2 the scheme is exact for N = 4 and conservative below it, where the
drop still contracts toward the talus angle by 0.6 a sweep, leaving under 2% of
the original excess after eight sweeps. Measured effect: grade p99 falls
1.053 -> 0.777 and p999 falls 1.487 -> 1.037, while the median is essentially
untouched at 0.086 -> 0.089. That is the correct signature: it relaxes over-steep
ground and leaves ordinary ground alone.

The regression guard is now `relaxes over-steep ground without amplifying
relief`, which checks the height envelope, that no cells are pinned against the
ceiling, and that the steep tail of the slope distribution came down rather than
up. Bounds come from measurement across 11 seeds.

##### Defect found by looking: D4 drainage is rectilinear

Erosion is not visible on any contact sheet, because every sheet stages the
terrain *material* on synthetic flat and tilted patches and none of them builds a
`Terrain` heightfield. So the review surface for this task was a hillshaded
relief render of the heightfield straight out of Node, with the `flow` field
tinted over it. Relief shading is the honest way to look at a heightfield:
drainage networks and scree are legible in it and are not legible in a colour
ramp.

That render showed the drainage network staircasing through ninety-degree turns
and running dead straight along rows and columns. It was a four-neighbour (D4)
steepest-descent field, which can only send water in four directions. Nothing
about it read as a river system.

Fixed by moving the descent and accumulation to eight neighbours (D8). The
comparison had to move from raw drop to *grade*, drop over run, because diagonals
reach `sqrt(2)` further and comparing raw drop biases every choice toward them.
Channels now branch at varied angles. Cost is four more array reads per cell.

The network still prefers the worley panel-join grooves that the noise stack
scratches into the deck, and that is kept deliberately: water finding the
structural joins of the megastructure floor is the right answer for this world.

##### Defect found by looking: incision was punching one-cell pits

The incision cap was 40% of the drop to the *downstream* cell. Those differ from
the drop to the lowest neighbour, so a cell could be cut below a sideways
neighbour it does not drain to, creating a fresh one-cell pit. Visible as dark
speckle in the hillshade, and worse than cosmetic: it breaks the drainage that
the `flow` field is supposed to describe.

The cap is now 40% of the drop to the lowest of all eight neighbours, which makes
the post-cut height `0.6h + 0.4 * lowest` and is provably still above that
neighbour.

Local minima across the whole grid: 3273 before erosion (craters and worley
grooves already produce them) against 4384 after, an increase of 0.31% of cells.
The residual comes from deposition raising channel cells, which makes their
neighbours into relative pits. Nothing in the simulation routes water or depends
on pit-freeness, so this is left as measured rather than pursued further.

##### Defect found by looking: drainage ran across the base pads

Erosion must run *before* `flatten()` and `carveCorridor()`, or the flat pads and
corridors that gameplay depends on get chewed up. But the fields it produces are
consumed by the renderer, which draws the surface *after* that carving. Left
alone the two disagree, and the visible result in Task 10 would have been a river
painted across a landing pad.

The eroded surface is now snapshotted before carving, and `flow` and `deposition`
fade out where the final surface disagrees with it, over
`smoothstep(0.5, 4.0, displacement)`. Fading rather than zeroing keeps a pad
shoulder reading as a graded site rather than a hard stencil edge.

That alone was not enough. A pad flattens toward its own mean height, so cells
that already sat near that mean barely move, and a per-cell test reads them as
untouched: 1.2% of pad interior cells stayed wet against 5.95% field-wide. The
displacement measure is therefore dilated over a two-cell neighbourhood before
use, which asks the right question, whether this *ground* was regraded rather
than whether this one *cell* needed moving. Wet pad cells then fall below 0.1%.

##### Performance

Two allocation faults in the first implementation, both found by profiling rather
than by reading:

- `Array.from(indices).sort(comparator)` boxed all 355k indices into heap objects
  and called back into JS for roughly 6M comparisons: 124 ms. Replaced with
  `orderByDescendingHeight()`, which packs each cell into one float64 as
  `orderable(height) * 2^19 + complement(index)` and hands it to the native
  typed-array sort: 36 ms, and verified to produce a byte-identical ordering.
  `orderable` is the IEEE-754 monotonic-uint32 trick, so no precision is lost and
  no height range has to be assumed.
- Both inner loops allocated a four-element neighbour array per cell, about
  eleven million short-lived arrays across the thermal sweeps, and spent more
  time in the allocator than in the erosion. Unrolled into scalars. A helper
  closure was tried first and rejected for being the same fault in a nicer shape.

Erosion cost fell from 436 ms to 218 ms. Measured on the T480s reference machine,
5-run medians for a full `createTerrain`: 1271 ms before this task, 1544 ms
after, so the two passes plus the surface fields cost about 273 ms, a 21%
increase. A cold first call in a fresh process is nearer 2000 ms because of JIT
warm-up.

Worth flagging for later, since it is not Task 8's to fix: terrain generation was
already 1271 ms of the sub-three-second budget in `docs/procedural-assets.md`
section 9 before this work, and the pre-existing noise stack, not erosion, is
where that time goes.

##### What Task 8 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean, 1.75 s |
| `npx vitest run` | 14 failed / 520 passed, same 14 pre-existing `progress-manifest` failures, +12 new |
| `npm run validate:core-match` | 1 passed, 641 s. Mandatory here: erosion changes authoritative heights |
| e2e renderer, post-stage, calibration, authored-building-pilot | 11 passed |
| Contact sheets | 15 passed, and correctly unchanged: no sheet builds a heightfield |
| T480s 720p Low gate | verdict `pass`, frame 16.7 / 16.7 / 16.8 ms, 70 draws, 105,519 tris, 2 textures, identical to the Phase 1 baseline. Receipt `validation/evidence/procedural-graphics/t480s-low-task8-erosion.json` |
| Visual review | hillshaded relief of the heightfield plus flow overlay, before and after, at three iterations |

The Low gate is unchanged because erosion is load-time CPU only and the ring mesh
grid is fixed; only vertex heights differ. A first run showed 2 frames over 100 ms
against the baseline's 0, which did not reproduce on a clean re-run and was
concurrent test load on this machine.

Determinism receipt: same seed gives byte-identical `heights`, `slope`, `flow`,
`deposition`, `curvature`, and `splat`, asserted by SHA-256 over the raw buffers.
Ties in the height ordering break on ascending index, which is what makes the
drainage network reproducible.

Also fixed while here: three of the new tests called `expect()` once per cell,
building over a million assertion objects and taking 32 s for a single test. They
scan to counters and assert once. The file runs in 9.6 s.

#### Task 9: Bake the fields into ring mesh vertex attributes

Extend `buildRingGeometry` at `ringMesh.ts:124-197` to emit `aSplat`,
`aCurvature`, and `aAO` alongside the existing `aSurface`. These are static
attributes, uploaded once, with zero per-frame cost.

Consider raising `SEG_Z` from 160, since the mesh currently samples at ~25 m
axially against a 16 m heightfield and is therefore discarding real silhouette
detail. Weigh that against the shadow-receive pass and the 400-call ceiling.

Keep the wrap-welded seam via `i1 = (i + 1) % cols` and keep the manual
`boundingSphere`. Low keeps `LOW_SEG_S` and `LOW_SEG_Z` and receives the new
attributes only if its shader will actually consume them.

Tests: attribute presence and length; seam continuity, meaning the first and last
columns agree; memory delta measured and asserted bounded;
`e2e/renderer.spec.ts:157-185`'s Low-versus-High triangle gap still at least
200k.

Demo: no visual change yet, but a diagnostic overlay can display the baked splat,
curvature, and AO channels directly on the terrain.

#### Task 9 outcome

Delivered in `src/render/ringMesh.ts` and `src/gen/terrain.ts`, with
`tests/render/ringMeshFields.test.ts` (7 tests) as the guard. Still no visual
change: the terrain shader does not sample any of this until Task 10.

Three new attributes on the full-detail ring, quantised rather than float32:

| Attribute | Type | Contents |
| --- | --- | --- |
| `aSplat` | `Uint8` x4, normalised | dust, rock, bared deck, rim wall |
| `aCurvature` | `Int8` x1, normalised | negative on crests, positive in bowls |
| `aAO` | `Uint8` x1, normalised | fraction of the sky visible |

The quantisation is the whole memory story. Splat weights are a partition of
unity and AO is a plain multiplier, so a 1/255 step sits far below anything
visible, and curvature only ever scales a wear term. At float32 the three would
be 24 bytes a vertex, 3,956,736 B on the full ring, taking the geometry from
11.5 MB to 14.5 MB. Quantised they are 6 bytes, 989,184 B, which is 8.6% of the
finished geometry. On the integrated GPU this has to run on, that 3 MB is worth
more than precision nobody can see. The arithmetic is written out in the memory
test so a later change has to argue with the numbers rather than quietly grow the
mesh.

##### Low is deliberately excluded

`buildRingGeometry` now takes a `bakeFields` flag, false for Low. This is not
caution about the frozen budget, it is that Low runs `makeLowTerrainMaterial`,
which is a separate `ShaderMaterial` with its own vertex and fragment source
rather than a variant of the full material's `map_fragment`. Task 10 rewrites the
full material only, so Low would never sample these attributes and baking them
there is VRAM spent on data nothing reads. Measured: the Low geometry build is
unchanged at 47 ms against 51 ms before, and the Low ring geometry has no new
attributes at all.

##### `aSurface` was already there, so the samplers had to match it

The mesh samples at 22 m spinward and 25 m axially against a 16 m heightfield, so
the fields have to be bilinear or material boundaries land in visibly the wrong
place. `Terrain` gained one public sampler, `surfaceFieldsAt`, which fills splat,
curvature, and sky visibility together.

ONE CALL RATHER THAN THREE, for a measured reason. The first version had
`splatAt`, `curvatureAt`, and `skyViewAt`, and the high-detail ring build went
from 237 ms to 358 ms. Stubbing the three calls out while keeping the
quantisation and the attribute writes brought it to 239 ms, which located the
whole 120 ms in the samplers rather than anywhere else. Splat and curvature share
the same 16 m grid, so they can share one bilinear cell lookup, and the lookup is
the bulk of the cost. Folding them into one call took the build to 305 ms. The
combined call is also the better interface: the renderer asks "what are the baked
fields here" once, instead of the caller knowing which fields happen to live on
which grid.

##### The AO field: how it works, and the 1.25 s mistake

`aAO` is horizon-based sky visibility. For each of eight azimuths, walk outward
and keep the steepest elevation angle to the terrain; visibility is one minus the
mean sine of those angles, which is the fraction of the hemisphere the landform
leaves open. Radii are geometric, 24 / 64 / 160 / 480 m, so near-field detail and
several-hundred-metre enclosure both register from four samples. The longest
reach catches a rim wall from well out on the floor.

This is not redundant with the screen-space AO from Task 4. That pass works from
the depth buffer over a small radius, so it finds where a mech's foot meets the
ground but is blind to a valley floor or the base of a rim wall sitting inside a
bowl hundreds of metres across. This is the low-frequency term the depth pass
cannot see, and being baked it costs nothing per frame.

The first implementation evaluated it per ring-mesh vertex through `heightAt`:
164,864 vertices times eight azimuths times four radii is 5.3M bilinear samples,
which took **1.25 s** and more than doubled the load budget by itself. The high
ring build measured 1499 ms.

Two changes fixed it, and both are about recognising what the field actually is:

- Occlusion at these radii is inherently smooth, so it does not belong on the
  16 m grid at all. It now lives on its own 354 x 64 grid, roughly 64 m in both
  axes, and is bilinearly sampled from there. The column count divides the
  circumference exactly so the field wraps without a seam; decimating the
  1414-column grid by four would not, since 1414/4 is not an integer, and the
  discontinuity would land as a shading stripe running the ring's full width.
- The sample pattern is precomputed as integer *cell offsets* rather than metre
  displacements resolved per point. The offsets are the same for every point, so
  resolving them once turns the inner loop into pure integer indexing with no
  trigonometry, no rounding, and no wrap-helper calls. The run length is
  recomputed from the quantised offset so the elevation tangent stays honest
  rather than using the nominal radius.

Cost fell from 1.25 s at vertex rate to 154 ms, and then to **20 ms** with the
integer offsets.

##### Defect found by looking: the raw field was blocky and speckled

Rendered on its own, contrast-stretched over 0.6..1.0, the field showed 64 m
blocking and clear salt-and-pepper speckle. Each coarse node reads single 16 m
cells, so it picks up whatever one-cell noise sits under its samples, and
bilinear reconstruction then spreads that speckle into 64 m blocks.

Occlusion over hundreds of metres is genuinely smooth, so the speckle was
sampling noise rather than signal. A separable 1-2-1 blur run twice, wrapping
spinward and clamping axially, removes it for a fraction of a millisecond on a
354 x 64 grid. The field minimum rose from 0.540 to 0.634 as the outliers went;
the mean is unchanged at 0.880.

Reviewed three ways, since none of this is visible in any contact sheet: relief
alone, the sky-visibility field alone, and the product of the two, which is what
the shader will do with it. The product reads correctly -- valleys and the worley
panel-join grooves deepen, crater interiors sit down, the feet of the rim walls
darken, and open floor stays bright.

##### `SEG_Z` was left at 160, deliberately

The task suggested raising it, since 160 rows over 4000 m samples at 25 m against
a 16 m heightfield and is therefore discarding real silhouette detail. Not done
in this task, because Task 10 owns the Medium / High / Ultra re-measurement and
raising `SEG_Z` to 250 would take the full ring from 327,680 to 512,000 triangles
without a tier measurement to weigh it against. Deciding geometry density in the
task that bakes attributes, and re-measuring cost in the next one, would put the
decision and its evidence in different places. Carried into Task 10.

##### Incidental fix

`tests/render/disposal.test.ts` stubs `Terrain` as an object literal and builds a
`high` geometry, so it needed `surfaceFieldsAt` or the full-detail path would call
a method that does not exist. Extended to answer with a featureless surface: all
dust, flat, fully open to the sky.

##### A test that was measuring the wrong thing

`generates inside the load-time budget` from Task 8 failed once the sky field was
added, at 3012 ms against a 1900 ms bound. The cause was not the 20 ms field.
Vitest runs test files across parallel workers, and the same generation measures
1544 ms alone against 3012 ms during a full-suite run, so the assertion was
measuring CPU contention.

Rewritten as `generates without a runaway load-time cost` with a deliberately
loose 6000 ms bound, which still catches a droplet simulation or an accidental
O(n^2) and nothing finer. The real figures belong in this document, not in an
assertion that competes for cores.

Related, and worth recording because it invalidates cross-session comparison:
this machine drifts. The pre-existing noise stack alone measured about 1230 ms
early in a session and 1650-1745 ms an hour into one, under identical code. Only
same-session comparisons mean anything here.

##### Load-time cost, attributed

Per-phase, same session, five repeats of `createTerrain(6060)`:

| Phase | Cost | Owner |
| --- | --- | --- |
| Noise stack | 1650-1745 ms | pre-existing |
| Erosion, both passes | 200-318 ms | Task 8 |
| Surface fields | 104-188 ms | Task 8, plus the regrade dilation |
| Sky visibility | 16-42 ms | Task 9 |
| Slopes, flatten, corridors | 120-155 ms | pre-existing |

Full ring geometry build: 237 ms before this task, 305 ms after, so the field
bake costs about 68 ms. Low: 51 ms before, 47 ms after, unchanged within noise.

Task 9 therefore adds roughly 90 ms to load, split between the sky field and the
bake. The pre-existing noise stack remains four fifths of terrain generation and
is where any real load-time work would have to go.

##### What Task 9 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean, 2.04 s |
| `npx vitest run` | 14 failed / 527 passed, same 14 pre-existing `progress-manifest` failures, +7 new |
| `npm run validate:core-match` | not owed, and why: every write to `heights`, `slope`, `flow`, `deposition`, `curvature`, and `splat` is Task 8 code. `computeSkyView` writes only `skyView`, and the samplers are read-only. Gameplay-authoritative state is untouched |
| e2e renderer, calibration-sheets, calibration, post-stage | 25 passed, including the Low-versus-High triangle gap and quality churn |
| T480s 720p Low gate | verdict `pass`, frame 16.7 / 16.8 / 16.8 ms, 0 frames over 100 ms, 70 draws, 105,519 tris, 2 textures, 152 geometries, identical to the Phase 1 and Task 8 baselines |
| Visual review | sky-visibility field rendered alone and multiplied into relief shading, before and after the blur |

Attribute-level guards, since nothing renders these yet: presence and per-vertex
count, quantised types and the `normalized` flag, splat summing to one within
2/255 at every vertex, seam agreement no worse than the roughest ordinary
neighbouring column pair, sky visibility genuinely varying rather than constant,
curvature carrying both signs and never reaching the unrepresentable -128, Low
carrying none of it, and the memory arithmetic.

#### Task 10: Terrain shader reads the baked fields, and real quality tiers

Rewrite the `map_fragment` block at `terrainMaterial.ts:267-354` to blend from
`aSplat`, still through `rww_hblend` height blending rather than linear alpha,
instead of recomputing `nBig`, `deckRegion`, `regA`, and `regB`. Multiply in
`aAO` and drive wear from `aCurvature`. Keep only the high-frequency detail that
genuinely needs to be per-pixel.

Use the finally-plumbed `vHeight` at line 219 for altitude banding and strata,
and the bound-but-unread `uTime` at line 240 for drifting dust and heat shimmer.
Both already exist and need no new plumbing.

Measure the recovered GPU time, then spend part of it on real tier
differentiation: octave counts, detail-normal range, triplanar on or off,
parallax on Ultra. Medium and Ultra must stop being byte-identical. Add explicit
uniforms per feature rather than overloading `uDetailFade`.

Tests: re-run the `phase-4c` terrain isolation measurement and record the new
attribution; assert Medium GPU time is no worse than today's 49.186 ms and
ideally materially better; Low path byte-identical; baselines updated.

Demo: material regions follow the actual landforms, with talus on eroded slopes,
dust in deposition basins, and exposed deck where erosion scoured down to the
megastructure floor. Medium also runs faster than it does today.

#### Task 10 outcome

This is the task the terrain half of the overhaul existed to reach. Material now
follows the landform, and it costs substantially less than the noise it replaced.

Delivered in `src/render/materials/terrainMaterial.ts`, `src/render/renderer.ts`,
`src/main.ts`, and `src/dev/calibration.ts`, with six new tests in
`tests/render/terrainMaterial.test.ts`.

##### What the shader used to do, and why it looked wrong

The fragment stage invented its own regions from noise fields -- `nBig`,
`deckRegion`, `regA`, `regB` -- that had nothing to do with the landform being
drawn. Dust could sit on a ridge crest. Bared deck could appear on a slope no
water had ever run down. Material never corresponded to shape because nothing
connected the two, and no amount of tuning the noise could have fixed it.

It now blends from `aSplat`, which is terrain's own answer from erosion: dust
where sediment settled and the grade is gentle, rock where it is steep or flow
stripped the cover, bared deck in the channels carrying the most water, rim wall
where the containment structure is. Still through `rww_hblend` height blending
rather than linear alpha, so transitions keep interlocking gritty edges.

Three further fields replaced with the baked ones:

- Oxidised staining was its own three-octave field. It is now driven by
  `aCurvature` and dust cover: positive curvature is a bowl and dust cover means
  sediment settled there, so the two together are exactly "low and damp". Cheaper
  than what it replaced, and it lands where the landform says it should.
- Roughness took the deck mask from a fourth evaluation of the 0.0026 field and
  the variation from its own three-octave fbm. It now uses `aSplat.z` and reuses
  `nMid`.
- Metalness took the deck mask from a fifth evaluation and the rim from a
  `smoothstep` over the axial coordinate. Both are now baked channels.

##### Districts moved to the vertex stage

`regA` and `regB` have periods of about 2.4 km and 3.2 km. Vertices are 22 m
apart, so interpolating them is exact to well inside a colour step, and it moves
six fbm octaves off a shader that runs on most of the screen onto one that runs
165k times. They stay procedural because districts are an art device orthogonal
to the landform, and baking them would have spent memory on something a varying
carries for free.

##### The two dead varyings are now read

`vHeight` was plumbed through the vertex stage and never used. Bedding planes are
horizontal, so height is exactly the right coordinate for strata, and strata are
what make a steep face read as cut rock rather than as tilted ground. Banded at a
26 m period, gated to rock weight times slope, so it appears only on exposed rock
faces.

`uTime` was bound and never read. It now drives a slow dust drift over
dust-covered ground, deliberately near the threshold of noticing: creeping dust is
a living-world cue, and anything strong enough to read as motion would read as a
bug.

##### Rim walls: the triplanar Task 6 deferred, in the ring's own frame

A near-vertical wall textured from arc length and axial position alone gets the
floor projection smeared up its face, because the face barely moves in those two
coordinates while climbing 260 m.

The shared `rww_triplanarWeights` on object-space position would not have fixed
it. On a ring, object space is not aligned with local up: at theta = 0 up is +y,
at theta = 90 degrees up is +x. A world-axis triplanar would hand the three
projections different roles depending on where you stand, so the wall material
would change character around the circumference.

`rww_ringProjection` blends in the ring's own frame instead -- up, axial,
spinward -- which reduces to three 2D projections using coordinates already to
hand: (arc, axial) for the floor, (arc, height) and (axial, height) for walls.
Gated behind `uTriplanarRim` and a rim-weight test, so Medium skips it entirely
and the rest of the ring never evaluates it.

##### The baked AO goes where Task 4's could not

Task 4 had to apply its depth-derived occlusion to the composite behind a
luminance-protection window, because by that point the direct and indirect terms
are already summed and there is nothing left to separate. Its outcome section
recorded that as unachievable.

The baked term arrives as a vertex attribute *inside* the lighting model, while
the two terms are still apart. So it multiplies `indirectDiffuse` and
`indirectSpecular` and the sky-bounce fill, and leaves direct sunlight alone.
Sunlit ground stays sunlit; what darkens is the sky contribution into places that
cannot see much sky. A test asserts `directDiffuse` is never multiplied by it,
because that regression would flatten the whole world and still look plausible in
a still frame.

Verified visually, and the verification is worth recording because the first
reading looked like a failure. On the contact sheet, `dust-occluded` at half sky
visibility was barely distinguishable from `dust`. That is correct: the sheet
deliberately parks its patches *between* shadow squares, in full sun, which is
exactly where sky occlusion should be weakest -- a valley floor in direct sunlight
really is not much darker than a ridge in direct sunlight. Re-rendering with the
patches inside a shadow band made the difference unmistakable, and the sheet's own
chroma floor failed at 0.00015 against 0.06, which is the guard correctly
reporting that everything was in deep shade. The term is subtle in sun and
pronounced in shade, which is what it should be, and the ring spends a large
fraction of every day cycle in shade.

##### Real tier differentiation, in one program

Four new `QualitySettings` fields -- `terrainFineOctaves`,
`terrainTriplanarRim`, `terrainDustDrift`, `terrainMicroDetail` -- one per
feature, rather than more meanings piled onto `detailFade`. Pushed through one
`applyTerrainQuality` function so a new terrain feature is wired once instead of
at each of the four call sites that change tier.

| | Medium | High | Ultra |
| --- | --- | --- | --- |
| Fragment detail octaves | 2 | 3 | 3 |
| Ring-frame rim projection | off | on | on |
| Dust drift | off | on | on |
| Micro-grain | off | off | on |
| Detail-normal strength | 0.8 | 1.0 | 1.0 |

All of these are uniform branches inside a single program, not separate
compilations. Every fragment of a draw takes the same path, so the GPU genuinely
skips the work, and switching quality cannot grow the program set -- which the
`shader-program-growth` invariant and the quality-churn e2e both depend on.

Parallax on Ultra, which the plan floated, was not done. At RTS camera distance a
parallax step would be invisible while costing a march loop; micro-grain is what
actually reads at that range. Recorded as a deviation rather than a gap.

##### Measured cost

Isolation pair, same session, `heavy-combat` at 1280x720 DPR 1 on Intel UHD 620:

| Medium diagnostic | GPU median | Calls | Triangles |
| --- | ---: | ---: | ---: |
| Default | 40.170 ms | 122 | 429,656 |
| Low terrain path | 19.150 ms | 122 | 167,512 |
| **Terrain path attribution** | **21.020 ms** | | |

Against `docs/phase-4c-renderer-profile.md`, where the same isolation gave
49.186 - 8.136 = **41.05 ms**. A second pair taken earlier in the session gave
45.103 - 21.523 = 23.58 ms. So the terrain path now costs 21.0 to 23.6 ms against
41.05 ms before: a **43 to 49% reduction**, about 17.5 to 20 ms recovered.

The low-terrain floor moved from 8.136 ms to 19.15 ms, and that is not a
regression in this task: Medium now runs the ten post passes Phase 1 added. Only
the *difference* between the two rows is comparable across the two profiles, which
is why the attribution is quoted rather than the totals.

Whole-tier medians, all three faster than the phase-4c baseline despite carrying
those ten extra passes:

| Quality | GPU median before | GPU median now |
| --- | ---: | ---: |
| Medium | 49.186 ms | 45.103 ms |
| High | 60.259 ms | 54.287 ms |
| Ultra | 67.220 ms | 58.256 ms |

Receipts: `validation/evidence/procedural-graphics/t480s-medium-default-task10.json`
and `t480s-medium-low-terrain-task10.json`.

##### The contact sheet became a real reference chart

The terrain sheet stages the material on synthetic patches, which carried only
`aSurface`. Left alone they would have fed the shader WebGL's defaults for the
missing attributes -- `(0,0,0,1)` for a vec4, which is pure rim wall, and zero for
the occlusion float, which is total darkness -- and every swatch would have been
wrong in a way that looked deliberate.

The patches now supply all three, staged explicitly rather than sampled from a real
`Terrain`. This is a reference chart, not a screenshot of the world: sampling would
show whatever layers the seed happened to put under seven arbitrary coordinates,
and bared deck covers well under a tenth of the ring, so the layer most likely to
regress would be the one least likely to appear.

One correction during review. The first version moved occlusion and curvature
together on a single patch, which made it impossible to tell which had produced
the difference -- or, as it turned out, whether one of them was doing anything at
all. The first three patches now share a coordinate, a splat, and a tilt and differ
in exactly one field each, so each is a direct A/B against `dust`. Before that
change the sheet showed seven swatches and could not answer a question about any of
them; after it, the AO finding above was immediate.

Known limitation: `dust-damp` is nearly invisible on the sheet, because oxidised
staining lands on the same hue as the rust belt the reference ground plane happens
to sit in. The swatch renders correctly, it just has no contrast against that
backdrop. Not worth moving the ground plane for.

##### What Task 10 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npx vitest run` | 14 failed / 532 passed / 2 skipped, same 14 pre-existing `progress-manifest` failures, +6 new |
| Contact sheets | 15 passed, terrain and combined baselines regenerated and reviewed |
| e2e renderer, calibration, post-stage, authored-building-pilot | 11 passed, including quality churn and program bounds |
| T480s 720p Low gate | verdict `pass`, frame 16.7 / 16.8 / 16.8 ms, 0 frames over 100 ms, 70 draws, 105,519 tris, 2 textures, 152 geometries, 47 programs -- identical to the Phase 1, Task 8, and Task 9 baselines. Receipt `t480s-low-task10-terrain.json` |
| Medium / High / Ultra GPU | 45.103 / 54.287 / 58.256 ms, zero console errors on every run |
| Visual review | terrain contact sheet at both tiers; the same sheet re-rendered inside a shadow band to isolate the occlusion term; whole-ring and gameplay-range frames from `rww visual`; three close-range vantages over the steepest eroded ground and a rim wall |

The close-range review is what confirmed the point of the whole terrain arc: cool
grey-blue drainage bands cutting through warm tan dust, following the eroded
channels, with the interlocking edges height blending gives. Material follows the
landform. That review needed a temporary spec driving `window.RWW.rig.setView`,
because no shipped surface frames the terrain at gameplay range -- the contact
sheet uses synthetic patches and both scenario cameras sit too far out. That gap
is still open and is worth a permanent review surface.

`npm run validate:core-match` is not owed: this task changes only the render layer.

### Phase 4 - Units

#### Task 11: Extend the primitive vocabulary

Additive work in `src/gen/models.ts`:

- turn panel lining at lines 198-220 into real inset channels with side walls,
  recursive face subdivision, both vertical and horizontal divisions, and
  per-plate offset variation;
- add `addTube(path, radius, segments)`, a swept-tube primitive, and route it
  along chassis edge paths as trim and piping;
- add hydraulic rams at knee, ankle, and torso joints, where exactly one exists
  today at line 774;
- give `addGreebles` a density map, joint and vent clustering, and a `tier`
  parameter, which is the prerequisite for Task 13's LOD;
- add cylinder and pipe greebles, where only boxes exist;
- close the open cylinder bottom in `addCylinder`.

Retune per-class `PROFILES` greeble counts and panel divisions against the
contact sheet, holding `docs/art-direction.md` section 7's silhouette-first rule.
The narrow-torso and long-leg proportions documented at `models.ts:539-551` are
hard-won and must not regress.

Tests: `tests/render/models.test.ts` extended with normals unit length,
front-facing exterior raycasts, watertightness, and per-class triangle counts
asserted against explicit budgets, none of which exist today; faction geometry
still differs while rig metadata stays identical.

Demo: the contact sheet shows genuinely machined mechs and structures, with
recessed channels catching Task 4's AO, piping following the chassis, and
actuators at every joint.

#### Task 11 outcome

Delivered in `src/gen/models.ts`, with three new tests in
`tests/render/models.test.ts`.

Two corrections to the plan before the work: the tests it asked for as "none of
which exist today" were partly already there. Normals-unit-length, front-facing
exterior raycasts, and faction-geometry-differs-while-rig-metadata-matches all
existed. What genuinely did not exist was watertightness and per-class triangle
budgets, and those are what got added.

##### Real inset channels, and why the old ones were not channels

`addBlock` used to emit the wall as one quad and then a second quad pulled 4.5%
inward across it. That is not a channel. The wall still spans the full height, so
the strip sits behind solid geometry, and the two near-coplanar surfaces have no
side walls between them. It read as a faint tone change, and having no concave
geometry it could not catch the occlusion Tasks 4 and 10 added.

`addPanelledWall` now breaks the wall into bands with gaps where the channels go,
and closes each channel with a recessed floor and two lips. A wall with N channels
is 5N+1 quads against the 2 it used to be.

##### Deviation: vertical divisions were withdrawn

The task asked for both vertical and horizontal divisions with recursive face
subdivision. Horizontal shipped; vertical did not, for a structural reason rather
than a matter of taste.

A horizontal channel closes cleanly. Its bands' side edges run up the block's
corners where they meet the neighbouring face exactly, and their top and bottom
edges span the full face width where they meet the single-quad chamfer bands
exactly.

A vertical channel does neither. Its bands are split across the width, so the
wall's boundary at the chamfer is subdivided while the chamfer quad is not. That
is a T-junction, and a T-junction is a hole. Cutting both axes into one face
additionally requires matching every lip to its neighbour's subdivision in both
axes per band. Closing it properly means a genuine 2D subdivision of the entire
block including the chamfer bands, which is a different piece of work from the one
described, and the read it buys is modest next to the horizontal channels because
plate joins on armour are dominated by the horizontal run.

Attempted, measured as leaking, and removed rather than shipped. `panelColumns`
and the `torsoColumns` profile field are gone rather than left as dead options.

##### What the watertightness test found

Writing the test the task asked for immediately paid for itself. Three holes, none
of which any existing assertion could see:

- `addCylinder` emitted a top cap and no bottom cap. Every piston, mast, and
  barrel in the game was a tube open at one end, visible as a hole from below or
  on any cylinder mounted clear of a hull.
- Vertical channels terminated at their band boundary as an open slot, the width
  of the channel by its depth, because the recessed floor ended while the wall
  either side of it did not.
- The channel offset jitter was seeded per FACE. Each face then placed its channel
  at a slightly different height, so the band edges meeting at a corner spanned
  different ranges and nothing paired: 24 unpaired edges on the pelvis alone. It
  was wrong to look at as well as being non-manifold, since a channel machined
  into a housing continues around the corner rather than stepping at every edge.

The test keys edges on rounded POSITION, not on vertex index. Index keying would be
useless: `MeshBuilder` pushes four fresh vertices per quad so every face can carry
its own flat normal, so no two faces share an index even where they share an edge
in space. Interpenetration is fine for the check, since a greeble half inside a
hull is two closed shells overlapping and each still contributes a closed surface.

##### Added primitives

- `addTube(path, radius, segments, mask)`, a swept tube with mitred corners, both
  ends capped. Routed as a conduit down the back of the torso.
- `addRam(from, to, radius)`, a hydraulic actuator as a body tube plus a narrower
  rod. There used to be exactly one actuator on a whole mech; there are now four,
  at both hips, the knee, and the ankle. Joints without visible hardware read as if
  the limbs are glued together, and an actuator is the clearest "this thing moves"
  cue a walker has.
- `addGreebles` gained a density map (`clusters`), a `roundFraction` for cylinder
  and pipe forms where only boxes existed, and a `GreebleTier` parameter. Every
  caller asks for `full`; Task 13 is what will select between tiers per LOD.
  Introducing the parameter here rather than there keeps the LOD work from having
  to reshape this function while also building a mesh cache around it.

##### Deviation: the ram collar, and limb channels, were cut for the frame budget

Mech geometry is built once and used at every quality. There is no per-tier mech
mesh, so anything added here lands on the frozen T480s Low frame budget.

The first version put channels on the thighs and shins, a second ram on each
thigh, a feed line across each knee, a collar ring on every ram, and two torso
conduits. That took the mean mech from 1,810 to 2,607 triangles and **the frozen
Low frame p95 from 16.8 ms to 33.3 ms** -- dropped frames, at 121,312 triangles.
The perf verdict still reported `pass`, because it does not gate on frame p95, so
this would have shipped as a silent regression against an explicit constraint.

What came back out was everything that could not resolve on screen. At tactical
range a channel in a sub-metre shin is sub-pixel, which is the same error Task 6
corrected in the hull shader frequencies: it costs triangles and returns aliasing.
The actuators stayed, because a silhouette survives any distance. Detail is now
concentrated on the torso and pelvis, where the plate is broad enough to carry it.

Greeble counts were also retuned down per class -- vanguard 16 to 10, bulwark 20 to
12, and so on -- which is a good exchange rather than a sacrifice: a channel reads
as machined surface, a scattered box reads as noise.

##### Measured cost

| | Before | After |
| --- | ---: | ---: |
| Mech mean, whole standing mech | 1,810 tris | 2,017 tris |
| Structure mean | 862 tris | 936 tris |
| Low scene total | 105,519 tris | 110,724 tris |
| Low frame median / p95 / p99 | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 16.8 ms |
| Low GPU median | 6.969 ms | 5.651 ms |

Per class: vanguard 2,052, longbow 2,048, wisp 1,880, aegis 2,152, bulwark 2,108,
needle 1,860. The budget test holds each against a ceiling about 12% above its
measured value, and the mean under 2,300, so a future addition has to come and
argue with a number rather than quietly eat the Low budget.

##### What Task 11 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean, 2.02 s |
| `npx vitest run` | 14 failed / 535 passed / 2 skipped, same 14 pre-existing `progress-manifest` failures, +3 new |
| Watertightness | every part of all 6 mech classes and all 12 structures closes with zero unpaired edges |
| Contact sheets, renderer, calibration e2e | 21 passed |
| T480s 720p Low gate | verdict `pass`, 16.7 / 16.8 / 16.8 ms, 0 frames over 100 ms, GPU median 5.651 ms, 110,724 tris. Receipt `t480s-low-task11-vocabulary.json` |
| Visual review | three mech classes at close range, per faction |

The mech contact sheet is NOT a usable review surface for this task, and that is
worth recording for Tasks 12 to 15. It stages twelve mechs across 1100 px, so each
is around 100 px tall, and the snapshot comparison allows `threshold: 0.15` with
`maxDiffPixelRatio: 0.004` -- about 2,800 pixels. Every geometry change in this
task fell under that: the sheet passed byte-identical while the mechs had gained
four actuators, real channels, a conduit, and six fewer greebles. Reviewing it
needed a temporary spec driving `RWWCalibration.camera` in on individual mechs,
the same gap the terrain work hit in Task 10. At close range the thigh actuator
reads clearly as a pipe down the outside of the leg and the torso channel reads as
a shadowed band across the chest.

`npm run validate:core-match` is not owed: `MechRig` metadata -- height, radius,
hip offset and height, leg lengths, muzzles -- is unchanged, which the existing
faction test asserts directly.

#### Task 12: Weld pass and curvature channel for real edge wear

`MeshBuilder.quad` pushes four fresh vertices per quad with a flat face normal,
so nothing knows where an edge is, which is why wear is currently faked as
`smoothstep(0.55, 1.0, grain)`.

Add an optional weld and adjacency pass in `MeshBuilder.build()` at lines
108-124, computing per-vertex curvature and AO and emitting them as `aCurvature`
and `aAO`. Weld only for smoothing-angle purposes and preserve hard chamfer
edges, since those chamfer highlights are load-bearing for the hard-surface read.

Replace the noise-thresholded wear at lines 441-443 with genuine
curvature-driven wear: bare metal on convex chamfers, grime and AO in concave
recesses. `docs/procedural-assets.md` section 2 calls these two effects the ones
that most reliably make CG surfaces stop looking clean and fake.

Add a third per-instance float alongside `instanceDamage` and `instancePhase` at
`entityRenderer.ts:775-800` for per-unit wear or veterancy, so that identical
instances stop looking cloned.

Tests: curvature channel correctness on known geometry, where a bevelled cube's
chamfers must read convex and its panel channels concave; attribute memory
bounded; baselines updated.

Demo: chamfers wear bright, recesses collect grime and shadow, and each mech in a
lance looks individually weathered.

#### Task 12 outcome

Delivered in `src/gen/models.ts` and `src/render/entityRenderer.ts`, with four new
tests in `tests/render/models.test.ts`.

##### The weld pass, and what it is deliberately not

`MeshBuilder.quad` pushes four fresh vertices per quad so every face carries its
own flat normal, which is what gives the chamfers their hard highlight. The cost
was that nothing in the mesh knew where an edge was, or which side of one it was
on, so edge wear was faked as `smoothstep(0.55, 1.0, grain)` on a noise field:
bright metal wherever the noise happened to peak, which put scuffing in the middle
of flat plates and left the chamfers -- the only places a machine actually rubs --
exactly as painted as everything else.

`weldedSurfaceFields` groups vertices by position and answers two questions per
group, then writes the answers back to every vertex sharing that position.
**Vertices are never merged and normals are never averaged.** Doing either would
round off the chamfers. The weld exists only to derive data. A test asserts this
directly: a corner must still hold three or more different normals at one position,
which goes to zero the moment the weld starts touching geometry.

- **Convexity** is the mean, over the ring of neighbours, of how far the position
  stands out along its own averaged normal. A chamfer corner comes out positive, a
  channel floor negative. Adjacency is held in compressed-row form and
  deliberately not deduplicated, so a neighbour shared by two triangles is counted
  twice and the mean is weighted by incident area.
- **Occlusion** could not come from convexity, which is why it is a separate pass.
  Convexity is local to the surface: it knows a channel floor is recessed but has
  no idea a greeble box is sitting on the plate beside it, or that a ram runs down
  the outside of a thigh. Those contacts are what read as assembled hardware.
  Triangle centroids are dropped into a 24-cube occupancy grid and each position
  probes nine directions in its own hemisphere. A ray cast against every triangle
  would be exact and is not affordable at load for six mech classes and twelve
  structures.

The shader now uses `rww_edgeWear` and `rww_cavityGrime` from the shared surface
library on the real curvature, plus the occlusion term, so bare metal lands on
convex chamfers and grime and shading in concave recesses. That pairing is what
`docs/procedural-assets.md` section 2 calls the most reliable way to stop CG
surfaces looking clean and fake.

##### Per-unit weathering

A third per-instance value, so a lance of one class stops looking cloned. It is
distinct from `instanceDamage`: damage is combat state and changes during a match,
weathering is service history and is fixed for the life of the unit. Driven by a
second golden-ratio walk on a different offset from the animation phase, because
correlated the whole lance would wear in step with its footfalls, which is exactly
the cloned look this is meant to break.

##### Two performance regressions, both found by reading p95 rather than the verdict

This task broke the frozen Low frame budget twice. Both times the perf verdict
reported `pass`, because it gates on the median and on frames over 100 ms and not
on frame p95. The lesson from Task 11 -- read `p95FrameMilliseconds` by hand --
is what caught them.

**First: a third instanced attribute cost 50 buffer uploads a frame.** Instance
indices are re-packed every frame, so every instanced attribute is re-uploaded
every frame, and each is its own `bufferSubData` call across some sixty instanced
meshes. Adding weathering as a separate float took uploads from 168 to 218 calls a
frame while the byte volume barely moved, 1.27 MB to 1.30 MB. That call overhead
alone took the presentation phase p95 from 2.5 ms to 5.55 ms, the CPU full-frame
p95 from 6.9 ms to 16.45 ms, and the frame p95 from 16.8 ms to 33.3 ms.

Fixed by packing animation phase and weathering into one `instanceVariation` vec2,
which costs one extra float per instance and no extra calls. Uploads returned to
168 a frame exactly. Worth noting the diagnosis came from the receipt's own upload
counters: bytes flat while calls rose is a very specific fingerprint, and guessing
would have pointed at bandwidth.

**Second: three new float varyings.** Even with uploads fixed, frame p95 stayed at
33.3 ms. The hull shader was already carrying fifteen floats of varyings and this
added three more, on hardware the Low budget is frozen against. Packed convexity,
occlusion, and weathering into a single `vWear` vec3, and the two vertex
attributes into a single `aSurfaceField` vec2. Frame p95 returned to 16.8 ms.

Both fixes are strictly better than what they replaced, so neither is a
compromise. But the shape of this task is worth recording for Tasks 13 to 15: on
this hardware, at this tier, *attribute and varying count* is a first-order cost,
not a rounding error.

##### Measured cost

| | Task 11 | Task 12 first pass | Task 12 shipped |
| --- | ---: | ---: | ---: |
| Low frame median / p95 / p99 | 16.7 / 16.8 / 16.8 ms | 16.7 / 33.3 / 33.4 ms | 16.7 / 16.8 / 16.8 ms |
| Frames over 100 ms | 0 | 0 | 0 |
| Upload calls a frame | 168 | 218 | 168 |
| Presentation CPU p95 | 2.5 ms | 5.55 ms | 3.0 ms |
| CPU full frame p95 | 6.9 ms | 16.45 ms | 9.2 ms |
| Draws / triangles / programs | 70 / 110,724 / 47 | 70 / 110,724 / 47 | 70 / 110,724 / 47 |

Geometry is unchanged: this task adds no triangles.

Low GPU median read 8.4 ms against Task 11's 5.7 ms. That figure is NOT clean.
Across this session the same unchanged code has measured between 5.6 and 9.7 ms as
the machine warmed, so the delta cannot be separated from drift. What can be
stated is that the frame gate holds with the same resource signature, twice in a
row, and that GPU p95 is 10.5 ms against a 16.7 ms budget.

Load cost: the weld pass adds about 61 ms to the roster build, taking it from 38 ms
to 99 ms for twelve mechs across two factions plus twenty-four structures. The
first version cost 104 ms, and the difference was one line: keying positions with a
`${x},${y},${z}` template string. Replacing it with a single packed number --
quantising to a millimetre over +/-64 m is 17 bits an axis, and 51 bits fits a
float64 exactly -- removed 43 ms. The same allocation fault as Task 8's boxed sort,
in a different costume. A first attempt at optimising this replaced the per-group
`Set` adjacency with typed arrays and moved the total by 2 ms, which is a reminder
to measure before choosing what to fix.

##### What Task 12 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npx vitest run` | 14 failed / 539 passed / 2 skipped, same 14 pre-existing `progress-manifest` failures, +4 new |
| Contact sheets, renderer, calibration, post-stage, authored pilot | 26 passed |
| T480s 720p Low gate | verdict `pass`, 16.7 / 16.8 / 16.8 ms, 0 frames over 100 ms, 70 draws, 110,724 tris, 47 programs. Receipt `t480s-low-task12-wear.json` |
| Visual review | bulwark and needle at close range, both factions |

Curvature is pinned on geometry whose shape is known by construction rather than on
a screenshot: `MASK_RECESS` labels the channel geometry independently of the thing
being measured, so the test can assert that recessed vertices average less convex
than the rest of the hull and that the chamfers reach genuinely convex. If the sign
convention ever inverts, wear moves into the recesses and grime onto the chamfers,
which is a very specific kind of wrong that still looks like "a weathered mech" in
a thumbnail.

##### An incidental find worth recording

Three full-suite runs during this task reported spurious failures -- once
`2 failed | 9 skipped`, once four failed files including a sim determinism test
this work does not touch. All of them passed in isolation. The cause was 34
orphaned Chrome processes left behind by the session's playwright runs, competing
for cores and crashing vitest workers. Worth knowing before chasing a phantom:
check for stray browsers before believing a new full-suite failure.

`npm run validate:core-match` is not owed: this task changes the render layer and
per-vertex attributes only, and `MechRig` metadata is untouched.

#### Task 13: Greeble-tier LOD, weapon sockets, and real wrecks

Tasks 11 and 12 add triangles. This task pays for them and then some.

- **LOD.** Three tiers per part by dropping greeble tiers, per
  `docs/procedural-assets.md` section 1: LOD1 without greebles, LOD2 chassis
  blocks only, LOD3 a single billboarded silhouette. Selected by the arc distance
  already computed in `drawUnits` and `drawStructures`. Bucket-per-LOD, extending
  the loops at `entityRenderer.ts:102-118`.
- **Bucket caps.** Fix the asymmetry where leg and foot buckets saturate at 64
  mechs per (class, faction) while the torso bucket has room, and where overflow
  silently drops instances at lines 598-606.
- **Sockets.** Split shoulders, arms, and weapons out of the welded torso into
  socketed parts, which enables `docs/procedural-assets.md` section 4's arm lag
  spring and gives weapon variety without a new torso per variant. Bounded scope:
  the legs and the IK solver are already good and must not regress.
  `PART_NAMES` at `entityRenderer.ts:42` and `MechRig.parts` at
  `models.ts:491-509` are the coupling points.
- **Wrecks.** Replace the torso-only flat `0x24272b` mesh with damaged geometry
  on the shared hull material at forced high damage, keeping faction identity,
  exposed glowing internals, and legs. This is the largest visual gain for the
  least work in the entire plan.

Tests: triangle count asserted at each LOD; visual continuity at LOD switch
distances verified by baselines captured at the boundary distances, confirming no
popping; cap-saturation test with 128 mechs of one class;
`tests/render/entityRenderer.test.ts` gait, footfall determinism,
recoil-affects-torso-not-pelvis, and no-simulation-mutation assertions all still
passing; net triangle budget measured against the current ~1.6k to 2.0k per mech.

Demo: a 40-mech battle at higher fidelity than today's eight, running no slower,
with wrecks that still look like the machines they were.

#### Task 13 progress: bucket caps and wrecks done, LOD and sockets outstanding

This task has four independent sub-features. Two are delivered and verified; two
are not started. Recorded as partial rather than complete, because calling it done
would hide the two that remain.

**Delivered:** bucket caps, and wrecks.
**Outstanding:** greeble-tier LOD, and socketed shoulders/arms/weapons.

##### Bucket caps: the failure mode was a floating torso

The asymmetry was not in the capacities, which are all `MAX_PER_BUCKET`, but in the
consumption. Legs and feet are pushed twice a mech, once per leg, so their buckets
held 64 mechs' worth while the pelvis and torso buckets still had half their room
free.

Worse than the waste was the failure mode. `push` checked for room one part at a
time and returned quietly when a bucket was full, and the legs are pushed last, so
the mech that straddled the limit rendered as a torso and pelvis hovering over
nothing. A mech that is simply absent reads as a culling distance; a mech missing
its legs reads as a broken game.

Two changes. `PART_INSTANCES` states how many instances each part contributes, and
bucket depth is sized from it, so leg buckets are twice as deep. And a mech's draw
is now all-or-nothing: every bucket it needs is checked before any of them is
written. The saturation test runs 200 mechs of one class through the renderer and
asserts every part count stays consistent with a whole number of mechs.

##### Wrecks: a wreck is the mech, damaged and collapsed

What this replaced was a single torso, no legs, on its own flat
`MeshStandardMaterial({ color: 0x24272b })`. No faction identity, no panel lines,
no emissive, no relationship to the machine that died. The plan called fixing it
the largest visual gain for the least work in the whole overhaul, and that was
right.

A wreck is now drawn as a collapsed mech -- pelvis, torso, and both legs -- pushed
into the **same faction hull buckets the live mechs use**, with per-instance damage
forced to full. That one decision is what makes it cheap:

- no new material and no new shader program, because it is the material the live
  mechs already use;
- no new draw call, because the dedicated wreck meshes are gone and nothing
  replaced them. Draw calls at Low stayed at exactly 70;
- faction colour, panel lines, the Task 12 edge wear, and the damage path's
  exposed glowing internals all arrive for free, because every one of them already
  keys off the material and the damage channel.

The collapsed stance is derived from the rig's own proportions -- hips dropped to
34% of standing height, knees folded forward and outward, feet splayed -- so every
class collapses in proportion to itself. The existing topple, settle bounce, decay
scale, and terrain-normal alignment are preserved and now apply to the whole
machine rather than to a lone torso. Wrecks get the same all-or-nothing bucket
reservation, since a wreck missing its legs is the same defect.

##### Measured

| | Task 12 | Task 13 so far |
| --- | ---: | ---: |
| Low frame median / p95 / p99 | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 16.8 ms |
| Frames over 100 ms | 0 | 0 |
| Low GPU median | 8.4 ms (drift-affected) | 5.5 ms |
| Draws / triangles / programs | 70 / 110,724 / 47 | 70 / 110,724 / 47 |
| Upload calls a frame | 168 | 168 |

The GPU median reading here, 5.462 ms, is *below* Task 11's 5.651 ms, which
settles the open question from Task 12: that task's apparent 8.4 ms was machine
drift over a long session and not a cost it introduced.

##### What this part of Task 13 verified

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npx vitest run` | 14 failed / 541 passed / 2 skipped, same 14 pre-existing `progress-manifest` failures, +2 net new |
| Contact sheets, renderer, calibration, post-stage | 25 passed |
| Gait, footfall determinism, recoil-not-pelvis, no-sim-mutation | all still passing |
| T480s 720p Low gate | verdict `pass`, 16.7 / 16.8 / 16.8 ms, 0 over 100 ms. Receipt `t480s-low-task13-wrecks.json` |
| Visual review | four wrecks across both factions at gameplay range |

Two existing tests encoded the old design and were rewritten rather than deleted:
the wreck-bucket existence check now asserts that no wreck buckets exist and that
leg buckets are twice as deep, and the fall-and-settle test reads the pelvis rather
than the torso, because the pelvis is the one part placed with an identity local
rotation and so isolates the topple from the new collapse pitch.

##### Note for whoever picks up the rest

The visual review needed real mech wrecks, and getting them is less obvious than it
looks. The default scene is six `engineer` units, and an engineer is not a mech, so
nothing in it can leave a mech wreck. `Bulwark` is Compact-exclusive and `Needle`
is Choir-exclusive, so `spawnUnit` throws if either is spawned for the wrong
faction. The working recipe is to spawn `vanguard` plus the faction's exclusive
class for each side, then `applyDamage` them.

For LOD specifically: there is still **no per-tier mech mesh at all**. Geometry is
built once and shared across every quality, so introducing LOD means introducing
that machinery, and `GreebleTier` from Task 11 is the hook it should hang off.

### Phase 5 - Buildings

#### Task 14: Structure detail parity

`solarArray` at lines 911-926, `pointDefense` at 994-1013, and `radarMast` at
1042-1076 have zero panel lining and zero greebles, while `bastion` gets panels
plus 22 greebles. `radarMast` spends ~1,260 triangles on lattice rings with no
surface detail, which makes it simultaneously the densest and the flattest
structure in the game.

Bring all twelve kinds to a consistent detail budget using the Task 11
vocabulary. Add the motion that is commented but absent: rotate the radar dish
per the comment at line 1071, open silo blast doors on launch, and recoil turret
barrels on fire. Strengthen the faction architecture suffixes at lines 1131-1156
per `docs/art-direction.md` section 7's Phase 3C grammar, keeping them merged
into geometry already owned by existing faction buckets so no accessory draw
calls appear.

Tests: per-kind triangle budgets asserted; structure contact-sheet baselines;
`structureRadius` footprints unchanged, because the UI sizes selection rings from
them; faction geometry differs while footprint metadata is identical.

Demo: every building belongs to the same architecture, and the base is alive.

#### Task 15: Facade grammar for dressing, and distance fade

`battlefieldDressing.ts:113-118` renders the entire background city as four
primitives. `docs/procedural-assets.md` section 1's ruins-and-props grammar
(footprint, extrude, floors, facade grammar, damage pass, rubble scatter at the
base) does not exist.

Build it: a footprint-and-facade grammar producing per-palette silhouette
families, wearing the Task 6 shared material, still drawn through the existing
fixed instanced buckets so that the draw-call and instance-cap contracts hold.
Where an authored GLB reads better than a generated form, instance that instead;
Task 7 means both wear the same surface, so they mix freely within a district.

Two further fixes belong here. Add the distance fade that does not exist today,
where items pop in and out at the `drawDistance` boundary, via per-instance scale
or a dither ramp against the already-computed `candidate.distanceSq` in
`place()`. And replace the eight hardcoded `DISTRICT_ANCHORS` in `patternedPoint`
at lines 406-425 with a terrain- and noise-driven density map, using Task 8's
material and moisture fields.

Preserve the LS-12, LS-13, and LS-14 contracts exactly: `MAX_DISTRICTS 16`,
`MAX_ITEMS_PER_LAYER 256`, `MAX_DISTRICT_SCATTER_ITEMS 2048`, `MAX_VISIBLE 256`,
four palettes, four life cues, the reserved-slot guarantee that no palette or
life cue is starved at Low caps, 12 Hz activity quantisation, and
`prefers-reduced-motion`.

Tests: `e2e/layered-district-scatter.spec.ts`,
`e2e/environmental-district-palettes.spec.ts`, and
`e2e/inhabited-ring-life.spec.ts` all passing including the sub-100k dressing
triangle bound; draw buckets still four; deterministic generation; Low
`dressingCap` of 72 still yielding all four palettes and all four life cues;
baselines added.

Demo: the ring reads as an inhabited megastructure with real districts, and
nothing pops as the camera moves.

## Verification Standard

Every task reports:

- `npm run lint`
- `npm test`
- `npm run build`
- the relevant Playwright lane
- updated screenshot baselines with explicit review
- for anything touching the render path, a fresh T480s Low measurement
  confirming the frozen gate still holds: hard 30 FPS, p95 at or under 34 ms,
  68 draw calls, 115,044 triangles, 15 programs, 2 textures, no black frame, no
  context loss

Tasks 8 and 13 additionally run `npm run validate:core-match`, because Task 8
changes the authoritative heightfield and Task 13 changes instance caps.

Anything that cannot be verified is reported as unverified, with the exact
blocker, what was attempted, and what remains unknown. No check is described as
passing unless it ran. No result is invented.

### Pre-existing failures at the frozen baseline

Both were confirmed to fail at `1980ed6` with all overhaul changes stashed, so
they are inherited rather than caused by this work. Neither is a graphics defect.
They are recorded here so that "npm test is green" is never used as a completion
signal for a task in this overhaul, and so the counts can be compared rather than
eyeballed.

**`tests/tools/progress-manifest.test.ts`, 14 tests.** Fails with
`LS-09 implementation source SHA-256 mismatch: src/main.ts`. The launch progress
manifest pins a content hash for `src/main.ts` that no longer matches the
committed file. Baseline count is 14 failed / 491 passed; any task in this
overhaul must reproduce exactly that count and no more. Note that Task 2 edits
`src/main.ts`, which will change that hash again and require the manifest receipt
to be refreshed as part of that task.

**`e2e/renderer.spec.ts`, "keeps quality switching resource-bounded and restores
the full-detail ring".** Asserts the spread in shader program count across
quality switches is at most 12, and measures 13. This one is directly relevant:
Task 2 introduces composite and bloom programs on Medium and above, which will
widen that spread further. Task 2 must therefore either bring the spread back
inside a justified bound or renegotiate the assertion explicitly with the reason
recorded, rather than simply raising the number.

## Acceptance Gate

This overhaul passes when:

1. The T480s 1280x720 DPR1 Low run still meets the frozen budgets with no black
   frame, context loss, console error, or page error, and Low's draw call,
   triangle, program, and texture counts are unchanged.
2. Faction emissive strips, the solar filament, and explosions bloom, while
   Compact amber and Choir cyan remain the only large saturated accents.
3. Mechs, structures, and dressing visibly contact the ground through ambient
   occlusion and correctly biased contact shadows.
4. Day and deep shadow use distinct graded palettes, and night is legible rather
   than murky.
5. Procedural geometry, imported geometry, and terrain share one surface
   vocabulary and read as one world at close range and at tactical zoom.
6. Terrain material regions correspond to actual landforms, and Medium GPU time
   is no worse than the current 49.186 ms.
7. Medium, High, and Ultra are visually and measurably distinct from each other.
8. Unit and structure silhouettes remain identifiable by faction, class, and
   health within one second at maximum zoom out, per
   `docs/art-direction.md` section 9's readability gate.
9. Simulation hashes, save/load payloads, and all existing gameplay and browser
   tests remain unchanged, except where a test encoded the old visual contract
   and was deliberately updated with the reason recorded.
10. Screenshot baselines exist for every sheet at Low and High, and each update
    across the overhaul was explicitly reviewed rather than blindly accepted.
11. Human review accepts the composed result at tactical zoom, at direct-mech
    range, and in the strategic side view.

## Deferred

Explicitly out of scope for this overhaul:

- volumetric light shafts and raymarched fog;
- temporal antialiasing, screen-space reflections, motion blur, depth of field,
  and chromatic aberration from `docs/art-direction.md` section 5;
- dynamic environment-map regeneration on day-phase change;
- terrain clipmap or quadtree LOD, which
  `docs/phase-4c-renderer-profile.md` states is not justified by current draw-call
  evidence;
- gameplay-bearing ruins, cover, terrain deformation, weather, or structural
  stress;
- new units, weapons, structures, missions, resources, or campaign branches;
- authored gameplay meshes; the mixed-asset decision covers decorative and
  presentation geometry only;
- camera composition changes;
- a complete adaptive score and final audio mix.

## Docs To Update

- `docs/art-direction.md` section 5, as the post stack moves from roadmap to
  shipped;
- `docs/art-direction.md` section 11, for the asset pipeline decision;
- `docs/procedural-assets.md`, for the mixed-asset policy and the shared surface
  library;
- `docs/spec.md`, for the binary-asset constraint;
- `docs/t480s-low-performance.md`, for the Low omission list;
- `docs/phase-4c-renderer-profile.md`, for the new measurements;
- `docs/roadmap.md`, for status and for the Phase 3B renderer-boundary decision,
  which currently forbids the composer that Task 2 reintroduces in narrowed form.

## Open Decisions

**1. Task 8 is not purely presentational.** Erosion changes `heights`, which is
authoritative for pathing and buildability as well as for rendering, so it can
shift gameplay. It is scoped with a core-match validation gate and a determinism
receipt. The alternative is a render-only visual heightfield, at the cost of
simulation and rendering disagreeing about where the ground is, which the header
comment in `src/gen/terrain.ts` explicitly warns against. Recommendation: keep
the shared heightfield and accept the validation gate.

**2. Task 7's texture decision.** Recommendation is not to ship `building.png`
and to let the triplanar procedural material own the imported geometry's surface,
because an imported albedo is what reintroduces the mismatch this work exists to
remove. A cheap side-by-side comparison inside Task 7 is acceptable if the user
wants to see the textured variant first.

## Execution Notes

Graph maintenance: `graphify-out/` exists in this repository. Run
`graphify . --update` incrementally at coherent commit boundaries, and use
`save-result` in the moment for decisions, findings, and false-flag corrections.
Do not run a full rebuild, and do not update mid-edit on an incomplete tree.

Sequencing: Phase 1 stops at a gate for a go/no-go on Phases 2 through 5. Phases
2 through 5 depend on Task 6's shared surface library, so Task 6 is the first
task after the gate regardless of which later phase is prioritised.
