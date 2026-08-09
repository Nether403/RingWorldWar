# Phase 4 Execution Plan

## 4A Measurement

- [x] Run source-current doctor and browser capability receipt.
- [x] Run three 72,000-tick standard headless samples.
- [x] Run source-current T480s 30-second heavy-combat sample.
- [x] Capture High/Ultra resource characterization.
- [x] Add an accelerated ten-minute soak and quality-thrash regression (18,000 fixed ticks, repeated quality transitions, forced-GC heap/resource plateau, and simulation-hash guard). This is structural coverage, not the physical GTX Gate 4 soak.
- [x] Record baseline report with exact source and hardware provenance.

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

- [x] Profile GPU/CPU frame components for Low, Medium, High, and Ultra on the T480s reference GPU.
- [x] Complete dynamic-upload, transparent-effects, active-quality shader-prewarm, and HUD attribution.
- [x] Isolate the full procedural PBR terrain path as the dominant Intel UHD 620 GPU cost.
- [x] Prewarm active-quality forward and generated shadow programs before the playable frame.
- [x] Conclude that no LOD/batching, upload-range, or transparent product change is justified.
- [x] Keep the current minimap cadence; Phase 4D did not show sustained HUD CPU or heap pressure.

## 4D Hardening

- [x] Zero-allocation and bounded-cache audit.
- [x] Long-session heap and teardown tests.
- [x] Startup under 15 seconds.
- [x] Context-loss and recovery tests.

## 4E/4F Qualification

- [x] Browser compatibility matrix on the T480s: Chromium, Chrome stable, Firefox, and Playwright WebKit.
- [ ] Physical device/browser matrix: GTX 1660, RTX 3070, Apple Silicon, Edge, and Safari where available.
- [ ] CI performance manifests and stable thresholds.
- [ ] Ten-minute 1080p GTX 1660 Gate 4 soak.
