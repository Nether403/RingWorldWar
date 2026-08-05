# Core Match Validation Sprint Results

These historical measurements were recorded on 2026-08-01 using the then-checked
standard-terrain manifests under `validation/manifests/`. At measurement time,
each cohort contained ten deterministic seeds with two faction-swapped legs, for
twenty matches. The current Veteran mirror methodology instead uses twenty
unique seeds with one leg each; difficulty cohorts retain the historical ten-seed,
two-leg method. The measurements below have not been rewritten or rerun.

## Baseline

Before the sprint, all sixty baseline matches reached the 45-minute time cap.

| Cohort | Result | Mean duration | Primary symptom |
| --- | --- | ---: | --- |
| Veteran mirror | Compact 8, Choir 10, draws 2 | 45:00 | 17/20 destroyed no structures |
| Veteran vs Recruit | Veteran 10, Recruit 9, draw 1 | 45:00 | Difficulty was effectively parity |
| Commander vs Veteran | Commander 10, Veteran 9, draw 1 | 45:00 | Difficulty was effectively parity |

Instrumented matches confirmed four deterministic progression failures:

- Foundries reserved duplicate Wisps before the first completed, saturating the
  opening command cap with too little line strength.
- Scouts selected nodes by insertion order, including disconnected or much more
  distant objectives.
- An impossible fourth Extractor remained the top build desire and prevented
  valid lower-priority structures from being considered.
- Strategic pushes lost their target identity, repeatedly traded nodes, or
  stopped on unreachable/ballistically invalid orders.

## Retained Corrections

- Production composition counts live and queued units before reserving another.
- Build planning falls through to the first affordable feasible site.
- Standard node pads and narrow terrain corridors guarantee strategic
  connectivity without globally reducing slope constraints.
- Scouts choose stable, nearest reachable distinct objectives.
- Unreachable AI strategic orders are recovered without affecting player orders.
- Pushes invalidate captured, arrived, destroyed, and unreachable targets.
- A scenario-known Bastion becomes the strategic win-condition objective in the
  late game; the final approach preserves entity-targeted attacks.
- Mobile artillery continues moving until its directional ballistic envelope can
  reach the target, and failed ballistic solves receive a deterministic backoff.
- Veteran/Commander tactics preserve healthy committed Bastion attacks while
  retaining emergency retreat and projectile dodge behavior.
- The retreat threshold was reduced from 30% to 15% because no repair system
  exists yet; permanently withdrawing survivors previously occupied command for
  the remainder of the match.
- At twenty minutes the AI can construct a power-supported Silo. Chord Shots are
  terminal-point-defence immune; their counterplay is the expensive,
  counter-battery-visible launcher and midcourse Laser Grid coverage.

## Accepted Cohorts

| Cohort | Role result | Faction result | Draws | Mean duration | Gate |
| --- | --- | --- | ---: | ---: | --- |
| Veteran mirror | 50% / 50% role split | Compact 50%, Choir 50% | 0% | 36:33 | PASS |
| Veteran vs Recruit | Veteran 90%, Recruit 10% | Compact 60%, Choir 40% | 0% | 37:10 | PASS |
| Commander vs Veteran | Commander 80%, Veteran 20% | Compact 50%, Choir 50% | 0% | 36:02 | PASS |

All three cohorts satisfy:

- exactly twenty matches;
- neither faction winning more than 70%;
- mean simulated duration from 20 through 40 minutes;
- no excessive draw rate;
- Veteran beating Recruit in more than 60% of matches; and
- Commander beating Veteran in more than 60% of matches.

The ignored detailed reports are generated at:

- `output/core-match/veteran-mirror.{json,md}`
- `output/core-match/veteran-vs-recruit.{json,md}`
- `output/core-match/commander-vs-veteran.{json,md}`

## Opening And Pacing Observations

- First production occurs at approximately six simulated seconds.
- First combat contact generally occurs around eleven to twelve minutes because
  the opposing starts are half a 22.6 km ring apart.
- First Bastion pressure generally begins between twenty-one and twenty-five
  minutes.
- Most decisive endings occur between twenty-seven and forty minutes; a small
  number still reach the 45-minute Dominance cap.

This pacing is suitable for beginning onboarding work: the opening economy has a
clear build window, contact is not immediate, and the late game now reaches an
actual victory condition.

## Remaining Qualification Gap

Requirement 17.5 is not closed on this machine. A representative 35-minute
standard-terrain match completed in roughly 23.5 seconds of wall time, and the
full cohorts showed substantial shared-machine variance. The deterministic
simulation and balance gates pass. This historical ten-second criterion was
superseded on 2026-08-04 by the explicit warm-median runner contract in
`docs/headless-performance-policy.md`; clean-source pinned-runner qualification
remains open.

The sprint also used AI proxies. A real first-time-player observation session is
still needed before tutorial copy and objective timing are finalized.
