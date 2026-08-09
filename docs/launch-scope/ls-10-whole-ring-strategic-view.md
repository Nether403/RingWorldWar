# LS-10 Whole-Ring Strategic Side View

**Status:** Active bounded contract  
**Slice:** LS-10  
**Milestone:** 2 - Ring USP slice

## Player Outcome

The player can leave the local tactical camera for a live side-on view of the
entire ring, read the moving shadow pattern and reduced strategic contacts, and
return without losing tactical focus or selection. The view reinforces that the
surface closes into a ring and that antispinward is the long-shot direction.

## Bounded Contract

- `M` and a keyboard-accessible HUD control toggle the view. `Escape` returns to
  tactical before it can open Settings.
- The simulation continues while the view is open.
- The camera uses a dedicated `whole-ring` owner and a strategic-only render
  layer. Terrain, units, ordinary structures, effects, markers, and battlefield
  dressing are not rendered through that camera.
- The scene is a fixed-budget strategic annulus. It does not render tactical
  entities at reduced scale.
- Shadow bands are sampled from the canonical shared shadow model. No second
  timing formula or environment-local approximation is introduced.
- Hostile marks come only from `World.strategicContacts(viewer)` and expose only
  category, faction, and surface position. They never confer exact visibility,
  selection, targeting, health, construction progress, cooldown, queue, or
  hostile Spinal Alignment knowledge.
- Friendly marks are limited to the same strategic categories: Bastions,
  completed Silos, captured operational Spinal Nodes, and major construction.
- Axial position is deliberately collapsed in the side profile. The view makes
  no claim of tactical axial precision.
- The current tactical focus, shadow timing at that focus, spinward and
  antispinward orientation, contact counts, category names, live-state notice,
  and exit controls have visible non-color text and accessible descriptions.
- The view is read-only. Selection, build placement, abilities, direct-control
  entry, artillery targeting/firing, control-group recall, minimap orders, and
  world-canvas orders are inactive until tactical control is restored.
- Selection and tactical camera focus/yaw/zoom are preserved. Transient build or
  targeting modes are cancelled only after a successful whole-ring transition.
- Failed entry changes no gameplay state. Failed exit leaves one consistent
  whole-ring owner. Load/reset returns to tactical.
- Resize, quality change, shader prewarm, WebGL recovery, and disposal cover the
  strategic scene without leaking resources or causing first-entry compilation.

## Acceptance Criteria

1. **Dedicated view:** `whole-ring` is registered, transactionally enterable,
   side-on, resize-safe, and restores the tactical camera state.
2. **Simplified annulus:** the strategic layer has a fixed render budget and the
   tactical layer is excluded while active.
3. **Shadow authority:** five moving sectors, seam behavior, and local timing
   agree with `src/core/shadow.ts`.
4. **Strategic authority:** only approved live contact categories are shown;
   ordinary units/structures and exact hostile state remain absent.
5. **Input isolation:** no tactical command mutates the world while the view is
   active; `M`, the HUD control, and `Escape` restore tactical control.
6. **Presentation/accessibility:** 1280x720 Low clearly shows the annulus,
   direction/topology, focus, shadow state, contact summary, live-state notice,
   and exit instructions without color-only meaning or overlap.
7. **Lifecycle/performance:** strategic resources prewarm and dispose; the view
   remains bounded and the accepted core-match behavior is unchanged.

## Deliberate Exclusions

- No strategic issuing of orders, selection, targeting, or camera-focus jump.
- No tactical terrain, district, unit, health, queue, cooldown, or exact
  construction-progress display.
- No hostile Spinal pair connector or inferred Alignment.
- No free strategic zoom/rotation, alternate axial projection, strategic pause,
  projectile history, or persistent strategic-view save state.
- No Gravity Range mode, Ballistic Arena behavior, campaign revision, air/cargo
  mechanics, or later district work.

## Qualification

LS-10 requires focused unit and browser lanes, `npm run check`, the core-match
lane, and an independent platform/presentation/accessibility criterion review.
This systems/presentation slice does not require a new human comprehension
cohort. Existing LS-09 source-bound evidence must be regenerated on the final
snapshot because LS-10 intentionally changes shared integration files.
