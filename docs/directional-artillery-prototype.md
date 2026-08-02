# Directional Artillery USP Prototype

## Status

Implemented as a prototype. Automated behavior and rendering checks pass. Human comprehension is **unverified** and remains the release gate for the USP.

## Player-Facing Behavior

Selecting exactly one friendly conventional ballistic launcher displays a lopsided footprint on the ring-strip minimap:

- `◀ ANTISPINWARD` is the long side.
- `SPINWARD ▶` is the short side.
- The launcher is marked with a cross.
- The dashed wedge, arrows, text, and `ANTISPINWARD = LONG SHOT` panel copy communicate direction without relying on color.
- The footprint is drawn in wrapped copies when it crosses the joined minimap edges.

The overlay applies to Rocket Battery standard rockets and to a Longbow only after Siege Mode has finished deploying. Silo Chord Shot and cruise flight are excluded because their flight modes do not use the conventional level-ground directional envelope.

For the current weapon definitions, the level-ground explanatory profile is approximately:

| Weapon | Spinward | Antispinward |
| --- | ---: | ---: |
| Rocket Battery `batteryGun` | 2.5 km | 9.9 km |
| Longbow `siegeMortar` | 2.1 km | 8.9 km |

These are approximate, conservative communication ranges derived from the drag-free necessary envelope. Terrain, visibility, drag refinement, and exact target geometry still determine whether a shot is valid.

## Authority And Cost

`directionalReachProfile` uses the same rotating-ring `requiredLaunch` helper as the aim solver. It samples the fixed flight-time envelope and performs a bounded directional binary search. It does not call `solveAim`, `maxRangeInDirection`, the drag integrator, or terrain queries.

`World.directionalBallisticReach` caches profiles by weapon, launch speed, and relative muzzle height. HUD redraws read the cached result. The existing throttled trajectory preview and `fireBallisticAt` remain authoritative and continue to use the canonical drag path.

The target marker adds a pooled three-segment arrow pointing antispinward. It adds no draw call and performs no trajectory solve.

## Longbow Command Rules

- A Longbow gets a `Siege Mortar` ground-target button only when Siege Mode is active and its transition timer is zero.
- `Game.beginArtilleryTarget` accepts either a unit or structure through the same ballistic capability path.
- Targeting cancels if the source dies, disappears, becomes invalid, or starts undeploying.
- Preview and firing still enforce visibility, cooldown, power, terrain, and exact ballistic reach.

## Validation Scenario

`validation/scenarios/directional-artillery.json` places a selected deployed Compact Longbow near the ring seam, Compact Wisp and radar spotters, supporting power, and a Choir target antispinward of the launcher. The target arrangement makes the favorable long side explicit while exercising seam wrapping and satisfies the declared live-structure invariant.

Run:

```text
npm run rww -- play directional-artillery
npm run rww -- visual directional-artillery
npx playwright test e2e/scenario.spec.ts --grep "deployed Longbow"
npm run rww -- perf browser-heavy --scenario directional-artillery --target validation/hardware/t480s-low.json --seconds 5 --json
```

The first command is the approved human USP workflow. It opens a headed hardware Chromium window with the exact deterministic setup, disables general AI for this teaching scenario, resumes normal world ticking, and leaves the tester in control. Close the browser or press Ctrl+C when the observation is complete. The command prints a local notes template, receipt path, and exact reproduction command. Follow `docs/player-observation-protocol.md`; do not use `--headless` for human evidence.

The automated browser assertion verifies that the displayed antispinward range exceeds the spinward range, multiple wrapped overlay copies are drawn, the deployed Longbow button starts targeting, and the authoritative preview agrees with the newly fired projectile.

The durable visual signature, renderer metadata, scenario hash, artifact hashes, and dirty-worktree caveat are tracked at `validation/evidence/directional-artillery-visual.json`. Its ignored source receipt can be regenerated with the visual command above; the tracked evidence is the reviewable repository record.

## Human Success Criteria

Human comprehension is **unverified**. A moderated or instrumented playtest should pass all of these criteria before treating the USP as validated:

1. On first selection, at least 4 of 5 players identify antispinward as the longer shot direction within five seconds without coaching.
2. At least 4 of 5 players correctly choose which side of a target is favorable after seeing the target-side arrow once.
3. At least 4 of 5 players understand that the minimap footprint is approximate and the live trajectory preview is authoritative.
4. No participant interprets the seam-wrapped halves as two launchers or two separate firing zones.
5. Players can deploy a Longbow, find the Siege Mortar target command, preview a shot, and fire without being told where the command appears.

Failure on criteria 1 or 4 should trigger a minimap communication revision before any balance or physics changes are considered.

Ask these five questions without explaining the mechanic first:

1. Which direction lets this launcher shoot farther?
2. Which side of the target is the favorable firing position, and why?
3. Is the minimap footprint exact or approximate, and what determines whether the shot can actually fire?
4. What do the footprint halves wrapping across the joined minimap edges represent?
5. Without coaching, can the tester deploy the Longbow, find Siege Mortar, preview a shot, and fire?

## Latest Measurement

On 2026-08-02, a 1280x720 Low, 5-second T480s-target browser run on Intel UHD Graphics 620 passed the existing `720p-low-hard-candidate` gate:

- Frame interval: 16.7 ms median, 16.7 ms p95, 16.8 ms p99.
- Full frame work: 4.4 ms median, 8.4 ms p95, 9.6 ms p99.
- Render work: 2.6 ms median, 4.1 ms p95, 5.3 ms p99.
- Simulation work: 0.3 ms median, 0.6 ms p95, 1.7 ms p99.
- Frames over 100 ms: 0.
- Context losses: 0.
- Draw calls: 25.

Receipt: `output/runs/20260802T011710.897Z-13324-5773ec3f/receipt.json`.

The final directional visual validation after the first-player UX corrections passed all invariants with 9 live units, 8 live structures, no browser errors, and no context losses. See `validation/evidence/directional-artillery-visual.json` rather than relying on the ignored local receipt alone.
