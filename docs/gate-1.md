# Gate 1 Verification Receipt

## Status

The technical playable slice is complete. The remaining gate item is a human playtest by someone outside development; automation cannot honestly substitute for the fun/readability assessment in the original gate.

## Locked Decisions

- Ring radius: 3.6 km; width: 4 km; gravity: 6 m/s².
- Antispinward artillery has the long-range advantage.
- Stable forward Three.js rendering with ACES is the Gate 1 baseline.
- Stable object arrays remain the simulation model for this entity budget.
- Simulation and flow fields remain on the main thread until profiling justifies worker synchronization.
- No external assets.

## Implemented Slice

- Fixed 30 Hz deterministic world with render interpolation and state hashes.
- Procedural complete-ring terrain, wrapped cached flow fields, and local avoidance.
- Salvage, power/brownouts, command reservation, prerequisites, construction, and production.
- Vision and terrain LOS enforced by targeting, AI, rendering, picking, health bars, and minimap.
- Direct fire, armor, splash damage, deaths, artillery, shared trajectory preview, and interception.
- Player-commanded Rocket Battery targeting and counter-battery reveal.
- Tactical selection/orders/control groups and direct mech takeover/return.
- Utility AI, Spinal Node capture, Dominance, Bastion victory, and time-cap resolution.
- Stable renderer fallback plus black-frame and GPU-resource regressions.

## Verification

```text
npm run lint
npm test
npm run build
npm run test:e2e
```

Automated coverage includes ring math, ballistics, navigation, determinism, economy, production invariants, authoritative vision, commanded artillery path agreement, interception, victory, match resolution, renderer stability, and the browser command loop.

## Human Gate

- [ ] A player outside development completes a match without intervention.
- [ ] Record match duration, outcome, points of confusion, and whether the ring/artillery asymmetry were understood.
- [ ] Decide go/rebalance/re-scope before beginning Phase 2 depth work.
