# Phase 3A - Signature Battlefield

**Status:** In progress.

**Frozen baseline:** `a67ef7473a96da4e4c95bca36c8d4bcfc65412a5`

## Goal

Make the accepted game feel physically present without changing how it plays.
Phase 3A produces the signature battlefield from `docs/art-direction.md` as
normal gameplay: a readable mech lance on a ruined ring surface, active fire and
persistent artillery contrails, the ring rising into the sky, and shadow squares
crossing its far side.

## Production Slice

### Mech weight

- Smooth the existing procedural gait between fixed simulation ticks.
- Add render-only recoil, hydraulic settle, close-range footfall dust, and a
  deterministic low-health limp.
- Preserve authoritative positions, movement speeds, aiming, damage, and firing.

### Combat atmosphere

- Keep particles, lights, trails, and shockwaves in bounded shared pools.
- Make major explosions win scarce Low-quality light slots over muzzle flashes.
- Avoid submitting unused particle, tracer, and trail vertices.
- Preserve contrails in ring coordinates across floating-origin rebases.

### Procedural audio

- Generate combat and ambient sound through WebAudio; no sampled audio files.
- Create or resume the audio graph only after a trusted user gesture.
- Reuse the authoritative presentation-event stream without draining simulation
  events a second time.
- Apply the same fog-of-war eligibility policy to audio and visual effects so
  hidden enemy activity never leaks through sound.
- Connect the existing persisted master-volume setting to the live audio graph.

### Signature composition

- Advance `signature-lance` into the deterministic Phase 3A presentation scene.
- Show both faction colors, multiple readable mech silhouettes, the ring vista,
  shadow squares, combat effects, and a gameplay-generated artillery trail.
- Keep the screenshot generated and ignored; track signatures, hashes, renderer
  identity, and receipts as evidence.

## Hard Boundaries

Phase 3A must not change:

- unit or structure statistics;
- movement or projectile speeds;
- economy, power, production, capture, or victory rules;
- weapons, abilities, targeting, AI, navigation, visibility, or ballistics;
- world snapshots, mission snapshots, or deterministic state hashes.

All new motion, particles, sound, and dressing are presentation-only. They must
not consume simulation RNG or mutate simulation state.

The procedural-only asset rule remains active. Allowed sources are TypeScript,
GLSL, CSS, generated geometry, generated textures, SVG, and WebAudio graphs.
Authored binary models, textures, LUTs, samples, and committed screenshots remain
out of scope.

## Acceptance Gate

Phase 3A passes when:

1. The signature frame is captured from the normal renderer and normal gameplay,
   not a separate staged rendering path.
2. The ring rises visibly on both sides, with a readable far band and shadow
   squares.
3. Compact and Choir faction, unit class, health, and active ability state remain
   readable at tactical zoom.
4. Bulwark movement reads as heavy and Needle movement reads as predatory without
   changing either unit's statistics.
5. Rockets, impacts, interception, and major deaths have distinct procedural
   visual and audio signatures.
6. Hidden hostile presentation events produce neither effects nor audio.
7. Save/load clears transient presentation state and does not replay stale sound.
8. Unit, browser, lint, build, determinism, visual, and T480s Low gates pass.
9. The T480s 1280x720 DPR1 Low run keeps the accepted frame budgets, has no black
   frame or context loss, and records current source provenance.
10. A human playthrough confirms that the added presentation improves weight,
    readability, and atmosphere without obscuring commands or narrative.

## Deferred

- Post-processing and volumetric render passes.
- Authored Blender/glTF assets or sampled audio.
- Gameplay-bearing ruins, cover, terrain deformation, or structural stress.
- New units, weapons, missions, resources, and campaign branches.
- A complete adaptive score and final mix.
