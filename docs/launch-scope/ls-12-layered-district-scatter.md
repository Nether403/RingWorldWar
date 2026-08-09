# LS-12 Layered District And Bounded Scatter Foundation

**Status:** Active bounded contract  
**Slice:** LS-12  
**Milestone:** 3 - Inhabited ring

## Player Outcome

The tactical battlefield reads as deliberately inhabited rather than as a
uniform ruin field. Authored districts combine overhead landmarks, tactical
silhouettes, and bounded micro-detail while preserving unit, terrain, command,
and artillery readability on the 1280x720 Low target.

## Bounded Contract

- A strict renderer-owned district plan declares stable district IDs, wrapped
  ring extents, axial bounds, exclusions, and ordered scatter layers.
- Scatter layers use the three roadmap scales: `overhead`, `tactical`, and
  `micro`. This slice proves the reusable composition system with a neutral
  foundation plan; the four environmental palettes remain LS-13.
- Generation is deterministic for the same plan and world seed. All generated
  items remain inside their authored district and outside authored exclusions.
- Placement uses canonical wrapped ring distance, authoritative terrain height,
  and a per-layer slope ceiling. It never changes terrain or simulation state.
- Four fixed instanced render buckets bound draw topology. Quality profiles keep
  explicit global distance, instance, and shadow budgets; scarce capacity favors
  overhead and tactical readability before micro-detail.
- District resources participate in existing quality switching, floating-origin
  rebasing, shader prewarm, WebGL recovery, and session disposal.
- District scatter remains presentation-only. It does not enter collision,
  cover, LOS, navigation, buildability, salvage, AI, economy, ballistics, saves,
  strategic intelligence, or the whole-ring strategic scene.

## Acceptance Criteria

1. **Authored layer contract:** strict bounded plans declare stable districts,
   exclusions, and all three density scales without consuming LS-13 palettes.
2. **Deterministic bounded scatter:** identical seed and plan produce identical
   items and transforms; counts and draw buckets have hard ceilings.
3. **Ring and terrain placement:** seam-crossing districts and exclusions are
   correct, steep candidates are rejected, and accepted items use terrain height.
4. **Presentation authority:** generation, quality changes, updates, and disposal
   do not mutate terrain or authoritative simulation state.
5. **Quality and readability:** Low retains authored landmark/tactical identity;
   higher profiles add bounded detail while preserving exact global caps.
6. **Lifecycle and regression:** disposal releases each owned render resource,
   repeated updates remain bounded, full check and core match pass, and existing
   tactical and whole-ring behavior remains intact.
7. **Presentation acceptance:** an independent review scores the representative
   1280x720 Low result at least 3 for layering, tactical readability, and support.

## Deliberate Exclusions

- No four-palette completion, vegetation system, city grammar, transit network,
  ambient life, or milestone-wide closure of G-05.
- No collision, cover, LOS, salvage, destructibility, terrain deformation, or
  authored gameplay landmark authority.
- No runtime-scenario or save schema change, binary gameplay asset pipeline,
  post-processing, render target, volumetric, or dynamic environment-map work.

## Qualification

LS-12 requires focused district/render unit tests, a production browser lane,
`npm run check`, the core-match lane, and an independent systems/presentation
review. The accepted T480s 720p Low contract remains a regression boundary; this
foundation slice does not require a new player-comprehension cohort.
