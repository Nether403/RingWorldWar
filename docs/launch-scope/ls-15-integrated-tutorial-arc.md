# LS-15 Bounded Acceptance Contract: Integrated Public-Alpha Tutorial Arc

**Status:** Active; automation lanes qualified, G-02 novice cohort open
**Policy version:** 1  
**Slice class:** Gameplay, campaign, and onboarding  
**Depends on:** LS-04 through LS-14

## Player Outcome

A public-alpha visitor can start the First Contact tutorial arc from the title
screen's campaign archive without manual routing, receives the authored
objective hints and the LS-08 directional onboarding, completes the ten
objectives through real commands, and sees the debrief, campaign progression,
continuation, replay, and retry behavior. A standalone scenario route keeps the
same arc outside campaign semantics.

This slice qualifies the integrated arc's deterministic, automatable boundary:
integration, completion, legibility, persistence, and authority. Automation can
prove the arc is reachable, deterministic, and completable; it cannot prove an
uncoached novice completes it. That question belongs to G-02.

## Canonical Behavior

1. The title screen campaign archive presents the twelve-mission registry with
   First Contact (`compact-01`) as the current, launchable opener. Beginning it
   transitions through the production runtime route with the authored scenario
   bindings and a start intent; no CLI or hand-edited URL is required.
2. The arc's ten objectives advance only from real player commands and
   simulation events. Milestones completed slightly out of order are retained so
   an exploratory player cannot permanently strand the sequence.
3. The mission HUD presents the current objective title, hint, and progress as
   an accessible live region whose state matches the authoritative mission
   snapshot; the final objective keeps the LS-08 deployed-Longbow
   antispinward teaching.
4. Mission progress round-trips through the validated save envelope together
   with the match session and AI mode. Malformed or forged mission state fails
   closed without mutating live authority. The campaign profile records
   completion, failure, replay, and retry transitions independently of the match
   save.
5. Campaign wiring observes mission results only for the bound
   `first-contact`/`compact-01` session. The standalone scenario route completes
   the same arc without touching the campaign profile or campaign debrief
   actions. Invalid or mismatched campaign route context fails closed.
6. Ordinary simulation failure remains real inside the arc: losing every Compact
   engineer fails the mission visibly and offers retry without corrupting the
   profile or the save slot.

## Bounded Acceptance Matrix

LS-15 can reach `automation-passed` only when the following categories pass:

1. **Public alpha front door:** the production title campaign archive launches
   First Contact through the runtime route with mission bindings and start
   intent; route context round-trips and mismatched context is rejected.
2. **Arc completable:** deterministic automation completes all ten objectives
   through real construction, production, capture, deployment, and a valid
   antispinward Siege Mortar command, in both the campaign and standalone
   routes.
3. **Onboarding legibility:** the mission HUD exposes the active objective,
   hint, and progress through non-color copy and ARIA live-region semantics at
   the 1280x720 Low target, matching the authoritative mission state.
4. **Persistence and continuity:** mission progress survives save/load round
   trips; campaign route context survives reload; the campaign profile records
   completion, failure, continuation, replay, and retry transitions.
5. **Authority boundary:** tutorial observation never advances objectives by
   DOM clicks or wall-clock timers, never bypasses simulation authority, and
   never leaks campaign semantics into the standalone route; core-match cohorts
   remain unaffected.
6. **Regression and review:** the focused browser lane, full check, and
   protected core-match lane pass. No new solver, balance, shadow,
   overhead-intelligence, air, cargo, transport, or campaign-final behavior is
   introduced.

## Required Automation Lanes

| Lane | Command | Primary coverage |
| --- | --- | --- |
| Tutorial and campaign unit | `npx vitest run tests/tutorial/mission.test.ts tests/tutorial/gameSave.test.ts tests/campaign/missionRegistry.test.ts tests/campaign/campaignRoute.test.ts tests/campaign/campaignProfile.test.ts` | Objective authority, save envelope, registry, route context, profile lifecycle |
| Browser acceptance | `npx playwright test e2e/integrated-tutorial-arc.spec.ts --project=chromium-regression` | Front-door launch, deterministic arc completion, persistence, standalone boundary |
| General regression | `npm run check` | Lint, unit suite, typecheck, and build |
| Match regression | `npm run validate:core-match` | Existing deterministic gameplay cohorts |

The targeted tutorial-arc lane uses its declared `1280x720` Low profile.
Project-wide browser regression retains its own compatibility viewport where
configured; that is not a substitute for the target-resolution acceptance
capture.

## Human Gate: G-02

G-02 requires four of five uncoached novices to complete the tutorial arc
without external coaching, recorded under `docs/player-observation-protocol.md`
without personal data. One internal First Contact completion is recorded in
`docs/playtests/2026-08-02-first-contact-completion.md`; the required novice
cohort remains open.

No smoke run, AI proxy, screenshot, browser test, or agent review can
substitute for the required novice evidence, and no fabricated
player-observation record may be produced to satisfy it. The progress manifest
must not reference an LS-15 claim receipt while G-02 is not passed.

## Explicit Exclusions

LS-15 does not add:

- New objectives, missions, mechanics, balance, solver, shadow, overhead
  intelligence, air, cargo, transport, or campaign-final behavior.
- Tutorial pacing, hint-copy, or difficulty conclusions that require uncoached
  novice observation; those belong to the G-02 cohort.
- A new save schema, renderer bucket, render target, post-processing, or
  binary asset pipeline.
- Fabricated or personally identifying player-observation records.

Those concerns remain assigned to G-02 and later campaign and release slices.

## Completion Boundary

`automation-passed` records only the completed automated lanes. `complete`
requires G-02 to be passed, an exact source-bound claim receipt, and a
criterion review under `docs/launch-scope-execution-policy.md`. The human gate
is a completion requirement, not a defect to work around.
