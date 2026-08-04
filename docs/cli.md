# RWW CLI

The Milestone 1 CLI orchestrates the existing Vite, Playwright, and Vitest engines. It does not replace their normal `dev`, `test`, or `build` scripts.

```bash
npm run rww -- doctor --json
npm run rww -- doctor --browser --target validation/hardware/t480s-low.json
npm run rww -- run validation/manifests/veteran-mirror.json --repeat 2
npm run rww -- perf headless-40m --terrain standard --runs 3 --ticks 72000
npm run rww -- visual signature-lance
npm run rww -- visual signature-lance --compare
npm run rww -- visual rim-atmosphere
npm run rww -- visual faction-readability
npm run rww -- play signature-lance
npm run rww -- perf browser-heavy --scenario signature-lance --target validation/hardware/t480s-low.json --seconds 30 --json
npm run rww -- play directional-artillery
npm run rww -- play directional-artillery --headless --seconds 2
npm run rww -- perf browser-heavy --scenario heavy-combat --target validation/hardware/t480s-low.json --seconds 30
npm run rww -- perf browser-heavy --seconds 5 --json
```

Each executed command writes a versioned receipt under ignored `output/runs/<run-id>/receipt.json`. Receipts separate deterministic inputs/results from environmental system, Git, timing, and log data. Artifact entries include SHA-256 hashes. Reproduction data contains the normalized argument array plus separately quoted PowerShell and POSIX commands; internal execution continues to use argument arrays.

Git provenance records the `HEAD` source-base SHA, dirty flag, SHA-256 of the staged plus unstaged `git diff --binary HEAD`, and a sorted manifest of non-ignored untracked source paths and content SHA-256 values. The manifest also has an aggregate SHA-256 and count. Git-ignored paths such as `output/` are omitted by `git ls-files --others --exclude-standard`. `validation/evidence/**` is explicitly excluded from the untracked-source manifest so a tracked evidence summary can quote a receipt digest without hashing itself; this exclusion and its pattern are recorded in every receipt. Evidence files remain represented by their own artifact/receipt hashes.

Exit codes are stable: `0` success, `2` usage/configuration error, `3` deterministic or gate failure, and `4` infrastructure/runtime failure.

`doctor --browser` reuses a Ring World War Vite server at port 5180 when one is already running; otherwise it starts an isolated Vite process and cleans it up. The T480s target contains candidate 720p Low budgets and an advisory 1080p target. Doctor reports these as `not-measured`: certification requires a future representative visual benchmark, not a capability probe.

## Browser scenarios

Browser scenarios live under `validation/scenarios/` and use strict `rww.browser-scenario` version 1 JSON. They pin the world seed, quality, viewport and DPR, 30 Hz target tick, visual time, camera, public-API entity setup, observation masks, benchmark windows, and coarse invariants. Unknown fields and unsafe scenario names are rejected as configuration errors.

`play <scenario>` strictly parses the same scenario, starts or reuses Vite, launches a headed hardware Chromium session (ANGLE D3D11 on Windows), applies the scenario through the browser scenario driver, resumes the normal game loop, and hands control to the tester. Close the page/browser or press Ctrl+C to finish. `--seconds N` automatically closes an observed or smoke session after `N` seconds. `--headless` is reserved for automated smoke runs.

Each play session writes an ignored `playtest-notes.md` beside its receipt and prints both paths plus the exact reproduction command. The receipt records the scenario and notes hashes, pre-setup/applied/post-session state, browser and renderer identity, observed duration, and console/page errors. The notes are a local template only: the launcher does not collect or transmit playtest data. See `docs/player-observation-protocol.md` before moderating a human session.

`visual` launches or reuses an isolated Vite server, runs the scenario in Chromium, and writes an ignored lossless PNG, a tracked-compatible visual-signature JSON, a visual manifest, and a receipt under `output/runs/<run-id>/`. Signatures contain luminance/chroma grids, a histogram, edge density, perceptual and difference hashes, and sky/ground/unit/UI region statistics. A scenario without `expectedVisual` is reported as `baseline-created` with a warning. `--compare` only produces a pass/fail when the scenario embeds an expected signature and explicit coarse tolerances; the command never treats exact cross-GPU pixels as portable.

For the Phase 3A signature gate, first capture `signature-lance` without an
expected visual and review the generated frame against
`docs/phase-3a-signature-battlefield.md`. Capture it on the Intel UHD 620 target
and at least one second renderer class before choosing coarse tolerances. Embed
the accepted signature and measured tolerances in the scenario, then run
`visual signature-lance --compare`. Screenshots remain ignored; receipts and
tracked evidence retain source, renderer, scenario, artifact, and signature
hashes.

`perf browser-heavy` always uses Low quality and disables adaptive quality. On Windows Chromium is launched through ANGLE D3D11 with GPU rasterization enabled; a detected software renderer is an infrastructure failure. The command uses the selected target's candidate Low resolution, warms up for the scenario-defined interval, and samples real RAF intervals for `--seconds`. It reports median/p95/p99 frame intervals, long frames per minute, render/simulation/full-frame distributions, renderer resources, context loss, a coarse black-frame check, optional timer-query availability, and the candidate target verdict. `EXT_disjoint_timer_query_webgl2` is advisory and never required.

The T480s frame-budget remains `not-measured` in `doctor`. Only `perf browser-heavy --target validation/hardware/t480s-low.json` evaluates that budget.

## PBR calibration

`/dev/calibration?quality=high` boots an isolated deterministic calibration scene
instead of a match. It uses the production renderer, ACES exposure, output color
space, generated environment map, analytic atmosphere, fog, key light, and hull
material. The page contains chrome and grey reference balls, roughness and
metalness sweeps, a generated 24-patch chart, environment material swatches, and
a generated Compact reference mech. It creates no World, AI, HUD, gameplay input,
or audio authority.

Use `visual rim-atmosphere` for the deterministic axial-space/rim artifact and
`visual signature-lance` for the ringward fog, far-ring, unit-readability, and
combat composition artifact. Both remain baseline candidates until human review
and cross-renderer tolerances are recorded.

`visual faction-readability` and `play faction-readability` present paired
Compact and Choir shared classes, exclusive units, production structures, and
controlled healthy/damaged states. Use this as the Phase 3C one-second faction,
class, and critical-damage comprehension gate.
