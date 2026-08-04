# Implementation Plan: Phase 3D and Phase 3E

## Overview

Deliver battlefield memory first, freeze a technical checkpoint, then redesign
the tactical HUD against that completed battlefield. Both phases remain
presentation-only and are reviewed together by the player.

## Architecture Decisions

- Existing visibility-filtered `SimEvent` batches remain the only aftermath and
  event-rail source.
- Scars store ring coordinates and rebuild one shared terrain-conforming buffer.
- Debris is one fixed `InstancedMesh`; smoke reuses the existing point pool.
- Existing wreck lifetime derives fall/settle age without persistence changes.
- HUD behavior/selectors remain stable; visual hierarchy is additive.
- Phase 3D receives independent receipts before Phase 3E begins.

## Task List

### Phase 3D

- [ ] D1: Add presentation-only Chord classification and quality caps.
- [ ] D2: Add bounded ring-space scar and debris pools with deterministic eviction.
- [ ] D3: Add smoke emitters, wreck fall/settle, and transient reset coverage.
- [ ] D4: Add distinct Chord visual/audio treatment using existing events.
- [ ] D5: Add deterministic aftermath scenario and technical checkpoint evidence.

### Phase 3D Checkpoint

- [ ] Unit, browser, lint, build, visual, and T480s gates pass.
- [ ] No simulation/schema changes or hidden-event leakage.
- [ ] Record source-current aftermath and performance receipts.

### Phase 3E

- [ ] E1: Establish responsive HUD zones and final visual tokens.
- [ ] E2: Patch resources and selection hierarchy in place with semantic HP/order state.
- [ ] E3: Add command mode/acknowledgment and bounded visible event rail.
- [ ] E4: Improve minimap frame, focus, dialogs, settings, and accessibility fallbacks.
- [ ] E5: Add HUD browser coverage and recapture affected visual scenarios.

### Combined Checkpoint

- [ ] Full unit/browser/lint/build gates pass.
- [ ] Final signature, aftermath, mission, and HUD receipts are source-current.
- [ ] T480s Low passes after both phases.
- [ ] Ready for combined human review.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Transparent smoke overdraw | High | Shared particle cap, emitter throttling, Low caps |
| Hidden-event history leak | High | Consume only Game-filtered presentation batches |
| Scar drift on ring/rebase | High | Canonical ring-space storage and terrain rebuild tests |
| HUD selector/input regression | High | Preserve classes/data/accessibility contracts, full E2E |
| DOM churn/focus loss | Medium | Persistent nodes and stable-key focus restoration |
| Visual clutter | Medium | Priority caps, semantic scenarios, joint human review |
