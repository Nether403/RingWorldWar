# Phase 4E - Device and Browser Matrix

**Status:** Available local browser engines qualified on the T480s on
2026-08-05. Additional physical device classes remain open.

## Contract

Every available engine must:

- boot Low quality at 1100x640/DPR1 with WebGL2;
- reach a successfully rendered playable frame within 30 seconds;
- advance authoritative simulation and preserve ground picking;
- render a non-black, non-uniform frame with the active shader topology;
- report no console errors or uncaught page errors;
- pause and resume the same match through `WEBGL_lose_context`;
- apply deterministic scenarios at tick zero with identical state hashes; and
- pass scenario rendering, directional artillery HUD, and firing authority.

Chromium runs the full 58-test regression and presentation suite. Chrome stable,
Firefox, and WebKit each run two matrix tests, three deterministic scenario
tests, and two bounded presentation/media compatibility tests.

## Results

The final source-bound media-enabled suite passed all 79 tests. Timing and frame
values are characterization rather than portable gates and therefore live only
in `validation/evidence/phase-4e-browser-matrix-2026-08-06.json`, alongside the
exact report and receipt hashes for that run.

### Chromium 151.0.7922.34

- Classification: hardware browser qualification on this T480s.
- Renderer: Intel UHD Graphics 620 through ANGLE D3D11.
- Programs after boot: 17; after Medium recovery: 18 with a live shadow map.
- Boot, recovery, full regression, and scenarios: pass.

### Google Chrome Stable 150.0.7871.187

- Classification: branded-browser compatibility on this T480s.
- Renderer: Intel UHD Graphics 620 through ANGLE D3D11.
- Programs after boot: 17; after Medium recovery: 18 with a live shadow map.
- Boot, recovery, and scenarios: pass with no console errors.

### Firefox 153.0

- Classification: compatibility qualification on this T480s.
- Renderer: ANGLE D3D11 with Firefox's privacy-coarsened Intel renderer string.
- `KHR_parallel_shader_compile` is unavailable; synchronous compilation passes.
- Programs after boot: 17; after Medium recovery: 18 with a live shadow map.
- Boot, recovery, and scenarios: pass with no console errors.

### Playwright WebKit 26.5

- Classification: WebKit compatibility on Windows, not Safari or Apple hardware.
- Reported renderer: Apple GPU. This is the Playwright WebKit backend identity
  and must not be interpreted as physical Apple GPU evidence.
- Programs after boot: 17; after Medium recovery: 18 with a live shadow map.
- Boot, recovery, and scenarios: pass with no console errors.

## Determinism

All four browser projects repeated the same tick-zero scenario three times and
produced the same hashes:

- Pre-setup state hash: `a4edc7b0`.
- Applied scenario state hash: `a8809baa`.

## Defect Found

The first WebKit recovery run resumed rendering but logged
`INVALID_OPERATION` while deleting a PMREM target owned by the lost context.
The recovery path now abandons invalid context-owned handles without issuing
deletes, then creates fresh PMREM and shadow resources after restoration. A unit
test verifies the abandoned target is not disposed, and the final WebKit
recovery run has zero console and page errors.

## Unavailable Matrix Cells

- Microsoft Edge stable: not installed on the current machine.
- Safari: unavailable on Windows; Playwright WebKit is not a substitute for
  Safari/macOS qualification.
- GTX 1660, RTX 3070, and Apple Silicon: not present on the current machine.

No unavailable matrix cell is treated as a pass. These remain Phase 4E work
subject to hardware access.

## Verification

- `npm run lint`: passed.
- `npm test`: 323 passed; one opt-in performance profile skipped.
- `npm run build`: passed.
- `npm run test:e2e:qualify`: 79 passed across four projects with a source-bound
  JSON report and qualification receipt.
- CI installs all bundled Playwright engines plus Chrome stable before running
  the same multi-project suite.
