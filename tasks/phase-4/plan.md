# Phase 4 Execution Plan

## 4A Measurement

- [x] Run source-current doctor and browser capability receipt.
- [x] Run three 72,000-tick standard headless samples.
- [x] Run source-current T480s 30-second heavy-combat sample.
- [ ] Capture High/Ultra resource characterization.
- [ ] Add ten-minute soak and quality-thrash scenarios.
- [ ] Record baseline report with exact source and hardware provenance.

## 4B Simulation

- [x] Profile late-loop phases and allocations.
- [x] Align ballistic counters to the profiler warmup window and attribute by caller/faction/weapon.
- [ ] Add internal Newton failure/elevation-seed diagnostics and a simulation ballistic-event transcript if deeper solver work resumes.
- [x] Isolate JIT and shared-machine contention on a clean pinned runner; retain GC as diagnostic-only.
- [x] Decide ballistic solver/cadence semantics for the rejected ranked-seed experiment.
- [x] Implement measured optimization increments with hash guards; retain none without evidence.
- [x] Experiment: impact-only result dead-store removal — rejected after no measured wall improvement.
- [x] Experiment: ranked four-seed drag solver — rejected after 95% Choir Veteran-mirror win rate.
- [x] Experiment: terrain-ceiling query skip — rejected after no measured wall improvement.
- [x] Experiment: battery-only envelope factors 0.80/0.81/0.82 — rejected; fast factors fail mirror balance and 0.82 misses performance.
- [x] Experiment: tangent-Jacobian and guarded tangent failure screens — rejected after 17.320 s direct and 11.321-12.627 s guarded medians.
- [x] Qualify Requirement 17.5 on pinned hardware.
- [x] Define the Requirement 17.5 runner, warmup, sample, statistic, and 15-second candidate budget.
- [x] Run the executable candidate policy and preserve a provisional 14.021-second warm-median receipt.
- [x] Add the protected manual GitHub Actions qualification workflow.
- [x] Register `t480s-headless-01`, configure the protected Environment, and capture clean protected run `30990813691`.

## 4C Renderer

- [ ] Profile GPU/CPU frame components by quality.
- [ ] Audit geometry, draw, dynamic upload, shader, smoke, and HUD costs.
- [ ] Prewarm combat permutations.
- [ ] Add only profile-justified LOD/batching changes.

## 4D Hardening

- [ ] Zero-allocation and bounded-cache audit.
- [ ] Long-session heap and teardown tests.
- [ ] Startup under 15 seconds.
- [ ] Context-loss and recovery tests.

## 4E/4F Qualification

- [ ] Device/browser matrix.
- [ ] CI performance manifests and stable thresholds.
- [ ] Ten-minute 1080p GTX 1660 Gate 4 soak.
