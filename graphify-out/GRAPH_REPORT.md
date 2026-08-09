# Graph Report - .  (2026-08-09)

## Corpus Check
- 386 files · ~303,939 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2666 nodes · 6795 edges · 232 communities (169 shown, 63 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 293 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Scenario Saves and Test Driver
- Launch Evidence Validation
- Simulation Data and Tests
- World Snapshot Serialization
- Media Generation and Manifests
- Game Interaction Controller
- TypeScript Project Configuration
- Shadow Cycle Environment
- World Simulation Tick
- Terrain and Navigation Foundations
- Camera Control Modes
- Qualification Receipts
- Project Package Tooling
- Core Match Reporting
- Tactical HUD Interface
- Runtime Scenario Parsing
- Scenario Validation CLI
- Ring Math and Anchors
- Procedural Terrain Generation
- Campaign Profile Persistence
- Rotating Frame Ballistics
- Title Screen Menus
- AI Opponent Strategy
- Strategic Ballistic Commands
- Mission Narrative Integration
- Headless Match Runner
- AI Strategic Planning
- Procedural Model Generation
- Renderer Lifecycle Quality
- World Combat Resolution
- Tutorial Mission Objectives
- RWW Command Execution
- Application Boot and Campaign
- Scene Dressing and Markers
- Delivery Roadmaps and Gates
- Terrain Rendering Pipeline
- AI Behavior Trees
- Web Audio Backend
- Tactical AI Behaviors
- World Rendering Updates
- Surface Navigation Fields
- Spinal Alignment Gameplay
- Camera Input Controls
- Settings Menu Controls
- World Setup and Production
- Combat Particle Effects
- Persisted Render Settings
- CLI Argument Parsing
- Session Audio Wiring
- Instanced Mech Rendering
- Mission Snapshot Parsing
- Headless Performance Profiling
- Combat Presentation Effects
- Product Roadmap and Assets
- Campaign Title Screen Data
- Camera Mode Framework
- Mission Event Bindings
- Core Match Manifests
- Tactical Retreat Behaviors
- Campaign Mission Registry
- Visual Calibration Tools
- Mission Controller Flow
- Browser Performance Metrics
- Browser Scenario Automation
- Voice Clip Preloading
- Deterministic Randomness
- Ring Environment Rendering
- Audio Backend Interface
- Audio Engine Tests
- Visual Signature Analysis
- Tactician Squad Management
- Procedural Audio Mixer
- Core Match Manifest Parsing
- Voice Media Manifest
- Campaign Route Parameters
- Media Delivery Receipts
- Runtime Hardware Doctor
- Headless Performance Policy
- Audio Cue Routing
- Debug Overlay Controls
- Core Match Cohorts
- Entity Renderer Setup
- Screenshot Capture Tool
- Paired Spinal Nodes
- Last Rotation Setting
- Directional Artillery Roadmap
- Break Line Tutorial
- Last Rotation Worldbuilding
- First Contact Scenario
- Phase Two Task Plan
- Launch Scope Policy
- Distress Poster Artwork
- Player Observation Protocol
- First Contact Playtest
- Tactical UX Playtest
- Signature Battlefield Design
- Faction Visual Identity
- Phase Four Hardening
- Browser Matrix Qualification
- Voice Visual Identity
- Counterfire Playtest
- Artillery Human Gate
- Campaign End-to-End Tests
- Core Game Concepts
- Ring Crisis Title Art
- Signal Briefing Art
- Signal Hunters Art
- Last Correction Art
- Migration Signal Art
- Choir Vanguard Dossier
- Choir Wisp Dossier
- Compact Longbow Dossier
- AI Difficulty Configuration
- Tactical HUD Plan
- Tactician Unit Tests
- Deterministic Simulation Design
- Signal in Spine Narrative
- RWW CLI Documentation
- Tactical Media Provenance
- Opening Video Provenance
- Core Interface Contracts
- Directional Artillery Scope
- Skirmish Theater Design
- Ballistic Performance Plan
- Atmosphere Rendering Design
- Battlefield Memory Design
- Tactical HUD Design
- Performance Baseline Plan
- Renderer Profiling Plan
- Break Line End-to-End Test
- Scenario End-to-End Test
- Launch Progress Dashboard
- Choir Engineer Dossier
- Choir Longbow Dossier
- Choir Needle Dossier
- Compact Aegis Dossier
- Compact Bulwark Dossier
- Compact Engineer Dossier
- Compact Vanguard Dossier
- Project Overview
- AI Systems Task Plan
- Boundary Lint Tool
- Headless Qualification Workflow
- AI Design Specification
- Weapon Systems Requirements
- Spinal Network Glossary
- Ring Space Architecture
- Cinematic Presentation Specification
- Core Match Validation
- Directional Artillery Prototype
- First Contact Tutorial
- First Player UX
- Combat Design Systems
- Core Loop Design
- Playable Slice Gate
- Shadow Intelligence Scope
- Memory and Recovery Hardening
- Tutorial End-to-End Test
- Application Loading Screen
- Choir Aegis Dossier
- Compact Wisp Dossier
- Chord Shot Task Plan
- Phase Two Delivery Report
- Development Phase Roadmap
- Presentation Feature Plan
- Campaign Storage Test Double
- Browser CI Qualification
- Ability and Damage Design
- Chord Shot Design
- Cruise and Laser Design
- Match Quality Requirements
- AI Requirements
- Anchor Protocol Glossary
- Migration Protocol Glossary
- Last Rotation Glossary
- Spinal Alignment Decision
- Data and Determinism Architecture
- Ring Surface Coordinates
- Atmosphere Art Direction
- Faction Color Art Direction
- Break Line Mission Docs
- Core Match Accepted Results
- Core Match Corrections
- Counterfire Mission Docs
- Procedural Model Contracts
- Shadow Cycle Model
- Determinism Performance Plan
- Session Recovery Hardening
- Procedural World Assets
- Ring Physics Requirements
- Counterfire End-to-End Test
- HUD End-to-End Test
- Play Command End-to-End Test
- Signal Spine End-to-End Test
- Campaign Validation Error
- Missile and Laser Tasks
- Ring Ballistics Tasks
- Verification CI Job
- Counter Battery Specification
- Faction Asymmetry Specification
- Quality Preset Specification
- Phase Two Requirements
- Bastion Glossary
- Chord Shot Glossary
- Scrith Salvage Glossary
- Shadow Square Glossary
- Signal Spine Overview
- Procedural Art Direction
- Game Design Overview
- Procedural Audio Contract
- Presentation Preproduction
- Drag Selection Playtest
- Shader Atmosphere Design
- District Palette Roadmap
- Performance Hardening Roadmap
- Mech Ability Tasks
- Quality Preset Tasks

## God Nodes (most connected - your core abstractions)
1. `World` - 222 edges
2. `Faction` - 178 edges
3. `Game` - 78 edges
4. `deltaS()` - 76 edges
5. `Terrain` - 67 edges
6. `wrapS()` - 58 edges
7. `RenderAnchor` - 54 edges
8. `surfaceDist()` - 49 edges
9. `startSession()` - 42 edges
10. `AiOpponent` - 39 edges

## Surprising Connections (you probably didn't know these)
- `Directional Artillery High Ground` --semantically_similar_to--> `Direction Is Territory`  [INFERRED] [semantically similar]
  game ideas plus.md → docs/publishable-game-roadmap.md
- `Gravity Range Arcade Mode` --semantically_similar_to--> `Launch Scope`  [INFERRED] [semantically similar]
  game ideas.md → docs/publishable-game-roadmap.md
- `startSession()` --indirect_call--> `frame()`  [INFERRED]
  src/main.ts → tests/audio/audioEngine.test.ts
- `Deterministic State Task` --semantically_similar_to--> `Deterministic Simulation`  [INFERRED] [semantically similar]
  tasks/todo.md → docs/spec.md
- `applyBrowserScenario()` --indirect_call--> `unit()`  [INFERRED]
  e2e/support/scenario-driver.ts → tests/headless/core-match.test.ts

## Import Cycles
- 2-file cycle: `src/ai/opponent.ts -> src/ai/tactician.ts -> src/ai/opponent.ts`
- 3-file cycle: `src/ai/behaviorTree.ts -> src/ai/opponent.ts -> src/ai/tactician.ts -> src/ai/behaviorTree.ts`

## Hyperedges (group relationships)
- **Phase 2 Systems Depth** — _kiro_specs_phase_2_systems_depth_design_ai_strategist, _kiro_specs_phase_2_systems_depth_design_ai_tactician, _kiro_specs_phase_2_systems_depth_design_cruise_missile, _kiro_specs_phase_2_systems_depth_design_chord_shot, _kiro_specs_phase_2_systems_depth_design_laser_grid, _kiro_specs_phase_2_systems_depth_design_ability_system, _kiro_specs_phase_2_systems_depth_design_headless_sim_runner [EXTRACTED 1.00]
- **Ring World War Core Loop** — docs_game_design_core_loop, docs_game_design_scrith_salvage, docs_game_design_rocket_warfare, docs_game_design_mech_combat, docs_game_design_spinal_alignment [EXTRACTED 1.00]
- **Core Match Balance Validation** — docs_core_match_validation_core_match_validation, docs_core_match_validation_observer, docs_core_match_validation_balance_gates [EXTRACTED 1.00]
- **Paired Spinal Control System** — docs_launch_scope_ls_07_paired_spinal_nodes_operational_pair, docs_launch_scope_ls_07_paired_spinal_nodes_spinal_alignment, docs_launch_scope_ls_07_paired_spinal_nodes_pair_dominance, docs_launch_scope_ls_07_paired_spinal_nodes_pair_aware_ai [EXTRACTED 1.00]
- **Directional Artillery Onboarding** — docs_launch_scope_ls_08_directional_advantage_directional_artillery_advantage, docs_launch_scope_ls_08_directional_advantage_directional_range_footprint, docs_launch_scope_ls_08_directional_advantage_authoritative_targeting, docs_launch_scope_ls_08_directional_advantage_first_contact_final_objective, docs_launch_scope_ls_08_directional_advantage_g_01_human_gate [EXTRACTED 1.00]
- **Shadow Intelligence System** — docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_shadow_cycle_core_model, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_shadow_gameplay_effects, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_strategic_contacts, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_tactical_visibility_boundary [EXTRACTED 1.00]
- **Last Rotation Survival Doctrines** — docs_narrative_last_rotation_meridian_compact, docs_narrative_last_rotation_anchor_protocol, docs_narrative_last_rotation_axiom_choir, docs_narrative_last_rotation_migration_protocol [EXTRACTED 1.00]
- **Phase 4 Hardening Program** — docs_phase_4_performance_hardening_phase_4b_headless_qualification, docs_phase_4_performance_hardening_phase_4c_renderer_gpu, docs_phase_4_performance_hardening_phase_4d_memory_startup_recovery, docs_phase_4_performance_hardening_phase_4e_device_browser_matrix, docs_phase_4_performance_hardening_gate_4 [EXTRACTED 1.00]
- **Ring USP Slice Components** — docs_publishable_game_roadmap_ring_usp_slice, docs_publishable_game_roadmap_direction_is_territory, docs_publishable_game_roadmap_physics_guardrails, docs_publishable_game_roadmap_validation_gates [EXTRACTED 1.00]
- **Ring War Core Loop** — game_ideas_plus_directional_artillery_high_ground, game_ideas_plus_spinal_alignment, game_ideas_plus_shadow_square_front_line, game_ideas_plus_revised_core_loop [EXTRACTED 1.00]
- **Phase 2 Combat Systems** — tasks_phase_2_systems_depth_design_cruise_missile, tasks_phase_2_systems_depth_design_chord_shot, tasks_phase_2_systems_depth_design_laser_grid, tasks_phase_2_systems_depth_design_mech_abilities, tasks_phase_2_systems_depth_design_silo [EXTRACTED 1.00]
- **Compromised Transmission Status** — public_media_presentation_last_rotation_poster_degraded_signal, public_media_presentation_last_rotation_poster_unknown_source, public_media_presentation_last_rotation_poster_aes_256_encryption_malfunction [INFERRED 0.85]
- **Ring Habitat Crisis Depiction** — public_media_presentation_last_rotation_title_habitat_ring_interior, public_media_presentation_last_rotation_title_central_luminary, public_media_presentation_last_rotation_title_inhabited_cityscape, public_media_presentation_last_rotation_title_damaged_superstructure [INFERRED 0.85]
- **Signal Hunting Observation System** — public_media_presentation_narrative_signal_hunters_signal_hunter_drone, public_media_presentation_narrative_signal_hunters_tracking_overlay, public_media_presentation_narrative_signal_hunters_central_signal_spire [INFERRED 0.75]
- **Final Correction Visual System** — public_media_presentation_narrative_signal_last_correction_habitat_ring, public_media_presentation_narrative_signal_last_correction_central_energy_discharge, public_media_presentation_narrative_signal_last_correction_perimeter_correction_signal, public_media_presentation_narrative_signal_last_correction_last_correction [INFERRED 0.85]
- **Signal Migration Flow** — public_media_presentation_narrative_signal_migration_signal_emitter, public_media_presentation_narrative_signal_migration_holographic_transmission_path, public_media_presentation_narrative_signal_migration_stellar_focal_point [EXTRACTED 1.00]
- **Aegis Visual Configuration** — public_media_presentation_units_dossier_choir_aegis_aegis, public_media_presentation_units_dossier_choir_aegis_quadruped_armored_walker, public_media_presentation_units_dossier_choir_aegis_illuminated_sensor_arrays [INFERRED 0.85]
- **Mobile Launcher Configuration** — public_media_presentation_units_dossier_choir_longbow_choir_longbow, public_media_presentation_units_dossier_choir_longbow_articulated_quadrupedal_chassis, public_media_presentation_units_dossier_choir_longbow_elevated_tubular_launcher, public_media_presentation_units_dossier_choir_longbow_armored_weapon_platform [EXTRACTED 1.00]
- **Vanguard Combat Configuration** — public_media_presentation_units_dossier_choir_vanguard_axiom_choir_vanguard, public_media_presentation_units_dossier_choir_vanguard_bipedal_combat_mech, public_media_presentation_units_dossier_choir_vanguard_dual_heavy_armament [EXTRACTED 1.00]
- **Wisp Sensor Platform** — public_media_presentation_units_dossier_choir_wisp_wisp_unit, public_media_presentation_units_dossier_choir_wisp_bipedal_machine_chassis, public_media_presentation_units_dossier_choir_wisp_sensor_antenna_array [EXTRACTED 1.00]
- **Aegis Combat Walker Configuration** — public_media_presentation_units_dossier_compact_aegis_armored_bipedal_combat_walker, public_media_presentation_units_dossier_compact_aegis_dual_sensor_dish_array, public_media_presentation_units_dossier_compact_aegis_shoulder_mounted_weapon_turrets [INFERRED 0.85]
- **Defensive Combat Platform** — public_media_presentation_units_dossier_compact_bulwark_compact_bulwark, public_media_presentation_units_dossier_compact_bulwark_quadrupedal_combat_chassis, public_media_presentation_units_dossier_compact_bulwark_frontal_shield_armor, public_media_presentation_units_dossier_compact_bulwark_dual_cannon_armament [EXTRACTED 1.00]
- **Compact Engineer Unit Assembly** — public_media_presentation_units_dossier_compact_engineer_compact_engineer_unit, public_media_presentation_units_dossier_compact_engineer_armored_biped_chassis, public_media_presentation_units_dossier_compact_engineer_cable_spool, public_media_presentation_units_dossier_compact_engineer_articulated_tool_arm [EXTRACTED 1.00]
- **Longbow Artillery Walker Configuration** — public_media_presentation_units_dossier_compact_longbow_self_propelled_artillery_platform, public_media_presentation_units_dossier_compact_longbow_long_range_cannon, public_media_presentation_units_dossier_compact_longbow_quadrupedal_chassis, public_media_presentation_units_dossier_compact_longbow_sensor_module [EXTRACTED 1.00]
- **Compact Vanguard Combat Unit Configuration** — public_media_presentation_units_dossier_compact_vanguard_armored_bipedal_combat_chassis, public_media_presentation_units_dossier_compact_vanguard_layered_heavy_armor, public_media_presentation_units_dossier_compact_vanguard_dual_rotary_cannon_armament [EXTRACTED 1.00]

## Communities (232 total, 63 thin omitted)

### Community 0 - "Scenario Saves and Test Driver"
Cohesion: 0.07
Nodes (65): applyBrowserScenario(), applyScenarioHealth(), benchmarkScenario(), BrowserScenario, captureScenarioFrame(), captureScenarioState(), captureScenarioStateHash(), installUploadProfiler() (+57 more)

### Community 1 - "Launch Evidence Validation"
Cohesion: 0.08
Nodes (64): ls07CriterionReview(), ls07RunArtifacts(), alias, allowlistedString(), asArray(), asRecord(), buildProgressPayload(), CLAIM_EVIDENCE_POLICY (+56 more)

### Community 2 - "Simulation Data and Tests"
Cohesion: 0.04
Nodes (52): ATMOSPHERE_HEIGHT, ABILITIES, TrajectorySample, ArmorClass, BUILDABLE, COMMAND_PER_NODE, Cost, DamageType (+44 more)

### Community 3 - "World Snapshot Serialization"
Cohesion: 0.11
Nodes (57): AbilityDef, AbilityId, AbilityState, BaseAbilityDef, CloakDef, createAbilityState(), ShieldWallDef, SiegeModeDef (+49 more)

### Community 4 - "Media Generation and Manifests"
Cohesion: 0.09
Nodes (46): root, run, buildImageRequest(), decodeImage(), finalPrompt(), main(), parseArgs(), pathExists() (+38 more)

### Community 5 - "Game Interaction Controller"
Cohesion: 0.08
Nodes (4): abilityName(), clamp(), Game, wireCommands()

### Community 6 - "TypeScript Project Configuration"
Cohesion: 0.04
Nodes (46): DOM, DOM.Iterable, e2e, ES2022, node, playwright.config.ts, src, ./src/ai/* (+38 more)

### Community 7 - "Shadow Cycle Environment"
Cohesion: 0.08
Nodes (37): DAY_LENGTH, RING_CIRCUMFERENCE, SHADOW_SQUARE_COUNT, clamp01(), distanceToPanelCenter(), normalizePanelAngle(), panelPhaseAt(), relativePanelAngle() (+29 more)

### Community 8 - "World Simulation Tick"
Cohesion: 0.10
Nodes (5): surfaceDistSq(), snapshotPlayer(), World, updateCounterfireMilestones(), runTicks()

### Community 9 - "Terrain and Navigation Foundations"
Cohesion: 0.07
Nodes (31): CORIOLIS_SCALE, MAX_FLIGHT_HEIGHT, RING_HALF_WIDTH, RING_PERIOD, RING_SURFACE_SPEED, RING_WIDTH, SIM_DT, SURFACE_GRAVITY (+23 more)

### Community 10 - "Camera Control Modes"
Cohesion: 0.07
Nodes (8): clamp(), lerp(), CameraController, RigModeController, CameraRig, shortestDelta(), RuntimeScenario, RuntimeScenarioWorld

### Community 11 - "Qualification Receipts"
Cohesion: 0.11
Nodes (37): cwd, receipt, reportPath, runDirectory, runId, runsRoot, startedAt, executePerf() (+29 more)

### Community 12 - "Project Package Tooling"
Cohesion: 0.05
Nodes (39): dependencies, three, description, devDependencies, playwright, @types/node, @types/three, typescript (+31 more)

### Community 13 - "Core Match Reporting"
Cohesion: 0.07
Nodes (37): CoreMatchFactionInactivity, CoreMatchFactionSample, CoreMatchFactionSummary, CoreMatchGateCheck, CoreMatchGateEvaluation, CoreMatchGatePolicy, CoreMatchManifestValidationError, CoreMatchMilestone (+29 more)

### Community 14 - "Tactical HUD Interface"
Cohesion: 0.10
Nodes (9): button(), decorativeImage(), el(), formatRange(), Hud, hudEventText(), minimapAriaLabel(), shadowTimingCopy() (+1 more)

### Community 15 - "Runtime Scenario Parsing"
Cohesion: 0.17
Nodes (36): arcPosition(), axialPosition(), boolean(), boundedArray(), difficulty(), faction(), factionLabel(), fail() (+28 more)

### Community 16 - "Scenario Validation CLI"
Cohesion: 0.15
Nodes (37): ACTIVE_ABILITY_UNITS, array(), BALLISTIC_SOURCE_WEAPONS, BALLISTIC_WEAPONS, boundedInteger(), boundedNumber(), DAMAGE_TYPES, exactKeys() (+29 more)

### Community 17 - "Ring Math and Anchors"
Cohesion: 0.07
Nodes (19): StrategicState, STRATEGIST_CONFIG, renderToRing(), ringToRender(), tangentAt(), TAU, upAt(), Vec3Out (+11 more)

### Community 18 - "Procedural Terrain Generation"
Cohesion: 0.11
Nodes (12): clamp01(), GRAD3, hash2(), Noise, smootherstep(), smoothstep(), worley2(), clampAxial() (+4 more)

### Community 19 - "Campaign Profile Persistence"
Cohesion: 0.19
Nodes (31): CAMPAIGN_PROFILE_KEY, CAMPAIGN_PROFILE_SCHEMA, CAMPAIGN_PROFILE_VERSION, CampaignActionError, CampaignProfileLoadResult, completeCampaignMission(), continueCampaign(), createCampaignProfile() (+23 more)

### Community 20 - "Rotating Frame Ballistics"
Cohesion: 0.12
Nodes (31): RING_OMEGA, AimOptions, AimSolution, airDensityAt(), BallisticState, clamp(), directionalReachProfile, inertialToRing() (+23 more)

### Community 21 - "Title Screen Menus"
Cohesion: 0.13
Nodes (4): configureButton(), div(), field(), TitleScreen

### Community 22 - "AI Opponent Strategy"
Cohesion: 0.14
Nodes (15): AiOpponent, ballisticPlanKey(), clamp(), clearAiOrder(), isReachable(), isScenarioKnownEnemyBastion(), samePoint(), spinalMainForceBonus() (+7 more)

### Community 23 - "Strategic Ballistic Commands"
Cohesion: 0.14
Nodes (6): AudioFrame, Faction, WeaponDef, BallisticSource, normalizeBallisticTarget(), withBallisticTarget()

### Community 24 - "Mission Narrative Integration"
Cohesion: 0.11
Nodes (24): PlayerVoiceAction, SaveActionResult, STRUCTURES, UNITS, BreakLineBindings, CounterfireBindings, MissionBindings, MissionDebriefModel (+16 more)

### Community 25 - "Headless Match Runner"
Cohesion: 0.11
Nodes (29): ExpandedCoreMatch, averages(), controllerSeed(), countTotal(), createFactionResult(), createFactionResults(), EconomyResult, emptyFactionTotals() (+21 more)

### Community 26 - "AI Strategic Planning"
Cohesion: 0.09
Nodes (28): AiPoint, issueAttackMove(), issueBuild(), ARTILLERY_REPOSITION_OFFSETS, ArtilleryRevealTrackingState, artilleryTargetValue(), BallisticPlanKeyState, BASE_WEIGHTS (+20 more)

### Community 27 - "Procedural Model Generation"
Cohesion: 0.11
Nodes (23): addBlock(), addCylinder(), addGreebles(), BlockSpec, buildMech(), buildStructure(), _e1, _e2 (+15 more)

### Community 28 - "Renderer Lifecycle Quality"
Cohesion: 0.09
Nodes (8): LifecycleApi, QUALITY_THRASH_SEQUENCE, StartupMetrics, MatrixSession, Window, RwwWindow, Renderer, snapRatio()

### Community 29 - "World Combat Resolution"
Cohesion: 0.16
Nodes (3): DAMAGE_TABLE, angleDelta(), turnToward()

### Community 30 - "Tutorial Mission Objectives"
Cohesion: 0.13
Nodes (24): BreakLineMilestones, breakLineObjectiveMet(), emptyBreakLineMilestones(), COUNTERFIRE_OBJECTIVES, CounterfireMilestones, counterfireObjectiveMet(), emptyCounterfireMilestones(), bool() (+16 more)

### Community 31 - "RWW Command Execution"
Cohesion: 0.20
Nodes (25): normalizeCommand(), readJsonFile(), captureBrowserState(), describeArtifact(), executeCommand(), executeDoctor(), executePlay(), executeRun() (+17 more)

### Community 32 - "Application Boot and Campaign"
Cohesion: 0.14
Nodes (19): CampaignProfileStorage, CampaignTransition, loadCampaignProfile(), saveCampaignProfile(), SAVE_SLOT_KEY, BASE_SEPARATION, boot, factionFromParams() (+11 more)

### Community 33 - "Scene Dressing and Markers"
Cohesion: 0.10
Nodes (13): AXIAL, BattlefieldDressing, DressingItem, LOCAL_CENTER, ONE, UP, disposeObject(), Markers (+5 more)

### Community 34 - "Delivery Roadmaps and Gates"
Cohesion: 0.08
Nodes (25): T480s Low Gate, Deterministic Simulation, Simulation Render Separation, Testing Strategy, Candidate 30 FPS Gate, Dedicated Low Terrain Pass, T480s 720p Low Measurement, Visual Signature Validation (+17 more)

### Community 35 - "Terrain Rendering Pipeline"
Cohesion: 0.14
Nodes (12): RING_RADIUS, RIM_WALL_HEIGHT, makeLowTerrainMaterial(), makeTerrainMaterial(), TerrainUniforms, ORDER, QUALITY, QualityLevel (+4 more)

### Community 36 - "AI Behavior Trees"
Cohesion: 0.13
Nodes (9): BTContext, BTNode, Cooldown, DIFFICULTY_RANK, DifficultyGate, finite(), Selector, Sequence (+1 more)

### Community 37 - "Web Audio Backend"
Cohesion: 0.15
Nodes (9): createNoiseBuffer(), noiseRate(), oscillatorType(), pitchDrop(), SpeechRecord, stopQuietly(), usesNoise(), VoiceRecord (+1 more)

### Community 38 - "Tactical AI Behaviors"
Cohesion: 0.13
Nodes (17): issueAttack(), StrategicGoal, ActivateAbility, attackRange(), averageDistance(), centroid(), chooseFocusTarget(), FocusFire (+9 more)

### Community 39 - "World Rendering Updates"
Cohesion: 0.24
Nodes (4): deltaS(), RenderAnchor, wrapLerp(), mapDelta()

### Community 41 - "Spinal Alignment Gameplay"
Cohesion: 0.22
Nodes (3): BallisticFireResult, Structure, updateBreakLineMilestones()

### Community 43 - "Settings Menu Controls"
Cohesion: 0.18
Nodes (5): clamp01(), Settings, field(), KEYBINDINGS, SettingsMenu

### Community 44 - "World Setup and Production"
Cohesion: 0.15
Nodes (13): FactionMatchResult, HeadlessStructureObservation, RuntimeScenarioStructure, RuntimeScenarioUnit, createRuntimeScenarioWorld(), effectiveSalvageCost(), effectiveStructureStats(), effectiveUnitStats() (+5 more)

### Community 45 - "Combat Particle Effects"
Cohesion: 0.16
Nodes (3): distanceAttenuation(), Effects, hashUnit()

### Community 46 - "Persisted Render Settings"
Cohesion: 0.14
Nodes (13): browserSearch(), browserStorage(), DEFAULT_VOICE_VOLUME, DEFAULT_VOLUME, isQualityLevel(), isRecord(), isVolume(), PersistedSettings (+5 more)

### Community 47 - "CLI Argument Parsing"
Cohesion: 0.22
Nodes (18): boundedNonNegativeInteger(), boundedPositiveInteger(), nonNegativeInteger(), normalizePath(), optionValue(), parseBrowserPerf(), parseCliArgs(), parseDoctor() (+10 more)

### Community 48 - "Session Audio Wiring"
Cohesion: 0.14
Nodes (6): VoiceDirector, createWebAudioBackend(), CleanupStack, CommandWiring, savedPlayerFaction(), startSession()

### Community 49 - "Instanced Mech Rendering"
Cohesion: 0.14
Nodes (18): MechClass, StructureModel, angleLerp(), angleWrap(), clampN(), FootState, _local, markInstanceUpdates() (+10 more)

### Community 50 - "Mission Snapshot Parsing"
Cohesion: 0.28
Nodes (20): array(), countRecord(), fail(), finiteNumber(), idArray(), integer(), narrativeBeats(), parseJson() (+12 more)

### Community 51 - "Headless Performance Profiling"
Cohesion: 0.13
Nodes (13): BallisticAttempt, BallisticWorkSnapshot, config, flatTerrain, PROFILE_TICKS, profileBallisticCommands(), profileNearbyCache(), recordTiming() (+5 more)

### Community 52 - "Combat Presentation Effects"
Cohesion: 0.14
Nodes (11): AXIAL, DebrisShard, Scar, SmokeEmitter, TRACER_COLOR, Trail, WORLD_UP, combatPresentationKind (+3 more)

### Community 53 - "Product Roadmap and Assets"
Cohesion: 0.12
Nodes (17): Procedural Asset Budget, Greeble Compiler, MechDef, Presentation Simulation Boundary, Procedural-Only Gameplay Rule, Seeded Generation, Axiom Choir Campaign, Campaign Platform (+9 more)

### Community 54 - "Campaign Title Screen Data"
Cohesion: 0.18
Nodes (14): CampaignProfile, CampaignResult, CampaignRouteContext, CampaignMissionId, PRESENTATION_MEDIA, PresentationMedia, UnitDossierMedia, FACTION_NAME (+6 more)

### Community 55 - "Camera Mode Framework"
Cohesion: 0.13
Nodes (9): CameraCapabilities, CameraMode, CameraModeController, CameraModeRequestResult, CameraUpdateContext, DIRECT_CAPABILITIES, TACTICAL_CAPABILITIES, directCapabilities (+1 more)

### Community 56 - "Mission Event Bindings"
Cohesion: 0.17
Nodes (13): SimEvent, breakLineBindings(), counterfireBindings(), firstContactBindings(), milestoneMet(), signalBindings(), validateBreakLineWorldBindings(), validateCounterfireWorldBindings() (+5 more)

### Community 57 - "Core Match Manifests"
Cohesion: 0.16
Nodes (11): CORE_MATCH_MANIFEST_SCHEMA, CORE_MATCH_MANIFEST_VERSION, CoreMatchManifest, CoreMatchRecord, HeadlessMatchObservation, MatchResult, MatchStatus, manifest (+3 more)

### Community 58 - "Tactical Retreat Behaviors"
Cohesion: 0.15
Nodes (8): BTStatus, issueMove(), clamp(), deterministicAngle(), DodgeIncoming, nearestRallyPoint(), Retreat, ScriptedNode

### Community 59 - "Campaign Mission Registry"
Cohesion: 0.16
Nodes (12): CampaignLaunch, CAMPAIGN_MISSIONS, CampaignMissionAvailability, CampaignMissionStatus, CampaignRuntimeScenarioId, DEFINITIONS, fail(), MISSION_BY_ID (+4 more)

### Community 60 - "Visual Calibration Tools"
Cohesion: 0.22
Nodes (14): addPart(), addStandingLeg(), buildColorChart(), buildMaterialSwatches(), buildReferenceMech(), buildSweep(), CalibrationManifest, COLOR (+6 more)

### Community 61 - "Mission Controller Flow"
Cohesion: 0.18
Nodes (6): observeCounterfireAction(), formatMissionClock(), MissionController, missionObjectives(), missionTitle(), objectiveMet()

### Community 62 - "Browser Performance Metrics"
Cohesion: 0.23
Nodes (12): scenario, distribution(), evaluateBrowserBudget(), percentile(), summarizeDistributions(), summarizeFrameMetrics(), executeBrowserPerf(), maximumInvariant() (+4 more)

### Community 63 - "Browser Scenario Automation"
Cohesion: 0.25
Nodes (13): acquireVite(), availablePort(), isRingWorldWar(), once(), probeBrowser(), benchmarkBrowserScenario(), captureVisualScenario(), decodeScreenshot() (+5 more)

### Community 64 - "Voice Clip Preloading"
Cohesion: 0.20
Nodes (8): isUnitKind(), VoiceClip, VoicePlayback, VoicePlaybackSink, VoiceUnitRef, preloadRank(), clip(), CLIPS

### Community 68 - "Audio Engine Tests"
Cohesion: 0.18
Nodes (3): AudioCue, frame(), RecordingBackend

### Community 69 - "Visual Signature Analysis"
Cohesion: 0.29
Nodes (11): averageHash(), bitsToHex(), buildGrid(), check(), compareVisualSignatures(), computeVisualSignature(), differenceHash(), edgeDensity() (+3 more)

### Community 70 - "Tactician Squad Management"
Cohesion: 0.21
Nodes (5): AlwaysSuccess, createSquadTree(), finite(), hasMechs(), Tactician

### Community 72 - "Core Match Manifest Parsing"
Cohesion: 0.41
Nodes (12): fail(), parseCoreMatchManifest(), readArray(), readDifficulty(), readFinite(), readGates(), readInteger(), readNonEmptyString() (+4 more)

### Community 73 - "Voice Media Manifest"
Cohesion: 0.24
Nodes (9): VoiceTrigger, factionClips(), GROUP_TRIGGERS, priority(), REVIEWED_VOICE_CLIPS, UNIT_TRIGGERS, UNITS, publicPath() (+1 more)

### Community 74 - "Campaign Route Parameters"
Cohesion: 0.29
Nodes (9): applyCampaignRouteContext(), CAMPAIGN_INTENT_PARAM, CAMPAIGN_MISSION_PARAM, campaignIntent(), campaignRouteContextFromParams(), CampaignRouteIntent, CampaignRouteValidationError, routeFail() (+1 more)

### Community 75 - "Media Delivery Receipts"
Cohesion: 0.18
Nodes (9): assets, DELIVERY_DIRS, EXTRA_FILES, files, IMAGE_REQUEST_IDS, OUTPUT, PUBLIC, receipt (+1 more)

### Community 76 - "Runtime Hardware Doctor"
Cohesion: 0.35
Nodes (10): buildDoctorReport(), check(), evaluateTarget(), parseTarget(), TARGET_SCHEMA, TARGET_VERSION, thresholdCheck(), validateBudgetNumber() (+2 more)

### Community 77 - "Headless Performance Policy"
Cohesion: 0.20
Nodes (10): Canonical Headless Workload, Headless Performance Gate, Protected Headless Qualification Workflow, Protected Qualification Evidence, T480s Reference Runner, Requirement 17.5, 15 Second Warm Median Budget, Accepted Canonical Solver (+2 more)

### Community 78 - "Audio Cue Routing"
Cohesion: 0.31
Nodes (8): AudioBackendFactory, AudioCueKind, AudioState, clamp(), cue(), cueForEvent(), cuePriority(), hashUnit()

### Community 79 - "Debug Overlay Controls"
Cohesion: 0.22
Nodes (3): wireKeys(), DebugOverlay, readMemory()

### Community 80 - "Core Match Cohorts"
Cohesion: 0.20
Nodes (7): collectCoreMatchTimeline(), CoreMatchTimelineCollector, createExpandedMatch(), expandCoreMatchManifest(), formatCoreMatchJson(), runCoreMatchCohort(), manifestPath

### Community 82 - "Screenshot Capture Tool"
Cohesion: 0.20
Nodes (8): args, height, logs, out, panS, url, width, zoomNotches

### Community 83 - "Paired Spinal Nodes"
Cohesion: 0.22
Nodes (9): Alignment HUD and Minimap Representation, LS-07 Completion Evidence, Node Neutralization, Operational Pair, Pair-Aware AI, Pair Dominance, Spinal Pair Identity, World Snapshot V2 Pair Migration (+1 more)

### Community 84 - "Last Rotation Setting"
Cohesion: 0.22
Nodes (9): Anchor Protocol, Axiom Choir, Last Rotation Inciting Incident, Meridian Compact, Migration Protocol, Ring World War, Shadow-Square Network, Solar Filament (+1 more)

### Community 85 - "Directional Artillery Roadmap"
Cohesion: 0.22
Nodes (9): Direction Is Territory, Physics Guardrails, Product Thesis, Ring USP Slice, Launch Validation Gates, Directional Artillery Authority, Directional Artillery High Ground, Revised Core Loop (+1 more)

### Community 86 - "Break Line Tutorial"
Cohesion: 0.25
Nodes (5): BREAK_LINE_HOLD_TICKS, BREAK_LINE_OBJECTIVES, validateWorldChronology(), missionAtFinalObjective(), terrain

### Community 87 - "Last Rotation Worldbuilding"
Cohesion: 0.25
Nodes (8): Anchor Protocol, Arc Link, Axiom Choir, The Last Rotation, Meridian Compact, Migration Protocol, Solar Filament, Spinal Network

### Community 88 - "First Contact Scenario"
Cohesion: 0.36
Nodes (5): FIRST_CONTACT_RUNTIME_SCENARIO, requiredBinding(), resolveFirstContactMissionBindings(), STARTING_SALVAGE, terrain

### Community 89 - "Phase Two Task Plan"
Cohesion: 0.29
Nodes (7): Ability System, AI Systems, Data Layer Extensions, Headless Balance Runner, Phase 2 Implementation Plan, Task Dependency Graph, Weapon Systems

### Community 90 - "Launch Scope Policy"
Cohesion: 0.29
Nodes (7): Absolute Acceptance Rubric, Bounded Review and Remediation, Class-Specific Acceptance, Launch-Scope Ship-First Execution Policy, Launch-Scope Quality Ladder, Stop and Reopen Rules, Validation Gate Lanes

### Community 91 - "Distress Poster Artwork"
Cohesion: 0.38
Nodes (7): AES-256 Encryption Malfunction, Degraded Signal, Industrial Communications Site, Terminal 04-B, Last Rotation Transmission Alert Poster, Unknown Source, Urgent Transmission

### Community 92 - "Player Observation Protocol"
Cohesion: 0.33
Nodes (6): G-01 Human Comprehension Gate, Five Directional Artillery Questions, Initial Human Cohort, Player Observation Protocol, Privacy-Preserving Observation Evidence, Uncoached Directional Artillery Session

### Community 93 - "First Contact Playtest"
Cohesion: 0.33
Nodes (6): Deposit Placement Guidance, Directional Artillery Comprehension Finding, First Contact Completion Playtest, Inertial Starfield, Low-Quality Presentation Findings, Outward Procedural Hull Winding

### Community 94 - "Tactical UX Playtest"
Cohesion: 0.33
Nodes (6): Directional Artillery Comprehension, Minimap Commands, Sensor Coverage, Structured Fire Command Reasons, Terrain Line of Sight, Tactical UI Task

### Community 96 - "Signature Battlefield Design"
Cohesion: 0.40
Nodes (5): Bounded Combat Atmosphere, Fog-Safe Procedural Audio, Presentation-Only Boundary, Render-Only Mech Weight, Signature Battlefield

### Community 97 - "Faction Visual Identity"
Cohesion: 0.40
Nodes (5): Axiom Choir Visual Language, Faction Geometry Variants, Meridian Compact Visual Language, Neutral Spinal Infrastructure, Render-Derived Damage Surfaces

### Community 98 - "Phase Four Hardening"
Cohesion: 0.40
Nodes (5): Gate 4, Phase 4 Performance and Hardening Goal, Phase 4C Renderer and GPU, Phase 4D Memory, Startup, and Recovery, Phase 4E Device and Browser Matrix

### Community 99 - "Browser Matrix Qualification"
Cohesion: 0.40
Nodes (5): Available Engine Qualification, Cross-Browser Scenario Determinism, Device and Browser Matrix Contract, Unavailable Matrix Cells, WebKit Recovery Fix

### Community 100 - "Voice Visual Identity"
Cohesion: 0.40
Nodes (5): Faction Voice Identity, Offline Media Authoring, Phase 5 Voice and Visual Identity, Presentation Media Manifest, VoiceDirector

### Community 101 - "Counterfire Playtest"
Cohesion: 0.40
Nodes (5): Authoritative Projectile ID, Compact Rocket Battery, Counterfire Objective 6, Laser Grid, Standard Rocket

### Community 102 - "Artillery Human Gate"
Cohesion: 0.40
Nodes (5): Developer Review, Directional Artillery Criteria, G-01 Gate, Uncoached Human Tester, Human Playtesting Evidence

### Community 104 - "Core Game Concepts"
Cohesion: 0.40
Nodes (5): Alignment Victory, Chord Coffin, Overhead Intelligence, Spinal Alignment, Structural Stress

### Community 105 - "Ring Crisis Title Art"
Cohesion: 0.40
Nodes (5): Central Luminary, Damaged Superstructure, Habitat Ring Interior, Inhabited Cityscape, Observation Deck

### Community 106 - "Signal Briefing Art"
Cohesion: 0.40
Nodes (5): Central Signal Tower, Industrial Settlement, Orange Signal Aperture, Ring Superstructure, Signal Briefing

### Community 107 - "Signal Hunters Art"
Cohesion: 0.40
Nodes (5): Central Signal Spire, Industrial Settlement, Ring Habitat Interior, Signal Hunter Drone, Signal Tracking Overlay

### Community 108 - "Last Correction Art"
Cohesion: 0.60
Nodes (5): Central Energy Discharge, Habitat Ring, Last Correction, Perimeter Correction Signal, Signal Last Correction Illustration

### Community 109 - "Migration Signal Art"
Cohesion: 0.60
Nodes (5): Holographic Transmission Path, Ring Infrastructure, Signal Emitter, Signal Migration, Stellar Focal Point

### Community 110 - "Choir Vanguard Dossier"
Cohesion: 0.40
Nodes (5): Axiom Choir Vanguard, Bipedal Combat Mech, Dual Heavy Armament, Industrial Staging Bay, Axiom Choir Vanguard Unit Dossier

### Community 111 - "Choir Wisp Dossier"
Cohesion: 0.50
Nodes (5): Axiom Choir, Bipedal Machine Chassis, Axiom Choir Wisp Dossier Image, Sensor Antenna Array, Wisp Unit

### Community 112 - "Compact Longbow Dossier"
Cohesion: 0.40
Nodes (5): Long-Range Cannon, Longbow, Quadrupedal Chassis, Self-Propelled Artillery Platform, Sensor Module

### Community 113 - "AI Difficulty Configuration"
Cohesion: 0.40
Nodes (4): Difficulty, CoreMatchRole, CoreMatchRoleSummary, RuntimeScenarioAi

### Community 114 - "Tactical HUD Plan"
Cohesion: 0.40
Nodes (5): Battlefield Memory, Phase 3D and 3E Risks, Presentation-Only Boundary, Tactical HUD, Phase 3D and 3E Checklist

### Community 115 - "Tactician Unit Tests"
Cohesion: 0.70
Nodes (4): abilityWorld(), dodgeWorld(), emptyWorld(), focusWorld()

### Community 116 - "Deterministic Simulation Design"
Cohesion: 0.50
Nodes (4): Deterministic Simulation Boundary, Headless Sim Runner, Phase 2 Systems Depth, Sim Snapshot

### Community 117 - "Signal in Spine Narrative"
Cohesion: 0.50
Nodes (4): Bulwark, Narrative Layer, Needle, Story Mission

### Community 118 - "RWW CLI Documentation"
Cohesion: 0.50
Nodes (4): Browser Scenarios, Headless Qualification, RWW CLI, Versioned Receipts

### Community 119 - "Tactical Media Provenance"
Cohesion: 0.50
Nodes (4): Azure OpenAI GPT-image-2, Deepgram Aura-2, Phase 5 Tactical Media Delivery, Media Review Gates

### Community 120 - "Opening Video Provenance"
Cohesion: 0.50
Nodes (4): HeyGen Video Agent, Last Rotation Opening, Reviewed Last Rotation Media, Generated Media Usage Rights Basis

### Community 121 - "Core Interface Contracts"
Cohesion: 0.50
Nodes (4): Deterministic Rng, Module Contracts, RenderAnchor, VfxSystem

### Community 122 - "Directional Artillery Scope"
Cohesion: 0.50
Nodes (4): Authoritative Artillery Targeting, Directional Artillery Advantage, Directional Range Footprint, First Contact Directional Objective

### Community 123 - "Skirmish Theater Design"
Cohesion: 0.50
Nodes (4): Current Gameplay Mechanics, Proposed Future Mechanics, Skirmish Theater, Theater Commander

### Community 124 - "Ballistic Performance Plan"
Cohesion: 0.50
Nodes (4): Canonical Ballistic Verification, Failed Ballistic Attempts, Failed AI Plan Cache, Signed Ring Reach Envelope

### Community 125 - "Atmosphere Rendering Design"
Cohesion: 0.50
Nodes (4): Analytic Ring Atmosphere, Direct Renderer Boundary, Environmental Quality Budgets, PBR Calibration Scene

### Community 126 - "Battlefield Memory Design"
Cohesion: 0.50
Nodes (4): Aftermath Authority Boundary, Battlefield Memory, Chord Launch and Impact Sequence, Transient Aftermath Pools

### Community 127 - "Tactical HUD Design"
Cohesion: 0.50
Nodes (4): Bounded Visibility-Filtered Event Rail, HUD Authority Boundary, Responsive HUD Zones, Tactical HUD and Command Feedback

### Community 128 - "Performance Baseline Plan"
Cohesion: 0.50
Nodes (4): Hardware Doctor, Headless 40-Minute Profile, Phase 4A Provisional Baseline, T480s Heavy Combat Profile

### Community 129 - "Renderer Profiling Plan"
Cohesion: 0.50
Nodes (4): Procedural PBR Terrain GPU Bottleneck, Heavy-Combat Renderer Profile, Renderer Attribution, Active Quality Shader Prewarm

### Community 130 - "Break Line End-to-End Test"
Cohesion: 0.50
Nodes (3): scenario, scenarioSha256, scenarioSource

### Community 132 - "Launch Progress Dashboard"
Cohesion: 0.50
Nodes (4): Launch Scope Control, Plan Freshness, Progress Endpoint, Remaining Work Dashboard

### Community 133 - "Choir Engineer Dossier"
Cohesion: 0.50
Nodes (4): Articulated Bipedal Chassis, Choir Engineer, Cyan Illuminated Accents, Tool Appendages

### Community 134 - "Choir Longbow Dossier"
Cohesion: 0.50
Nodes (4): Armored Weapon Platform, Articulated Quadrupedal Chassis, Choir Longbow, Elevated Tubular Launcher

### Community 135 - "Choir Needle Dossier"
Cohesion: 0.50
Nodes (4): Axiom Choir Needle, Faceted Dark Armor, Humanoid Combat Construct, Integrated Lance Weapon

### Community 136 - "Compact Aegis Dossier"
Cohesion: 0.50
Nodes (4): Aegis, Armored Bipedal Combat Walker, Dual Sensor Dish Array, Shoulder Mounted Weapon Turrets

### Community 137 - "Compact Bulwark Dossier"
Cohesion: 0.50
Nodes (4): Compact Bulwark, Dual Cannon Armament, Frontal Shield Armor, Quadrupedal Combat Chassis

### Community 138 - "Compact Engineer Dossier"
Cohesion: 0.50
Nodes (4): Armored Biped Chassis, Articulated Tool Arm, Cable Spool, Compact Engineer Unit

### Community 139 - "Compact Vanguard Dossier"
Cohesion: 0.50
Nodes (4): Armored Bipedal Combat Chassis, Compact Vanguard, Dual Rotary Cannon Armament, Layered Heavy Armor

### Community 140 - "Project Overview"
Cohesion: 0.50
Nodes (4): Enemy Bastion, Ring World War, Rocket Battery, Spinal Nodes

### Community 141 - "AI Systems Task Plan"
Cohesion: 0.50
Nodes (4): AI Strategist, AI Tactician, Behavior Tree, AI Difficulty Tiers

### Community 143 - "Headless Qualification Workflow"
Cohesion: 0.67
Nodes (3): Headless 40m Qualification, Pinned Headless Runner, Requirement 17.5

### Community 144 - "AI Design Specification"
Cohesion: 0.67
Nodes (3): AI Strategist, AI Tactician, Behavior Tree

### Community 145 - "Weapon Systems Requirements"
Cohesion: 0.67
Nodes (3): Chord Shot, Cruise Missile, Laser Grid

### Community 146 - "Spinal Network Glossary"
Cohesion: 0.67
Nodes (3): Spinal Alignment, Spinal Network, Spinal Node

### Community 147 - "Ring Space Architecture"
Cohesion: 0.67
Nodes (3): Render Anchor, Ring Space, Rotating-frame Ballistics

### Community 148 - "Cinematic Presentation Specification"
Cohesion: 0.67
Nodes (3): Cinematic Presentation Layer, Optional Media Boundary, Title Screen

### Community 149 - "Core Match Validation"
Cohesion: 0.67
Nodes (3): Balance Gates, Core Match Validation, Validation Observer

### Community 150 - "Directional Artillery Prototype"
Cohesion: 0.67
Nodes (3): Authoritative Preview/Fire Agreement, Directional Artillery USP, Directional Reach Profile

### Community 151 - "First Contact Tutorial"
Cohesion: 0.67
Nodes (3): First Contact Tutorial, Mission Persistence, Objective Sequence

### Community 152 - "First Player UX"
Cohesion: 0.67
Nodes (3): Artillery Authority, Minimap and Selection Inputs, Sensor Coverage

### Community 153 - "Combat Design Systems"
Cohesion: 0.67
Nodes (3): AI Opponent, Mech Combat, Rocket Warfare

### Community 154 - "Core Loop Design"
Cohesion: 0.67
Nodes (3): Core Loop, Scrith Salvage, Spinal Alignment

### Community 155 - "Playable Slice Gate"
Cohesion: 0.67
Nodes (3): Gate 1 Playable Slice, Human Gate, Locked Decisions

### Community 156 - "Shadow Intelligence Scope"
Cohesion: 0.67
Nodes (3): LS-09 Automation Acceptance, Strategic Contacts, Strategic Contact Authority Boundary

### Community 157 - "Memory and Recovery Hardening"
Cohesion: 0.67
Nodes (3): Accelerated Lifecycle Soak, Bounded Memory Indexes, First Playable Frame Measurement

### Community 159 - "Application Loading Screen"
Cohesion: 0.67
Nodes (3): Application Bootstrap, Boot Loading Screen, Ring World War Title

### Community 160 - "Choir Aegis Dossier"
Cohesion: 0.67
Nodes (3): Aegis, Illuminated Sensor Arrays, Quadruped Armored Walker

### Community 161 - "Compact Wisp Dossier"
Cohesion: 0.67
Nodes (3): Bipedal Walker, Compact Wisp Unit, Sensor Communications Mast

### Community 162 - "Chord Shot Task Plan"
Cohesion: 0.67
Nodes (3): Chord Shot, Silo, Counter-Battery Flash

### Community 163 - "Phase Two Delivery Report"
Cohesion: 0.67
Nodes (3): Delivered Phase 2 Systems, Phase 2 Design Corrections, Verified Vertical Increments

### Community 164 - "Development Phase Roadmap"
Cohesion: 0.67
Nodes (3): Phase 0 Foundations, Phase 1 Playable Core Loop, Phase 2 Systems Depth

### Community 165 - "Presentation Feature Plan"
Cohesion: 0.67
Nodes (3): Audio Expansion, Cinematic Presentation, Optional Media Manifest

## Knowledge Gaps
- **627 isolated node(s):** `scenarioSource`, `scenario`, `scenarioSha256`, `POST_MISSION_VISUAL_PROFILE`, `scenario` (+622 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **63 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Faction` connect `Strategic Ballistic Commands` to `Scenario Saves and Test Driver`, `Simulation Data and Tests`, `World Snapshot Serialization`, `Game Interaction Controller`, `Shadow Cycle Environment`, `World Simulation Tick`, `Terrain and Navigation Foundations`, `Camera Control Modes`, `Core Match Reporting`, `Tactical HUD Interface`, `Runtime Scenario Parsing`, `Ring Math and Anchors`, `Campaign Profile Persistence`, `Rotating Frame Ballistics`, `AI Opponent Strategy`, `Mission Narrative Integration`, `Headless Match Runner`, `AI Strategic Planning`, `World Combat Resolution`, `Tutorial Mission Objectives`, `Application Boot and Campaign`, `Scene Dressing and Markers`, `Web Audio Backend`, `Tactical AI Behaviors`, `World Rendering Updates`, `Spinal Alignment Gameplay`, `World Setup and Production`, `Combat Particle Effects`, `Session Audio Wiring`, `Instanced Mech Rendering`, `Headless Performance Profiling`, `Combat Presentation Effects`, `Campaign Title Screen Data`, `Mission Event Bindings`, `Core Match Manifests`, `Campaign Mission Registry`, `Voice Clip Preloading`, `Audio Engine Tests`, `Tactician Squad Management`, `Voice Media Manifest`, `Audio Cue Routing`, `Break Line Tutorial`, `First Contact Scenario`, `Tactician Unit Tests`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `World` connect `World Simulation Tick` to `Scenario Saves and Test Driver`, `Simulation Data and Tests`, `World Snapshot Serialization`, `Game Interaction Controller`, `Shadow Cycle Environment`, `Terrain and Navigation Foundations`, `Camera Control Modes`, `Tactical HUD Interface`, `Ring Math and Anchors`, `Procedural Terrain Generation`, `Rotating Frame Ballistics`, `AI Opponent Strategy`, `Strategic Ballistic Commands`, `Mission Narrative Integration`, `Headless Match Runner`, `AI Strategic Planning`, `World Combat Resolution`, `Tutorial Mission Objectives`, `Scene Dressing and Markers`, `Tactical AI Behaviors`, `World Rendering Updates`, `Surface Navigation Fields`, `Spinal Alignment Gameplay`, `World Setup and Production`, `Combat Particle Effects`, `Session Audio Wiring`, `Instanced Mech Rendering`, `Headless Performance Profiling`, `Combat Presentation Effects`, `Mission Event Bindings`, `Core Match Manifests`, `Mission Controller Flow`, `Voice Clip Preloading`, `Deterministic Randomness`, `Audio Engine Tests`, `Tactician Squad Management`, `Audio Cue Routing`, `Entity Renderer Setup`, `Break Line Tutorial`, `First Contact Scenario`, `Tactician Unit Tests`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `Game` connect `Game Interaction Controller` to `Scenario Saves and Test Driver`, `Simulation Data and Tests`, `World Simulation Tick`, `Terrain and Navigation Foundations`, `Camera Control Modes`, `Tactical HUD Interface`, `Procedural Terrain Generation`, `AI Opponent Strategy`, `Strategic Ballistic Commands`, `Mission Narrative Integration`, `Renderer Lifecycle Quality`, `Application Boot and Campaign`, `Scene Dressing and Markers`, `Terrain Rendering Pipeline`, `Spinal Alignment Gameplay`, `Combat Particle Effects`, `Session Audio Wiring`, `Mission Event Bindings`, `Mission Controller Flow`, `Debug Overlay Controls`, `Entity Renderer Setup`, `AI Difficulty Configuration`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `scenarioSource`, `scenario`, `scenarioSha256` to the rest of the system?**
  _627 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Scenario Saves and Test Driver` be split into smaller, more focused modules?**
  _Cohesion score 0.06518987341772152 - nodes in this community are weakly interconnected._
- **Should `Launch Evidence Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.07766599597585513 - nodes in this community are weakly interconnected._
- **Should `Simulation Data and Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.04182194616977226 - nodes in this community are weakly interconnected._