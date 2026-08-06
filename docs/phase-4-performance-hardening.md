# Phase 4 - Performance and Hardening

**Status:** Phase 4D complete; Phase 4E device and browser qualification is current.

**Frozen product baseline:** `a0c72a25f66548bec38df21e3996f9c1abaa1074`

## Goal

Hit repeatable frame, simulation, memory, startup, and recovery budgets on named
hardware without changing accepted gameplay semantics. Every optimization begins
with a source-current measurement and ends with deterministic and human-visible
regression evidence.

## Presentation Work During Deferred Qualification

Gate 4 still blocks formal performance closure, post-processing, volumetrics,
cinematic gameplay cameras, and new gameplay systems. A 2026-08-05 product
decision allows presentation-only preproduction and integration to proceed:
title screens, generated images/video, cutscenes, voices, music, and audio may be
added behind Low-quality, missing-media, and reduced-motion fallbacks without
changing simulation authority. Local generation credentials remain in ignored
`.env` files and must never enter source, receipts, logs, prompts, or artifacts.

## Sequence

### 4A - Measurement Foundation

- Capture clean source-current headless and browser baselines.
- Add a ten-minute soak and quality-switch stress scenario.
- Record CPU phases, frame percentiles, resources, allocation/heap observations,
  startup timing, renderer identity, and source hashes.
- Establish stable pinned-runner strategy before enforcing wall-clock CI limits.

### 4B - Requirement 17.5

- Reprofile the 72,000-tick standard-terrain match.
- Isolate successful ballistic solve, movement/navigation, visibility/acquisition,
  and separation costs.
- Preserve accepted outcomes, event order, and deterministic hashes.
- Use the evidence-based 15-second warm-median policy in
  `docs/headless-performance-policy.md` rather than changing gameplay semantics.
- Qualify the policy from clean source on the pinned reference runner.

### 4C - Renderer and GPU

- Profile Low, High, and Ultra separately.
- Audit draw calls, geometries, shader programs, dynamic uploads, and transparent overdraw.
- Prewarm every combat shader permutation.
- Add LOD/impostors only when profiling demonstrates a bottleneck.
- Preserve the stable direct-render fallback.

### 4D - Memory, Startup, and Recovery

- Audit simulation and presentation hot-loop allocation.
- Bound caches and verify long-session heap stability.
- Complete render-owner disposal and repeated-session construction tests.
- Reach under 15 seconds to first playable frame on minimum hardware.
- Add WebGL context-loss detection and recovery qualification.

Completed on 2026-08-05. The source-current T480s/UHD 620 Low run reached
first playable in 2.029 seconds during the full browser suite and 3.775 seconds
in an isolated run. A forced-GC 6,000-tick accelerated soak held heap and WebGL
resource counts flat. Render owners and whole sessions now have explicit
teardown, presentation starvation is bounded, ID lookup storage does not scale
with projectile IDs, and forced context loss pauses and restores the same match.
See `docs/phase-4d-hardening.md` and
`validation/evidence/phase-4d-hardening-2026-08-05.json`.

### 4E - Device and Browser Matrix

- Intel UHD 620 / T480s.
- GTX 1660-class.
- RTX 3070-class.
- Apple Silicon where available.
- Chrome, Edge, Firefox, and Safari where hardware is available.

The locally available T480s matrix now runs the full Chromium regression suite
plus shared boot, rendering, picking, context-recovery, and deterministic
scenario checks on Chrome stable, Firefox, and Playwright WebKit. All available
engines pass.
This is browser-engine compatibility evidence, not Safari or Apple-hardware
qualification. See `docs/phase-4e-device-browser-matrix.md`.

### 4F - CI Gates

- Pinned deterministic headless regression manifests.
- Browser-heavy frame gate.
- Ten-minute soak and resource plateau gate.
- Bundle/startup budgets.
- No flaky shared-machine wall-clock assertions.

## Hard Boundaries

- No optimization may silently alter gameplay, AI, ballistics, visibility,
  economy, navigation, damage, mission, or save semantics.
- Hash-changing numeric substitutions require an explicit design decision.
- No performance claim from concurrent browser workloads or dirty provenance.
- No secrets or ignored generation assets may enter any benchmark input.
- No feature work is bundled into a hardening change.

## Gate 4

1. 60 FPS at 1080p on GTX 1660-class hardware in heavy combat.
2. No frame exceeds 33 ms during a 10-minute representative match.
3. T480s 1280x720 DPR1 Low remains within its accepted candidate gate.
4. Requirement 17.5 passes or has a formally approved evidence-based revision.
5. No black frame, context loss, unbounded resource growth, or sustained heap growth.
6. No mid-combat shader compilation stutter.
7. Save/load and transient presentation state remain bounded.
