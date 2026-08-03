# First UX Observation - 2026-08-02

## Context

Early hands-on observation after the directional-artillery prototype. This is
development feedback, not a completed USP-comprehension cohort.

## Observations

1. Fog of war and sensor ownership were unclear.
2. Artillery collapsed unrelated failures into one message:
   `TARGET UNREACHABLE, UNSPOTTED, OR LAUNCHER RELOADING`.
   A visible trajectory made this especially misleading when cooldown, power,
   deployment, sensor coverage, or terrain LOS was the real blocker.
3. The minimap could center the camera but could not issue unit or artillery
   commands.
4. Drag selection worked without a visible selection rectangle.

## Retained Corrections

- Minimap now displays nominal wrapped sensor coverage over a dark shroud and
  labels it as `SENSOR COVERAGE`; exact terrain LOS remains a separate check.
- Selected sensors display effective range and power reduction, plus a pooled
  world-space range ring.
- Artillery commands return structured authoritative failure reasons and show
  precise messages for deployment, transition, reload, power, sensor range,
  terrain LOS, and trajectory failure. Blocked trajectories are explicitly
  marked `PREVIEW ONLY`.
- Minimap left-click centers the camera, right-click issues selected-unit
  orders, Ctrl-right-click attack-moves, and artillery targeting can preview and
  fire through the minimap.
- Left-drag selection now renders a bounded, pointer-transparent technical
  selection rectangle and clears it on release, cancel, blur, or menu open.

## Verification

- Structured fire-command reasons have unit coverage, including no-side-effect
  failure paths.
- Playwright covers blocked-preview messaging followed by successful fire,
  minimap movement/attack-move/artillery commands, sensor presentation, and the
  visible multi-unit drag rectangle.
- The T480s 1280x720 Low heavy-combat gate remains passing after these changes.

## Follow-up Observation

The follow-up internal playtest passed the four comprehension checks:

- Nominal sensor coverage versus exact terrain LOS was clear.
- The tester understood that a visible trajectory is a preview and could name
  the invalid game states that block the projected action.
- Minimap commands worked and their semantics felt logical.
- The tester understood that spinward and antispinward firing produce different
  velocity outcomes. The mechanic required some acclimation, but was described
  as original and functional rather than arbitrary.

This is sufficient evidence to begin the tutorial alpha. It is one internal
observation, not the full five-player USP cohort, so final tutorial copy and
balance remain provisional.
