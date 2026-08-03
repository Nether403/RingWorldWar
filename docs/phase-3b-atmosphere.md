# Phase 3B - Ring Atmosphere and Calibration

**Status:** In progress.

**Frozen baseline:** `f599edfb358832d84a795d05f846520be7e34354`

## Goal

Make the ring read as an enclosed world rather than a curved battlefield. Phase
3B adds environmental value structure around the real ring geometry: near-black
axial space, a day/night horizon haze matched to distance fog, readable far-side
terrain and shadow squares, and a production calibration scene for every shared
PBR decision.

## Scope

### Analytic atmosphere

- Add one camera-centered procedural sky dome to the normal forward render pass.
- Keep open axial space dark while concentrating desaturated color at the
  horizon.
- Drive atmosphere colors and fog density from the existing `DayCycle`.
- Match the atmosphere horizon color to the terrain fog endpoint.
- Preserve stars, filament, real ring geometry, and normal depth ordering.

### PBR calibration

- Add `/dev/calibration` without introducing a router or second renderer stack.
- Reuse the production `Renderer`, `Environment`, ACES exposure, output color
  space, generated IBL, and hull material.
- Include chrome and grey reference balls, roughness and metalness sweeps, a
  generated 24-patch color chart, environment material swatches, and a Compact
  reference mech.
- Keep the scene deterministic, static, and independently inspectable.

### Environmental quality budgets

- Use the analytic atmosphere on Medium through Ultra. Low retains the same
  dynamic fog and dark-space palette through a zero-draw clear-color fallback.
- Add no texture, render target, post-processing pass, or runtime raymarch.
- Bound the atmosphere to one draw call, one geometry, and one shader program.
- Give procedural battlefield dressing explicit quality-dependent distance,
  instance, and shadow budgets.
- Normalize render-side shadow-square depth so Low, full terrain, units, and
  environmental lighting remain readable through the same transition.

## Hard Boundaries

Phase 3B must not change:

- terrain height data or generation;
- collision, navigation, LOS, cover, salvage, or buildability;
- economy, solar production, simulation daylight, or shadow timing;
- unit, structure, weapon, ability, AI, ballistics, or victory behavior;
- camera pitch/FOV curves or the accepted signature composition;
- world snapshots, mission snapshots, or deterministic state hashes.

The stable direct renderer remains mandatory. Phase 3B adds no composer,
offscreen atmosphere buffer, bloom, volumetric raymarch, LUT, TAA, SSAO, SSR,
or dynamic PMREM rebuild.

## Acceptance Gate

1. At the unchanged `signature-lance` camera, open space, horizon haze, and real
   ring terrain are visually distinct.
2. The ring still rises on both sides; the far band and shadow-square bars remain
   identifiable.
3. Daylight and deep shadow use distinct but readable palettes.
4. Compact amber and Choir cyan remain the dominant saturated colors.
5. Units, health, orders, artillery ribbons, and combat effects remain readable.
6. Stars remain behind real geometry and visible through open space.
7. `/dev/calibration` uses the production renderer and contains every required
   reference without external assets.
8. Atmosphere resources remain stable across quality switches and repeated
   frames; Low adds no atmosphere draw call.
9. Simulation hashes and all existing gameplay/browser tests remain unchanged.
10. T480s 1280x720 DPR1 Low passes current frame budgets with no black frame,
    context loss, console error, or page error.
11. Human review accepts both the signature battlefield and calibration frame.

## Deferred

- Volumetric shafts and raymarched fog.
- Bloom, grading LUTs, SSR, SSAO, TAA, and other post-processing.
- Dynamic environment-map regeneration.
- Camera composition changes.
- Authoritative terrain continuity or material-wrap changes.
- Gameplay-bearing ruins, weather, structural stress, or terrain deformation.
