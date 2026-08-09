# Graph Trace Report

**Project:** RingWorldWar  
**Generated:** 2026-08-09  
**Graph:** `graphify-out/graph.json`

## Scope

This report records the source-reviewed disposition of the issues originally raised by `GRAPH_REPORT.md` and the remediation now represented in the graph. It distinguishes source defects from graph-extraction limits and from qualification evidence that requires a separate canonical refresh.

## Graph Quality And Limits

- Current rendered graph: 2,681 nodes, 6,842 edges, 190 communities.
- Current `graph.json` contains zero dangling edges and zero self-loops.
- The graph was refreshed from commit `56a07093` with local AST extraction.
- Three changed documentation files were skipped during semantic extraction because no supported LLM API key was configured. Their older semantic nodes may remain until a keyed rebuild.
- Community labels were regenerated from graph hubs rather than an LLM, so several labels are implementation symbols rather than plain-language names.
- AST import/reference edges establish structural dependency, not state mutation. Source review remains authoritative for command/query classification.

## Executive Summary

The source review corrected two overstatements in the original graph report and confirmed three bounded improvements:

1. The reported AI cycles were source/type cycles, not runtime ESM cycles. Shared types now live in `src/ai/contracts.ts`, and the refreshed report detects no import cycles.
2. Browser validation scenarios are intentionally distinct from production runtime scenarios. Direct Playwright consumers now call the canonical browser `parseScenario()` before page injection.
3. Break the Line now hashes the exact bytes it parses, emits complete scenario identity, and records full dirty-worktree provenance.
4. `World` remains the concrete simulation aggregate. Its reviewed authority owners are now documented and enforced by repository lint rather than by shallow command/query interfaces.
5. Broad `Faction` projections and a physical `data.ts` decomposition remain deferred because source review found no current defect and the move would require coordinated LS-07/LS-09 requalification.

## Trace 1: AI Dependency Direction

### Evidence

- `Difficulty` and `StrategicGoal` are defined in `src/ai/contracts.ts:1-3`.
- `behaviorTree.ts` imports `Difficulty` from `contracts.ts` at `src/ai/behaviorTree.ts:1`.
- `tactician.ts` imports `Difficulty` and `StrategicGoal` from `contracts.ts` at `src/ai/tactician.ts:15`.
- `opponent.ts` imports and re-exports those public types while retaining the runtime `Tactician` dependency.
- `tools/lint.mjs:75-83` rejects a future lower-level import from `./opponent`.
- `GRAPH_REPORT.md:216-217` reports no import cycles.

### Finding

The runtime and source dependency direction is now one-way:

```text
opponent.ts -> tactician.ts -> behaviorTree.ts
      |              |               |
      +--------------+---------------+-> contracts.ts
```

The behavior-tree and tactical modules no longer depend on the strategic opponent implementation.

### Verification

- AI behavior, tactics, strategy, artillery, serialization, and core-match tests passed after the move.
- Typecheck and lint passed.

## Trace 2: Browser Scenario Validation And Provenance

### Evidence

- The canonical browser parser remains `parseScenario()` at `tools/rww/scenario.mjs:38`.
- Break the Line reads raw bytes, parses those bytes, and hashes the same bytes at `e2e/break-line.spec.ts:9-12`.
- Direct scenario consumers in `break-line.spec.ts`, `tutorial.spec.ts`, `counterfire.spec.ts`, `signal-in-spine.spec.ts`, `hud.spec.ts`, and `scenario.spec.ts` now call `parseScenario()`.
- `tests/tools/scenario.test.ts:39-48` parses every tracked browser scenario artifact.
- `tests/tools/scenario.test.ts:50-70` binds the current Break the Line bytes to completion, visual, and T480 evidence.
- Break the Line completion evidence now includes schema, version, id, revision, path, SHA-256, and the repository's full `collectGit()` provenance snapshot.
- Production runtime coverage remains separate in `e2e/runtime-scenario.spec.ts` through `parseRuntimeScenario()` and `createRuntimeScenarioWorld()`.

### Finding

The original recommendation to send browser fixtures through the runtime parser was incorrect. The repaired seam is:

```text
validation/scenarios/*.json
  -> JSON decoding
  -> parseScenario()
  -> applyBrowserScenario()
```

Production authored runtime scenarios retain their different schema and production factory path.

### Verification

- All 10 tracked browser scenario JSON artifacts passed strict parsing.
- Break the Line completion passed and emitted scenario/provenance evidence.
- Scenario, tutorial, counterfire, signal, HUD, and Break the Line browser paths passed except for two unrelated committed LS-10 assertions documented below.

## Trace 3: World Authority Seam

### Evidence

- `docs/architecture.md:91-99` classifies external use as commands, queries, and state transfer.
- `tools/lint.mjs:39-57` defines reviewed owners for lifecycle, bootstrap, gameplay command, event-drain, and persistence methods.
- `tools/lint.mjs:59-85` normalizes Windows paths, checks authority calls, and prevents the AI dependency from reversing.
- `tests/tools/lint.test.ts` covers allowed owners, unauthorized command/state-transfer callers, and the AI import direction.
- `Game` and the headless runner remain the only event-drain owners; scenario construction remains the only external spawning/topology owner.

### Finding

Source review found no current unauthorized mutation defect. The useful fix was to preserve the existing authority model with executable checks. A type-level `WorldCommands`/`WorldQueries` split would not create a real seam while entity lookups still return mutable objects.

### Verification

- Repository lint passes with the new authority checks.
- World determinism, serialization, headless observer, renderer, and presentation-event tests pass.

## Rejected Or Deferred Findings

### Faction Projections

`Faction` is already a two-member identity at `src/sim/data.ts:15-18`. Presentation, audio, headless, scenario, AI, and simulation consumers do not share one oversized faction object. New per-layer projection interfaces would add indirection without reducing meaningful coupling.

### data.ts Physical Split

`src/sim/data.ts` does mix content catalogs, faction modifiers, presentation labels/colors, and global/default rules. It does not contain test fixtures. A later qualified refactor may extract faction identity, presentation metadata, and simulation rules, but must coordinate source-bound LS-07/LS-09 evidence rather than manually changing hashes.

### World Interface Extraction

No broad command/query interface is warranted until a real second adapter, worker authority, multiplayer authority, or independent command producer appears.

## Remaining Blockers Outside This Remediation

### Qualification Evidence

The concurrent commit that captured the AI contract move changed `src/ai/opponent.ts`, but LS-07 and LS-09 receipts still contain its previous SHA-256. `tests/tools/progress-manifest.test.ts` therefore fails current-source validation. This requires canonical requalification and independent review; the hashes must not be manually patched.

### Existing Chromium Assertions

The focused Chromium run passed 23 of 25 tests. Two committed LS-10 assertions remain failing:

- `e2e/runtime-scenario.spec.ts:78` expects the authored engineer to remain inside the old tactical framing after camera changes.
- `e2e/scenario.spec.ts:106` expects `SENSOR COVERAGE`, while the current HUD renders `SENSOR · 1 BASTION`.

These failures are unrelated to scenario parsing and authority linting and should be resolved in the LS-10 change set.

## Verification Summary

- `npm run lint`: passed.
- `npm run build`: passed.
- Unit suite excluding the stale qualification-integrity test: 443 passed, 1 skipped.
- `npm run validate:core-match`: passed.
- Focused Chromium regression: 23 passed, 2 unrelated committed LS-10 failures.
- Rendered graph integrity: 2,681 nodes, 6,842 edges, zero dangling edges, zero self-loops.
- Import cycles: none detected.

## Recommended Next Actions

1. Requalify LS-07 and LS-09 through the canonical evidence workflow for the committed `opponent.ts` change.
2. Reconcile the two LS-10 Chromium assertions with the intended camera and HUD behavior.
3. Run a keyed Graphify semantic update so the three changed documentation files and community labels are refreshed.
4. Revisit the bounded `data.ts` split only in a dedicated requalification window.
