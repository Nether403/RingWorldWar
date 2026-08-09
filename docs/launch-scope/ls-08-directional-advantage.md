# LS-08 Bounded Acceptance Contract: Directional Advantage And Onboarding

**Status:** Complete; G-01 developer-reviewed initial comprehension gate passed
**Policy version:** 1  
**Slice class:** Gameplay, presentation, and onboarding  
**Depends on:** LS-04 through LS-07

## Player Outcome

Players can see and use the ring's directional artillery advantage without
mistaking the explanatory range footprint for firing authority. First Contact
then asks the player to deploy a Longbow and fire antispinward at a known
target.

This slice prepares the real novice observation gate. Automation can prove that
the teaching path exists and behaves deterministically; it cannot prove that an
uncoached person understands it.

## Canonical Behavior

1. Selecting exactly one friendly Rocket Battery with its conventional rocket,
   or a fully deployed friendly Longbow, shows a lopsided minimap footprint.
2. The footprint labels antispinward as the long-shot direction and spinward as
   the short-shot direction using text, shape, and arrows rather than color
   alone.
3. A seam-crossing footprint draws its wrapped copies and retains the launcher
   cross, so it cannot be interpreted as separate launchers.
4. The selection panel and minimap accessibility label state that the envelope
   is approximate and that live preview and fire checks are authoritative.
5. Cruise Missile and Chord Shot targeting never show the conventional
   directional footprint or target-side direction cue.
6. Conventional artillery targeting shows a ground-side arrow pointing
   antispinward, whether the current target is valid or blocked.
7. Preview and fire continue to enforce the canonical ballistic solution,
   terrain, visibility, power, cooldown, and source-state checks. The overlay
   never grants an otherwise invalid shot.
8. First Contact's final objective requires a deployed Longbow to fire its
   Siege Mortar antispinward near the bound Choir power core.

## Bounded Acceptance Matrix

LS-08 can reach `automation-passed` only when the following categories pass:

1. **Directional profile:** Rocket Battery and deployed Longbow profiles are
   deterministic and antispinward reach exceeds spinward reach.
2. **Weapon-mode gate:** The conventional footprint is present for a Rocket
   Battery standard rocket and absent while Cruise Missile or Chord Shot is the
   active flight mode.
3. **Presentation and accessibility:** The minimap footprint wraps at the seam,
   selection copy and ARIA expose both ranges and the approximate-authority
   distinction, and the target-side cue is antispinward.
4. **Authoritative targeting:** A visible directional overlay does not bypass
   live preflight, and a valid preview agrees with the fired projectile.
5. **Onboarding:** The production First Contact route reaches the final
   objective through real construction, production, capture, deployment, and a
   valid antispinward Siege Mortar command.
6. **Regression and scope:** Existing fixed-step hashes, scenario setup,
   core-match outcomes, build, lint, and affected browser suites pass. No
   balance, solver, shadow, overhead-intelligence, transport, air, cargo, or
   campaign-final behavior is introduced.

## Required Automation Lanes

| Lane | Command | Primary coverage |
| --- | --- | --- |
| Physics and mission | `npx vitest run tests/sim/ballistics.test.ts tests/sim/artillery.test.ts tests/tutorial/mission.test.ts` | Directional reach, authoritative fire, First Contact objective semantics |
| Browser acceptance | `npx playwright test e2e/scenario.spec.ts e2e/tutorial.spec.ts --project=chromium-regression` | Wrapped overlay, flight-mode exclusion, copy, ARIA, preview/fire agreement, onboarding flow |
| General regression | `npm run check` | Lint, unit suite, typecheck, and build |
| Match regression | `npm run validate:core-match` | Existing deterministic gameplay cohorts |

The targeted directional scenario uses its declared `1280x720` Low profile.
Project-wide browser regression retains its own compatibility viewport where
configured; that is not a substitute for the target-resolution acceptance
capture.

## Human Gate: G-01

G-01 requires a successful initial human cohort recorded with
`docs/player-observation-protocol.md`: the human developer and one uncoached
human tester must each demonstrate the five criteria in
`docs/directional-artillery-prototype.md`: direction identification,
target-side inference, approximate-versus-authoritative understanding, seam
interpretation, and independent Longbow/Siege Mortar use.

After reviewing that initial cohort, the developer may require one to three
additional uncoached human testers before accepting G-01. This escalation is a
developer judgement based on observed comprehension, not an automatic fixed
cohort requirement.

No smoke run, AI proxy, screenshot, browser test, or agent review can substitute
for the required human developer and uncoached-tester evidence. The progress
manifest rejects an LS-08 completion claim while G-01 is not passed.

## Explicit Exclusions

LS-08 does not add:

- A new ballistic solver, range tuning, ammunition balance, or rotating-frame
  approximation.
- Directional bonuses for Cruise Missile, Chord Shot, transport, or aircraft.
- Shadow timing, persistent overhead intelligence, a whole-ring strategic view,
  or Gravity Range mode.
- Air, cargo, transport, paired-node finale, Anchor, Migration, or campaign
  expansion behavior.
- Fabricated or personally identifying player-observation records.

Those concerns remain assigned to LS-09 through LS-19 and later campaign and
release slices.

## Completion Boundary

`automation-passed` records only the completed automated lane. `complete`
requires G-01 to be passed, an exact source-bound claim receipt, and a
criterion review under `docs/launch-scope-execution-policy.md`. The human gate
is a completion requirement, not a defect to work around.
