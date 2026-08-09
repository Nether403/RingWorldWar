# Graph Trace Report

**Project:** RingWorldWar  
**Generated:** 2026-08-09  
**Graph:** `graphify-out/graph.json`

## Scope

This report traces the five recommended questions from `GRAPH_REPORT.md`, then records the architectural follow-ups the graph supports. It is an evidence report, not an implementation plan: no source files were changed.

## Graph Quality And Limits

- Corpus: 386 files, approximately 303,939 words.
- Rendered graph: 2,666 nodes, 6,795 edges, 232 communities.
- Audio and video content was not transcribed because the optional `faster-whisper` dependency is not installed. The 69 media files therefore contribute file metadata but no spoken-content concepts.
- The extraction diagnostic found 207 dangling edges, 1 self-loop, 45 directed endpoint collapses, and 48 undirected endpoint collapses. Dangling edges were not rendered.
- Broad two-hop traversals around `Faction`, `World`, and `Game` exceeded the query budget. Findings below use exact node IDs and shortest paths where possible.
- An AST edge establishes structural use or a call/reference relationship; it does not by itself prove that a method mutates state. Recommendations that distinguish reads from writes require source review before implementation.

## Executive Summary

`World`, `Faction`, and `Game` are the three primary runtime bridges. Their high degree is mostly consistent with their roles: `World` is the simulation aggregate, `Faction` is shared domain data, and `Game` is the composition root. The graph nevertheless identifies four focused follow-ups:

1. Separate AI policy, tactics, and behavior-tree contracts to break the current import cycle.
2. Make the scenario artifact used by E2E tests explicit and connect it to the production parser/factory flow.
3. Audit direct consumers of `World` methods and preserve a narrow command/query boundary as more features are added.
4. Split the conceptual responsibilities currently grouped around `data.ts` and the broad `Faction` dependency.

## Trace 1: World Mutation Boundary

**Question:** Which `World` mutations are performed directly outside `src/sim/world.ts`, and should they become explicit commands?

### Evidence

- `World` is defined at `src/sim/world.ts:L393` and has degree 222.
- `Game` references `World` at `src/game.ts:L63`.
- `opponent.ts`, `tactician.ts`, `hud.ts`, `session.ts`, `runner.ts`, `entityRenderer.ts`, `gameSave.ts`, `audioEngine.ts`, tutorials, and tests import or reference `World`.
- The graph found 268 external call/reference edges incident on `World` methods.
- Examples that look command-like:
  - `src/ai/opponent.ts:L844`: `.updateArtilleryRepositioning()` calls `World.activateAbility()`.
  - `src/ai/opponent.ts:L589`: `AiOpponent.runTactics()` calls `World.fireBallisticAt()`.
  - `src/ai/opponent.ts:L531`: `.findBuildSpot()` calls `World.canPlace()`.
  - `src/tutorial/counterfire.ts:L172`: `updateCounterfireMilestones()` calls `World.hasExactSensorContactFrom()`.
- Examples that look query/read-only:
  - `src/ui/hud.ts:L1442` and `L1446`: HUD selection code calls ballistic capability/range methods.
  - `src/sim/serialize.ts:L52`: `createWorldSnapshot()` calls `World.exportPersistenceState()`.
  - `src/headless/runner.ts:L139`: `runHeadlessMatch()` calls `World.drainEvents()`.

### Finding

The graph supports a mixed model: AI invokes action-bearing `World` methods, while HUD, serialization, headless execution, and presentation consume query/state APIs. This is not automatically a violation. It is a boundary worth protecting because the `World` aggregate is already the highest-degree node in the graph.

### Recommendation

Do not move methods yet. First classify externally used `World` methods into three explicit sets:

- Commands: ability activation, ballistic fire, build/order issuance, and any method that changes simulation state.
- Queries: reachability, visibility, range, placement, and entity lookup.
- State transfer: persistence export/restore and event draining.

Then require new external consumers to depend on the smallest applicable surface rather than the whole aggregate. Source review is needed to verify the graph's call/reference classifications before this is enforced.

## Trace 2: AI Dependency Cycle

**Question:** Can `opponent.ts`, `tactician.ts`, and `behaviorTree.ts` depend on shared AI interfaces instead of each other?

### Evidence

- The graph report identifies a two-file cycle: `src/ai/opponent.ts -> src/ai/tactician.ts -> src/ai/opponent.ts`.
- It also identifies a three-file cycle: `src/ai/behaviorTree.ts -> src/ai/opponent.ts -> src/ai/tactician.ts -> src/ai/behaviorTree.ts`.
- `AiOpponent` references `Tactician` directly.
- `tactician.ts --imports_from--> behaviorTree.ts`.
- `behaviorTree.ts --imports_from--> opponent.ts`.
- `AiOpponent` reaches `BTNode` in three hops through `opponent.ts` and `behaviorTree.ts`.
- `AiOpponent` exposes strategy operations such as `.runTactics()`, `.chooseAttackTarget()`, `.findBuildSpot()`, and `.refreshPushTarget()` from `src/ai/opponent.ts`.
- `Tactician` owns persistence and tactical updates, including `.exportPersistenceState()`, `.restorePersistenceState()`, and `.update()`.
- `behaviorTree.ts` owns reusable behavior-tree primitives, including `BTContext`, `BTNode`, `Selector`, `Sequence`, `Cooldown`, and `DifficultyGate`.

### Finding

The files currently combine three different roles: strategic policy, tactical execution/persistence, and reusable behavior-tree mechanics. The import cycle is therefore a credible architectural coupling, not merely a file-layout concern.

### Recommendation

Introduce a dependency direction before extracting implementation:

1. Define behavior-tree primitives and an `AiWorldReadModel` in a low-level AI contracts module.
2. Let `Tactician` depend on behavior-tree primitives plus a narrow command sink.
3. Let `AiOpponent` assemble strategic policy and pass data/commands into `Tactician`, rather than importing tactical implementation details bidirectionally.
4. Keep persistence DTOs owned by the tactical layer or a neutral persistence module, never by behavior-tree primitives.

## Trace 3: E2E Scenario Provenance

**Question:** Should E2E scenarios call the same parser/factory used by `runtimeScenario.ts`?

### Evidence

- `scenarioSource` is defined in `e2e/break-line.spec.ts:L6` and has degree 1. Its only graph edge is containment by `break-line.spec.ts`.
- There is no graph path from `e2e_break_line_spec_scenariosource` to `parseGameSaveSnapshot()`.
- `scenarioSha256` is likewise E2E-local at `e2e/break-line.spec.ts:L8`.
- The production scenario path is cohesive:
  - `parseRuntimeScenario()` is defined at `src/scenario/runtimeScenario.ts:L103`.
  - `parseRuntimeScenario() --calls--> validateReferences()` directly.
  - It also calls `readAi()`, `readBinding()`, `readDeposit()`, `readOpeningView()`, `readPlayer()`, `readSpinalPair()`, `readStructure()`, `readUnit()`, and `faction()`.
  - `runtimeScenario.ts -> opponent.ts -> World` forms a two-hop production path.
- `runtimeScenario.test.ts` imports both `parseRuntimeScenario()` and `createRuntimeScenarioWorld()`, creating a two-hop test-mediated connection between parser and factory.

### Finding

The runtime parser is already a clear validation boundary. The E2E source/hash identifiers are currently evidence metadata rather than graph-visible inputs to the parser/factory contract. That prevents the graph from proving that an E2E scenario is parsed and instantiated by the same production code.

### Recommendation

Use a shared scenario artifact at the E2E boundary. The test should obtain its scenario input through the same parse-and-factory entry point as production, or explicitly assert the artifact/hash passed to that entry point. Retain E2E-only metadata separately if it describes browser setup rather than scenario content.

## Trace 4: Faction Consumer Contracts

**Question:** Which `Faction` consumers only need a smaller derived contract?

### Evidence

- `Faction` is defined at `src/sim/data.ts:L15` and has degree 178.
- It is imported or referenced by 39 or more files.
- High-fan-out consumer groups include:
  - `src/sim/world.ts`: 57 connections.
  - `src/ui/hud.ts`: 13 connections.
  - `src/audio/voiceDirector.ts`: 6 connections.
  - `src/headless/runner.ts`: 6 connections.
  - `src/headless/coreMatch.ts`: 5 connections.
  - `src/render/effects.ts` and `src/render/entityRenderer.ts`: 4 connections each.
  - `src/scenario/runtimeScenario.ts`: 4 connections.
- Direct shortest paths show `Faction` imported by `audioEngine.ts` and `coreMatch.ts`; `Game` references it at `src/game.ts:L69`.

### Finding

The graph cannot determine whether each consumer needs the entire enum/type or only a small projection. It does distinguish consumer roles well enough to identify likely candidates for narrowing.

### Recommended Contract Candidates

- UI and rendering: faction presentation data such as palette, iconography, display label, and visual identity.
- Audio and voice: a faction voice-pack selector or cue namespace.
- Headless/core-match validation: faction identity and balance/modifier read models.
- Scenario parsing and saves: validated faction identifier plus serialization conversion.
- AI and simulation: the full combat/balance modifier model where necessary.

The simulation core should remain the owner of authoritative faction statistics. Presentation, audio, and metadata-only consumers should not need the full simulation-facing dependency.

## Trace 5: data.ts Responsibility Split

**Question:** Which parts of `data.ts` are balance catalogs versus runtime rules versus test fixtures?

### Evidence

- `data.ts` anchors the low-cohesion "Simulation Data and Tests" community: 70 nodes, cohesion 0.042.
- The graph identifies catalog-like concepts: `ABILITIES`, `WEAPONS`, `UnitDef`, `StructureDef`, `BUILDABLE`, `FactionModifiers`, `FACTION_MODS`, `DamageType`, `ArmorClass`, `WeaponKind`, `UnitKind`, and `StructureKind`.
- It identifies simulation rule/config concepts: `STARTING_COMMAND`, `COMMAND_PER_NODE`, `DOMINANCE_PER_ALIGNED_PAIR_PER_SEC`, spinal capture constants, firing reveal time, wreck lifetime, and power/damage-related concepts.
- It identifies runtime consumers including `World`, `RuntimeScenario`, `AiOpponent`, `Game`, `Terrain`, headless runners, and tutorial scenarios.
- Test and validation code has its own nearby path through `runtimeScenario.test.ts`, balance validation documentation, and scenario helpers; the graph does not establish a dedicated fixture module inside `data.ts`.

### Finding

`data.ts` appears to be a mixed domain catalog and simulation configuration dependency. The graph provides stronger evidence for the first two responsibilities than for a dedicated test-fixture responsibility. Tests may be importing production data directly rather than consuming separately named fixtures.

### Recommendation

Split conceptually before splitting files:

- Catalogs: unit, structure, ability, weapon, armor, and faction definitions.
- Rules/config: economy, spinal alignment, visibility, firing, wreck, and timing constants.
- Test fixtures: only scenario builders, intentionally synthetic definitions, and test defaults.

If source review confirms production data is reused as implicit test fixtures, add explicit fixture builders rather than duplicating balance catalogs.

## Prioritized Follow-Ups

1. **Scenario contract traceability:** make E2E scenario content visibly pass through the production parser/factory. This closes the current degree-one scenario evidence gap.
2. **AI dependency direction:** break the `opponent.ts` / `tactician.ts` / `behaviorTree.ts` cycle with contracts and a one-way dependency structure.
3. **World API audit:** classify the 268 graph-visible external `World` method edges into commands, queries, and state transfer before adding more consumers.
4. **Faction projections:** introduce presentation/audio/metadata projections only where source review shows a consumer does not need full simulation-facing faction data.
5. **Data responsibility map:** name and test catalog, rules, and fixture seams before deciding whether physical file extraction is worth the churn.

## Additional Questions The Graph Supports

- Which external callers of `World` invoke command-like methods without going through `Game` or a dedicated command service?
- Which `Faction` imports are only needed to select visual or audio assets?
- Which E2E scenario fields are browser harness controls versus authored scenario content?
- Can `TacticianPersistenceState` be serialized without importing strategic policy or behavior-tree mechanics?
- Which `data.ts` constants vary per scenario or difficulty and therefore belong in runtime configuration rather than global data?

## Source References

- `src/sim/world.ts:L393` - `World`
- `src/sim/data.ts:L15` - `Faction`
- `src/game.ts:L62-L75` - `Game` references to core runtime subsystems
- `src/scenario/runtimeScenario.ts:L103` - `parseRuntimeScenario()`
- `src/ai/opponent.ts:L309` - `AiOpponent`
- `e2e/break-line.spec.ts:L6-L8` - E2E scenario source and hash metadata
- `graphify-out/GRAPH_REPORT.md` - community cohesion, import-cycle report, and full graph audit
