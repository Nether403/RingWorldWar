# Phase 4D - Memory, Startup, and Recovery

**Status:** Complete on the T480s reference machine on 2026-08-05.

## Scope

Phase 4D hardened the existing product without changing simulation, AI,
ballistics, visibility, economy, rendering quality, or accepted visuals. The
work covered bounded memory, explicit ownership, startup-to-first-playable
measurement, and WebGL reset behavior.

## Retained Changes

- Replaced sparse entity and bucket lookup arrays with ID-keyed maps. Projectile
  IDs no longer create empty entity-index slots, and dead entities are removed
  from derived indexes at deterministic compaction boundaries.
- Capped presentation events at 4,096 when rendering is starved. Ordinary frame
  draining remains unchanged.
- Added complete geometry, material, instanced-buffer, render-target, DOM,
  listener, audio, RAF, canvas, and renderer disposal through one reverse-order
  session cleanup stack.
- Made navigation teardown BFCache-aware and removed failed renderer canvases.
- Measured navigation start through the first successfully rendered interactive
  frame. Startup keeps shader prewarm behind the boot overlay.
- Added application-level WebGL loss handling. Loss pauses simulation and input;
  restoration regenerates the PMREM environment, synchronously recompiles the
  active shader topology, and resumes the same match. A stalled restore leaves
  the match in memory and offers an explicit reload button after ten seconds.

## T480s Evidence

Hardware identity:

- CPU: Intel Core i7-8650U, 8 logical CPUs.
- GPU: Intel UHD Graphics 620 through ANGLE D3D11.
- Browser: Chromium 151.0.7922.34.
- Hardware doctor viewport: 1280x720, DPR 1, Low quality, hardware rendering.
- Startup/soak Playwright viewport: 1100x640, DPR 1, Low quality.

Startup:

- Full 44-test browser suite: 2,028.5 ms navigation-to-first-playable.
- Isolated source-current sample: 3,774.5 ms.
- Isolated shader prewarm: 1,044.3 ms.
- Contract: less than 15,000 ms. Both samples pass.

Accelerated soak:

- 6,000 fixed simulation ticks, AI disabled, synthetic impact pressure,
  presentation every 30 ticks, and forced garbage collection between samples.
- Used JS heap: 37,300,000 bytes at warm, later, and final samples.
- WebGL resources: 136 geometries, 2 textures, and 17 programs at every sample.
- Final heap growth from warm sample: 0 bytes.

Teardown and recovery:

- Three repeated construction/explicit-disposal cycles returned canvas, HUD,
  and settings owners to zero each time.
- Weak references proved that disposed Game, Renderer, and HUD graphs were not
  retained after forced garbage collection.
- Forced `WEBGL_lose_context` held the world tick stable, regenerated the PMREM
  texture, restored programs, and resumed the same World instance.
- A deliberately stalled restore kept the simulation paused and exposed the
  explicit reload fallback.

Simulation guard:

- Source-current local headless warm median: 9,838.971 ms across three measured
  standard-terrain runs after one excluded warmup.
- Canonical MatchResult SHA-256 remained
  `6cbce1c53391f33b78949037500c429fc1b59b2c74ee051ed9cebce001fac9c0`.

## Verification

- `npm run lint`: passed.
- `npm test`: 322 passed; one opt-in performance profile skipped.
- `npm run build`: passed.
- `npm run test:e2e`: 44 passed.
- Independent lifecycle/code review: approved after BFCache, repeated-loss,
  PMREM, asynchronous recovery, instanced-disposal, and failed-construction
  findings were corrected.

## Limits

- The accelerated soak is a deterministic lifecycle qualification, not the open
  ten-minute 1080p GTX 1660 Gate 4 soak.
- Firefox, Safari/WebKit, Apple Silicon, GTX 1660, and RTX 3070 qualification
  remain Phase 4E work subject to available hardware.
- Browser history uses a synthetic persisted `pagehide` assertion in addition
  to repeated real navigation; a portable real BFCache round trip remains useful
  matrix evidence rather than a Phase 4D code blocker.
