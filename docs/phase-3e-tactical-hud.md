# Phase 3E - Tactical HUD and Command Feedback

**Status:** Planned after Phase 3D checkpoint.

## Goal

Turn the functional technical overlay into one coherent command system while
preserving every accepted command, minimap, artillery, mission, and selector
contract.

## Scope

- Explicit responsive HUD zones for resources, mission, alert, selection,
  command deck, minimap, and context help.
- Persistent resource nodes patched in place rather than rebuilt every frame.
- Clear selection hierarchy, textual HP, current order, and status treatment.
- Command readiness/active/reload/locked labels with keyboard focus preserved.
- Presentation-only command acknowledgments and a three-item visible event rail.
- Stronger minimap frame, focus treatment, topology copy, and compact legend.
- Accessible blocking dialogs, nonblocking transmission focus behavior, settings
  focus discovery, reduced motion, contrast, and short-viewport containment.

## Boundaries

- No new commands, controls, mobile/touch claim, remapping, targeting, or economy.
- No change to minimap coordinate mapping, sensor/LOS semantics, or artillery authority.
- No UI framework, external font/icon package, binary asset, or per-frame DOM growth.
- No direct-control heat/ammo/lead/damage-direction values that lack authority.
- Existing classes, data attributes, accessible names, and text contracts remain.

## Gate

1. No overlap at 1280x720, 1100x640, 700x600, and short/narrow viewports.
2. Resources, selected force, available action, objective, and minimap camera are found immediately.
3. Blocked controls remain clickable for precise explanations and expose ARIA state.
4. Command acknowledgment never replaces critical alerts.
5. Event rail consumes only visibility-filtered events and stays bounded.
6. Keyboard focus survives command refresh; dialogs trap and restore focus correctly.
7. Reduced-motion and forced-colors fallbacks remain usable.
8. Existing gameplay/browser selectors and behavior stay green.
9. Battlefield scars cannot be confused with live warnings or orders.
10. Final combined T480s gate passes.
