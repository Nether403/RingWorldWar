# Phase 3D - Battlefield Memory and Strategic Destruction

**Status:** In progress.

**Frozen baseline:** `31de325eaa637418f73688499a0af35de87c7345`

## Goal

Make an observed battle leave bounded visual history. Recent fighting should be
legible from scars, smoke, debris, settling wrecks, and a unique Chord sequence,
without creating terrain or intelligence authority.

## Scope

- One preallocated terrain-conforming scar draw for impact and death sites.
- One preallocated instanced debris draw for cosmetic fragments.
- Bounded smoke emitters that reuse the existing particle pool.
- Wreck fall/settle derived from authoritative wreck lifetime.
- Chord launch/impact classification from existing `weapon` event data.
- Distinct procedural Chord audio and higher-value light/scar priority.
- Quality-specific caps allocated once and changed without resource growth.

## Boundaries

- No terrain deformation, collision, navigation, LOS, cover, buildability, or salvage.
- No saved battlefield history; load/reset clears transient aftermath.
- No simulation event, projectile, snapshot, weapon, AI, or damage changes.
- Hidden hostile events create no aftermath.
- No per-scar/debris mesh, material, timer, listener, or draw call.
- Low retains an intentional bounded version and must pass T480s.

## Gate

1. Scars remain terrain-conforming across ring wrap and floating-origin rebases.
2. Pools never exceed quality caps and evict lower-priority history first.
3. Persistent smoke cannot starve immediate combat effects.
4. Wrecks fall and settle without changing authoritative wreck state.
5. Chord launch and impact are distinct from ordinary artillery.
6. Save/load clears all transient aftermath.
7. Rendering and aging leave world hashes unchanged.
8. `battlefield-aftermath` clearly shows where heavy fighting occurred.
9. Unit/browser/build/T480s gates pass.
