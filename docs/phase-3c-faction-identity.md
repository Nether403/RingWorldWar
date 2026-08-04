# Phase 3C - Faction and Structure Identity

**Status:** In progress.

**Frozen baseline:** `0178d61`

## Goal

Make faction readable before color is consciously processed. Compact and Choir
forces must retain clear class identity while expressing different industrial
languages in silhouette, surface response, and damage. Phase 3C remains a
presentation-only production slice.

## Visual Languages

### Meridian Compact

- Broad, layered, angular armor.
- External buttresses, shoulder plates, armored brows, and grounded mass.
- Warmer dark metal, higher roughness, and blunt structural repetition.

### Axiom Choir

- Narrow composite shells, vertical sensor fins, and asymmetric spines.
- Cleaner cool metal response and concentrated emissive sensing surfaces.
- Taller negative-space rhythms without changing authoritative dimensions.

### Neutral Spinal infrastructure

- Retains its monumental inherited geometry and neutral material treatment.
- It must not inherit either contemporary faction grammar.

## Scope

### Mechs

- Generate faction-specific merged torso details for shared mech classes.
- Keep class profiles, standing heights, joint lengths, muzzles, and render
  metadata identical between faction variants.
- Keep Bulwark and Needle recognizable as the strongest exclusive expressions
  of their existing faction language.
- Use existing `(class, part, faction)` buckets; no accessory draw calls.

### Structures

- Generate Compact and Choir geometry variants inside existing
  `(kind, faction)` buckets.
- Keep simulation radius, height, placement, targeting, and muzzle metadata
  identical between variants.
- Preserve one draw per visible structure kind/faction bucket.

### Damage surfaces

- Add a per-instance damage attribute to existing hull geometry.
- Derive damage only from authoritative `hp / maxHp` each frame.
- Drive grime, roughness, emissive instability, and exposed internal glow
  independently for every live mech and structure.
- Keep existing critical-damage pose and overhead warning markers.
- Clear and rebuild the attribute every frame; it is render state, not saved
  authority.

## Hard Boundaries

Phase 3C must not change:

- unit or structure statistics, radii, heights, costs, build times, or command;
- movement, projectiles, weapons, abilities, AI, targeting, or ballistics;
- collision, navigation, LOS, buildability, selection authority, or victory;
- world/mission snapshot schemas or deterministic state hashes;
- draw-bucket topology or shader-program count;
- the procedural-only asset policy.

## Acceptance Gate

1. Shared Compact and Choir mech classes have distinct deterministic torso
   geometry while retaining identical rig metadata.
2. Compact and Choir structures have distinct deterministic geometry while
   retaining identical gameplay metadata.
3. Neutral Spinal Nodes remain faction-neutral.
4. Faction surface treatment remains desaturated enough that amber and cyan
   emissives stay the principal color accents.
5. Damage is independently visible on multiple same-faction instances sharing a
   material and bucket.
6. Cloaked Wisp and Needle instances use the same faction and damage channels.
7. No simulation hash changes after rendering or quality switching.
8. Draw calls and shader programs do not increase in equivalent scenarios.
9. Unit, browser, lint, build, signature, and T480s gates pass.
10. Human tactical-zoom review identifies faction, class, and critical damage
    within one second without coaching.

## Deferred

- New units, structures, weapons, or abilities.
- Authored models, textures, animation, or sampled audio.
- LOD generation or billboard impostors.
- Gameplay hit-location damage and detachable armor.
- Structure animation and destruction staging.
