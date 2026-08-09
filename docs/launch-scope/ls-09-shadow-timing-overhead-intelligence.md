# LS-09 Bounded Acceptance Contract: Shadow Timing And Overhead Intelligence

**Status:** Complete; automation and independent remediation review passed  
**Policy version:** 1  
**Slice class:** Platform, gameplay, presentation, and accessibility  
**Depends on:** LS-03, LS-04, LS-06, LS-07, and LS-08

## Player Outcome

Players can read when a moving shadow band will reach the current tactical view,
plan around the resulting solar and sensor penalties, and observe reduced
strategic contacts for major hostile infrastructure around the ring. A launch
from deep shadow creates a visible strategic signal and plume without granting
exact tactical knowledge of the launcher.

## Canonical Shadow Rules

1. One pure core model owns the five-panel, 420-second repeating shadow cycle.
   Rendering, terrain, simulation, HUD timing, and AI queries use that model.
2. The existing `0.19` radian panel half-span, half-spacing opening phase, and
   maximum `0.72` occlusion remain unchanged. Deep shadow therefore remains
   readable at `0.28` direct daylight.
3. A location is `day` outside a panel span, `transition` in either penumbra,
   and `shadow` inside the half-span core. The next transition time is derived
   from simulation time and surface position and is deterministic across the
   wrapped seam and save/load.
4. Solar output continues to multiply by direct daylight. UI copy describes
   reduced output rather than incorrectly claiming that an array stops.
5. Sensor range is source-local. Compact sensors retain at least 65% range in
   deep shadow; Choir sensors retain at least 80%. Penumbra reduction is smooth.
   Faction-wide power degradation remains an additional multiplier.
6. A hostile ballistic projectile in deep shadow is visually observable. A
   hostile `weaponFired` event originating in deep shadow is eligible at any
   ring distance. Neither rule reveals or selects the source entity.

## Overhead Intelligence

`World.strategicContacts(viewer)` returns immutable reduced contacts for hostile:

- living Bastions;
- completed Silos as launch sites;
- captured Spinal Nodes as active Nodes; and
- incomplete Bastions, Mech Foundries, and Silos as major construction.

Contacts are live and continuously derived, not remembered after destruction or
loss of qualifying state. They reveal entity identity to trusted game systems,
surface position, faction, and one broad category. They do not reveal health,
queue, cooldown, capture progress, exact construction progress, nearby units,
or any ordinary structure.

The tactical minimap draws a distinct outlined signal for a strategic contact
only while the entity lacks exact tactical visibility. It publishes bounded
contact counts/categories and includes the current shadow state and next
transition in its accessible label.

## Authority Boundary

Strategic contact is not tactical visibility:

- `isEntityVisible`, `isVisible`, exact LOS, selection, detailed rendering,
  health display, and conventional artillery authority remain unchanged.
- AI may use the same contacts as movement objectives, but target acquisition,
  focus fire, and conventional artillery still require exact tactical contact.
- Counter-battery reveal remains a separate six-second exact reveal.
- Hostile Alignment presentation still requires the existing exact visibility
  rule; an active-Node contact does not disclose a remote pair's Alignment.

## Bounded Acceptance Matrix

LS-09 reaches `automation-passed` only when all categories pass:

1. **Shadow authority:** shared factor, state, period, seam, and next-transition
   calculations are deterministic and rendering consumes the core model.
2. **Gameplay consequences:** solar output remains daylight-driven; source-local
   sensor penalties and faction minima match this contract.
3. **Launch intelligence:** deep-shadow hostile launch events and plumes are
   observable without exact launcher disclosure; day launches retain existing
   fog and range rules.
4. **Strategic contacts:** exact qualifying categories are derived and removed
   with state, while ordinary structures and units remain absent.
5. **Authority and AI:** strategic contacts do not change tactical visibility or
   fire authority; AI can route toward contacts but cannot focus-fire them blind.
6. **Presentation and accessibility:** target-resolution HUD/minimap show timing,
   outlined strategic signals, non-color legend/copy, categories, and ARIA.
7. **Persistence and regression:** world time restores the exact shadow state;
   focused tests, full checks, existing LS-07/08 behavior, and core matches pass.
8. **Scope:** no strategic camera, Gravity Range, cloak/interception rebalance,
   remembered fog, air, cargo, transport, campaign mission, or victory change.

## Required Automation Lanes

| Lane | Command | Primary coverage |
| --- | --- | --- |
| Focused unit | `npx vitest run tests/core/shadow.test.ts tests/sim/shadowIntelligence.test.ts tests/sim/vision.test.ts tests/render/environment.test.ts tests/render/presentationEvents.test.ts tests/audio/audioEngine.test.ts tests/ai/strategist.test.ts tests/ui/hud.test.ts` | Shared timing, gameplay, contacts, authority, launch policy, AI, audio, copy |
| Focused browser | `npx playwright test e2e/shadow-intelligence.spec.ts --project=chromium-regression` | HUD/minimap timing, strategic signals, ARIA, target viewport |
| General regression | `npm run check` | Lint, unit suite, typecheck, and production build |
| Match regression | `npm run validate:core-match` | Existing deterministic gameplay cohorts |

## Explicit Exclusions

LS-09 does not add the LS-10 whole-ring side view or strategic annulus, LS-11
Gravity Range, explored or remembered fog, exact far-side entity models,
searchlights, faster cloak, explicit interception penalties, air/cargo/transport,
new campaign content, balance changes outside the sensor minima, or a new save
schema. Strategic contacts are not target locks.

## Completion Boundary

Completion requires all four automation lanes, one independent criterion review
scoring every category at least 3, an exact source-bound claim receipt, and
atomic activation of LS-10. No human cohort is required for this systems slice.
