# T480s 720p Low Rendering Measurement

Measured on 2026-08-02 with Chromium 151 through ANGLE D3D11 on Intel UHD Graphics 620. Every browser-heavy run used the `heavy-combat` scenario at 1280x720, DPR 1, Low quality, a 3 second warmup, and a 10 second sample. Adaptive quality was disabled.

## Result

The candidate hard 30 FPS gate passes in the final measured run:

The p95 gate uses 34 ms rather than the mathematical 33.333 ms boundary because
Chromium reports synchronized frame intervals in one-decimal 16.7/33.4 ms
buckets on this hardware. The tolerance still requires at least 29.4 FPS at
p95 and avoids classifying a quantized 30 FPS frame as a regression.

Durable machine-readable evidence for the post-UX 5-second confirmation is tracked at `validation/evidence/t480s-heavy-combat-5s.json`. It records the scenario and target hashes, hardware/browser identity, complete timing metrics, source artifact hash, base code SHA, and dirty-worktree caveat. The historical table below remains the original 10-second optimization comparison.

| Metric | Baseline | Final |
| --- | ---: | ---: |
| RAF median | 83.3 ms | 16.7 ms |
| RAF p95 | 121.61 ms | 16.8 ms |
| RAF p99 | 166.686 ms | 17.955 ms |
| Render CPU median | 6.4 ms | 3.8 ms |
| Full-frame CPU median | 15.5 ms | 6.8 ms |
| Draw calls | 63 | 68 |
| Triangles | 378,780 | 115,044 |
| Programs | 15 | 15 |
| Textures | 2 | 2 |
| Context losses | 0 | 0 |
| Black frame | no | no |

Baseline receipt: `output/runs/20260802T000401.319Z-14184-1fff8792/receipt.json`

Final passing receipt: `output/runs/20260802T005203.552Z-18340-0034814b/receipt.json`

The immediately preceding run also passed at 16.7 / 33.3 / 33.4 ms: `output/runs/20260802T004108.399Z-21728-a5dc7e97/receipt.json`.

## Measured Variants

| Variant | RAF median / p95 / p99 | Full-frame CPU median | Triangles | Result |
| --- | --- | ---: | ---: | --- |
| Full terrain shader and geometry | 83.3 / 121.61 / 166.686 ms | 15.5 ms | 378,780 | fail |
| Low branch in standard terrain material | 50.0 / 66.7 / 66.8 ms | 12.6 ms | 377,188 | fail |
| Low branch plus 512x64 ring geometry | 33.4 / 50.1 / 50.1 ms | 10.6 ms | 115,044 | fail |
| Two Low explosion lights and cheap Low hull detail | 33.3 / 33.4 / 39.275 ms | 11.05 ms | 115,044 | fail on p95 rounding bucket |
| Dedicated Low terrain pass, final repeat | 16.7 / 16.8 / 17.955 ms | 6.8 ms | 115,044 | pass |

Intermediate receipts:

- Shader only: `output/runs/20260802T000728.090Z-10764-45977aea/receipt.json`
- Low geometry: `output/runs/20260802T001331.339Z-9624-34ffc821/receipt.json`
- Light cap: `output/runs/20260802T002154.309Z-13568-af76a57e/receipt.json`
- Cheap Low hull: `output/runs/20260802T002523.897Z-8308-a86b32b7/receipt.json`

## Quality Tradeoffs

Low uses a 512x64 ring mesh instead of the 1024x160 full-detail mesh. Its terrain material keeps terrain height, broad districts, slope contrast, rim treatment, structural bay lines, shadow-square bands, fog, tone mapping, and output color conversion, but omits close-range PBR, multi-octave noise, Worley cracks, height blending, detail normals, procedural roughness, and metalness.

Low hulls keep geometry, mask-based hull/recess/metal surfaces, faction emissive strips, and damage tinting. They omit procedural grain, grime, wear, and roughness noise. Low also shades at most two simultaneous explosion lights; High and Ultra retain fourteen. Contrails, particles, UI, the fixed 1280x720/DPR1 drawing buffer, and the direct renderer path are unchanged.

The full ring geometry and original terrain/hull material paths remain in use for Medium, High, and Ultra. They are created lazily and cached, so repeated quality changes plateau rather than leaking geometries, textures, or programs.

## Visual Evidence

The pre-change and final High `signature-lance` JSON signatures retain the same perceptual hash `760000fffffbdfb8` and difference hash `0b384cd4ab4e6d8c`. Final global mean luminance changed by 0.006%, variance by 0.087%, mean chroma by 0.007%, and edge density by 0.11%; every sky/ground/unit/UI statistic remained within 0.8% of baseline. The Ring, terrain, units, and UI therefore remain nonblank and coherent without relying on exact cross-GPU pixels.

- Before: `output/runs/20260802T000406.609Z-14344-1aa6f74d/artifacts/signature-lance.visual-signature.json`
- After: `output/runs/20260802T005344.256Z-22660-dfceaeec/artifacts/signature-lance.visual-signature.json`

The visual command reports `baseline-created` because `signature-lance.json` does not yet embed an `expectedVisual` block. The before/after JSON artifacts were therefore inspected directly; no exact cross-GPU pixel assertion was introduced.

## Post-UX Confirmation

The requested 5-second `heavy-combat` rerun passed the same `720p-low-hard-candidate` gate: 16.7 ms median, 33.3 ms p95, 39.542 ms p99, one frame over 100 ms, 63 draw calls, 114,736 triangles, no context losses, and no black frame. The tracked report is `validation/evidence/t480s-heavy-combat-5s.json`; its ignored source receipt remains reproducible from the command recorded there.
