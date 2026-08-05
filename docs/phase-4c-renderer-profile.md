# Phase 4C Renderer Profile

**Status:** Phase 4C and 4C-2 complete; long-session heap/resource stability moves to Phase 4D.

## Method

- Deterministic `heavy-combat` scenario.
- 1280x720 at DPR 1 on Intel UHD Graphics 620 / ANGLE D3D11.
- Adaptive quality disabled.
- Two presentation-only compile frames before a three-second warmup.
- Five-second steady-state samples for Low, Medium, High, and Ultra.
- Asynchronous `EXT_disjoint_timer_query_webgl2` samples with disjoint rejection.

## Quality Results

| Quality | RAF median | GPU median | GPU p95 | Full-frame CPU median | Calls | Triangles | Programs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 16.7 ms | 5.756 ms | 7.674 ms | 4.6 ms | 66 | 117,199 | 16 |
| Medium | 50.0 ms | 49.186 ms | 59.097 ms | 5.9 ms | 111 | 426,774 | 18 |
| High | 66.7 ms | 60.259 ms | 69.268 ms | 5.15 ms | 111 | 427,558 | 18 |
| Ultra | 66.7 ms | 67.220 ms | 73.232 ms | 7.4 ms | 111 | 428,134 | 18 |

High and Ultra have similar resource signatures at DPR 1, with Ultra adding about
7 ms GPU median. Medium through Ultra are GPU-bound; their synchronous CPU frame
work remains below 8 ms median in the source-current runs.

## Isolation Results

| Medium diagnostic | GPU median | Calls | Triangles |
| --- | ---: | ---: | ---: |
| Default | 49.186 ms | 111 | 426,774 |
| Shadows disabled | 44.508 ms | 71 | 381,943 |
| Low terrain path, shadows retained | 8.136 ms | 111 | 164,630 |

The dominant cliff is the full procedural PBR terrain path. Disabling shadows
recovers only about 4.7 ms, while replacing the terrain path recovers about 41 ms.
Replacing High/Ultra terrain with the Low material would be a substantial visual
downgrade, so the diagnostic override is not retained as product behavior.

## Other Findings

- The timer-query extension is available and now produces non-blocking GPU-time
  distributions in normal browser-performance receipts.
- Quality/variant changes can create exceptionally long first shader frames. The
  benchmark now compiles two presentation-only frames before starting warmup.
- Draw calls remain well below the architectural 400-call ceiling. No batching or
  LOD system is justified by current evidence.
- Dynamic upload bytes, transparent subsystem A/Bs, shader prewarm qualification,
  HUD attribution, and ten-minute resource/heap stability remain future Phase
  4C/4D evidence.

Tracked data: `validation/evidence/phase-4c-t480s-quality-2026-08-05.json`.

## Phase 4C-2 Attribution

Production now prewarms the active quality after scene, lights, fog, terrain,
effects, entities, and dressing are configured, while the boot overlay remains
visible. The final source-current Low run measured 848.4 ms, produced 17 programs,
and showed zero programs missed by startup and zero late combat programs.

The Low heavy-combat upload inventory measured 1,254,048 bytes/frame median:

- Transparent effects account for approximately 572,064 bytes/frame.
- Markers account for approximately 230,400 bytes/frame.
- Remaining entity/other buffers account for approximately 451,584 bytes/frame.

Diagnostic removal of effects or markers reduced upload bytes but did not produce
a repeatable GPU or delivered-frame improvement. No update-range complexity is
retained.

HUD p95 measured 0.9-1.7 ms, dominated by the minimap at 0.8-1.4 ms; selection
remained near 0.1 ms. The visual-only hidden-HUD diagnostic correctly left HUD
CPU work running, so it does not authorize a cadence conclusion. No HUD cadence
change is retained without a separate state-preserving CPU experiment.

Tracked attribution: `validation/evidence/phase-4c2-attribution-2026-08-05.json`.
