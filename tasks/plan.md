# Ring World War — Development Plan

Companion documents: `docs/spec.md` (contract), `docs/game-design.md` (what), `docs/art-direction.md` (how it looks), `docs/architecture.md` (how it's built).

## Sequencing Principle
**Front-load the risks that can invalidate the whole project.** The three things that could kill Ring World War are ring-scale precision, "everything is visible" rendering cost, and Coriolis being confusing rather than fun. All three are answered in Phases 0–1, before a single production art asset is made. Polish is cheap to add to a working game and impossible to add to a broken foundation.

Each phase ends at a **gate**: a demonstrable artifact plus a go/no-go decision. Do not start the next phase until the gate is met.

---

## Phase 0 — Foundations & Risk Kill (≈2 weeks)
**Goal:** prove the ring is technically viable before building a game on it.

- Repo scaffold: Vite + TS strict, ESLint (incl. the `no-Math.random-in-sim` rule), Vitest, Playwright, CI running typecheck/lint/test.
- `core/ringMath.ts`: ring↔surface↔render conversions, `deltaS` wrapping, curvature drop, orientation basis. Fully unit-tested — this module is the spine of the project.
- `core/rng.ts` + `core/detMath.ts` with determinism tests.
- **Spike A — Precision:** floating-origin camera flying the full 3,770 km circumference. Success = zero jitter, zero z-fighting, geometry visibly curving up into the sky.
- **Spike B — Ballistics:** a debug scene firing projectiles spinward/antispinward with trajectory ribbons. Success = the Coriolis asymmetry is *visible and legible* without explanation.
- **Spike C — Far ring shell:** whole ring drawn at interactive framerate. Success = < 3 ms for the far tier.

**Gate 0:** all three spikes green, ring math test suite passing. If precision or the far-ring cost fails here, revisit ring radius before anything else exists.

---

## Phase 1 — Playable Core Loop (≈6 weeks)
**Goal:** ugly but genuinely playable. Programmer art only — cubes, capsules, flat colors.

- ECS world + fixed-timestep sim loop + render interpolation; sim moved into its worker.
- Terrain: heightfield → clipmap LOD on the ring; navgrid + flow-field pathfinding with wrap.
- Economy: Salvage extraction, Energy generation/upkeep, Command Points from Spinal Nodes.
- Structures: Bastion, Extractor, Solar Array, Fabricator, Mech Foundry, Rocket Battery.
- Units: one support unit + the four mechs (as capsules) with real stats.
- Combat: targeting, LOS, damage/armor, death; fog of war.
- **Rockets end-to-end:** launch → rotating-frame flight → predicted trajectory UI → impact → damage. Point defense interception.
- **Direct mech control:** takeover camera, WASD + mouse aim, exit to tactical.
- Placeholder RTS UI: selection, command bar, ring-strip minimap, resource readout.
- Win/loss conditions + Dominance time cap.
- Determinism test passing on a full scripted match.

**Gate 1:** a person who is not you plays a full match against a scripted opponent and finishes it. Fun assessment happens here, on cubes. Rebalance or re-scope now — this is the cheapest moment in the project to change the design.

---

## Phase 2 — Systems Depth & AI (≈6 weeks)
**Goal:** a real opponent and real strategic texture.

- AI Strategist (utility-scored goals) + Tactician (squad behavior trees); three difficulty tiers.
- Full rocket kit: cruise missiles, chord shots, laser grid, counter-battery flash reveal.
- Mech abilities (shield wall, Longbow siege mode, Wisp cloak, Aegis umbrella), damage states, wrecks.
- Second faction with distinct identity; data-driven unit tables finalized.
- Quality-preset framework wired in from the start (Low → Ultra), settings menu, F3 perf overlay.
- Save/load of sim state (also validates the determinism boundary).
- Balance pass #1 against AI-vs-AI batch simulation runs.

**Gate 2:** AI on Normal beats a first-time player and loses to an experienced one. Match length lands in the 20–40 min target across 20 recorded matches.

---

## Phase 3 — Art & Audio Production (≈10 weeks)
**Goal:** replace every placeholder. This is the largest phase and it is asset-bound, not code-bound.

- PBR calibration scene + material library; lock the lighting model.
- Terrain materials: triplanar height-blended splats, detail layers, scatter system, decals.
- Mech production: shared skeletons, modular kits, trim-sheet texturing, 3 LODs + imposters, locomotion sets, foot IK, torso aim blending.
- Structure kit, Spinal Nodes, ruin/prop library.
- Sky system: procedural sky, ring-inclusive IBL, shadow squares + day/night cycle, volumetric shafts.
- VFX: rocket plumes and persistent contrails, layered explosions with light flash and shockwave, impacts, shields, the chord-strike full-screen event.
- Full post stack + day/night LUTs.
- Audio: mech foley, distance-delayed booms, weapon layers, adaptive score, bus/ducking mix.
- Final HUD/UI visual design pass.

**Gate 3:** the signature screenshot from `docs/art-direction.md §1` exists and is real gameplay, not a staged render.

---

## Phase 4 — Performance & Hardening (≈4 weeks)
**Goal:** hit the frame budget on real hardware and stop the stutters.

- Profile against `docs/architecture.md §4.3`; drive every phase into budget.
- Draw-call reduction pass; instancing/batching audit; shader permutation warming on the loading screen.
- Zero-allocation audit of the hot loop; pool everything that allocates during combat.
- Asset compression pass (KTX2/meshopt), streaming priority tuning, < 15 s to first playable frame.
- Device matrix testing: integrated GPU, GTX 1660, RTX 3070, Apple Silicon; Chrome/Edge/Firefox/Safari.
- CI perf regression scene.

**Gate 4:** 60 fps at 1080p on GTX 1660-class hardware in a heavy combat scene, no frame exceeding 33 ms over a 10-minute match.

---

## Phase 5 — Game Feel & Polish (≈4 weeks)
**Goal:** the difference between "works" and "good."

- Camera juice: shake, footstep thumps, tilt-with-zoom curve tuning, cinematic mode.
- Onboarding: interactive tutorial that teaches the ring, the wrap, and Coriolis through play, not text.
- Readability gate testing (identify faction/class/health in one second at max zoom).
- UX polish: hotkeys, control groups, alerts, order feedback, accessibility (colorblind-safe faction palettes, scalable UI, remappable keys).
- Balance pass #2 from external playtests; telemetry on match outcomes.
- Bug burn-down, crash/WebGL-context-loss recovery, main menu, settings, credits.

**Gate 5:** external playtesters complete matches unprompted and can explain Coriolis after playing without having read anything.

---

## Phase 6 — Expansion (post-launch, optional)
Multiplayer via deterministic lockstep (the architecture is already paid for), additional maps, faction asymmetry, campaign missions, replays, mod support, WebGPU renderer path.

---

## Parallelization
Phases 3 and 4 overlap heavily — art production is asset-bound and performance work is code-bound, so they run concurrently once Gate 2 clears. Within Phase 3, sky/atmosphere, mechs, terrain materials, VFX, and audio are five independent tracks. Phase 2's AI work is independent of Phase 2's rocket-kit work.

Estimated single-developer timeline to Gate 5: **~8 months**. With a small team (1 engineer, 1 artist, 1 generalist), roughly **4–5 months**.

## Definition of Done (v1.0)
All six success criteria in `docs/spec.md` met, all five gates passed, and the game is playable start-to-finish from a cold browser load with no console errors.
