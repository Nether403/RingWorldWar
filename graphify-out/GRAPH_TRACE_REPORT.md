# Graph Trace Report

**Project:** RingWorldWar  
**Generated:** 2026-08-11  
**Graph snapshot:** `graphify-out/graph.json` — **3,212 nodes, 7,892 edges, 242 communities**  
**Purpose:** Trace every current Graphify Suggested Question, then follow the highest-value bridges across simulation, presentation, scenario evidence, and persistence.

## Scope and method

This is a navigation and architecture report, not a claim that every graph edge is a causal runtime fact. It combines:

1. Graphify's current `GRAPH_REPORT.md` Suggested Questions.
2. Targeted `graphify path` and `graphify explain` traversals against `graphify-out/graph.json`.
3. Focused source review where a graph relationship needed semantic interpretation.
4. The already-rendered `graph.html` interactive graph for topology evidence.

Stable graph IDs were used where display names are duplicated (for example, `src_sim_data_faction`, `src_sim_world_world`, and `src_gen_terrain_terrain`). Undirected paths explain a connection regardless of import direction; they do **not** prove control flow or state mutation. Source files cited below remain the authority for behavioral claims.

## Executive findings

- **README and technical architecture are complementary, not directly coupled.** The graph gives an ambiguous semantic reference; the README is the product/developer entry point and the architecture document is the technical model and ownership reference.
- **Rotating-frame kinematics and inertial-frame ballistics are one canonical projectile model, not rival physics authorities.** The implementation keeps projectile state in inertial coordinates and converts at the ring boundary; launch/preview/impact share that authority.
- **`Faction`, `World`, and `Terrain` are intentional bridge concepts.** Each crosses multiple layers, but their graph centrality describes different kinds of responsibility: faction identity, world authority, and terrain generation/presentation.
- **Scenario evidence has two responsibilities.** `scenarioBytes` establishes exact input provenance, while `parseScenario()` establishes schema and semantic validity. The SHA-256 verifies byte identity, not correctness by itself.
- **`serialize.ts` is a large but cohesive persistence boundary.** It owns the world snapshot contract, strict validation, restoration compatibility, and reconstruction. A mechanical split could improve maintainability, but an architectural split is not currently justified.

## Suggested Question 1 — How does the README connect to Technical Architecture?

### Graph trace

```text
README --references [AMBIGUOUS]--> Technical Architecture
```

### Source evidence

- `README.md:1-43` introduces RingWorldWar, local run and verification commands, controls, and the player-facing Gravity Range goals.
- `docs/architecture.md:3-9` explains the rotating-ring physical model.
- `docs/architecture.md:79-120` records the architecture and physics approach, including the world authority seam and ballistic model.

### Finding — confidence: high

The two documents are related by subject matter and product narrative, not by a direct import, generated-document relationship, or explicit documentation link discovered in the trace. Treat Graphify's `references` edge as an **ambiguous semantic association**.

Use the README to orient a contributor or operator. Use the architecture document to understand the coordinate systems, simulation boundaries, and ownership rules that the README deliberately does not reproduce.

### Follow-up

Documentation terminology should stay aligned with the implementation. In particular, the architecture's older velocity-Verlet phrasing should be reconciled with the current exact drag-free / midpoint-drag description in `src/sim/ballistics.ts` if that document is revised.

## Suggested Question 2 — How does Custom Rotating-Frame Kinematics connect to Inertial-Frame Ballistic Authority?

### Graph trace

```text
Custom Rotating-Frame Kinematics
  <--semantically_similar_to [AMBIGUOUS]--
Inertial-Frame Ballistic Authority
```

### Source evidence

- `docs/architecture.md:3-9` describes artificial gravity and Coriolis effects on a rotating ring.
- `docs/architecture.md:79-120` explains the authoritative physical model.
- `docs/launch-scope/ls-11-gravity-range.md:7-28` requires preview, preflight, firing, flight, and scoring to use the existing inertial-frame ballistic authority rather than an approximate range display.
- `src/sim/ballistics.ts:42-207` stores ballistic state in inertial Cartesian coordinates and converts between inertial and ring frames.
- `src/sim/ballistics.ts:252-326` uses exact drag-free inertial stepping with midpoint drag integration; preview and impact use the same trajectory integrator.

### Finding — confidence: high

These phrases describe different views of one model:

```text
rotating-ring player/world frame
      <-> coordinate conversion <->
inertial projectile state and integration
      -> shared trajectory authority for preview and impact
```

The rotating-frame description explains what the player observes and why aiming behaves non-intuitively. The inertial-frame description defines the canonical state and numerical authority. They must not be presented as two alternative implementations or competing sources of truth.

### Follow-up

Adopt one concise canonical phrase in docs and feature specifications: **“Projectiles are integrated in inertial coordinates and rendered/interpreted in the rotating ring frame.”** This prevents future specifications from implying that a UI preview may use a different ballistic approximation.

## Suggested Question 3 — Where does `Faction` connect across the system?

### Graph trace

`graphify explain src_sim_data_faction` identifies `Faction` at `src/sim/data.ts:L15`, in the `World` community, with degree **186**. Direct graph consumers include world simulation, persistence, game orchestration, AI, HUD, headless session/runner, entity rendering, game saves, audio, scenario modules, and tests.

Selected paths:

```text
Faction <--imports-- serialize.ts --contains--> serializeWorld()
Faction <--imports-- opponent.ts --contains--> AiOpponent
Faction <--imports-- game.ts --imports--> Hud
```

### Finding — confidence: high

`Faction` is the compact shared identity required by several layers:

- **Simulation:** owns/scores entities and resolves faction-specific rules.
- **AI:** selects friendly/enemy targets and strategic decisions.
- **Presentation:** colors, HUD labels, and entity rendering distinguish sides.
- **Persistence and headless execution:** serializes, restores, and drives the same identities.

Its high degree is expected, rather than evidence that it should become a large cross-layer object. Source review found it is a small two-member identity at `src/sim/data.ts:15-18`, not an oversized data transfer structure.

### Follow-up

Do not introduce per-layer faction projection interfaces merely to reduce graph degree. Do consider an extraction only if `data.ts` grows distinct simulation rules and presentation metadata that routinely change under separate ownership.

## Suggested Question 4 — How does `World` connect to ballistics, rendering, and runtime layers?

### Graph trace

`graphify explain src_sim_world_world` identifies `World` at `src/sim/world.ts:L393`, in the `World` community, with degree **229** — the graph's highest identified domain hub. Consumers include mission/game code, serialization, AI, HUD, headless runner/session, entity renderer, game save, audio/effects, and strategic-annulus logic.

Selected paths:

```text
World <--imports-- game.ts --imports_from--> ballistics.ts
World <--imports-- game.ts --imports--> EntityRenderer
```

### Source evidence

- `docs/architecture.md:91-99` describes the external seam in terms of commands, queries, and state transfer.
- `src/sim/world.ts:L393` is the concrete aggregate boundary.
- `src/sim/ballistics.ts:42-326` owns canonical projectile integration rather than embedding it in UI or rendering.

### Finding — confidence: high

`World` is the authoritative simulation aggregate, not a generic application container. The graph shows it is deliberately connected to orchestration, persistence, headless execution, AI, and presentation adapters. The important architectural distinction is:

```text
World: state and simulation authority
Game/headless session: orchestration and lifecycle
Ballistics: authoritative projectile calculation
Renderer/HUD/audio: observation and presentation
```

A broad `WorldCommands`/`WorldQueries` interface would not yet create a real isolation boundary while callers can still obtain mutable entity objects. The existing command/query/state-transfer vocabulary is useful as an ownership rule, but not sufficient justification for a new façade.

### Follow-up

Revisit an explicit world adapter only when a second authoritative execution environment emerges, such as a worker, server, multiplayer host, or independent command producer.

## Suggested Question 5 — How does `Terrain` bridge generation, simulation, and rendering?

### Graph trace

`graphify explain src_gen_terrain_terrain` identifies `Terrain` at `src/gen/terrain.ts:L51`, in the `Terrain` community, with degree **70**. Consumers include `World`, persistence, game/core match, headless session/runner, battlefield dressing, camera controller/rig, navigation, rendering, and tests.

Selected paths:

```text
Terrain <--imports-- battlefieldDressing.ts --contains--> BattlefieldDressing
Terrain <--imports-- battlefieldDressing.ts --imports_from--> districtPlan.ts
```

### Finding — confidence: high

Terrain is a structured output of world generation that supports both gameplay topology and visual planning:

```text
Terrain
  -> world construction / persisted compatibility
  -> navigation and camera constraints
  -> BattlefieldDressing
  -> district planning and rendered presentation
```

The `BattlefieldDressing` and `districtPlan` path is a useful cross-community bridge. It shows presentation is built from the generated terrain rather than inventing a disconnected visual map.

### Follow-up

Maintain the distinction between terrain's durable world/topology data and presentation-only dressing. When a rendering feature needs additional information, first determine whether it is a genuine terrain property or an ephemeral visual derivation.

## Suggested Question 6 — What do `scenarioBytes`, `scenario`, and `scenarioSha256` prove?

### Graph trace

```text
scenarioBytes <--contains-- break-line.spec.ts --imports--> parseScenario()
scenarioSha256 <--contains-- break-line.spec.ts --imports--> parseScenario()
```

### Source evidence

- `e2e/break-line.spec.ts:10-31` reads `scenarioBytes` from the scenario file, parses JSON from those bytes, invokes `parseScenario`, and computes `scenarioSha256 = sha256(scenarioBytes)`.
- `e2e/break-line.spec.ts:273-297` persists schema/version/id/revision/path, the raw-byte SHA-256, and `collectGit()` provenance in evidence.
- `tools/rww/scenario.mjs:38-256` performs strict schema and semantic parsing.
- `tools/rww/scenario.mjs:258-294` validates Break the Line-specific bindings.

### Finding — confidence: high

The chain has two distinct guarantees:

```text
raw scenario bytes
  -> SHA-256: exact input identity/provenance
  -> JSON + parseScenario(): structural and semantic validity
  -> parsed scenario: browser test input
  -> completion evidence: reproducible record of what was tested
```

The hash shows that future reviewers can identify the exact source artifact used in a run. It does **not** establish that the JSON is valid or that its gameplay bindings make sense. Those are the parser's responsibility. Conversely, parsed scenario data alone does not prove which file revision the browser received; the raw-byte hash supplies that provenance.

### Follow-up

Keep byte hashing adjacent to parsing at every qualification entry point. For new scenario classes, record both stable scenario identity (schema/version/id/revision) and raw input digest, then bind any scenario-specific semantic requirements in the canonical parser.

## Suggested Question 7 — Should `serialize.ts` be split?

### Graph trace

```text
serialize.ts <--imports_from-- gameSave.ts
serialize.ts <--imports_from-- session.ts

serializeWorld() <--contains-- serialize.ts --contains--> deserializeWorld()
serializeWorld() --calls--> createWorldSnapshot()
                 <--calls-- createMatchSessionSnapshot()
```

The test-facing game-save path also connects snapshot construction to `createGameSaveSnapshot()` through `serialize.test.ts`.

### Source evidence

- `src/sim/serialize.ts:28-85` defines `WorldSnapshot`, schema/version handling, and snapshot creation.
- `src/sim/serialize.ts:92-250` serializes world state and strictly parses snapshot input.
- `src/sim/serialize.ts:300-550` restores worlds, verifies terrain compatibility, applies v1-to-v2 spinal migration, and validates entities/domain values.
- `src/headless/session.ts:22-91,106-297` wraps `WorldSnapshot` in `MatchSessionSnapshot` with AI controller persistence and uses `createWorldSnapshot`, `parseWorldSnapshot`, and `deserializeWorld`.
- `src/gameSave.ts:18-40,42-156` wraps a session in `GameSaveSnapshot`, adds AI enablement/mission/factions, applies size/compatibility checks, and rehydrates mission state after session restore.

### Finding — confidence: high

The intended layering is:

```text
game save
  -> match session
    -> world snapshot
      -> world serialization / validation / restoration
```

`serialize.ts` is long because it protects one critical world-persistence contract: snapshot shape, backward compatibility, strict input validation, domain validation, and authoritative rehydration. That makes it **cohesive architecturally**, even though it is a candidate for mechanical decomposition.

### Recommendation

Do not split it simply to lower file length. If maintenance pressure appears, extract internal modules without changing the public persistence boundary, for example:

- snapshot schema/types,
- entity/domain validators,
- migration helpers,
- serialization/rehydration helpers.

Keep `WorldSnapshot`, `createWorldSnapshot`, `parseWorldSnapshot`, `serializeWorld`, and `deserializeWorld` as the clear public seam unless a more substantive boundary is discovered.

## Cross-community follow-up — Persistence is layered, not duplicated

The `serialize.ts`, `session.ts`, and `gameSave.ts` traces show three nested levels of state:

| Layer | Owns | Does not replace |
| --- | --- | --- |
| World snapshot | canonical simulation world state | session/AI or campaign context |
| Match session snapshot | world snapshot plus AI controller persistence | game-save metadata/mission policy |
| Game save snapshot | session plus AI enablement, mission, and factions | authoritative low-level world serialization |

This separation prevents game-save policy from leaking into the core simulation snapshot while allowing headless and browser-oriented sessions to restore the same `World` state.

## Cross-community follow-up — High centrality is a review cue, not an automatic refactor order

The prominent graph hubs are `World` (229 edges), `Faction` (186), `Game` (89), `deltaS()` (84), `Terrain` (70), `wrapS()` (64), `RenderAnchor` (58), `startSession()` (57), `surfaceDist()` (53), and `AiOpponent` (41).

Each should receive careful review when changed, but their degrees mean different things:

- `World` and `Faction` represent intended domain-wide concepts.
- Coordinate helpers such as `deltaS()`, `wrapS()`, and `surfaceDist()` are expected physics/navigation utilities.
- `RenderAnchor`, `Game`, and `startSession()` are composition and orchestration bridges.
- `AiOpponent` is a strategic adapter, not a reason to put AI policy inside world state.

Graph degree should therefore prioritize impact analysis and test selection, not force a generic “reduce coupling” change.

## Graph quality and interpretation limits

- **Duplicate labels:** `Faction`, `World`, and `Terrain` matched multiple nodes in CLI queries. Use ID-qualified queries to avoid mixing modules, types, functions, and symbols with the same display label.
- **Ambiguous semantic edges:** the README/Architecture and rotating/inertial links are labelled `AMBIGUOUS`. They guided source review; they are not proof of a precise dependency.
- **Truncated broad traversal:** broad depth-two BFS requests for `Faction` (981 nodes), `World` (919), `Terrain` (1,001), scenario artifacts (122), and `serialize.ts` (196) were too broad to use as exhaustive causal evidence. This report relies on the targeted paths and sources above.
- **Thin/weakly connected material:** the graph includes **242 communities**, while `GRAPH_REPORT.md` renders **192** and omits **50 thin communities**. Suggested-question material also reports roughly **800 weakly connected nodes**. These are useful candidates for future documentation/semantic-edge review, not proof that the underlying artifacts are defective.
- **Integrity:** the recent graph diagnostic found zero dangling endpoints, missing endpoints, self-loops, duplicate edges, or collapsed edges. A structurally clean graph can still contain ambiguous or incomplete semantic relationships, so the source review remains necessary.

## Recommended actions

1. **Align ballistic terminology.** Update architecture/feature prose to describe the inertial-coordinate authoritative integrator and rotating-frame interpretation consistently; remove any stale implication of a separate rotating-frame solver.
2. **Keep the persistence boundary cohesive.** Consider a mechanical `serialize.ts` submodule split only when ownership or navigation cost warrants it; preserve the public world snapshot contract.
3. **Use stable graph IDs in future traces.** Add disambiguating display labels or consistently use node IDs where concepts such as `World` and `Terrain` exist in several files.
4. **Expand scenario provenance deliberately.** Preserve the raw-byte digest + strict parser pattern for new qualification scenarios and review weakly connected scenario evidence artifacts as the suite evolves.
5. **Review thin communities in batches.** Use Graphify's incremental update after coherent source changes and record source-backed corrections for ambiguous semantic edges rather than treating their initial labels as facts.

## Verification record

- Rendered interactive graph was opened from `graphify-out/graph.html`; the UI displayed **3,212 nodes · 7,892 edges · 242 communities**.
- All seven current Suggested Questions received a targeted graph trace and source-backed disposition in this report.
- The report replaces the obsolete 2026-08-09 version, whose **2,681 nodes / 6,842 edges / 190 communities** snapshot no longer described the current graph.
