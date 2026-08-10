# LS-14 Habitation, Vegetation, Transit, And Ambient Life

**Status:** Complete  
**Slice:** LS-14  
**Milestone:** 3 - Inhabited ring

## Player Outcome

The battlefield reads as part of a working habitat rather than an isolated ruin
field. Occupied structures, engineered canopy forms, active transit
infrastructure, and bounded maintenance activity remain legible on Low, while a
ring-wide habitation/vegetation corridor prevents empty tactical regions between
the authored palette districts.

## Bounded Contract

- The renderer-owned district plan declares exactly four stable life cues:
  `habitation`, `vegetation`, `transit`, and `ambient`.
- Every active district silhouette owns one compatible cue; ruined, abandoned,
  exposed, and seal-wall silhouettes are explicitly static. The strict parser
  rejects unknown cues and cue/silhouette mismatches.
- The eight LS-13 districts keep their palette, silhouette, density, exclusion,
  and terrain-placement rules. Sixty-four bounded corridor cells, placed at 16
  longitudinal stations and four axial lanes, add only habitation or vegetation
  landmarks so every playable ring position has one within Low draw distance.
- Life remains deterministic for the same plan, seed, anchor, and presentation time.
  Vegetation receives bounded sway; occupied, transit, and ambient silhouettes
  receive bounded color activity without changing authored position, terrain
  height, slope qualification, or exclusions.
- Visibility selection remains anchor/quality-driven. Visual activity updates at
  a 12 Hz presentation clock and rewrites only already-selected instance matrices
  and colors.
- All cues share the existing four named instanced geometry buckets and existing
  distance, instance, shadow, draw, and triangle budgets.
- Runtime changes to `prefers-reduced-motion` freeze visual activity and are
  released with the session lifecycle.
- Life is presentation-only. It does not enter simulation entities, collision,
  cover, LOS, navigation, buildability, salvage, AI, economy, ballistics, saves,
  strategic intelligence, or the whole-ring strategic scene.

## Acceptance Criteria

1. **Strict cue grammar:** all four exact cues parse only on compatible authored
   silhouettes; unknown and mismatched cues fail closed.
2. **Ring-wide inhabited coverage:** the bounded corridor cell grid leaves every
   playable ring/axial sample within 1,000 m of a habitation or vegetation
   landmark and Low selects one throughout the ring.
3. **Deterministic bounded activity:** identical inputs reproduce cue identity,
   phase, matrices, and colors; changed presentation time changes activity without
   changing authored items.
4. **Placement and authority:** activity never moves authored positions, bypasses
   slope/exclusion qualification, or mutates terrain or world state.
5. **Fixed topology and Low readability:** production 1280x720 Low keeps all four
   cues in the authored battlefield, uses exactly four buckets, stays below the
   accepted instance/triangle envelope, and retains a clean console.
6. **Accessibility and lifecycle:** live reduced-motion changes freeze matrices
   and colors; sustained updates keep GPU resources, world hash, and context
   stable.
7. **Regression and review:** focused unit/browser lanes, full check, protected
   core match, and independent systems/presentation review pass the bounded
   execution policy.

## Deliberate Exclusions

- No simulated citizens, animals, traffic agents, schedules, needs, or population
  state.
- No collision, cover, LOS, salvage, destructibility, terrain deformation, or
  authored gameplay landmark authority.
- No additional draw buckets, binary art pipeline, runtime-scenario/save schema
  change, post-processing, render target, volumetric, or environment-map work.
- Further primitive-art refinement is optional polish unless a cue loses the
  qualified Low readability or ring-wide coverage boundary.

## Qualification

LS-14 requires focused district/render unit tests, a production 1280x720 Low
browser lane including sustained activity and reduced motion, `npm run check`,
the protected core-match lane, and one independent systems/presentation review.
No new player-comprehension cohort is required. Passing the coverage criterion
also closes G-05 for the current battlefield renderer contract.
