# LS-11 Gravity Range

**Status:** Active bounded contract  
**Slice:** LS-11  
**Milestone:** 2 - Ring USP slice

## Player Outcome

The player can launch a gravity-focused range from the main menu, use the
canonical artillery preview and firing rules to strike a nearer spinward marker
and then a farther antispinward marker, and complete the exercise without RTS
economy or enemy-AI pressure. The contrast makes direction a deliberate firing
decision rather than background lore.

## Bounded Contract

- `Gravity Range` is a keyboard-accessible main-menu action and a production
  route. It does not require the development scenario driver.
- The authored range is deterministic and AI-free. It provides one completed
  Rocket Battery, sufficient power, sensor coverage, one friendly and one
  hostile Bastion to keep ordinary victory checks stable, and two inert targets.
- The ordered exercise requires an authoritative impact on a spinward marker
  800 m from the launcher, then an authoritative impact on an antispinward
  marker 1,800 m from the launcher.
- Preview, preflight, firing, flight, and impact use the existing inertial-frame
  ballistic authority. Approximate reach graphics never score a hit.
- Only a Compact `batteryGun` impact within the declared target tolerance
  advances the exercise. Wrong location, faction, weapon, or order does not.
- The tactical minimap remains the primary keyboard and pointer firing surface.
  It names antispinward as the long shot, spinward as the short shot, the joined
  ring edges, sensor state, and the preview-versus-authority distinction.
- The LS-10 whole-ring view remains available as a live, read-only observation
  view. Gravity Range does not weaken its intelligence or command isolation.
- A dedicated mode panel shows the current direction, distance, progress,
  controls, reload state, completion, retry, and main-menu actions with visible
  non-color text and accessible live status.
- Save/load, building, AI combat, and campaign progression are not part of the
  mode. Reset reconstructs the same authored range.

## Acceptance Criteria

1. **Production launch:** the title action and direct route create the same
   deterministic range without development-only controls.
2. **Canonical setup:** AI is disabled and both declared target coordinates pass
   existing power, sensor, LOS, and ballistic preflight authority.
3. **Authoritative loop:** only ordered live impact events advance two stages;
   completion is deterministic and replayable.
4. **Direction comprehension:** the exercise and non-color copy contrast an
   800 m spinward shot with a 1,800 m antispinward shot.
5. **Input and observation:** pointer and keyboard minimap fire remain usable,
   while LS-10 whole-ring command isolation and return behavior remain intact.
6. **Presentation/accessibility:** 1280x720 Low and a narrow viewport expose
   legible mode state, progress, controls, retry, and exit without overlap.
7. **Lifecycle/regression:** reset, disposal, full check, predecessor browser
   lanes, and core match pass without physics or accepted gameplay changes.

## Deliberate Exclusions

- No fixed-cannon Ballistic Arena, ammunition roster, adjustable gravity,
  leaderboard, online score, campaign reward, or save-game schema change.
- No new weapon statistics, solver approximation, ring dimensions, or gravity
  tuning.
- No strategic-view targeting, projectile history, free strategic camera, or
  exact hostile intelligence expansion.
- No air/cargo, district, campaign, skirmish, or remappable-input work.

## Qualification

LS-11 requires focused unit and production-browser lanes, `npm run check`, the
core-match lane, and an independent gameplay/presentation/accessibility review.
The already-passed G-01 comprehension cohort remains the milestone human gate;
this bounded productization slice does not require a second cohort.
