# LS-07 Bounded Acceptance Contract: Paired Spinal Nodes

**Status:** Approved for implementation  
**Policy version:** 1  
**Slice class:** Gameplay system  
**Depends on:** LS-03 through LS-06  
**SC2 comparison:** Not applicable; LS-07 is qualified by deterministic gameplay-system evidence.

## Player Outcome

Known battlefields contain authenticated operational pairs of Spinal Nodes. Holding one Node provides local Command capacity. Holding both members of a pair establishes a reversible **Spinal Alignment** that generates Dominance until either member is lost.

The player must be able to complete a pair, deny an enemy pair, break an Alignment, recapture a neutralized Node, and understand the local pair state from the HUD and minimap.

## Canonical Terms

- **Operational pair:** Two authored Spinal Nodes whose surviving routing records identify them as counterparts. Pairing is explicit data, not inferred from proximity during current play.
- **Pair identity:** A stable symbolic ID plus exactly two distinct Node entity IDs. Pair identity does not change when either Node changes owner.
- **Spinal Alignment:** The derived state in which both live, completed members of an operational pair are controlled by the same faction.
- **Broken Alignment:** Any pair that is neutral, divided between factions, incomplete, or has a non-live member.
- **Neutralization:** The ownership transition from faction-controlled to neutral. It is a distinct phase before an opposing faction can capture the Node.

Spinal Alignment is theater-level control. It is not execution of the Anchor Protocol or Migration Protocol and is not a victory condition by itself.

## Pair Topology And Identity

1. A pair has a safe, non-empty symbolic ID of at most 64 characters.
2. A pair contains exactly two distinct, live, completed `spinalNode` structures.
3. A Node may belong to at most one pair. Pair IDs are unique.
4. Pair records are stored in pair-ID order; member IDs are stored in numeric order. This canonical order is authoritative for hashes, saves, HUD numbering, and AI tie-breaks.
5. Unpaired Nodes are legal. They provide Command but can never establish Alignment or generate pair Dominance.
6. Runtime scenarios author pairs through symbolic Node references. Pair identity survives entity-ID resolution and save/load.
7. Standard skirmish uses its existing four Nodes as two authenticated pairs:
   - `standard-axis`: the Nodes at `0.25C, 0` and `0.75C, 0`.
   - `standard-rim`: the Nodes at `0.125C, +0.6W` and `0.625C, -0.6W`.
8. Strict antipodality is a property of these standard-map pairs, not established canon for every Spinal Node in the Network.
9. First Contact explicitly pairs `quarter-node` and `three-quarter-node` as `quarter-axis`. Its tutorial Node and rim Node remain unpaired so the existing tutorial capture remains unchanged.

## Capture, Neutralization, And Recapture

### Constants

| Rule | Value |
| --- | ---: |
| Capture radius | 110 m |
| Capture query radius | 130 m |
| Capture rate per net unit | 0.05 per second |
| Maximum net capture strength | 3 units |
| Endpoint epsilon | `1e-9` |
| Command per controlled Node | 3, unchanged |
| Dominance per aligned pair | 2 per second |

Engineers and combat units remain eligible capture units. Equal opposing pressure freezes control progress. There is no passive progress decay.

### Neutral Node

- Net Compact pressure moves capture from `0` toward `-1`.
- Net Choir pressure moves capture from `0` toward `+1`.
- Reaching an endpoint transfers ownership and emits one `nodeCaptured` event.
- One uncontested unit captures a neutral Node in 20 seconds; the capped three-unit advantage captures it in 200 ticks.

### Controlled Node

- Friendly pressure repairs capture toward the owner's endpoint.
- Enemy pressure erodes capture toward `0` without crossing it in the same ownership phase.
- Reaching `0` makes the Node neutral, immediately removes its Command contribution, and emits one `nodeNeutralized` event naming the previous owner.
- Continued enemy pressure then begins the normal neutral-to-controlled phase.
- One uncontested unit takes 20 seconds to neutralize and another 20 seconds to capture. A full enemy takeover therefore takes 40 seconds.

### Damage Neutralization

Spinal Nodes remain non-destructible. When a controlled Node reaches zero HP, it becomes neutral, capture resets to `0`, HP resets to 35%, Command is recomputed, and one `nodeNeutralized` event is emitted. Damaging an already-neutral Node to zero performs the HP reset without a duplicate ownership or Alignment event.

## Alignment Begin And Break

Alignment is derived immediately; it has no separate meter, timer, stored owner, or activation command.

- A broken pair becomes Compact-aligned when both members become Compact-controlled.
- A broken pair becomes Choir-aligned when both members become Choir-controlled.
- An aligned pair breaks as soon as either member ceases to be controlled by the aligned faction.
- An ownership mutation evaluates the old pair owner, changes Node ownership, then evaluates the new pair owner.
- A changed pair emits `alignmentBroken` for the old aligned owner before `alignmentStarted` for the new aligned owner.
- Setup and snapshot restoration establish derived Alignment without emitting gameplay events.

## Single Gameplay Consequence

Individual Node ownership continues to grant `3` Command. Individual Nodes no longer generate Dominance.

Each aligned pair generates exactly `2 Dominance/second` for its owner. A broken pair generates none. The standard map's two pairs therefore retain the previous maximum `4 Dominance/second` while making scoring contingent on connected territorial control.

Alignment does not change chord accuracy, visibility, transport, structure health, energy, production, final-protocol authorization, or victory rules. Bastion destruction and the existing time-cap Dominance comparison remain the only skirmish outcomes.

## AI Contract

The AI must use pair state through existing strategic knowledge without gaining new general intelligence.

### Completion And Denial Priority

For scout Node selection, use this stable priority before distance and Node ID:

1. `300`: a member of an enemy-aligned pair, to break Alignment.
2. `200`: a non-owned Node whose mate is friendly, to complete Alignment.
3. `150`: a non-owned Node whose mate is enemy-controlled but the pair is not aligned, to deny completion.
4. `100`: any other non-owned Node.

Ties resolve by shorter surface distance, then lower Node ID. Existing distinct-scout assignment remains intact.

Main-force target scoring keeps its current base values and adds `+120` for an enemy-aligned pair member, `+80` when the target's mate is friendly, and `+50` when the enemy controls the mate without a completed pair. The existing timed Bastion commitment remains higher-level victory behavior.

### Defense

After Bastion emergency defense and before a generic push, the AI defends a friendly aligned pair when a visible enemy combat unit is within `600 m` of either member. It chooses by nearest hostile distance, then pair ID, then Node ID, and sends available line units by `attackMove`. No new persisted AI state is required; issued orders remain authoritative and serialized.

AI behavior must be deterministic for identical seeds and state.

## Save And Scenario Compatibility

1. World snapshots advance to version 2 and contain the canonical pair registry.
2. Match-session and game-save envelope versions do not change; they continue delegating world parsing to the world snapshot parser.
3. Version-1 world snapshots remain loadable. Migration pairs exact half-circumference Node candidates within `1 m`, sorted by geometric error and then member IDs, taking non-overlapping pairs greedily. Stable migrated IDs are `legacy-<lowerId>-<higherId>`.
4. V1 Nodes without an unambiguous counterpart remain unpaired. Migration never guesses a nearest neighbor.
5. Owned V1 Nodes with a zero capture value migrate to their owner endpoint. Incoherent cross-owner signed progress migrates through the neutral state rather than granting ownership progress to the wrong faction.
6. Runtime scenario schema advances to version 2 with explicit `spinalPairs`. Version-1 scenarios migrate with an empty pair list.
7. Pair validation rejects duplicate IDs, duplicate membership, repeated members, missing members, non-Node members, unfinished members, and non-live members before mutating a live world.
8. Partial capture, neutralization, Alignment, AI orders, Dominance, and pair identity must round-trip deterministically.

## Minimum HUD And Minimap Representation

### HUD

- The resource bar adds `ALIGN <friendly>/<declared>` with accessible text: `Alignment: <friendly> of <declared> Spinal pairs controlled`.
- No global enemy-alignment count is shown.
- Selecting a paired Node shows its pair ID, visible mate state, local capture percentage, and `ACTIVE` or `BROKEN` Alignment.
- A hostile mate outside existing visibility rules is shown as `UNKNOWN`; LS-07 does not grant overhead intelligence.
- Player-relative alerts cover Node neutralization, Alignment established, and Alignment broken.

### Minimap

- Visible paired Nodes retain ownership-colored Node marks and share a stable pair index derived from pair-ID order.
- A friendly or otherwise visible aligned pair receives a double outline.
- The minimap exposes acceptance-test datasets for declared pair count, friendly aligned pair count, and visible aligned pair count.
- The minimap accessible label includes the friendly aligned-pair count.
- No cross-ring connector, corridor, hidden hostile mate, chord indicator, or whole-ring strategic marker is added.

## Explicit Exclusions

LS-07 does not include:

- Chord-shot accuracy or corridor bonuses.
- Persistent overhead intelligence or hidden enemy pair disclosure.
- Chord insertion, land transport, air transport, aircraft, or cargo.
- Structural stabilization, structural stress, terrain destruction, or habitat repair.
- Alignment countdowns, energy requirements, alternate victory, Anchor execution, or Migration execution.
- A dedicated whole-ring camera or strategic annulus.
- Shadow timing or expanded day/night rules.
- Campaign finale logic or additional campaign missions.
- A universal Spinal Network pair count or complete control hierarchy.

Those concerns remain assigned to LS-09, LS-10, LS-16 through LS-19, LS-25, LS-30, LS-31, or later release work.

## Bounded Acceptance Matrix

LS-07 is dependency-ready only when all of the following pass under `docs/launch-scope-execution-policy.md`:

1. **Topology:** Explicit standard and scenario pairs have stable canonical identity; malformed topology is rejected.
2. **Capture state machine:** Neutral capture, contested freeze, friendly repair, neutralization, recapture, full takeover, and damage neutralization produce exact states, timing, and event order.
3. **Alignment state machine:** Start, break, faction replacement, no duplicate events, and unpaired behavior pass.
4. **Gameplay consequence:** Command remains per Node; Dominance is exactly pair-only; existing victory conditions remain unchanged.
5. **AI:** Deterministic completion, pre-emptive denial, active-pair denial, and visible-threat defense pass for both factions.
6. **Persistence:** V2 round-trip, V1 migration, legacy game-save loading, partial capture continuation, pair identity, AI continuation, and strict rejection pass.
7. **Presentation:** HUD summary, selected-Node detail, visibility-safe mate state, minimap pair index/outline, accessible labels, and player-relative events pass at 1280x720 Low and narrow layout.
8. **Regression:** Tutorial Node capture, seeded state hashes, core-match completion, existing Bastion/time-cap outcomes, typecheck, lint, build, and affected browser suites pass.
9. **Scope:** No excluded LS-09/10, chord, air/cargo, stabilization, alternate-victory, or campaign behavior is introduced.

No human cohort or blind SC2 comparison is required for LS-07. Human comprehension remains a Milestone 2 validation concern.

## Completion Evidence Policy

Promotion is predeclared and exact:

- Claim: `LS-07`
- Accepted state: `complete`
- Disposition: `clean` or `polish-backlog` under the ship-first policy
- Claim receipt: `validation/evidence/launch-scope/LS-07.json`
- Machine evidence: `validation/evidence/ls-07-paired-nodes-2026-08-07.json`
- Independent criterion review: `validation/evidence/reviews/ls-07-criterion-review-2026-08-07.json`
- Frozen contract: `docs/launch-scope/ls-07-paired-spinal-nodes.md`
- Execution policy: `docs/launch-scope-execution-policy.md`
- Required receipt check ID: `paired-spinal-node-alignment`

The machine artifact must reference these exact tracked command-verification receipts:

| Run ID | Command | Receipt |
| --- | --- | --- |
| `focused-unit` | `npx vitest run tests/sim/spinalAlignment.test.ts tests/sim/serialize.test.ts tests/ai/strategist.test.ts tests/scenario/runtimeScenario.test.ts` | `validation/evidence/runs/ls-07-focused-unit-2026-08-07.json` |
| `focused-browser` | `npx playwright test e2e/spinal-alignment.spec.ts --project=chromium-regression` | `validation/evidence/runs/ls-07-focused-browser-2026-08-07.json` |
| `full-check` | `npm run check` | `validation/evidence/runs/ls-07-full-check-2026-08-07.json` |
| `core-match` | `npm run validate:core-match` | `validation/evidence/runs/ls-07-core-match-2026-08-07.json` |

Each receipt must use `rww.command-verification` version 1, bind the exact command and source snapshot, report exit code 0, and list the predeclared acceptance-test IDs that passed. Each machine acceptance category must name its exact run IDs and test IDs. The independent review must link each score to the corresponding machine category and provide a substantive rationale; labels plus self-asserted `passed` values are insufficient.

The source snapshot is the SHA-256 of the canonical ordered `{path, sha256}` implementation-source list. Every command receipt and the critic review must bind that same digest. Extra or missing test IDs are rejected. The critic review records the independent task ID, model label, completion time, and source snapshot. These tracked records are tamper-evident repository provenance; they do not claim cryptographic authentication of a human or agent identity, and they never substitute for a roadmap gate that explicitly requires human participants.

The machine artifact must contain current SHA-256 references for at least:

- `src/sim/data.ts`
- `src/sim/world.ts`
- `src/sim/serialize.ts`
- `src/scenario/runtimeScenario.ts`
- `src/scenario/worldFactory.ts`
- `src/scenario/firstContact.ts`
- `src/ai/opponent.ts`
- `src/ui/hud.ts`
- `tests/sim/spinalAlignment.test.ts`
- `tests/sim/serialize.test.ts`
- `tests/ai/strategist.test.ts`
- `tests/scenario/runtimeScenario.test.ts`
- `e2e/spinal-alignment.spec.ts`

The claim cannot validate until the machine evidence and independent review exist, their current SHA-256 hashes match the receipt, every bounded acceptance category scores at least 3, and no blocker or required-quality finding remains.
