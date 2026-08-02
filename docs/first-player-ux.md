# First-Player Command Clarity

## Sensor Coverage

The ring-strip minimap draws a dark shroud and dashed nominal sensor footprints for every completed friendly unit and structure. Footprints use each entity's runtime `vision` multiplied by the current power-derived sensor scale. They do not sample a LOS grid and do not reveal hidden enemy entities.

`SENSOR COVERAGE` means a point is inside at least one effective sensor radius. It is not a promise of exact line of sight. During artillery targeting, the minimap reports both `SENSOR COVERAGE` and `EXACT LOS`; exact LOS is queried only for the cursor point and can be blocked by terrain or wreck cover. A selected sensor also shows its effective range, current power reduction, and a dashed pooled world-space radius ring.

## Artillery Authority

`World.fireBallisticCommand` returns one structured result: `match-ended`, `invalid-source`, `longbow-not-deployed`, `longbow-transitioning`, `reloading`, `insufficient-power`, `outside-sensor-range`, `sensor-los-blocked`, `no-ballistic-solution`, or `success`. `fireBallisticAt` remains the boolean compatibility wrapper.

Trajectory geometry may remain visible for planning inside nominal coverage while another check blocks firing. The HUD and target marker label that state `PREVIEW ONLY`; a trajectory is never presented as permission to fire. Outside nominal coverage, exact trajectory solving is not exposed through the shroud. Failed commits do not consume spread RNG, power, cooldown, or a projectile.

## Minimap And Selection Inputs

- Minimap left click centers the camera; arrow keys continue to move it when the minimap is focused.
- Minimap right click sends the selected units a normal wrapped move order; Ctrl-right-click sends attack-move.
- With minimap focus, Enter performs the primary action at camera focus (center or artillery fire), M issues move, A issues attack-move, and Escape cancels artillery targeting.
- During artillery targeting, minimap movement updates the target preview, left click attempts the shot, and right click cancels.
- World-canvas left drag shows a viewport-bounded technical selection rectangle after 6 px. It is suppressed for clicks, building, artillery targeting, and direct control, and is hidden on release, cancellation, context menu, blur, or menu opening.
