# Phase 2 Systems Depth — Optimized Execution Report

## Scope decision

The original checklist was not executed literally because its dependency order would have created unusable state until the final integration task, and several assumptions did not match Gate 1:

- runtime entity state lives in `src/sim/world.ts`, not `src/sim/data.ts`;
- energy is a production/draw rate, not a stockpile;
- the renderer already had one quality system and a deliberately stable direct-ACES path;
- cruise missiles had no launcher or selectable fire-mode API;
- a World-only save omitted AI controller state and could not resume deterministically;
- standard ballistic planning could spend seconds retrying unreachable shots.

The work was therefore re-sliced into vertical, independently verified increments:

1. Runtime contracts and faction-effective stats.
2. Abilities, damage states, wrecks, and authoritative visibility.
3. Selectable projectile modes, interception, Laser Grid, Silo, and Chord Shot.
4. Strategist goals, behavior trees, squads, reaction delays, and ability coordination.
5. Versioned World + AI session snapshots and atomic restore.
6. Headless match orchestration, telemetry, and balance summaries.
7. Existing quality-system extension, settings UI, F3 metrics, save/load controls, and procedural presentation.
8. Measured headless optimization with deterministic regression guards.

## Delivered

- Three AI difficulty tiers with exact 3.0 / 1.5 / 0.6 second strategist cadences.
- Utility-scored strategic goals and deterministic squad tactics.
- Shield Wall, Siege Mode, Cloak, and Umbrella simulation, controls, AI use, and state-driven presentation.
- Mechanical faction modifiers for HP, vision, construction/production time, and ballistic structure costs.
- Damage states, targetable/decaying wrecks, and short-range wreck line-of-sight cover.
- Standard rocket, cruise missile, Chord Shot, Point Defence, Umbrella, and Laser Grid interaction matrix.
- Procedural Silo, Laser Grid, wreck, damage, cloak, siege, shield, and umbrella visuals.
- Counter-battery reveal with clamped deterministic expiry.
- Versioned, deeply validated World and AI session snapshots with RNG, terrain-seed, and controller-state restoration.
- Browser save/load with corrupt-slot and terrain-mismatch rejection before live-state mutation.
- Headless match/batch APIs with result status, draws, economy, production, loss, and destruction telemetry.
- Four persisted quality presets, settings menu, input suppression, volume placeholder, and expanded F3 overlay.
- Deterministic one-second power pulses that make `energyPerShot` operative without replacing the rate economy.
- O(1) derived entity lookup, reusable spatial buckets, spatial-query caching, terrain segment acceleration, bounded navigation fields, and ballistic failure caching.

## Intentional design corrections

- **Chord speed:** raised from the proposed 280 m/s to a tested value that actually exits the 1,400 m atmosphere shell.
- **Energy:** weapon engagements create bounded transient draw instead of subtracting from a nonexistent stockpile.
- **Umbrella:** protected-impact radius is separate from projectile engagement range, avoiding the proposed 120 m “upgrade” reducing the existing 260 m weapon range.
- **Speed modifiers:** ability and damage factors are derived independently; they never compound each tick.
- **Match result:** completion status is separate from nullable winner, so an equal-Dominance time cap ends as a draw.
- **Quality:** no unstable post-processing composer was reintroduced. Every preset retains the Gate 1 direct-render fallback.
- **Tests:** correctness/property tests marked optional in the original plan were treated as mandatory.

## Verification evidence

- Static TypeScript and architecture-boundary checks pass.
- Production build passes.
- Unit/integration suite covers simulation, AI, persistence, rendering settings, headless orchestration, and deterministic continuation.
- Playwright covers Gate 1 controls plus settings, performance overlay, Phase 2 structures/presentation, weapon selection, abilities, and save/load.
- A 72,000-tick deterministic performance profile preserves the standard-terrain golden state hash after optimization.
- Low-load 72,000-tick simulation measurements reached 6.2–8.6 seconds on flat terrain and 7.7–9.2 seconds on standard terrain; shared-machine contention produced slower outliers, so no flaky wall-clock assertion was added.

See `docs/phase-2-headless-performance.md` for profiling methodology and measurements.

## Remaining Gate 2 evidence gaps

The systems implementation is operational, but the statistical match-quality gate is not claimed complete:

- the required full-length 20-match Veteran balance sample has not demonstrated a 20–40 minute mean;
- the short 20-seed Veteran mirror diagnostic produced 17 draws, so it is not a substitute for full-match tuning;
- Recruit/Veteran/Commander ordering is covered behaviorally and in short diagnostics, but not yet by representative 20–40 minute match samples;
- the original under-10-second criterion was later superseded by the explicit warm-median runner contract in `docs/headless-performance-policy.md`; final clean-source pinned-runner qualification remains open;
- Ultra retains the stable direct renderer rather than enabling the post-processing stack that Gate 1 explicitly deferred;
- faction palettes are distinct, but geometry remains roster-shared rather than providing fully separate faction silhouettes.

These are tuning, CI-hardware qualification, and deferred visual-fidelity items—not hidden implementation failures.
