# Phase 4A Provisional Baseline

**Date:** 2026-08-04

**Product baseline:** `a0c72a25f66548bec38df21e3996f9c1abaa1074`

**Provenance caveat:** the worktree also contains the approved local `.gitignore`
change, untracked `Speech-image-video.md`, and Phase 4 planning documents. Receipts
content-address those inputs. These results guide profiling but must be repeated
from the eventual clean Phase 4 baseline before CI thresholds are enforced.

## Security Boundary

- `.env` is ignored by `.gitignore:11`.
- No `.env` file is tracked.
- Generation credentials were not read or used by any benchmark.
- Speech/image/video work is deferred until after Gate 4.

## Hardware Doctor

Receipt: `output/runs/20260804T164328.692Z-25088-567f19d4/receipt.json`

- CPU: Intel Core i7-8650U, 8 logical CPUs.
- RAM: 23.84 GiB available to the OS report.
- Browser: Chromium 151, WebGL2.
- Renderer: Intel UHD Graphics 620 through ANGLE D3D11.
- Drawing buffer: 1280×720, DPR1.
- Hardware renderer, texture/renderbuffer limits, and texture-unit checks pass.
- Dedicated GPU memory remains unmeasurable and advisory.

## Headless 40-Minute Profile

Receipt: `output/runs/20260804T164415.926Z-16680-55f6270b/receipt.json`

- Terrain generation: 2,508.943 ms.
- Simulation runs: 19,948.762 / 11,170.144 / 11,889.513 ms.
- Median simulation: 11,889.513 ms.
- Completed in 50,890 ticks with the Choir winning by Bastion destruction.
- Requirement 17.5 target: under 10,000 ms.
- Status: **fail**.

The current median is about 1.89 seconds over target, while the first run shows a
large cold/shared-machine outlier. Phase 4B must distinguish warm deterministic
work from process startup, JIT, GC, and machine contention before enforcing a
wall-clock assertion.

## T480s Heavy Combat

Receipt: `output/runs/20260804T164555.673Z-8420-debc10a9/receipt.json`

- Median frame: 16.7 ms.
- p95: 33.3 ms.
- p99: 50.0 ms.
- Frames over 100 ms: 0.
- Render p95: 12.2 ms.
- Simulation p95: 2.0 ms.
- Full-frame p95: 18.83 ms.
- Draw calls: 46.
- Triangles: 96,655.
- Lines: 3,600.
- Points: 2,606.
- Geometries: 136.
- Textures: 2.
- Programs: 16.
- Context losses: 0.
- Black frame: false.
- Candidate hard gate: **pass**.

## Phase 4B Entry Decision

The browser gate is healthy enough that Phase 4B should begin with simulation
profiling rather than speculative renderer reductions. The first investigation is
the current successful ballistic workload and its interaction with movement,
target acquisition, and visibility. Any solver/cadence change requires explicit
deterministic and gameplay-semantic approval.

## Late-Loop Phase Profile

Provisional command: `RWW_PROFILE=phase`, standard terrain, 72,000-tick cap.

- Measured late ticks: 38,890 of a 50,890-tick completed match.
- Late-loop instrumentation time: 12,275.993 ms.
- Choir AI: 4,804.970 ms / 39.14% inclusive.
- `stepUnits`: 3,236.988 ms / 26.37% inclusive.
- Compact AI: 1,818.677 ms / 14.81% inclusive.
- Projectiles: 609.394 ms.
- Structures: 521.437 ms.
- Economy: 428.793 ms.
- Final world hash: `e958010d`.
- Final controller hashes: `76de5221` / `97b45387`.
- Trajectory evaluations: 43,329.
- Integration steps: 10,124,706.
- Full trajectory builds: 126.

## Late-Loop Detail Profile

Provisional command: `RWW_PROFILE=detail`, standard terrain, 72,000-tick cap.

- Instrumented late-loop time: 19,426.114 ms.
- `stepUnits`: 7,265.643 ms inclusive.
- Choir AI: 5,707.610 ms inclusive.
- `fireBallisticAt`: 5,263.297 ms across 199 timed calls.
- Choir tactical planning: 4,452.295 ms across 864 tactical cycles.
- Unit movement: 2,669.125 ms.
- Entity visibility: 1,898.672 ms.
- Navigation direction lookup: 1,756.753 ms.
- Point visibility: 1,580.023 ms.
- Target acquisition: 1,383.828 ms.

These timers are nested and inclusive; they must not be summed or subtracted
from wall time. The original profile mixed late-loop timers with full-match work
counters; the retained profiler now snapshots at the 12,000-tick warmup boundary
and attributes the resulting deltas by faction, source, weapon, outcome, and caller.

## Phase 4B Instrumentation Gate

Current status:

1. Complete: snapshot ballistic counters at warmup and report late-loop deltas.
2. Partial: record caller/faction/weapon attempts, solved/cached/no-solution
   outcomes, evaluations, integration steps, and full-path builds. Exact internal
   Newton failure reasons and elevation seeds remain open.
3. Partial: record exact periodic world/controller hashes and a planning-attempt
   transcript hash. A simulation ballistic-event transcript remains open.
4. Partial: record wall/CPU time and terrain generation separately. Explicit JIT,
   GC, and shared-machine contention isolation remains open.
5. Open: repeat from a clean committed Phase 4 baseline or pinned runner.

The first safe experiments, after that evidence, are impact-only dead-store
elimination, exact canonical terrain sampling, local scratch reuse, avoiding full
path retention for committed AI shots, and exact within-tick envelope reuse.
Cadence, integrator, tolerance, elevation-seed, and Jacobian changes remain
semantics-changing and require separate approval.

## Phase 4B Attribution Result

The aligned detail profiler attributes all late planning work as follows:

| Caller / faction / weapon | Calls | Successes | Cached failures | No solution | Time | Evaluations | Integration steps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Command / Choir `batteryGun` | 92 | 22 | 7 | 63 | 4,261.367 ms | 29,363 | 7,841,195 |
| Command / Compact `batteryGun` | 80 | 75 | 0 | 5 | 1,005.086 ms | 7,969 | 1,824,198 |
| Automatic / Compact `siegeMortar` | 170 | 8 | 150 | 12 | 202.752 ms | 5,891 | 398,142 |
| Automatic / Choir `siegeMortar` | 1 | 1 | 0 | 0 | 5.797 ms | 27 | 11,623 |
| Command / Compact `chordShot` | 10 | 10 | 0 | 0 | 14.976 ms | 42 | 26,388 |
| Command / Choir `chordShot` | 10 | 10 | 0 | 0 | 12.528 ms | 37 | 23,160 |

Chord is not the Requirement 17.5 bottleneck. Failed conventional Choir battery
geometry dominates: 70 failed plans account for most of 7.84 million integration
steps. The faction controllers run the same cadence; their cost differs because
of match-state geometry, visibility opportunity, and solver convergence.

The shared `planBallistic` boundary now reconciles exactly with global late-loop
work. Attributed and global totals are both 43,329 evaluations, 10,124,706
integration steps, 126 full builds, 161,642 stored samples, and 157 failed-cache
hits. Unattributed work is zero. Normal profile logs include only the aggregate
and deterministic transcript hash; set `RWW_PROFILE_TRANSCRIPT=1` to emit raw
attempts when a separate artifact is explicitly needed.

## Safe Experiment 1 - Rejected

Experiment: stop rewriting the impact-only result object on every integration
step while retaining identical stepping, conversion, terrain, collision, and
work counts.

- Final world/controller hashes and ballistic work counts remained identical.
- Instrumented Choir battery time changed from 4,117.054 to 4,069.321 ms, within
  run variance; Compact changed from 1,034.555 to 1,068.202 ms.
- Fresh wall runs were 12,514.519 / 12,025.859 / 11,992.689 ms, median
  12,025.859 ms.
- No defensible wall-clock improvement was established.

Decision: runtime change reverted. The profiler instrumentation is retained.
Requirement 17.5 still needs approximately two seconds plus qualification margin.
Further safe micro-optimizations are unlikely to be sufficient alone.

## Solver Redesign Experiment - Rejected

Experiment: probe all 18 elevation seeds once at coarse cadence, rank them by
actual drag/terrain miss, and run full Newton refinement only on the best four.

- Late integration steps fell from 10,124,706 to 3,644,576.
- Choir battery command time fell from 4,117.054 to 1,135.839 ms.
- Five-run wall distribution: 10,608.661 / 9,168.239 / 9,142.071 /
  8,774.436 / 8,847.651 ms.
- Median: 9,142.071 ms; four of five runs below ten seconds.
- Wall receipt: `output/runs/20260804T173746.524Z-3432-9096ed42/receipt.json`.
- Final winner and Bastion-destruction end reason remained Choir victory.
- Local detail-profile observation: match tick, artillery success set, telemetry,
  and hashes changed as expected. This observation was not packaged as a receipt.

Balance qualification failed decisively:

- Veteran mirror: Choir won 19 of 20 matches.
- Allowed maximum faction win rate: 70%.
- Actual Choir win rate: 95%.
- Receipt: `output/runs/20260804T174046.526Z-10384-9ecb2d97/receipt.json`.

Decision: redesign reverted before running difficulty cohorts. A solver speedup
that changes convergence/root selection is not acceptable unless it preserves
the faction mirror gate. Phase 4B returns to exact-semantics optimization and
instrumentation. Requirement revision remains preferable to shipping a biased
solver if exact-semantics work cannot reach the target.

## Safe Experiment 2 - Rejected

Experiment: pass the generated terrain's proven height ceiling into trajectory
integration and skip `heightAt` only while projectile height is above that bound.

- Trajectory, artillery, Chord, AI targeting, and save/load tests remained exact.
- Final world/controller hashes and ballistic work counts remained unchanged.
- Five-run wall distribution: 13,517.890 / 12,454.949 / 12,084.177 /
  12,530.208 / 11,966.255 ms.
- Median: 12,454.949 ms.
- No measurable improvement was established under current machine variance.

Decision: runtime change and its test were reverted. The retained Phase 4B source
changes are profiler instrumentation and documentation only.

## Requirement 17.5 Decision Resolution

Phase 4B has now established:

- Exact-semantics dead-store and terrain-ceiling changes do not recover useful wall time.
- Ranked-seed solver search reaches a 9.142-second median but causes a 95% Choir
  Veteran-mirror win rate and is unacceptable.
- Chord is negligible; failed conventional Choir battery geometry is dominant.
- Current exact solver median remains around 11.9–12.0 seconds with large cold and
  shared-machine variance.

Decision: retain the accepted canonical solver and formally revise Requirement
17.5. The candidate contract uses one excluded JIT warmup, five measured standard-
terrain runs, and a 15-second warm median on the pinned reference machine. See
`docs/headless-performance-policy.md`.

No AI cadence or solver-semantics change should be retained without explicit
approval and renewed cohorts.

## Battery Envelope Research - Rejected

The profiler exported the existing drag-free required-speed calculation and
correlated its ratio with canonical outcomes. The result showed overlap between
successful and failed plans, but a battery-only empirical cutoff was tested
because it could avoid high-ratio failures without changing root selection.

### Factor 0.80

- Seed 501 preserved every periodic, final world, controller, command-success,
  and match-outcome hash.
- Integration steps fell from 10,124,706 to 3,859,653.
- Five-run wall median: 8,739.824 ms; four of five runs below ten seconds.
- Wall receipt: `output/runs/20260804T191540.987Z-16092-c62cad9b/receipt.json`.
- Veteran mirror: Choir won 15 of 20 matches, exceeding the 70% cap at 75%.
- Mirror receipt: `output/runs/20260804T191657.458Z-10568-9ab38a7c/receipt.json`.

### Factor 0.82

- Seed 501 still preserved the accepted hashes.
- Integration steps were 6,313,567.
- Isolated five-run wall median: 11,211.327 ms; Requirement 17.5 failed.
- Receipt: `output/runs/20260804T192625.201Z-25356-4f2d32dd/receipt.json`.

### Factor 0.81

- Seed 501 again preserved the accepted hashes.
- Integration steps matched the 0.80 candidate at 3,859,653.
- Isolated five-run wall median: 9,644.257 ms; the historical ten-second timing threshold passed locally, but Requirement 17.5 was not qualified.
- Wall receipt: `output/runs/20260804T192923.201Z-20136-339cd5f8/receipt.json`.
- Veteran mirror again produced 75% Choir wins and failed the balance gate.
- Mirror receipt: `output/runs/20260804T193046.452Z-5476-4f732e1e/receipt.json`.

Decision: all envelope-factor behavior changes were reverted. The useful cutoff
is discontinuous in the tested corpus: factors that recover enough work fail
balance, while the factor that preserves more plans misses performance. The
minimum-required-speed export and profiler correlation remain diagnostic only.

The seed-501 hash-preservation and integration-step figures above are local
detail-profile observations, not receipt-backed candidate artifacts. The linked
wall and mirror receipts support timing and cohort decisions; reproducing the
experimental detail observations would require temporarily restoring rejected code.

## Tangent-Jacobian Research - Rejected

An experimental forward-mode tangent solver differentiated the current discrete
drag update with respect to launch azimuth and elevation. It retained all 18
elevation seeds, current clamps/tolerances, and final canonical 30 Hz impact
verification. The candidate was never enabled by default.

Unreceipted local canonical-authoritative shadow observations for seed 501:

- 186 uncached conventional plans compared.
- 106 both solved; 76 both null.
- Zero canonical-only results; four candidate-only results.
- Candidate work: 3,472,220 integration steps.
- Maximum shared-solution impact delta: 2.954 m.
- Maximum elevation delta: 0.000388 rad.
- Canonical periodic/final hashes remained unchanged in shadow mode.

These shadow figures came from transient opt-in profiler output and are not a
content-addressed qualification artifact. They must not be used as acceptance
evidence. The candidate is rejected independently by the receipt-backed direct
and guarded wall failures below; reproducing shadow evidence would require
restoring the removed experiment and issuing a new source-provenanced receipt.

Candidate-authoritative execution was not viable:

- Five-run median: 17,320.006 ms.
- Match duration changed from 50,890 to 71,638 ticks because candidate-only
  solutions changed the battle timeline.
- Receipt: `output/runs/20260804T203552.359Z-14488-4b4e93c2/receipt.json`.

Two guarded variants kept canonical success/root authority:

- All-geometry tangent failure screen: exact seed-501 timeline, 12,626.593 ms median.
- Receipt: `output/runs/20260804T204524.719Z-23724-27da6edc/receipt.json`.
- High-ratio-only failure screen: exact seed-501 timeline and 5,415,042
  instrumented integration steps, but isolated medians remained 11,321.119 ms
  and 12,224.692 ms across two five-run samples.
- Receipts: `output/runs/20260804T204943.815Z-5556-cf2aee1e/receipt.json` and
  `output/runs/20260804T205350.639Z-6760-ace9358b/receipt.json`.

The candidate, injection seam, shadow code, and experimental tests were removed
after failing the performance gate. Veteran mirror was not run because the
performance gate failed first. Runtime gameplay remains on the accepted solver.

## Revised Requirement 17.5 Candidate Run

The executable 15-second warm-median policy passed provisionally:

- Terrain generation: 2,153.249 ms, reported outside the simulation gate.
- Excluded JIT warmup: 16,033.840 ms.
- Measured runs: 15,461.585 / 14,015.681 / 14,312.829 / 14,021.446 /
  13,965.350 ms.
- Warm median: 14,021.446 ms against a 15,000 ms candidate budget.
- Match result remained the canonical 50,890-tick Choir Bastion victory.
- Receipt: `output/runs/20260804T214043.081Z-9828-22c568f3/receipt.json`.
- Tracked summary: `validation/evidence/headless-40m-candidate-2026-08-04.json`.

Status remains provisional: the receipt records dirty source and the reference
machine is not yet configured as dedicated pinned CI hardware.

A later non-dedicated sample produced a 16,115.299 ms median with large
contention spikes while preserving the canonical SHA-256 result across all five
runs. Receipt: `output/runs/20260804T225902.771Z-25968-91cc7d6e/receipt.json`.
Local calibration is therefore inconclusive; only protected dedicated-runner
qualification can pass or reject the 15-second candidate policy.
