# Phase 2 Headless Performance Report

Measured on 2026-08-01 with Node 26.4.0 and Vitest 4.1.10. The machine was
shared with other development processes, so wall-clock results are reported as
observations rather than a CI performance gate.

## Bottleneck

Ready AI Rocket Batteries repeatedly planned shots against visible targets that
could not be hit. Every failure ran the drag solver, which swept 18 elevations
and repeatedly allocated full 30 Hz trajectories. Failed shots did not start a
weapon cooldown, so the same relative geometry was solved again at the next AI
planning update.

## Bounded Before/After Profile

The representative profile used flat terrain, seed 501, Veteran controllers,
and a 12,000-tick cap. `fireBallisticAt` and each AI update were timed without
changing simulation decisions.

| Metric | Before | After |
| --- | ---: | ---: |
| Simulation time | 7,305 ms | 2,212 ms |
| Ballistic attempts | 30 | 8 |
| Failed ballistic attempts | 30 | 8 |
| Time in failed attempts | 5,981 ms | 415 ms |
| Slowest failed attempt | 374 ms | 58 ms |
| Slowest AI update | 721 ms | 113 ms |

The pre-fix 72,000-tick flat run did not finish within a bounded 30-second
measurement. This confirmed that a full pre-fix run was not a useful iteration
loop; the 12,000-tick profile captured the onset and attributed 82% of elapsed
time to failed ballistic attempts.

## Changes

- AI filters targets through a cheap signed ring reach envelope before invoking
  the drag solver.
- Reachable targets are ordered by existing durability and replacement-cost
  data, then distance and stable entity ID, instead of distance alone.
- Failed AI plans are retained in a bounded cache keyed by weapon, source/target
  identity, and 64 m quantized relative geometry. Match-session snapshots persist
  this state and strictly validate its bounds, retry horizon, and unique plan keys
  so restore does not repeat already-rejected geometry.
- A battery tests at most one new expensive failed geometry per planning cycle.
- Drag refinement uses a coarse impact-only search followed by canonical 30 Hz
  verification. Impact-only and full-path evaluation share one integration
  loop, while committed preview/live shots still use the full canonical path.
- The headless runner no longer allocates temporary faction-salvage records on
  every tick.

## Historical Full Match Measurements

Both final measurements used the real `runHeadlessMatch` path, seed 501,
Veteran versus Veteran, and 72,000 ticks (40 simulated minutes). Terrain
construction was timed separately.

| Terrain | Generation | Simulation | Total | Ballistic attempts | Failed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Flat CI fixture | ~0 ms | 51,878-65,256 ms | 51,878-65,256 ms | 31 | 31 |
| Standard procedural | 1,492 ms | 23,291 ms | 24,784 ms | 34 | 24 |

The flat runs varied substantially under shared-machine load and have no robust
margin for a wall-clock assertion. Deterministic tests therefore guard solver
rejection, negative-cache suppression, target ordering, directional reach, and
impact/full-path identity instead.

## Historical Late-Match Steady-State Profile

The follow-up profile retained the same seed 501 Veteran-versus-Veteran match,
instrumented ticks 12,001 through 72,000, and timed the real world/controller
order. Nested rows are inclusive, so they explain a parent cost and must not be
added to the top-level rows.

| Top-level phase | Late-loop time | Percent |
| --- | ---: | ---: |
| `World.stepUnits` | 11,241.49 ms | 53.00% |
| Choir `AiOpponent.update` | 3,336.42 ms | 15.73% |
| `World.stepStructures` | 1,923.59 ms | 9.07% |
| Compact `AiOpponent.update` | 1,661.15 ms | 7.83% |
| `World.stepCapture` | 654.22 ms | 3.08% |
| `World.stepEconomy` | 605.62 ms | 2.86% |
| Spatial bucket maintenance | 283.09 ms | 1.33% |
| `World.stepProjectiles` | 264.28 ms | 1.25% |
| `World.stepVictory` | 94.57 ms | 0.45% |
| `World.stepProduction` | 94.10 ms | 0.44% |
| Event draining | 76.82 ms | 0.36% |
| `World.stepCleanup` | 57.28 ms | 0.27% |
| `World.stepWrecks` | 52.72 ms | 0.25% |

The main inclusive subphase costs were:

| Nested operation | Calls | Late-loop time | Percent |
| --- | ---: | ---: | ---: |
| Unit movement | 355,786 | 4,145.59 ms | 19.55% |
| Unit separation | 60,000 | 3,198.56 ms | 15.08% |
| Unit target acquisition | 793,821 | 2,690.34 ms | 12.68% |
| Navigation direction lookup | 355,786 | 2,289.87 ms | 10.80% |
| Choir tactical update | 1,333 | 2,146.64 ms | 10.12% |
| Spatial-query cache hits | 2,153,684 | 2,042.21 ms | 9.63% |
| Ballistic fire attempts | 34 | 1,986.98 ms | 9.37% |
| Entity visibility cache/API | 576,897 | 1,604.60 ms | 7.57% |
| Navigation segment validation | 813,049 | 1,412.65 ms | 6.66% |
| Point visibility scans | 260,029 | 1,226.31 ms | 5.78% |
| Terrain/wreck line of sight | 27,051 | 339.05 ms | 1.60% |
| Spatial-query cache misses | 14,602 | 61.90 ms | 0.29% |

Before optimization, a more intrusive lookup profile recorded 20,261,400
`unitById` calls and 6,651,252 `structureById` calls after tick 12,000. It also
showed 813,049 navigation segment checks and only 35 procedural navigation field
builds. This ruled out field construction as the original procedural bottleneck
and identified linear entity lookup, spatial-query churn, and exact terrain
segment sampling as the dominant ordinary steady-state work.

## Late-Match Changes

- Added a derived, non-serialized entity ID index. Stable entity arrays remain
  authoritative, but hot target/separation lookups no longer scan them.
- Replaced per-tick bucket `Map` allocation with fixed dense buckets, retained
  bucket traversal order, cached identical bucket/radius queries while bucket
  membership is unchanged, and precomputed the exact 3x3 neighborhood used by
  short-range queries. Late-profile cache misses fell from 1,014,692 to 14,602.
- Bucket contents are rebuilt only when an entity crosses a bucket boundary or
  entity membership changes. Positions and exact distance checks remain per tick.
- Procedural terrain now uses a blocked-cell prefix query to prove that a whole
  segment rectangle is passable. Rectangles containing any blocked cell fall
  back to the canonical 4 m samples; repeated samples of the same 16 m slope
  cell are read once. Tests compare the accelerated and canonical results across
  wrapped, axial, diagonal, blocked, and open segments.
- Navigation fields use a dense goal-indexed cache with access stamps instead of
  three `Map` operations per movement update. The bounded cache was raised from
  64 to 128 fields (under 3 MB at this grid size), covering the measured flat
  match's 104-field working set without rebuild churn.
- Kept the per-tick damage-state derivation contract, but recomputes the speed
  multiplier only when damage state or ability transition changes. Cloak
  visibility invalidation is transition-only, and siege transition expiry still
  refreshes speed on the exact canonical tick.
- Replaced range-only square roots with mathematically equivalent squared-range
  checks. Distances used for movement, target scoring, falloff, and separation
  are unchanged.
- Added an opt-in 72,000-tick profiler at
  `tests/headless/performance-profile.test.ts`. It is skipped in normal CI and
  supports wall, phase, and detailed modes plus repeated warmed runs. The profile
  logs the final hash and permits a match to finish by early victory; it does not
  assert a fixed hash or require the full tick cap.

No AI weights, faction modifiers, difficulty values, weapon values, simulation
cadences, or target tie rules changed. An attempted occupied-bucket reordering
shortcut was discarded after a bounded/full-run comparison exposed a late-match
performance cliff; the retained spatial cache emits IDs in the original bucket
traversal order.

## Historical Final Warmed Measurements

Low-load measurements used three sequential 72,000-tick runs in one worker.
Terrain creation was measured once and separately. Shared-machine scheduling
still caused variance, so no wall-clock assertion was added to CI.

| Terrain | Generation | Simulation runs | Median | Prior simulation |
| --- | ---: | ---: | ---: | ---: |
| Flat CI fixture | 0.008 ms | 7,049 / 6,648 / 6,223 ms | 6,648 ms | 51,878-65,256 ms |
| Standard procedural | 1,026 ms | 9,031 / 9,231 / 7,711 ms | 9,031 ms | 23,291 ms |

Those runs demonstrate the retained design's low-load capability, but they are
not a robust upper bound. A later final-code repetition during heavy shared load
measured standard terrain creation at 4,141 ms and simulation at 31,976 / 23,793 /
18,524 ms. The state/result was identical and each successive warmed run became
faster, which is consistent with the observed contention/throttling, but wall
clock is wall clock and these observations cannot be discarded.

The last samples taken from the fully verified code measured flat simulation at
8,619 ms and standard simulation at 11,964 ms, with standard terrain creation at
3,826 ms under the same shared load. These are the exact closing observations;
the standard sample does not meet the threshold.

The flat fixture exposes the same exact segment-passability capability as a flat
`Terrain`: axial bounds are still checked by navigation, while slope passage is
always true. The final flat result and the standard result were identical across
all repeated runs.

## Determinism Verification

- The standard 72,000-tick world hash was historically `5bb924df` before and
  after every retained optimization measured here. The current opt-in profile
  logs its final hash for comparison rather than asserting this historical value,
  and a deterministic early victory is an accepted completion.
- The flat and standard match winners, durations, end reasons, economy totals,
  production/loss counts, and destruction counts remained unchanged.
- Existing paired seeded hash-stream tests passed, as did snapshot continuation
  tests that compare every subsequent hash after restore.
- Navigation acceleration is checked against canonical sample results, and a
  deterministic work-count test verifies that the 72-field representative
  navigation set is built once and reused.
- No equivalent target tie ordering change was accepted or retained.

## Balance Diagnostic

A short 20-seed flat-terrain diagnostic used seeds 501-520, Veteran versus
Veteran, and a 12,000-tick cap:

- Compact wins: 0
- Choir wins: 3 (15%)
- Draws: 17 (85%)
- Average simulated duration: 400 seconds
- Average units produced: 5 per faction
- Average units lost: Compact 0, Choir 0.1
- Structures destroyed: 0 per faction

This short diagnostic is not a balance acceptance run and no balance values were
changed. Neither faction exceeded the Requirement 17.4 70% ceiling, but the high
draw rate means this sample cannot validate the 20-40 minute match-quality goals.

## Requirement 17.5

The optimized simulation demonstrates Requirement 17.5 capability under low
load: the three-run flat range was 6.22-7.05 seconds and the standard range was
7.71-9.23 seconds. Standard terrain creation remains separate at about 1.03
seconds in that cohort, as requested.

Requirement 17.5 is not robustly verified. It specifically names CI hardware,
which was not available here, and final-code wall time exceeded 10 seconds under
heavy shared load. For that reason there is deliberately no flaky wall-clock CI
assertion and no claim that the requirement is closed. The suite instead guards
deterministic continuation and result checks, canonical terrain/nav equivalence,
navigation field build count, and existing cache/solver behavior; CI should add its own
72,000-tick timing gate only after establishing a stable hardware baseline.

## 2026-08-02 T480s Measured Follow-up

This pass used the required command on the i7-8650U T480s:

```text
npm run rww -- perf headless-40m --terrain standard --runs 3 --ticks 72000
```

The representative seed ended by early victory at tick 63,311. The baseline
receipt is `output/runs/20260802T000427.549Z-956-0e111617/receipt.json`; it is a
failed infrastructure receipt because the old opt-in test timeout expired after
all three samples had completed. The final successful receipt is
`output/runs/20260802T004222.966Z-6060-af87a8dc/receipt.json`.

| Receipt metric | Baseline | Final |
| --- | ---: | ---: |
| Standard terrain generation | 8,906 ms | 3,019 ms |
| Simulation wall runs | 66,801 / 61,153 / 63,883 ms | 35,563 / 48,307 / 60,273 ms |
| Median simulation wall | 63,883 ms | 48,307 ms |
| Simulation CPU runs | 62,142 / 52,062 / 51,235 ms | 35,390 / 36,891 / 38,797 ms |
| Median simulation CPU | 52,062 ms | 36,891 ms |

The host was not pinned or idle: an observed system sample reported 68% CPU load
with several other development processes active. Wall time varied substantially,
including within each three-run receipt, so these results are evidence of partial
progress rather than a stable performance qualification.

### Phase and detail profiles

The same 12,000-tick warmup and 63,311-tick early-victory endpoint were used
before and after. Instrumentation is inclusive, and the absolute profiles were
taken under different shared-host load, so phase percentages and deterministic
work counts are more useful than treating elapsed deltas as a benchmark.

| Top-level phase | Before | Final |
| --- | ---: | ---: |
| Late measured loop | 136,486 ms | 28,817 ms |
| `World.stepUnits` | 84,101 ms (61.62%) | 11,729 ms (40.70%) |
| Choir `AiOpponent.update` | 23,250 ms (17.03%) | 7,781 ms (27.00%) |
| Compact `AiOpponent.update` | 12,100 ms (8.87%) | 3,409 ms (11.83%) |
| `World.stepStructures` | 4,344 ms (3.18%) | 1,541 ms (5.35%) |
| `World.stepEconomy` | 3,102 ms (2.27%) | 1,035 ms (3.59%) |
| `World.stepProjectiles` | 2,589 ms (1.90%) | 852 ms (2.96%) |

| Detailed operation | Before | Final |
| --- | ---: | ---: |
| Late measured loop | 190,658 ms | 39,855 ms |
| `fireWeapons` | 68,755 ms (36.06%) | 2,604 ms (6.53%) |
| `fireBallisticAt` | 23,094 ms (12.11%) | 6,726 ms (16.88%) |
| Unit movement | 19,837 ms (10.40%) | 6,113 ms (15.34%) |
| Entity visibility | 14,113 ms (7.40%) | 4,697 ms (11.79%) |
| Target acquisition | 13,665 ms (7.17%) | 4,174 ms (10.47%) |
| Navigation direction | 12,491 ms (6.55%) | 3,814 ms (9.57%) |
| Unit separation | 9,029 ms (4.74%) | 2,790 ms (7.00%) |

The retained changes are intentionally narrow:

- Chord refinement uses the canonical impact-only integrator until the final
  trajectory, avoiding full path allocation for intermediate corrections.
- Drag solving retains its final canonical path for commit instead of integrating
  and allocating that path again.
- Exact failed non-chord geometry is cached by source, weapon, source position,
  target position, and target terrain height. Identical retries preserve the same
  false decision and cooldown without rerunning the solver. The cache is derived,
  bounded to 2,048 entries, and cleared on restore.
- Indexed target validation reads faction and surface position directly rather
  than resolving an unused height-bearing position.

Deterministic work accounting changed from 425,919 to 53,693 trajectory
evaluations, 30,850,503 to 9,303,571 integration steps, 566 to 135 full paths,
and 173,941 to 148,943 stored samples. There were 831 exact failed-plan cache
hits. Target validation reduced `positionOf` calls from 147,627 to 74,458.

The final periodic World hashes at ticks 9,000 through 63,311 were
`60e2a995`, `c97d4334`, `94d0af29`, `ffc507ce`, `b6d334f9`, `44de89ac`,
`f4cd99a4`, and `51e4cfb8`. Final controller hashes were `012d8801` and
`8d0533d5`; all matched repeated phase/detail runs. Winner, duration, end reason,
economy, production, losses, and destruction telemetry also matched the baseline.

A bounded four-seed accepted Veteran mirror subset (501, 1709, 2903, 4217)
completed with no draws and a 2,116.775-second mean duration. Its receipt is
`output/runs/20260802T004739.734Z-21264-11153377/receipt.json`. This subset is a
regression sample, not a replacement for any 20-match cohort gate.

Requirement 17.5 remains **open**. The final median is above 10 seconds and no
wall-clock assertion was added to the default suite. A pinned CI qualification
and further measured work on movement/navigation, visibility/acquisition, and
the remaining successful ballistic solves are still required.

## 2026-08-02 Second T480s Headless Pass

This pass started from the clean T480s receipt median supplied for the current
tree: 14.63 seconds for seed 501, ending at tick 63,311. Fresh low-background
phase/detail profiles reproduced the accepted representative hashes before any
edit.

| Profile metric | Before | Retained final |
| --- | ---: | ---: |
| Late phase loop | 16,034.84 ms | 14,925.94 ms |
| Detailed late loop | 23,861.62 ms | 22,737.28 ms |
| `World.stepUnits` (phase) | 6,453.90 ms | 5,691.80 ms |
| Successful/attempted `fireBallisticAt` | 4,130.55 ms | 4,155.74 ms |
| Unit movement | 3,746.23 ms | 3,749.61 ms |
| Target acquisition | 2,544.66 ms | 2,004.60 ms |
| Entity visibility API | 2,838.58 ms | 2,435.19 ms |
| Unit separation | 1,765.08 ms | 1,707.52 ms |
| Ballistic reach envelope | 934.26 ms | 576.47 ms |

The retained change is deliberately small. Target range rejection now precedes
visibility work, and a cooling non-burst weapon decrements its cooldown before
skipping range and ballistic-envelope evaluation. Burst timers retain their
original range/envelope gates. A work-count test proves that a cooling Longbow
performs zero reach-envelope checks while preserving the exact cooldown value.

Detailed deterministic work counts explain the reduction: reach-envelope calls
fell from 77,545 to 44,286, point-visibility scans from 396,406 to 363,764, and
line-of-sight scans from 86,421 to 66,110. The canonical ballistic workload was
unchanged at 53,693 trajectory evaluations, 9,303,571 integration steps, 135
full paths, and 148,943 stored samples. The envelope reduction also avoids at
least 33,259 short-lived velocity-object allocations in the necessary-condition
scan. A 32 KiB sampling heap profile observed about 18.4 MiB of sampled
allocation, but Vitest runs the simulation in a worker and the parent profile was
dominated by transform/module compilation; it was not used to claim a precise
simulation-byte reduction.

Experiments with successful-plan caching produced zero representative hits.
Replacing canonical `Math.hypot` operations changed hashes at tick 27,000.
Faction-filtered spatial views and separation/nav shortcuts were also removed
rather than carried speculatively. The historical four-seed receipt is stale for
the current dirty tree: after reverting every experiment, seed 1709 ended at
tick 62,277 rather than its old 79,827. Against that current-tree baseline, the
retained gate ordering kept the accepted subset outcomes at ticks 63,311,
62,277, 61,605, and 49,270, with the same 1 Compact / 3 Choir winners and end
reasons. The subset gates passed.

The final required receipt is
`output/runs/20260802T020302.514Z-4824-49e63899/receipt.json`. Standard simulation
runs were 15,548.28 / 13,679.98 / 13,884.20 ms, for a 13,884.20 ms median.
Terrain generation was 1,412.40 ms and remains reported separately.

The target therefore **fails**. Removing the entire measured 4.16-second
canonical ballistic solve cost would only put this host near 9.7 seconds before
accounting for interactions and variance. The successful geometries had no exact
cache reuse, and the faster numeric integrator changed deterministic hashes.
Reaching less than 10 seconds with margin now requires a semantics-approved
solver/cadence change or a larger canonical solver redesign, not another safe
lookup micro-optimization. No default wall-clock assertion was added.
