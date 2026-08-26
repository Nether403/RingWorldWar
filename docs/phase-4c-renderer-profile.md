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

### Superseded: the terrain cliff was addressed

The numbers above are the measurements that motivated Task 10 of
`docs/procedural-graphics-overhaul.md`, and the terrain figures no longer describe
the renderer. The terrain fragment shader used to recompute several
kilometre-scale noise fields per pixel to decide where each material went; those
regions are now baked into vertex attributes by the terrain generator, and the
district fields moved to the vertex stage.

Re-measured with the same isolation method:

| Medium diagnostic | GPU median | Calls | Triangles |
| --- | ---: | ---: | ---: |
| Default | 40.170 ms | 122 | 429,656 |
| Low terrain path, shadows retained | 19.150 ms | 122 | 167,512 |
| Terrain path attribution | 21.020 ms | | |

The terrain path costs 21.0 to 23.6 ms across two same-session pairs, against
41.05 ms here: a 43 to 49% reduction.

Two things make the rows above non-comparable to the rows in this section, and only
the attribution should be compared across them. Medium now routes through the owned
post stage added in Phase 1, which is ten extra fullscreen passes and lifts the
low-terrain floor from 8.136 ms to about 19 ms. And Medium, High, and Ultra now
differ in the terrain shader itself rather than only in pixel ratio and shadow map
size. Whole-tier medians are 45.103, 54.287, and 58.256 ms, all lower than the
table above despite carrying the extra passes.

Receipts:
`validation/evidence/procedural-graphics/t480s-medium-default-task10.json` and
`t480s-medium-low-terrain-task10.json`.

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
