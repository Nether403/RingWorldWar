# Core Match Validation

Core-match validation is an opt-in deterministic balance harness. It is separate from the ordinary Vitest suite because each checked manifest expands to twenty full matches with an 81,000-tick cap. The Veteran mirror uses twenty unique seeds with one leg each; difficulty comparisons use ten seeds with two faction-swapped legs each.

## What It Measures

Each manifest declares `legsPerSeed` as `1` or `2`. The first leg assigns role A to the Meridian Compact and role B to the Axiom Choir. When a second leg is requested, it retains the same terrain and world seed while swapping the role and difficulty assignments.

The observer runs after the runner's single event drain and does not write to simulation state. It records:

- First contact, defined as the first combat unit or armed structure acquiring a target.
- First production, defined as the first `unitComplete` event.
- First combat, defined as the first `weaponFired` event.
- First Bastion damage, defined as the first observed Bastion below maximum HP.
- Samples every 900 ticks (30 simulation seconds) containing salvage, net power, dominance, alive and idle combat units, queued units, structures, and Bastion HP.
- The last tick with first contact or a discrete weapon fire/impact/interception, unit production, unit/structure death, node capture, structure-construction completion, damage-state change, or first Bastion-damage observation. Continuing contact and continuous construction progress are not observed.
- Terminal flags for no combat units, all combat units idle, empty production queues, and no progress for one telemetry window.

Wall-clock measurement is disabled by default. When enabled it appears in reports for profiling only; gate evaluation never reads it.

## Gates

Manifest parsing is strict and rejects unknown fields, duplicate seeds or roles, invalid rates, unsupported difficulties, `legsPerSeed` values other than `1` or `2`, and cohort sizes that do not equal `pairSeeds.length * legsPerSeed`.

Checked manifests enforce:

- Exactly 20 matches.
- Mean match duration from 1,200 through 2,400 simulation seconds (20 through 40 minutes).
- At most 70% wins by either faction.
- A manifest-configured draw cap.
- Optional minimum or maximum win rates for named difficulty roles.

Because the requirement is strictly greater than 60%, a 20-match cohort must
record at least 13 wins. The checked difficulty cohorts therefore require
Veteran to beat Recruit in at least 65% of all matches and Commander to beat
Veteran in at least 65%. Draws remain in the denominator.

## Usage

Run the Veteran mirror manifest:

```powershell
npm run validate:core-match
```

Select another manifest in PowerShell:

```powershell
$env:CORE_MATCH_MANIFEST = 'validation/manifests/veteran-vs-recruit.json'
npm run validate:core-match
Remove-Item Env:CORE_MATCH_MANIFEST
```

Select another manifest in a POSIX shell:

```bash
CORE_MATCH_MANIFEST=validation/manifests/commander-vs-veteran.json npm run validate:core-match
```

Enable observational wall-clock metrics by setting `CORE_MATCH_WALL_CLOCK=1` in the same way.

Reports are written to the ignored `output/core-match/` directory as JSON and Markdown. Both formats embed the parsed manifest and the reproducible per-match seed and assignment table.

`npm test` includes only `tests/**/*.test.ts`; it never discovers `validation/core-match.test.ts`.
