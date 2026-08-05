# Implementation Plan: Phase 2 — Systems Depth

## Overview

This plan builds Ring World War's Phase 2 systems in dependency order: foundational data-layer extensions first, then the ability and weapon systems that depend on them, followed by AI (which needs abilities and weapons to exist), then infrastructure (save/load, quality presets, UI), and finally the headless balance runner that exercises everything together.

## Tasks

- [ ] 1. Extend data tables and core interfaces
  - [ ] 1.1 Extend Unit interface with ability, damage state, and cloak fields
    - Add `ability: AbilityState | null`, `cloaked: boolean`, `stationaryTime: number`, `damageState: 0 | 1 | 2`, `speedMultiplier: number` to the Unit interface in `src/sim/data.ts`
    - Add `AbilityState` type definition (`id`, `active`, `cooldown`, `transitionTimer`)
    - _Requirements: 7.1, 8.1, 9.1, 11.1_

  - [ ] 1.2 Add Wreck entity type and wreckages array to World
    - Define `Wreck` interface in `src/sim/data.ts` with `id`, `s`, `z`, `yaw`, `kind`, `hp`, `lifetime`, `faction`
    - Add `wreckages: Wreck[]` to World state
    - _Requirements: 11.3, 11.4_

  - [ ] 1.3 Add WeaponDef extensions and new weapon entries
    - Add optional `cruise`, `cruiseAltitude`, `chord` fields to `WeaponDef`
    - Add `cruiseMissile` and `chordShot` entries to the WEAPONS table
    - Add `gridLaser` weapon entry for Laser Grid interception
    - _Requirements: 3.1, 4.1, 5.1_

  - [ ] 1.4 Add Silo and Laser Grid structure definitions
    - Add `silo` structure to STRUCTURES table (cost 1200, requires mechFoundry, weapons: ['chordShot'])
    - Add `laserGrid` structure with `coverageArc` field to STRUCTURES table
    - Add optional `coverageArc` to `StructureDef` interface
    - _Requirements: 5.2, 18.1, 18.2, 18.5_

  - [ ] 1.5 Add faction modifiers table
    - Define `FactionModifiers` interface and `FACTION_MODS` constant in `src/sim/data.ts`
    - Meridian Compact: mechHpMultiplier 1.15, ballisticCostMultiplier 0.85
    - Axiom Choir: buildTimeMultiplier 0.85, visionMultiplier 1.2, mechHpMultiplier 0.85
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 1.6 Add difficulty tier types and strategist config table
    - Define `Difficulty` type (`'recruit' | 'veteran' | 'commander'`), `StrategicGoal` type, `StrategistConfig` interface
    - Add `STRATEGIST_CONFIG` mapping each difficulty to evaluation interval, candidate goals, and weights
    - _Requirements: 1.3, 1.4, 1.5_

- [ ] 2. Implement faction asymmetry at spawn time
  - [ ] 2.1 Apply faction modifiers in World.spawnUnit and World.tryQueueUnit
    - Modify `spawnUnit` to multiply mech HP by faction modifier, multiply vision by visionMultiplier
    - Modify `tryQueueUnit` to apply `ballisticCostMultiplier` to ballistic structure/weapon costs
    - Apply `buildTimeMultiplier` to build times at queue time
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 2.2 Write property test for faction modifier determinism
    - **Property 26: Faction modifier determinism**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**

- [ ] 3. Implement ability system
  - [ ] 3.1 Create `src/sim/abilities.ts` with ability definitions and state machine
    - Define `AbilityId`, `AbilityDef`, `ABILITIES` record
    - Implement `tickAbilities(world, dt)` function that processes activate/tick/deactivate lifecycle
    - Implement energy consumption check and exhaustion-triggered deactivation
    - _Requirements: 7.1, 7.3, 7.4, 8.1, 9.1, 10.1_

  - [ ] 3.2 Implement Shield Wall ability
    - `onActivate`: set speedMultiplier to 0.6
    - `onTick`: consume energy per second; if exhausted, deactivate and apply cooldown
    - `onDeactivate`: restore speedMultiplier
    - Implement directional damage reduction (120-degree forward arc check) in damage application
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 3.3 Implement Siege Mode ability
    - `onActivate`: set speed to 0, turn rate to 0, swap weapon stats to siege multipliers, set transitionTimer to 3.0
    - `onTick`: no-op (flags maintain state)
    - `onDeactivate`: set transitionTimer to 3.0, restore mobility after timer expires
    - Apply Counter_Battery_Flash when firing in siege mode
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 3.4 Implement Cloak ability
    - Auto-activate after stationaryTime >= 1.5s (passive activation)
    - `onTick`: if unit moved or fired, deactivate immediately; if enemy within 30m, reveal
    - `onActivate`: set `cloaked = true`
    - `onDeactivate`: set `cloaked = false`
    - Exclude cloaked units from enemy targeting in the targeting loop
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.5 Implement Umbrella ability
    - `onActivate`: expand interception radius to 120m
    - `onTick`: consume energy; if exhausted, deactivate with cooldown
    - `onDeactivate`: reset interception radius to base value
    - Modify interception logic to check umbrella radius for allied units within range
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 3.6 Write property tests for abilities
    - **Property 18: Shield wall directional damage reduction**
    - **Property 19: Ability energy exhaustion deactivation**
    - **Property 20: Siege mode immobilization and stat change**
    - **Property 21: Cloak activation and breaking**
    - **Property 22: Cloak proximity detection**
    - **Property 23: Umbrella radius expansion and contraction**
    - **Validates: Requirements 7.1–7.4, 8.1–8.5, 9.1–9.4, 10.1–10.5**

- [ ] 4. Implement mech damage states and wrecks
  - [ ] 4.1 Implement damage state computation and effects
    - Add `computeDamageState(unit)` function called each tick after damage
    - State 0: ≥66% HP, no effect
    - State 1: 33–66% HP, emit presentation event (sparks)
    - State 2: <33% HP, apply speedMultiplier *= 0.8, emit presentation event (internals exposed)
    - _Requirements: 11.1, 11.2, 11.5_

  - [ ] 4.2 Implement wreck spawning and decay
    - On mech death, spawn Wreck entity at death position with hp, 60s lifetime
    - Tick wrecks: decrement lifetime, remove when expired
    - Make wrecks targetable (can receive damage from attacks)
    - Wrecks provide cover: block line-of-sight checks at short range
    - _Requirements: 11.3, 11.4_

  - [ ]* 4.3 Write property tests for damage states and wrecks
    - **Property 24: Damage state determination**
    - **Property 25: Wreck spawning on death**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

- [ ] 5. Implement counter-battery flash reveal
  - [ ] 5.1 Formalize counter-battery flash in visibility system
    - Ensure any entity firing a ballistic weapon sets `revealed = FIRING_REVEAL_TIME` (6 seconds)
    - In `isEntityVisible`, return true if `entity.revealed > 0` regardless of fog state
    - Tick `revealed` down by dt each sim step; when it reaches 0, restore normal fog
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 5.2 Write property test for counter-battery flash
    - **Property 17: Counter-battery flash visibility**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 6. Implement cruise missile system
  - [ ] 6.1 Implement terrain-following flight integrator
    - In `stepProjectiles`, detect cruise missiles via `WEAPONS[proj.weapon].cruise`
    - Advance cruise missile along surface toward target at launch speed
    - Maintain altitude at most `cruiseAltitude` (50m) above local terrain height
    - On reaching target coordinates, apply splash damage via standard damage table
    - _Requirements: 3.1, 3.4, 3.5_

  - [ ] 6.2 Implement cruise missile interception rules
    - Laser grids skip cruise missiles (altitude check: `< 200m` means no engagement)
    - Point defense and Aegis umbrella engage cruise missiles by range regardless of altitude
    - _Requirements: 3.2, 3.3_

  - [ ]* 6.3 Write property tests for cruise missiles
    - **Property 7: Cruise missile altitude invariant**
    - **Property 8: Cruise missile laser grid immunity**
    - **Property 9: Point defense engages cruise missiles**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

- [ ] 7. Implement laser grid structure
  - [ ] 7.1 Implement `stepLaserGrids` in World
    - Iterate alive laser grid structures
    - For each ballistic projectile at apex altitude (> 200m) within coverage arc:
      - Skip if cruise missile or chord shot above atmosphere
      - Check fire-rate cooldown and energy availability
      - On interception: mark projectile doomed, consume energy, emit event
    - Sequential engagement limited by fire rate enables saturation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 7.2 Write property tests for laser grid
    - **Property 15: Laser grid saturation**
    - **Property 16: Laser grid energy gate**
    - **Validates: Requirements 5.3, 5.5**

- [ ] 8. Implement chord shot system
  - [ ] 8.1 Implement chord shot flight physics and visibility
    - Chord shots use high launch angle exceeding escape velocity → existing integrator handles zero drag above ATMOSPHERE_HEIGHT
    - Add global visibility override: while `projectile.p.h > ATMOSPHERE_HEIGHT`, both factions see it
    - On re-entry, drag resumes and terminal damage applies at impact
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 8.2 Implement chord shot accuracy penalty and Silo gating
    - If target area lacks spotter vision, apply Gaussian jitter (spread = 80m) to impact point
    - Chord shots can only fire from Silo structures (validate in `fireBallisticAt`)
    - Silo applies Counter_Battery_Flash on fire
    - Silo reload cooldown prevents spam
    - _Requirements: 4.5, 4.6, 18.2, 18.3, 18.4_

  - [ ]* 8.3 Write property tests for chord shots
    - **Property 11: Chord shot exits atmosphere**
    - **Property 12: Zero drag above atmosphere**
    - **Property 13: Chord shot global visibility**
    - **Property 14: Accuracy penalty without spotter vision**
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.6**

- [ ] 9. Checkpoint — Weapon and ability systems
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement AI Strategist
  - [ ] 10.1 Implement goal scoring functions in `src/ai/opponent.ts`
    - Implement scoring for each StrategicGoal (expand, tech, harass, defend, allIn) as weighted sums of normalized signals
    - Each function reads only information visible to the AI (no cheats)
    - Wire evaluation interval from STRATEGIST_CONFIG based on active difficulty
    - Select highest-scoring goal and emit directives to Tactician
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 10.2 Write property tests for Strategist
    - **Property 1: Strategist scores all candidate goals**
    - **Property 2: AI never receives resource cheats**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6**

- [ ] 11. Implement AI Tactician with behavior trees
  - [ ] 11.1 Create `src/ai/behaviorTree.ts` with BT node framework
    - Implement `BTNode` interface with `tick(ctx)` and `reset()`
    - Implement composites: `Selector` (first success), `Sequence` (all succeed)
    - Implement decorators: `Cooldown` (rate-limit), `DifficultyGate` (min tier check)
    - _Requirements: 2.1_

  - [ ] 11.2 Implement behavior tree leaf nodes
    - `FocusFire`: assign squad target to highest-priority enemy in range
    - `Retreat`: move toward nearest rally point when HP below threshold
    - `Reposition`: move after firing (counter-battery evasion)
    - `DodgeIncoming`: move out of predicted splash area (Veteran/Commander only)
    - `ActivateAbility`: trigger unit's ability when conditions met
    - `FormUp`: position Aegis to maximize umbrella coverage over allies
    - _Requirements: 2.2, 2.3, 2.4, 2.8, 2.9_

  - [ ] 11.3 Implement squad formation and Tactician update loop
    - Partition alive mech units into squads by proximity and role
    - Assign behavior tree to each squad based on strategic goal and composition
    - Implement reaction delay: 0 for Commander, 0.8s for Veteran, behaviors skipped for Recruit
    - Wire Tactician into the AI update cycle, executing after Strategist
    - _Requirements: 2.1, 2.5, 2.6, 2.7_

  - [ ]* 11.4 Write property tests for Tactician
    - **Property 3: Tactician assigns all combat units to exactly one squad**
    - **Property 4: Focus-fire convergence**
    - **Property 5: Retreat threshold triggers withdrawal**
    - **Property 6: Difficulty gates behaviors**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7**

- [ ] 12. Checkpoint — AI systems
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement save/load simulation state
  - [ ] 13.1 Create `src/sim/serialize.ts` with snapshot serialization
    - Define `SimSnapshot` interface with version, tick, rngState, seed, all entity arrays, nextId, winner
    - Implement `serializeWorld(world): SimSnapshot` converting world state to plain objects
    - Implement `deserializeWorld(snapshot): World` reconstructing world from snapshot
    - Add `Rng.fromState(state)` factory if not already present
    - _Requirements: 16.1, 16.2_

  - [ ] 13.2 Implement snapshot validation and versioning
    - Implement `validateSnapshot(data): data is SimSnapshot` with field-by-field type checks
    - Reject snapshots with mismatched `version` field
    - `World.load()` returns error result on invalid snapshot without mutating current state
    - _Requirements: 16.4, 16.5_

  - [ ]* 13.3 Write property tests for save/load
    - **Property 28: Simulation snapshot round-trip**
    - **Property 29: Invalid snapshot rejection**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5**

- [ ] 14. Implement quality preset framework
  - [ ] 14.1 Create `src/render/settings.ts` with presets and persistence
    - Define `QualityPreset`, `QualityConfig` types and `PRESETS` record (Low/Medium/High/Ultra)
    - Implement `Settings` class: constructor reads from localStorage, `save()` persists, `apply(renderer)` sets all config values
    - Low disables shadows, reduces particle cap to 25%, skips post-processing
    - Ultra enables all features at max fidelity
    - Fall back to 'high' if localStorage value is unrecognized
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 14.2 Write property test for settings persistence
    - **Property 27: Settings round-trip persistence**
    - **Validates: Requirements 13.3**

- [ ] 15. Implement settings menu UI
  - [ ] 15.1 Create `src/ui/settingsMenu.ts` pause overlay
    - Toggle on Escape key press (DOM overlay, does not stop sim)
    - Include quality preset dropdown (Low/Medium/High/Ultra) wired to Settings class
    - Include master volume slider (0–100%, persisted via Settings)
    - Include keybindings display (read-only list of current controls)
    - Include Resume button that closes overlay and restores gameplay input
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 16. Expand F3 performance overlay
  - [ ] 16.1 Expand `src/ui/perfOverlay.ts` (or rename from debugOverlay.ts)
    - Toggle visibility on F3 keypress
    - Display: frame time (ms), FPS, draw call count, active entity count, sim step duration (ms), memory estimate
    - Update values every frame
    - Render as fixed-position DOM element with `pointer-events: none`
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 17. Implement headless AI-vs-AI batch runner
  - [ ] 17.1 Create `src/headless/runner.ts` with match execution
    - Implement `runHeadlessMatch(config: HeadlessConfig): MatchResult`
    - Create World + two AiOpponents, loop `world.step()` + `ai.update()` until winner or tick limit
    - On time cap (45 min), resolve via dominance score
    - Return MatchResult with winner, duration, economy stats, unit/structure counts
    - NEVER import from render/, ui/, or use DOM APIs
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 19.4_

  - [ ] 17.2 Create Vitest integration test for headless batch
    - Accept params: seed, faction pair, difficulty pair, tick limit
    - Run configurable batch (default 20 matches)
    - Assert neither faction wins more than 70% of matches
    - Assert average match duration is 20–40 minutes simulated
    - On the pinned reference runner, exclude one JIT warmup and assert a five-run standard-terrain median at or below 15s with a clean-source receipt
    - _Requirements: 17.2, 17.4, 17.5, 19.1, 19.2, 19.3_

  - [ ]* 17.3 Write property test for headless match completeness
    - **Property 30: Headless match completeness**
    - **Property 31: Time-cap dominance resolution**
    - **Validates: Requirements 17.3, 19.4**

- [ ] 18. Checkpoint — Integration and final validation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Wire all systems together in World.step()
  - [ ] 19.1 Integrate ability ticking, damage states, wreck decay, and laser grids into the main step loop
    - Call `tickAbilities(world, dt)` after movement resolution
    - Call `computeDamageState` for all alive mechs after damage application
    - Call `stepLaserGrids(dt)` after projectile advancement
    - Tick wreck lifetimes, remove expired wrecks
    - Ensure cruise missile and chord shot paths work end-to-end with all interception systems
    - _Requirements: All weapon and ability requirements_

  - [ ]* 19.2 Write integration tests for cross-system interactions
    - Test: cruise missile passes through laser grid without interception
    - Test: chord shot triggers global visibility while above atmosphere
    - Test: Aegis umbrella intercepts cruise missile targeting nearby ally
    - Test: Longbow in siege mode fires → counter-battery flash reveals it
    - Test: Wisp cloaks → enemy cannot target → proximity reveals
    - _Requirements: 3.2, 4.4, 10.2, 8.5, 9.1–9.4_

- [ ] 20. Final checkpoint — All systems operational
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The sim/ boundary constraint (no render imports) must be maintained in all new sim modules
- The headless runner is the ultimate integration validation — if it works, all sim systems compose correctly

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.2", "5.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.3"] },
    { "id": 4, "tasks": ["3.6", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1", "8.1"] },
    { "id": 6, "tasks": ["6.3", "7.2", "8.2"] },
    { "id": 7, "tasks": ["8.3", "10.1"] },
    { "id": 8, "tasks": ["10.2", "11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3"] },
    { "id": 10, "tasks": ["11.4", "13.1", "14.1"] },
    { "id": 11, "tasks": ["13.2", "14.2", "15.1", "16.1"] },
    { "id": 12, "tasks": ["13.3", "17.1"] },
    { "id": 13, "tasks": ["17.2", "17.3"] },
    { "id": 14, "tasks": ["19.1"] },
    { "id": 15, "tasks": ["19.2"] }
  ]
}
```
