# First Contact Completion - 2026-08-02

## Result

The internal tester reported completing `npm run rww -- play first-contact` and
rated the experience A+ overall.

The qualitative findings below are retained from that direct tester report. The
CLI receipt proves the scenario ran, but there is no independent recording or
telemetry proving the tester's interpretation, pacing, or rating.

## Comprehension

- The underlying ring-physics math felt complicated, but the resulting gameplay
  became easy to understand after seeing it once.
- The slower pace did not create confusion.
- Watching the mortar use the ring's rotation and gravity was described as
  refreshingly original.
- The Wisp-to-node-to-artillery sequence was easy to understand.
- No gameplay bugs or faulty mechanics were found during the completed run.

This closes the first internal First Contact comprehension pass. It does not
replace the broader multi-player cohort or establish final pacing and copy.

## Presentation Findings

Three Low-quality presentation problems were reported:

1. Extractor placement was difficult because salvage deposits had no visible
   world-space representation and only tiny minimap dots.
2. The background offered no inertial motion cue, so the ring's rotation was not
   perceptible.
3. Procedural building faces were wound inward, making structures look like
   hollow shells under front-face culling.

## Retained Corrections

- Extractor placement now highlights every available deposit with pooled amber
  world rings, a centre cross, and enlarged minimap markers matching the
  authoritative placement radius.
- The starfield is now an inertial reference that counter-rotates at the physical
  ring rate and renders at far depth without increasing Low's draw distance.
- Procedural hull triangle winding and normals now face outward centrally for
  structures, mechs, engineers, and wreck geometry.

These corrections do not add draw calls or triangles to the Low-quality hull and
sky paths. Deposit guidance reuses the existing marker pool.
