# LS-13 Four Reusable Environmental District Palettes

**Status:** Complete  
**Slice:** LS-13  
**Milestone:** 3 - Inhabited ring

## Player Outcome

The ring no longer reads as one repeated ruin field. Arc-City Habitat,
Agricultural Canopy, Spinal/Industrial Corridor, and Breach/Evacuation districts
have distinct color, silhouette, and spatial rhythms at tactical camera height,
while the qualified LS-12 density, readability, and performance boundaries remain
intact.

## Bounded Contract

- The renderer-owned district plan declares exactly four stable palette IDs:
  `arc-city`, `agricultural`, `spinal-industrial`, and `breach-evacuation`.
- Each palette owns four named silhouettes across the qualified overhead,
  tactical, and micro scales. A strict parser rejects unknown palettes,
  silhouettes used by the wrong palette, and unbounded plans.
- The production plan uses every palette in two authored ring districts. Reuse
  changes location and seeded transforms, not the palette contract.
- Palette identity is expressed through authored dimensions, layout patterns,
  silhouette names, and per-instance colors. The existing four instanced geometry
  buckets remain the complete draw topology.
- Low quality preserves an overhead or tactical palette silhouette and palette
  color wherever a district is visible. Higher qualities add bounded detail under
  the existing global distance, instance, and shadow caps.
- Palettes remain presentation-only. They do not enter collision, cover, LOS,
  navigation, buildability, salvage, AI, economy, ballistics, saves, strategic
  intelligence, terrain authority, or the whole-ring strategic scene.

## Acceptance Criteria

1. **Strict palette contract:** all four exact palettes and their owned silhouette
   sets parse; unknown palettes and cross-palette silhouettes fail closed.
2. **Reusable authored coverage:** the production plan contains two districts per
   palette and all three density scales without exceeding LS-12 bounds.
3. **Deterministic identity:** identical seeds and plans produce identical palette,
   silhouette, transform, and color output.
4. **Fixed render topology:** all four palettes render through exactly four named
   instanced buckets with stable per-instance colors and existing quality caps.
5. **Low readability:** production 1280x720 Low retains visible overhead and
   tactical identity, a clean console, and the accepted draw/triangle envelope.
6. **Authority and lifecycle:** quality cycling, updates, recovery, and disposal
   remain resource-bounded and preserve authoritative world and terrain state.
7. **Regression and review:** focused unit/browser lanes, full check, core match,
   and an independent presentation review pass the bounded execution policy.

## Deliberate Exclusions

- No vegetation animation, transit traffic, ambient life, habitation simulation,
  or milestone-wide closure of G-05; those remain LS-14.
- No collision, cover, LOS, salvage, destructibility, terrain deformation, or
  authored gameplay landmark authority.
- No additional draw buckets, binary art pipeline, runtime-scenario/save schema
  change, post-processing, render target, volumetric, or environment-map work.

## Qualification

LS-13 requires focused district/render unit tests, a production browser lane at
1280x720 Low, `npm run check`, the protected core-match lane, and an independent
systems/presentation review. No new player-comprehension cohort is required.
