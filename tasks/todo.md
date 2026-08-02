# Ring World War — Task List

> **Historical planning source.** This list preserves the original Phase 0–1 breakdown and does not report current project status. See `docs/roadmap.md` for the authoritative status, open evidence, and immediate sequence.

Tasks are ordered by dependency. Only Phase 0 and Phase 1 are broken down; later phases are decomposed at their gate, when we know more.

---
## Phase 0 — Foundations & Risk Kill

- [x] **Task: Scaffold the project**
  - Acceptance: `npm run dev` serves a black Three.js canvas; `typecheck`, `lint`, `test`, `test:e2e` all run clean; CI runs them on push.
  - Verify: `npm run typecheck && npm run lint && npm run test`
  - Files: `package.json`, `vite.config.ts`, `tsconfig.json`, `.eslintrc.cjs`, `src/main.ts`, `.github/workflows/ci.yml`

- [x] **Task: Implement `core/ringMath.ts`**
  - Acceptance: ring↔surface↔render conversions, `deltaS` wrap helper, curvature drop, orientation basis, all ring constants derived from `R` and `g` (change `R`, everything follows).
  - Verify: `npm run test tests/core/ringMath.test.ts` — includes round-trip conversion tests and wrap-boundary edge cases (θ=0, θ=2π−ε, antipodal).
  - Files: `src/core/ringMath.ts`, `src/core/constants.ts`, `tests/core/ringMath.test.ts`

- [x] **Task: Implement deterministic state + RNG**
  - Acceptance: seeded integer RNG, stable iteration, state hashing, and a boundary lint banning wall-clock and unseeded randomness in simulation.
  - Verify: paired seeded AI worlds produce identical hash streams for 900 ticks.
  - Files: `src/core/rng.ts`, `src/sim/world.ts`, `tools/lint.mjs`, `tests/sim/world.test.ts`

- [x] **Task: Spike A — floating-origin ring flythrough**
  - Acceptance: a free camera can traverse the full circumference with zero positional jitter and zero z-fighting; terrain visibly curves up into the sky on both sides; anchor re-basing is invisible.
  - Verify: manual — record a flythrough at 3 zoom levels and inspect for jitter at max distance from origin.
  - Files: `src/render/renderAnchor.ts`, `src/render/ringGeometry.ts`, `src/dev/spikePrecision.ts`

- [x] **Task: Spike B — rotating-frame ballistics**
  - Acceptance: projectiles integrate with centrifugal + Coriolis terms; a debug scene shows the authoritative antispinward long-range advantage over spinward fire and the range difference is obvious on screen; the aim solver hits a designated target within 5 m.
  - Verify: `npm run test tests/sim/ballistics.test.ts` — golden-value trajectories; plus manual inspection of the debug scene.
  - Files: `src/sim/systems/projectileSystem.ts`, `src/sim/ballistics/aimSolver.ts`, `src/dev/spikeBallistics.ts`, `tests/sim/ballistics.test.ts`

- [x] **Task: Spike C — complete ring mesh**
  - Acceptance: the entire 22.6 km ring is visible from any surface point as one static procedural mesh.
  - Verify: F3 perf overlay reading during a full-ring view; compare against budget.
  - Files: `src/render/farRingShell.ts`, `tools/bakeRingShell.ts`, `src/dev/spikeFarRing.ts`

- [x] **GATE 0 review** — 3.6 km radius accepted as the gameplay-scale habitat.

---
## Phase 1 — Playable Core Loop

- [x] **Task: Stable world + fixed-timestep loop**
  - Acceptance: 30 Hz sim tick with accumulator, render interpolation between states, state-hash function, empty system pipeline running.
  - Verify: `npm run test tests/sim/determinism.test.ts` — 10,000 ticks from a seed produce an identical hash stream across two runs.
  - Files: `src/sim/world.ts`, `src/sim/components.ts`, `src/sim/pipeline.ts`, `src/main.ts`, `tests/sim/determinism.test.ts`

- [x] **Decision: retain the Gate 1 sim on the main thread**
  - Acceptance: fixed-step state is deterministic and presentation interpolates previous/current transforms. Worker migration is profiling-triggered.

- [x] **Task: Terrain — heightfield and navgrid**
  - Acceptance: a heightfield map loads and renders as wrapped clipmap terrain; an 8 m navgrid is derived from it; slope/obstacle marking works.
  - Verify: `npm run test tests/sim/navgrid.test.ts` (wrap-boundary neighbor lookups) + visual check of LOD seams.
  - Files: `src/render/terrain/`, `src/sim/nav/navgrid.ts`, `tests/sim/navgrid.test.ts`

- [x] **Task: Pathfinding — wrapped flow fields**
  - Acceptance: units path to a destination taking the shorter way around the ring; groups don't stack; a path across the θ=0 seam works identically to one that doesn't cross it.
  - Verify: `npm run test tests/sim/pathing.test.ts` — explicit seam-crossing cases.
  - Files: `src/sim/systems/pathingSystem.ts`, `src/sim/nav/flowField.ts`, `src/workers/pathWorker.ts`, `tests/sim/pathing.test.ts`

- [x] **Task: Economy systems**
  - Acceptance: Salvage extraction from finite deposits, Energy generation with day/night solar modulation and upkeep draw, Command Points from captured Spinal Nodes; brownout behavior when Energy goes negative.
  - Verify: `npm run test tests/sim/economy.test.ts` — golden resource curves over 10 sim minutes.
  - Files: `src/sim/systems/economySystem.ts`, `src/sim/systems/captureSystem.ts`, `tests/sim/economy.test.ts`

- [x] **Task: Structures + production**
  - Acceptance: all Phase 1 structures placeable (with valid/invalid placement rules), build queues consume resources over time, completed structures activate.
  - Verify: `npm run test tests/sim/production.test.ts` + manual placement in-game.
  - Files: `src/sim/systems/productionSystem.ts`, `src/sim/data/structures.ts`, `src/input/placement.ts`, `tests/sim/production.test.ts`

- [x] **Task: Units, targeting, combat, fog of war**
  - Acceptance: units move, acquire targets within LOS and vision, deal armor-typed damage, and die; fog of war hides unseen units; data-driven unit defs.
  - Verify: `npm run test tests/sim/combat.test.ts`, `tests/sim/vision.test.ts`
  - Files: `src/sim/systems/{movement,targeting,combat,vision,lifecycle}System.ts`, `src/sim/data/units.ts`, `tests/sim/`

- [x] **Task: Rockets end-to-end**
  - Acceptance: Rocket Battery fires on player command; live predicted-trajectory ribbon (generated by the flight integrator, not a duplicate) shown before commit; rocket flies, impacts, applies AoE damage; point defense can intercept it.
  - Verify: `npm run test tests/sim/intercept.test.ts` + manual: predicted ribbon matches actual flight path within 2 m.
  - Files: `src/sim/systems/{projectile,intercept}System.ts`, `src/ui/trajectoryRibbon.ts`, `tests/sim/intercept.test.ts`

- [x] **Task: Direct mech control**
  - Acceptance: `V` on a selected mech drops into third-person; WASD locomotion with independent torso aim; abilities on keys; `Esc` returns to tactical with the camera at the mech's location; the sim treats piloted input as ordinary commands (no special-casing).
  - Verify: manual playtest — round-trip takeover 20 times with no camera or state glitches.
  - Files: `src/input/directControl.ts`, `src/render/cameras/`, `src/sim/systems/commandSystem.ts`

- [x] **Task: Tactical UI**
  - Acceptance: box/click selection, control groups, command bar, resource readout, ring-strip minimap that correctly represents the wrap, health bars and selection rings that hug terrain.
  - Verify: Playwright smoke test (select a unit, issue a move order) + manual.
  - Files: `src/ui/`, `src/input/selection.ts`, `e2e/smoke.spec.ts`

- [x] **Task: Victory conditions + match flow**
  - Acceptance: destroying the enemy Bastion wins; Dominance score accrues from Spinal Nodes; 45-minute time cap resolves by Dominance; win/lose screen with a match summary.
  - Verify: `npm run test tests/sim/victory.test.ts` — all three end conditions.
  - Files: `src/sim/systems/victorySystem.ts`, `src/ui/matchEnd.ts`, `tests/sim/victory.test.ts`

- [x] **Task: AI opponent**
  - Acceptance: a scripted build order + attack waves that provides enough pressure for a full match to be evaluated for fun.
  - Verify: play a full match to completion against it.
  - Files: `src/ai/scriptedOpponent.ts`

- [ ] **GATE 1 review** — external player completes a full match on programmer art. Fun assessment and re-scope decision.
