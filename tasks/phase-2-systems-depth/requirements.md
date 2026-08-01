# Requirements Document

## Introduction

Phase 2 of Ring World War adds systems depth and AI intelligence to the playable vertical slice established in Gate 1. The phase introduces a multi-layered AI opponent with three difficulty tiers, expands the rocket arsenal with cruise missiles and chord shots, gives each mech class a signature ability with damage states and wreckage, introduces mechanical faction asymmetry between the Meridian Compact and Axiom Choir, adds a quality-preset rendering framework, implements save/load of simulation state, and establishes a headless AI-vs-AI balance testing pipeline.

All additions maintain the project's hard constraints: zero external assets (everything procedural), deterministic simulation (seeded RNG, 30 Hz fixed tick, sim/ never imports render/), TypeScript strict mode, Three.js, Vite, Vitest, and Playwright.

## Glossary

- **Strategist**: The AI's high-level decision layer that scores goals (expand, tech, harass, all-in) using utility functions against economy and map-control state.
- **Tactician**: The AI's squad-level behavior layer that issues movement, targeting, ability usage, and retreat orders using behavior trees.
- **Behavior_Tree**: A hierarchical decision structure where nodes are evaluated top-to-bottom with selector/sequence composites, used by the Tactician to drive squad actions.
- **Difficulty_Tier**: One of three AI skill levels (Recruit, Veteran, Commander) that modulates reaction time, behavior availability, and optimization depth.
- **Cruise_Missile**: A terrain-hugging, low-altitude rocket that is immune to midcourse laser grid interception but vulnerable to point defense.
- **Chord_Shot**: A heavy projectile that exits the ring atmosphere and travels across the ring's interior, striking the far side. An endgame weapon.
- **Laser_Grid**: A structure that burns ballistic rockets at apex altitude within its coverage arc. Ineffective against cruise missiles and chord shots during interior transit.
- **Counter_Battery_Flash**: A temporary visibility reveal of a firing position after a weapon discharge, enabling retaliatory targeting.
- **Shield_Wall**: The Vanguard mech's activated ability that projects a frontal energy barrier reducing incoming damage from the forward arc.
- **Siege_Mode**: The Longbow mech's deployed state that immobilizes it and converts it into a mobile rocket battery with extended range and fire rate.
- **Cloak**: The Wisp mech's passive ability rendering it invisible to enemy vision while stationary.
- **Umbrella**: The Aegis mech's activated ability that extends its point-defense coverage radius to protect nearby allied units.
- **Damage_State**: A visual and mechanical degradation tier applied to mechs as HP decreases, affecting appearance and performance.
- **Wreck**: A persistent, non-functional husk left on the battlefield when a mech is destroyed. Provides cover and salvage.
- **Faction_Asymmetry**: Stat differences between the Meridian Compact and Axiom Choir applied to the shared unit/structure roster.
- **Quality_Preset**: A named rendering configuration (Low, Medium, High, Ultra) that adjusts draw distance, shadow quality, particle density, and post-processing effects.
- **Perf_Overlay**: A debug HUD activated by F3 that displays frame time, draw calls, entity count, and sim step duration.
- **Sim_Snapshot**: A JSON-serializable representation of the complete simulation state at a given tick, used for save/load and determinism validation.
- **Headless_Sim**: A simulation execution without a renderer, used for AI-vs-AI batch testing in CI.
- **World**: The authoritative simulation state container in `src/sim/world.ts`.
- **Meridian_Compact**: The first playable faction with amber/orange visual identity, cheaper artillery, and tougher mechs.
- **Axiom_Choir**: The second playable faction with cyan/white visual identity, faster deployment, and better sensors.

## Requirements

### Requirement 1: AI Strategist with Utility Scoring

**User Story:** As a player, I want the AI opponent to adapt its strategy to the current match state, so that every game feels different and the opponent exploits my weaknesses.

#### Acceptance Criteria

1. WHEN a strategy evaluation tick occurs, THE Strategist SHALL score each candidate goal (expand, tech, harass, defend, all-in) against current economy, army strength, map control, and enemy visibility.
2. WHEN the highest-scoring goal changes, THE Strategist SHALL transition the active goal within one evaluation cycle and issue new directives to the Tactician.
3. WHILE the Difficulty_Tier is Recruit, THE Strategist SHALL evaluate goals every 3.0 seconds and limit the candidate set to expand, tech, and defend.
4. WHILE the Difficulty_Tier is Veteran, THE Strategist SHALL evaluate goals every 1.5 seconds using the full candidate set.
5. WHILE the Difficulty_Tier is Commander, THE Strategist SHALL evaluate goals every 0.6 seconds using the full candidate set with optimized weighting coefficients.
6. THE Strategist SHALL operate without resource cheats at any Difficulty_Tier — only reaction speed and decision quality vary.

### Requirement 2: AI Tactician with Behavior Trees

**User Story:** As a player, I want the AI to control its squads intelligently with coordinated maneuvers, so that combat feels like fighting a thinking opponent rather than a script.

#### Acceptance Criteria

1. THE Tactician SHALL organize available combat units into squads and assign each squad a Behavior_Tree governing movement, targeting, ability activation, and retreat.
2. WHEN a squad engages enemies, THE Tactician SHALL execute focus-fire targeting on the highest-priority threat within weapon range.
3. WHEN a squad member's HP falls below a retreat threshold, THE Tactician SHALL issue a withdraw order toward the nearest safe rally point.
4. WHEN artillery units fire, THE Tactician SHALL issue a reposition order within 2 seconds of the Counter_Battery_Flash expiring.
5. WHILE the Difficulty_Tier is Recruit, THE Tactician SHALL skip kiting, ability coordination, and dodge behaviors.
6. WHILE the Difficulty_Tier is Veteran, THE Tactician SHALL execute all behaviors but with a 0.8-second reaction delay before responding to new threats.
7. WHILE the Difficulty_Tier is Commander, THE Tactician SHALL execute all behaviors with minimal reaction delay and optimized target prioritization.
8. WHEN the Tactician controls Aegis mechs escorting a push, THE Tactician SHALL position them to maximize Umbrella coverage over allied units.
9. WHEN enemy rocket impact zones are telegraphed, THE Tactician SHALL issue dodge orders to mobile units within the predicted splash area (Commander and Veteran tiers only).

### Requirement 3: Cruise Missile System

**User Story:** As a player, I want terrain-hugging missiles that bypass midcourse laser grids, so that I have a tool for breaking through heavily-defended static positions.

#### Acceptance Criteria

1. WHEN a Cruise_Missile is launched, THE World SHALL simulate its flight at low altitude following terrain contours using the existing rotating-frame integrator.
2. WHILE a Cruise_Missile is in flight, THE World SHALL enforce immunity to Laser_Grid interception.
3. WHILE a Cruise_Missile is in flight, THE World SHALL allow Point_Defense structures and Aegis Umbrella abilities to intercept it within their engagement range.
4. WHEN a Cruise_Missile reaches its target coordinates, THE World SHALL apply explosive splash damage using the standard damage table.
5. THE Cruise_Missile SHALL travel at a maximum altitude of 50 metres above local terrain height throughout its flight path.
6. WHEN a player targets a Cruise_Missile launch, THE World SHALL display a predicted ground-track ribbon showing the planned route.

### Requirement 4: Chord Shot System

**User Story:** As a player, I want a devastating cross-ring weapon for the endgame, so that I can threaten any point on the map at the cost of high visibility and expense.

#### Acceptance Criteria

1. WHEN a Chord_Shot is launched, THE World SHALL simulate its trajectory exiting the atmosphere shell and traversing the ring interior.
2. WHILE a Chord_Shot is above the atmosphere shell, THE World SHALL apply zero drag to its flight.
3. WHEN a Chord_Shot re-enters the atmosphere on the far side, THE World SHALL resume drag calculations and apply terminal damage at the impact point.
4. WHILE a Chord_Shot is in transit across the ring interior, THE World SHALL make the projectile visible to all players regardless of fog of war.
5. THE Chord_Shot SHALL require a Silo structure (new endgame building, requires Mech Foundry) and cost significantly more salvage and energy than standard ballistic rockets.
6. IF a Chord_Shot's launch position lacks spotter coverage of the target, THEN THE World SHALL apply a targeting accuracy penalty widening the impact ellipse.

### Requirement 5: Laser Grid Structure

**User Story:** As a player, I want a midcourse interception structure that denies airspace to standard ballistic rockets, so that I can create safe zones behind defensive lines.

#### Acceptance Criteria

1. WHEN a ballistic rocket reaches apex altitude within a Laser_Grid's coverage arc, THE Laser_Grid SHALL attempt interception consuming energy per engagement.
2. THE Laser_Grid SHALL define a coverage arc in surface coordinates, creating a geometric zone players can reason about on the map.
3. WHILE the Laser_Grid has insufficient energy, THE Laser_Grid SHALL fail to intercept and display a depleted state indicator.
4. THE Laser_Grid SHALL have zero effect on Cruise_Missiles (too low altitude) and Chord_Shots during interior transit (outside atmosphere).
5. WHEN multiple ballistic rockets pass through the coverage arc simultaneously, THE Laser_Grid SHALL engage them sequentially limited by its fire rate, allowing saturation.

### Requirement 6: Counter-Battery Flash Reveal

**User Story:** As a player, I want to see where enemy artillery fires from, so that I can plan counter-strikes against their batteries.

#### Acceptance Criteria

1. WHEN any ballistic weapon fires, THE World SHALL reveal the firing entity's position to all enemy players for a duration defined in the data table.
2. WHILE a firing entity is revealed by Counter_Battery_Flash, THE World SHALL grant vision of that entity to enemy players regardless of fog-of-war state.
3. WHEN the reveal duration expires, THE World SHALL remove the vision grant and restore normal fog-of-war rules for that entity.

### Requirement 7: Vanguard Shield Wall Ability

**User Story:** As a player, I want my Vanguard mechs to project a frontal shield, so that I can hold chokepoints and protect my army during advances.

#### Acceptance Criteria

1. WHEN the player activates Shield_Wall on a Vanguard, THE World SHALL apply a damage reduction multiplier to all incoming damage from the Vanguard's forward 120-degree arc.
2. WHILE Shield_Wall is active, THE World SHALL reduce the Vanguard's movement speed by 40%.
3. WHILE Shield_Wall is active, THE World SHALL consume energy at a per-second rate defined in the data table.
4. IF energy is exhausted while Shield_Wall is active, THEN THE World SHALL deactivate Shield_Wall and apply a cooldown before reactivation.
5. THE Vanguard SHALL render a visible energy barrier effect in the forward arc while Shield_Wall is active.

### Requirement 8: Longbow Siege Mode Ability

**User Story:** As a player, I want my Longbow mech to deploy into a powerful stationary artillery platform, so that I can bring devastating long-range fire from unexpected positions.

#### Acceptance Criteria

1. WHEN the player activates Siege_Mode on a Longbow, THE World SHALL immobilize the Longbow and increase its weapon range and fire rate according to data-table multipliers.
2. WHILE in Siege_Mode, THE Longbow SHALL use the full ballistic trajectory solver for targeting, matching Rocket Battery behavior.
3. WHEN the player deactivates Siege_Mode, THE World SHALL apply a 3-second deploy/undeploy transition before movement is restored.
4. WHILE in Siege_Mode, THE Longbow SHALL be unable to move or turn its chassis.
5. WHEN a Longbow in Siege_Mode fires, THE World SHALL apply Counter_Battery_Flash revealing its position.

### Requirement 9: Wisp Cloak Ability

**User Story:** As a player, I want my Wisp scouts to become invisible while stationary, so that I can establish hidden spotting positions deep in enemy territory.

#### Acceptance Criteria

1. WHILE a Wisp is stationary for longer than 1.5 seconds, THE World SHALL apply Cloak making the Wisp invisible to enemy vision.
2. WHEN a cloaked Wisp begins moving or fires its weapon, THE World SHALL immediately remove Cloak and reveal the Wisp.
3. WHILE a Wisp is cloaked, THE World SHALL exclude the Wisp from enemy targeting and render it transparent to the owning player only.
4. IF an enemy unit moves within a detection radius of 30 metres of a cloaked Wisp, THEN THE World SHALL reveal the Wisp to that unit's faction.

### Requirement 10: Aegis Umbrella Ability

**User Story:** As a player, I want my Aegis mech to extend its missile defense coverage to nearby allies, so that I can protect advancing forces from rocket volleys.

#### Acceptance Criteria

1. WHEN the player activates Umbrella on an Aegis, THE World SHALL expand the Aegis interceptor engagement radius to cover all allied units within a 120-metre radius.
2. WHILE Umbrella is active, THE Aegis SHALL intercept incoming ballistic and cruise projectiles targeting any unit within the umbrella radius, consuming energy per interception.
3. WHILE Umbrella is active, THE World SHALL increase the Aegis energy draw by the rate defined in the data table.
4. IF the Aegis's energy supply is exhausted while Umbrella is active, THEN THE World SHALL deactivate Umbrella and apply a cooldown.
5. WHEN the player deactivates Umbrella, THE World SHALL immediately reduce the interception radius to the Aegis's base value.

### Requirement 11: Mech Damage States

**User Story:** As a player, I want mechs to visually and mechanically degrade as they take damage, so that combat feels impactful and I can assess enemy unit health at a glance.

#### Acceptance Criteria

1. WHEN a mech's HP drops below 66% of maximum, THE World SHALL transition it to Damage_State 1 (light damage: cosmetic sparks, no stat penalty).
2. WHEN a mech's HP drops below 33% of maximum, THE World SHALL transition it to Damage_State 2 (heavy damage: movement speed reduced by 20%, visible armor loss).
3. WHEN a mech is destroyed, THE World SHALL spawn a Wreck entity at the death position with a hitbox that provides cover for ground units.
4. THE Wreck SHALL persist for 60 seconds before decaying and SHALL be targetable to deny cover.
5. WHEN a mech enters Damage_State 2, THE World SHALL emit a presentation event for the renderer to apply exposed-internals and limping visual effects.

### Requirement 12: Faction Asymmetry — Axiom Choir vs Meridian Compact

**User Story:** As a player, I want the two factions to play differently, so that faction choice is a meaningful strategic decision and matchups create variety.

#### Acceptance Criteria

1. THE World SHALL apply faction-specific stat modifiers to the shared unit and structure roster at entity creation time, sourced from a per-faction data table.
2. WHILE playing as Axiom_Choir, THE World SHALL apply a deployment speed bonus (15% faster build times) and a sensor range bonus (20% increased vision) to all units and structures.
3. WHILE playing as Axiom_Choir, THE World SHALL apply an armor penalty (15% reduced HP) to all mech-class units.
4. WHILE playing as Meridian_Compact, THE World SHALL apply a cost reduction (15% cheaper salvage cost) to all ballistic weapons and rocket structures.
5. WHILE playing as Meridian_Compact, THE World SHALL apply a durability bonus (15% increased HP) to all mech-class units.
6. THE World SHALL resolve faction modifiers deterministically by reading the faction field of the owning player at creation time.
7. THE renderer SHALL apply distinct color palettes (cyan/white for Axiom_Choir, amber/orange for Meridian_Compact) and silhouette variations to all faction-owned entities.

### Requirement 13: Quality Preset Framework

**User Story:** As a player, I want to choose a graphics quality level matching my hardware, so that the game runs smoothly on lower-end machines and looks best on powerful ones.

#### Acceptance Criteria

1. THE renderer SHALL support four named Quality_Presets: Low, Medium, High, and Ultra, each defining shadow resolution, draw distance, particle cap, and post-processing level.
2. WHEN the player selects a Quality_Preset from the settings menu, THE renderer SHALL apply the preset's parameters within 1 second without requiring a page reload.
3. THE settings menu SHALL persist the selected Quality_Preset to localStorage and restore it on next session load.
4. WHILE Quality_Preset is Low, THE renderer SHALL disable shadows, reduce particle cap to 25% of Ultra, and skip all post-processing passes.
5. WHILE Quality_Preset is Ultra, THE renderer SHALL enable all visual features at maximum fidelity.

### Requirement 14: Settings Menu

**User Story:** As a player, I want an in-game settings menu to configure graphics and controls, so that I can tune the experience without editing files.

#### Acceptance Criteria

1. WHEN the player presses Escape during gameplay, THE UI SHALL display a pause/settings overlay without stopping the simulation (single-player continues in background).
2. THE settings menu SHALL include a Quality_Preset selector with the four named presets.
3. THE settings menu SHALL include a master volume slider (for future audio, wired to a stored value now).
4. THE settings menu SHALL include a keybindings display showing current control mappings.
5. WHEN the player closes the settings menu, THE UI SHALL restore the gameplay view and resume input handling.

### Requirement 15: F3 Performance Overlay

**User Story:** As a developer or power user, I want a performance overlay showing real-time metrics, so that I can identify bottlenecks and verify frame budgets.

#### Acceptance Criteria

1. WHEN the player presses F3, THE Perf_Overlay SHALL toggle visibility.
2. WHILE visible, THE Perf_Overlay SHALL display: frame time (ms), frames per second, draw call count, active entity count, sim step duration (ms), and memory estimate.
3. THE Perf_Overlay SHALL update its values every frame without causing measurable performance impact (less than 0.5 ms overhead).
4. THE Perf_Overlay SHALL render as a DOM overlay that does not interfere with gameplay input.

### Requirement 16: Save/Load Simulation State

**User Story:** As a player, I want to save my match progress and resume later, so that I can play long matches across multiple sessions.

#### Acceptance Criteria

1. WHEN the player triggers a save action, THE World SHALL serialize its complete simulation state to a JSON Sim_Snapshot including tick count, RNG state, all entity data, economy state, and terrain seed.
2. WHEN the player triggers a load action, THE World SHALL deserialize a Sim_Snapshot and restore the simulation to the exact state represented, including RNG stream position.
3. WHEN a Sim_Snapshot is loaded, THE World SHALL produce identical subsequent state hashes as a continuous run from the same tick, validating the determinism boundary.
4. IF a Sim_Snapshot fails schema validation on load, THEN THE World SHALL reject the load and display an error message without corrupting current state.
5. THE Sim_Snapshot format SHALL be versioned with a schema identifier so that future format changes can detect and reject incompatible saves.

### Requirement 17: Headless AI-vs-AI Balance Simulation

**User Story:** As a developer, I want to run automated AI-vs-AI matches without a renderer, so that I can gather balance data across many games in CI.

#### Acceptance Criteria

1. THE Headless_Sim SHALL execute a complete match (World creation through victory or time-cap) without importing any render or DOM dependencies.
2. WHEN invoked from Vitest, THE Headless_Sim SHALL accept parameters for: seed, faction pair, difficulty pair, and tick limit.
3. WHEN a headless match completes, THE Headless_Sim SHALL output a results record containing: winner, match duration in ticks, final economy stats per faction, units produced, units lost, and structures destroyed.
4. THE CI pipeline SHALL run a configurable batch of headless matches (default: 20) and assert that aggregate win rates fall within acceptable balance bounds (neither faction wins more than 70% across the batch).
5. THE Headless_Sim SHALL complete a 40-minute simulated match in under 10 seconds of wall-clock time on CI hardware.

### Requirement 18: Silo Structure (Chord Shot Launcher)

**User Story:** As a player, I want a dedicated endgame structure for launching chord shots, so that accessing the most powerful weapon requires investment and can be scouted.

#### Acceptance Criteria

1. THE Silo SHALL be a buildable structure requiring a Mech Foundry prerequisite and costing significantly more salvage than a Rocket Battery.
2. WHEN the Silo completes construction, THE World SHALL enable Chord_Shot targeting from that structure.
3. THE Silo SHALL have a long reload cooldown between Chord_Shot launches, preventing spam.
4. WHEN the Silo fires, THE World SHALL apply Counter_Battery_Flash revealing the Silo's position.
5. THE Silo SHALL consume a large energy amount per shot, making it dependent on a robust power economy.

### Requirement 19: Gate 2 Match Quality Criteria

**User Story:** As a developer, I want measurable acceptance criteria for AI quality, so that Phase 2 is complete only when matches feel competitive and appropriately timed.

#### Acceptance Criteria

1. WHEN playing on Veteran difficulty, THE AI SHALL defeat a first-time player (simulated by Recruit-tier AI proxy) in more than 60% of headless matches.
2. WHEN playing on Veteran difficulty, THE AI SHALL lose to an experienced player (simulated by Commander-tier AI proxy) in more than 60% of headless matches.
3. THE average match duration across 20 recorded AI-vs-AI matches on Veteran difficulty SHALL fall between 20 and 40 minutes of simulated game time.
4. IF any single match exceeds the 45-minute time cap, THEN THE World SHALL resolve it via Dominance score as specified in the existing data table.
