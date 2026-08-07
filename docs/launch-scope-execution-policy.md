# Launch-Scope Ship-First Execution Policy

**Status:** Approved
**Applies to:** `LS-01` through `LS-37` in `docs/launch-scope-progress.json`

## Purpose

Ship the dependency-ordered launch scope without turning comparison footage, optional polish, or unbounded review into release blockers. Delivery state remains separate from qualification and disposition: a slice is `complete` only after its class-specific acceptance and exact claim receipt pass.

## Quality Ladder

Each slice moves through this ladder in order:

1. **Not run:** the queued slice has not entered qualification.
2. **Pending:** implementation or acceptance work is in progress and no ship decision exists.
3. **Automation passed:** the required automated lane is green; this is necessary but is not completion by itself.
4. **Accepted:** class-specific review scores the slice at least 3 on the absolute rubric and the exact claim receipt is verified.
5. **Disposed:** accepted work is marked `clean`, or non-blocking improvements are recorded as `polish-backlog`.

`state` remains the delivery field for compatibility. `qualification` records the highest completed qualification step. `disposition` records the acceptance outcome or `pending` before acceptance.

## Absolute Rubric

Score the delivered slice against its own acceptance contract, not against another game or an aspirational ideal.

| Score | Meaning | Decision |
| --- | --- | --- |
| 0 | Missing, unusable, or unverifiable | Blocked |
| 1 | Major required behavior is absent or broken | Not ship-ready |
| 2 | Functional in part, but a material acceptance defect remains | Not ship-ready |
| 3 | Required behavior is correct, legible, and supportable; only non-blocking polish remains | Ship-ready |
| 4 | Fully resolved with no meaningful known deficiency in scope | Ship-ready |

A score of **3 or higher is ship-ready**. A score of 3 may be accepted as `polish-backlog`; a score of 4 is normally `clean`. Reviewers must not lower an otherwise absolute score because a reference title has more budget, content, or production maturity.

## Class-Specific Acceptance

Classify each slice by its dominant risk and apply every listed acceptance condition for that class.

| Slice class | Acceptance conditions |
| --- | --- |
| Contract and evidence | Scope is unambiguous, internally consistent, reproducible from tracked sources, and protected by an exact claim receipt. |
| Platform and systems | Required interfaces and state transitions work deterministically; failure, persistence, and compatibility paths relevant to the slice are tested. |
| Gameplay and campaign | The authored flow is completable, objectives and consequences are legible, intended player choices work, and campaign progression remains coherent. |
| Presentation and visual | Required information is readable at target resolution and profile, faction/world identity is preserved, and no material visual defect obscures play. |
| Accessibility and release operations | The applicable input, caption, scaling, packaging, offline, recovery, migration, rollback, and artifact checks pass on the declared target. |

Mixed slices must satisfy each applicable class. Review only the acceptance conditions introduced or materially changed by the slice.

## Bounded Review And Remediation

Every slice receives one initial acceptance review and at most **two remediation rounds**. A remediation round must address concrete score-below-3 findings from the preceding review; it may not expand launch scope.

At most **one remediation round may be visual-only**. A visual-only round corrects presentation defects without changing gameplay, campaign behavior, simulation rules, or acceptance scope. If another visual-only pass would be desirable after the slice reaches 3, record it as `polish-backlog` and ship the slice.

After the second remediation round, apply the stop rules below rather than silently starting another loop.

## SC2 Reference Protocol

StarCraft II references are advisory and milestone-only. They may inform milestone reviews of pacing, information hierarchy, objective cadence, mission variety, and briefing-to-play continuity.

They are not per-slice acceptance gates, visual matching targets, claim evidence, or authority to reopen a ship-ready slice. Any observation derived from them must be translated into this project's absolute rubric and applicable class-specific acceptance condition before it can become a finding.

## Validation Gate Lanes

Run only the lanes applicable to the slice:

| Lane | Authority |
| --- | --- |
| Automated correctness | Unit, integration, deterministic simulation, schema, typecheck, and targeted browser checks. Required before `automation-passed`. |
| Functional acceptance | Class-specific behavior, campaign flow, persistence, and failure-path review. Blocking when applicable. |
| Visual and usability acceptance | Readability, target-resolution presentation, accessibility, and player-comprehension checks. Blocking only for applicable requirements scoring below 3. |
| Performance and compatibility | Declared hardware/browser budgets and compatibility contracts. Blocking only where the slice can affect those contracts. |
| Milestone advisory | Cohort results, comparative references, and milestone-wide pacing or cohesion review. Advisory for individual slices unless an approved launch gate explicitly makes the result blocking. |
| Claim receipt | Exact policy-bound evidence receipt. Required before a slice becomes `complete`. |

Local run telemetry and OpenCode goal/loop telemetry are advisory signals. They do not replace tracked evidence, acceptance review, or exact claim receipts.

## Stop And Reopen Rules

Stop remediation and accept the slice when applicable lanes pass, the absolute score is at least 3, and the exact claim receipt verifies. Use `clean` when no known in-scope issue remains; use `polish-backlog` when only non-blocking improvements remain.

Stop and escalate without promotion when the slice is still below 3 after the initial review plus two remediation rounds, a required lane cannot run, evidence cannot be reproduced, or a proposed fix would expand scope or break an accepted dependency. Keep the slice active and its disposition `pending`; record the blocker and obtain a scope, schedule, or risk decision.

Reopen a complete slice only for a reproducible regression, invalidated or mismatched claim evidence, a newly discovered score-0-to-2 defect against the original acceptance contract, or an approved launch-scope change. Advisory telemetry, later comparison review, and polish-backlog work alone do not reopen a slice.
