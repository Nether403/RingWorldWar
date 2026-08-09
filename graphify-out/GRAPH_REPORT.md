# Graph Report - .  (2026-08-09)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2681 nodes · 6842 edges · 190 communities (147 shown, 43 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 306 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `56a07093`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- serialize.ts
- mission.ts
- vite.config.ts
- world.ts
- Game
- scenario.mjs
- manifests.mjs
- Hud
- compilerOptions
- game.ts
- World
- scripts
- constants.ts
- environment.ts
- runtimeScenario.ts
- rww.test.ts
- commands.mjs
- coreMatch.ts
- Spinal Alignment
- tactician.ts
- TitleScreen
- Phase 2 Systems Depth
- opponent.ts
- campaignProfile.ts
- terrain.ts
- ringMath.ts
- Terrain
- wireKeys
- main.ts
- settings.ts
- models.ts
- RING_CIRCUMFERENCE
- ballistics.ts
- AiOpponent
- .structureById
- calibration.ts
- startSession
- runner.ts
- SimEvent
- Renderer
- scenario-driver.ts
- CameraRig
- BTNode
- deltaS
- UnitKind
- campaignRoute.ts
- InputController
- .emit
- .stepUnits
- SurfaceNav
- entityRenderer.ts
- titleScreen.ts
- performance-profile.test.ts
- headless/core-match.test.ts
- WholeRingModeController
- args.mjs
- strategicAnnulus.ts
- Launch Scope
- Rng
- WebAudioBackend
- missionRegistry.ts
- browser-scenario.mjs
- BTStatus
- AudioBackend
- audioEngine.test.ts
- ProceduralAudio
- visual-signature.mjs
- Headless Performance Gate
- surfaceDistSq
- parseCoreMatchManifest
- doctor.mjs
- webAudioBackend.ts
- write-delivery-receipt.mjs
- Chord Shot
- audioEngine.ts
- validation/core-match.test.ts
- abilities.ts
- .isEntityVisible
- shot.mjs
- Direction Is Territory
- EntityRenderer
- Ability System
- Sensor Coverage
- Battlefield Memory
- Noise
- StructureKind
- lint.mjs
- Launch-Scope Ship-First Execution Policy
- Last Rotation Transmission Alert Poster
- browser-metrics.mjs
- RenderAnchor
- Player Observation Protocol
- title-screen.spec.ts
- AI Strategist
- AI Strategist
- Presentation-Only Boundary
- Faction Geometry Variants
- Device and Browser Matrix Contract
- Phase 5 Voice and Visual Identity
- G-01 Gate
- campaign.spec.ts
- Habitat Ring Interior
- Central Signal Tower
- Central Signal Spire
- Perimeter Correction Signal
- Holographic Transmission Path
- Axiom Choir Vanguard
- Self-Propelled Artillery Platform
- tactician.test.ts
- Story Mission
- Versioned Receipts
- Phase 5 Tactical Media Delivery
- Last Rotation Opening
- Directional Artillery Advantage
- Current Gameplay Mechanics
- Failed Ballistic Attempts
- Analytic Ring Atmosphere
- Tactical HUD and Command Feedback
- Phase 4A Provisional Baseline
- Heavy-Combat Renderer Profile
- Launch Scope Control
- Choir Engineer
- Choir Longbow
- Axiom Choir Needle
- Armored Bipedal Combat Walker
- Compact Bulwark
- Compact Engineer Unit
- Compact Vanguard
- .tick
- Cinematic Presentation Layer
- Core Match Validation
- Directional Reach Profile
- First Contact Tutorial
- Rocket Warfare
- Gate 1 Playable Slice
- Strategic Contacts
- Accelerated Lifecycle Soak
- Boot Loading Screen
- Aegis
- Compact Wisp Unit
- Delivered Phase 2 Systems
- probe.mjs
- Browser Job
- Gate 2 Match Quality Criteria
- Strategist
- Alignment-only Dominance
- Data-driven Content
- deltaS
- Atmosphere System
- Faction Color Script
- Break the Line Mission
- Accepted Cohorts
- Progression Failures
- Counterfire Mission
- MechRig
- Shadow Cycle Core Model
- Dense Spatial Query Cache
- Session Cleanup Stack
- Procedural Mech Locomotion
- gameplay.spec.ts
- runtime-scenario.spec.ts
- Ring Math Task
- Verify Job
- Quality Preset Framework
- Bastion
- A Signal in the Spine
- Procedural-only Art
- AudioEngine
- Presentation-Only Preproduction
- Drag Selection Rectangle
- Shader-Based Atmosphere
- Environmental District Palettes
- playwright.config.ts
- Mech Abilities

## God Nodes (most connected - your core abstractions)
1. `World` - 194 edges
2. `Faction` - 160 edges
3. `deltaS()` - 78 edges
4. `Game` - 72 edges
5. `Terrain` - 66 edges
6. `wrapS()` - 60 edges
7. `RenderAnchor` - 53 edges
8. `surfaceDist()` - 49 edges
9. `startSession()` - 47 edges
10. `AiOpponent` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Directional Artillery High Ground` --semantically_similar_to--> `Direction Is Territory`  [INFERRED] [semantically similar]
  game ideas plus.md → docs/publishable-game-roadmap.md
- `Gravity Range Arcade Mode` --semantically_similar_to--> `Launch Scope`  [INFERRED] [semantically similar]
  game ideas.md → docs/publishable-game-roadmap.md
- `startSession()` --indirect_call--> `frame()`  [INFERRED]
  src/main.ts → tests/audio/audioEngine.test.ts
- `Faction Asymmetry` --semantically_similar_to--> `Faction Modifiers`  [INFERRED] [semantically similar]
  .kiro/specs/phase-2-systems-depth/design.md → tasks/phase-2-systems-depth/design.md
- `Axiom Choir` --conceptually_related_to--> `Wisp Unit`  [INFERRED]
  CONTEXT.md → public/media/presentation/units/dossier.choir.wisp.webp

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 2 Systems Depth** — _kiro_specs_phase_2_systems_depth_design_ai_tactician, _kiro_specs_phase_2_systems_depth_design_headless_sim_runner [EXTRACTED 1.00]
- **Ring World War Core Loop** — docs_game_design_core_loop, docs_game_design_rocket_warfare, docs_game_design_mech_combat [EXTRACTED 1.00]
- **Core Match Balance Validation** — docs_core_match_validation_core_match_validation, docs_core_match_validation_observer, docs_core_match_validation_balance_gates [EXTRACTED 1.00]
- **Paired Spinal Control System** — docs_launch_scope_ls_07_paired_spinal_nodes_operational_pair, docs_launch_scope_ls_07_paired_spinal_nodes_pair_dominance, docs_launch_scope_ls_07_paired_spinal_nodes_pair_aware_ai [EXTRACTED 1.00]
- **Directional Artillery Onboarding** — docs_launch_scope_ls_08_directional_advantage_directional_artillery_advantage, docs_launch_scope_ls_08_directional_advantage_directional_range_footprint, docs_launch_scope_ls_08_directional_advantage_authoritative_targeting, docs_launch_scope_ls_08_directional_advantage_first_contact_final_objective, docs_launch_scope_ls_08_directional_advantage_g_01_human_gate [EXTRACTED 1.00]
- **Shadow Intelligence System** — docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_shadow_cycle_core_model, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_shadow_gameplay_effects, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_strategic_contacts, docs_launch_scope_ls_09_shadow_timing_overhead_intelligence_tactical_visibility_boundary [EXTRACTED 1.00]
- **Phase 4 Hardening Program** — docs_phase_4_performance_hardening_phase_4b_headless_qualification, docs_phase_4_performance_hardening_phase_4c_renderer_gpu, docs_phase_4_performance_hardening_phase_4d_memory_startup_recovery, docs_phase_4_performance_hardening_phase_4e_device_browser_matrix [EXTRACTED 1.00]
- **Ring USP Slice Components** — docs_publishable_game_roadmap_ring_usp_slice, docs_publishable_game_roadmap_direction_is_territory, docs_publishable_game_roadmap_physics_guardrails, docs_publishable_game_roadmap_validation_gates [EXTRACTED 1.00]
- **Ring War Core Loop** — game_ideas_plus_directional_artillery_high_ground, game_ideas_plus_shadow_square_front_line, game_ideas_plus_revised_core_loop [EXTRACTED 1.00]
- **Phase 2 Combat Systems** — tasks_phase_2_systems_depth_design_cruise_missile, tasks_phase_2_systems_depth_design_laser_grid, tasks_phase_2_systems_depth_design_mech_abilities, tasks_phase_2_systems_depth_design_silo [EXTRACTED 1.00]
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

## Communities (190 total, 43 thin omitted)

### Community 0 - "serialize.ts"
Cohesion: 0.06
Nodes (98): MAX_BALLISTIC_PLAN_RETRY_TICKS, MAX_FAILED_BALLISTIC_PLANS, assertFactionPair(), assertGameSaveSize(), createGameSaveSnapshot(), deserializeGameSave(), faction(), fail() (+90 more)

### Community 1 - "mission.ts"
Cohesion: 0.06
Nodes (76): BREAK_LINE_HOLD_TICKS, BREAK_LINE_OBJECTIVES, BreakLineBindings, BreakLineMilestones, breakLineObjectiveMet(), emptyBreakLineMilestones(), COUNTERFIRE_OBJECTIVES, CounterfireBindings (+68 more)

### Community 2 - "vite.config.ts"
Cohesion: 0.07
Nodes (74): ls07CriterionReview(), ls07RunArtifacts(), alias, allowlistedString(), asArray(), asRecord(), buildProgressPayload(), CLAIM_EVIDENCE_POLICY (+66 more)

### Community 3 - "world.ts"
Cohesion: 0.04
Nodes (60): ATMOSPHERE_HEIGHT, HeadlessMatchObservation, ABILITIES, BallisticState, RingPoint, TrajectorySample, ArmorClass, BASE_ENERGY (+52 more)

### Community 4 - "Game"
Cohesion: 0.07
Nodes (6): wrapS(), abilityName(), clamp(), Game, wireCommands(), disconnectedWorld()

### Community 5 - "scenario.mjs"
Cohesion: 0.09
Nodes (46): scenario, scenarioBytes, scenarioSha256, scenario, signalScenario, directionalScenario, scenario, scenario (+38 more)

### Community 6 - "manifests.mjs"
Cohesion: 0.09
Nodes (46): root, run, buildImageRequest(), decodeImage(), finalPrompt(), main(), parseArgs(), pathExists() (+38 more)

### Community 7 - "Hud"
Cohesion: 0.10
Nodes (9): AudioFrame, RestoredGameSave, TrajectoryWork, Faction, normalizeBallisticTarget(), snapshotPlayer(), withBallisticTarget(), World (+1 more)

### Community 8 - "compilerOptions"
Cohesion: 0.04
Nodes (46): DOM, DOM.Iterable, e2e, ES2022, node, playwright.config.ts, src, ./src/ai/* (+38 more)

### Community 9 - "game.ts"
Cohesion: 0.08
Nodes (28): PlayerVoiceAction, SaveActionResult, CameraMode, Markers, RuntimeScenario, createRuntimeScenarioWorld(), requiredId(), RuntimeScenarioResolvedOpeningView (+20 more)

### Community 10 - "World"
Cohesion: 0.10
Nodes (11): button(), decorativeImage(), el(), formatOrder(), formatRange(), Hud, hudEventText(), shadowTimingCopy() (+3 more)

### Community 11 - "scripts"
Cohesion: 0.05
Nodes (39): dependencies, three, description, devDependencies, playwright, @types/node, @types/three, typescript (+31 more)

### Community 12 - "constants.ts"
Cohesion: 0.09
Nodes (26): CORIOLIS_SCALE, MAX_FLIGHT_HEIGHT, RING_HALF_WIDTH, RING_PERIOD, RING_RADIUS, RING_SURFACE_SPEED, RING_WIDTH, SHADOW_SQUARE_COUNT (+18 more)

### Community 13 - "environment.ts"
Cohesion: 0.09
Nodes (32): DAY_LENGTH, clamp01(), distanceToPanelCenter(), normalizePanelAngle(), panelPhaseAt(), relativePanelAngle(), SHADOW_MAX_OCCLUSION, SHADOW_PANEL_HALF_SPAN (+24 more)

### Community 14 - "runtimeScenario.ts"
Cohesion: 0.16
Nodes (37): arcPosition(), axialPosition(), boolean(), boundedArray(), difficulty(), faction(), factionLabel(), fail() (+29 more)

### Community 15 - "rww.test.ts"
Cohesion: 0.07
Nodes (34): CoreMatchFactionInactivity, CoreMatchFactionSample, CoreMatchFactionSummary, CoreMatchGateCheck, CoreMatchGateEvaluation, CoreMatchGatePolicy, CoreMatchManifestValidationError, CoreMatchMilestone (+26 more)

### Community 16 - "commands.mjs"
Cohesion: 0.16
Nodes (35): evaluateBrowserBudget(), readJsonFile(), captureBrowserState(), describeArtifact(), executeBrowserPerf(), executeCommand(), executePerf(), executePlay() (+27 more)

### Community 17 - "coreMatch.ts"
Cohesion: 0.06
Nodes (35): Anchor Protocol, Axiom Choir, Last Rotation, Meridian Compact, Migration Protocol, Scrith Salvage, Shadow-Square Network, Solar Filament (+27 more)

### Community 18 - "Spinal Alignment"
Cohesion: 0.10
Nodes (22): ActivateAbility, AlwaysSuccess, attackRange(), averageDistance(), centroid(), chooseFocusTarget(), createSquadTree(), finite() (+14 more)

### Community 19 - "tactician.ts"
Cohesion: 0.13
Nodes (4): configureButton(), div(), field(), TitleScreen

### Community 20 - "TitleScreen"
Cohesion: 0.06
Nodes (34): Deterministic Simulation Boundary, Faction Asymmetry, Headless Sim Runner, Sim Snapshot, Phase 4 Performance and Hardening Goal, Phase 4C Renderer and GPU, Phase 4D Memory, Startup, and Recovery, Phase 4E Device and Browser Matrix (+26 more)

### Community 21 - "Phase 2 Systems Depth"
Cohesion: 0.09
Nodes (29): AiPoint, issueAttackMove(), issueBuild(), Difficulty, StrategicGoal, AiOpponentPersistenceState, ARTILLERY_REPOSITION_OFFSETS, ArtilleryRevealTrackingState (+21 more)

### Community 22 - "opponent.ts"
Cohesion: 0.13
Nodes (29): cwd, receipt, reportPath, runDirectory, runId, runsRoot, startedAt, writeSanitizedErrorArtifact() (+21 more)

### Community 23 - "campaignProfile.ts"
Cohesion: 0.08
Nodes (11): LifecycleApi, QUALITY_THRASH_SEQUENCE, StartupMetrics, Window, BASE_EXPOSURE, ORDER, QUALITY, QualitySettings (+3 more)

### Community 24 - "terrain.ts"
Cohesion: 0.10
Nodes (20): BrowserScenario, CalibrationManifest, QualityLevel, browserSearch(), browserStorage(), clamp01(), DEFAULT_VOICE_VOLUME, DEFAULT_VOLUME (+12 more)

### Community 25 - "ringMath.ts"
Cohesion: 0.15
Nodes (25): CAMPAIGN_PROFILE_KEY, CAMPAIGN_PROFILE_SCHEMA, CAMPAIGN_PROFILE_VERSION, CampaignActionError, CampaignProfileLoadResult, CampaignProfileStorage, CampaignProfileValidationError, createCampaignProfile() (+17 more)

### Community 26 - "Terrain"
Cohesion: 0.07
Nodes (20): SIM_DT, createTerrain(), MAX_TERRAIN_HEIGHT, RIM_WALL_HEIGHT, standardCorridors(), standardFlatZones(), TERRAIN_CELL, TerrainConfig (+12 more)

### Community 27 - "wireKeys"
Cohesion: 0.07
Nodes (16): SURFACE_GRAVITY, renderToRing(), ringToRender(), tangentAt(), TAU, upAt(), Vec3Out, FlowField (+8 more)

### Community 28 - "main.ts"
Cohesion: 0.12
Nodes (13): clamp01(), GRAD3, hash2(), lerp(), smootherstep(), smoothstep(), worley2(), clampAxial() (+5 more)

### Community 29 - "settings.ts"
Cohesion: 0.10
Nodes (21): CampaignTransition, continueCampaign(), CampaignRouteIntent, SAVE_SLOT_KEY, BASE_SEPARATION, boot, CleanupStack, CommandWiring (+13 more)

### Community 30 - "models.ts"
Cohesion: 0.11
Nodes (23): addBlock(), addCylinder(), addGreebles(), BlockSpec, buildMech(), buildStructure(), _e1, _e2 (+15 more)

### Community 31 - "RING_CIRCUMFERENCE"
Cohesion: 0.10
Nodes (19): RING_CIRCUMFERENCE, AXIAL, DressingItem, LOCAL_CENTER, ONE, UP, disposeObject(), AXIAL (+11 more)

### Community 32 - "ballistics.ts"
Cohesion: 0.16
Nodes (26): RING_OMEGA, AimOptions, AimSolution, airDensityAt(), clamp(), directionalReachProfile, inertialToRing(), inertialToRingVelocity() (+18 more)

### Community 33 - "AiOpponent"
Cohesion: 0.17
Nodes (9): AiOpponent, artilleryTargetValue(), ballisticPlanKey(), clamp(), clearAiOrder(), createBallisticPlanState(), isReachable(), isScenarioKnownEnemyBastion() (+1 more)

### Community 34 - ".structureById"
Cohesion: 0.14
Nodes (4): WeaponDef, angleDelta(), BallisticSource, turnToward()

### Community 35 - "calibration.ts"
Cohesion: 0.13
Nodes (12): MatrixSession, addPart(), addStandingLeg(), buildColorChart(), buildMaterialSwatches(), buildReferenceMech(), buildSweep(), COLOR (+4 more)

### Community 36 - "startSession"
Cohesion: 0.11
Nodes (4): VoiceDirector, savedPlayerFaction(), startSession(), CameraController

### Community 37 - "runner.ts"
Cohesion: 0.13
Nodes (25): averages(), controllerSeed(), countTotal(), createFactionResult(), createFactionResults(), EconomyResult, emptyFactionTotals(), emptyStructureCounts() (+17 more)

### Community 38 - "SimEvent"
Cohesion: 0.13
Nodes (4): distanceAttenuation(), Effects, hashUnit(), SimEvent

### Community 39 - "Renderer"
Cohesion: 0.16
Nodes (15): applyBrowserScenario(), applyScenarioHealth(), benchmarkScenario(), captureScenarioFrame(), captureScenarioState(), captureScenarioStateHash(), installUploadProfiler(), requiredRww() (+7 more)

### Community 40 - "scenario-driver.ts"
Cohesion: 0.10
Nodes (4): RwwWindow, clamp(), RigModeController, CameraRig

### Community 41 - "CameraRig"
Cohesion: 0.13
Nodes (9): BTContext, BTNode, Cooldown, DIFFICULTY_RANK, DifficultyGate, finite(), Selector, Sequence (+1 more)

### Community 42 - "BTNode"
Cohesion: 0.23
Nodes (3): deltaS(), RenderAnchor, wrapLerp()

### Community 43 - "deltaS"
Cohesion: 0.14
Nodes (7): launchToInertial(), clampAxial(), artilleryWorld(), emptyWorld(), node(), battlefield(), storyWorld()

### Community 44 - "UnitKind"
Cohesion: 0.13
Nodes (16): isUnitKind(), VoiceClip, VoicePlayback, VoicePlaybackSink, VoiceTrigger, VoiceUnitRef, factionClips(), GROUP_TRIGGERS (+8 more)

### Community 45 - "campaignRoute.ts"
Cohesion: 0.20
Nodes (20): completeCampaignMission(), launchFor(), recordCampaignFailure(), recordCampaignReplayResult(), replayCampaignMission(), requireLaunchable(), retryCampaignMission(), revise() (+12 more)

### Community 48 - ".stepUnits"
Cohesion: 0.13
Nodes (20): makeHullMaterial(), MechClass, StructureModel, angleLerp(), angleWrap(), clampN(), FactionMaterials, FootState (+12 more)

### Community 49 - "SurfaceNav"
Cohesion: 0.21
Nodes (19): boundedNonNegativeInteger(), boundedPositiveInteger(), nonNegativeInteger(), normalizeCommand(), normalizePath(), optionValue(), parseBrowserPerf(), parseCliArgs() (+11 more)

### Community 50 - "entityRenderer.ts"
Cohesion: 0.15
Nodes (3): wireKeys(), DebugOverlay, SettingsMenu

### Community 51 - "titleScreen.ts"
Cohesion: 0.16
Nodes (16): CampaignProfile, CampaignResult, CampaignRouteContext, CampaignMissionId, PRESENTATION_MEDIA, PresentationMedia, UnitDossierMedia, REVIEWED_VOICE_CLIPS (+8 more)

### Community 52 - "performance-profile.test.ts"
Cohesion: 0.13
Nodes (13): BallisticAttempt, BallisticWorkSnapshot, config, flatTerrain, PROFILE_TICKS, profileBallisticCommands(), profileNearbyCache(), recordTiming() (+5 more)

### Community 53 - "headless/core-match.test.ts"
Cohesion: 0.22
Nodes (3): spinalMainForceBonus(), spinalNodePriority(), minimapAriaLabel()

### Community 54 - "WholeRingModeController"
Cohesion: 0.13
Nodes (15): CORE_MATCH_MANIFEST_SCHEMA, CORE_MATCH_MANIFEST_VERSION, CoreMatchManifest, CoreMatchRecord, createCoreMatchReport(), equalCheck(), evaluateCoreMatchGates(), maximumCheck() (+7 more)

### Community 55 - "args.mjs"
Cohesion: 0.12
Nodes (5): CameraCapabilities, CameraModeController, WholeRingModeController, directCapabilities, tacticalCapabilities

### Community 56 - "strategicAnnulus.ts"
Cohesion: 0.18
Nodes (11): CATEGORIES, countRenderables(), createAnnulusGeometry(), createMarkerGeometries(), createOutline(), markerPool(), projectSurfaceToAnnulus(), StrategicAnnulus (+3 more)

### Community 57 - "Launch Scope"
Cohesion: 0.12
Nodes (17): Procedural Asset Budget, Greeble Compiler, MechDef, Presentation Simulation Boundary, Procedural-Only Gameplay Rule, Seeded Generation, Axiom Choir Campaign, Campaign Platform (+9 more)

### Community 59 - "WebAudioBackend"
Cohesion: 0.23
Nodes (3): createNoiseBuffer(), stopQuietly(), WebAudioBackend

### Community 60 - "missionRegistry.ts"
Cohesion: 0.16
Nodes (12): CampaignLaunch, CAMPAIGN_MISSIONS, CampaignMissionAvailability, CampaignMissionStatus, CampaignRuntimeScenarioId, DEFINITIONS, fail(), MISSION_BY_ID (+4 more)

### Community 61 - "browser-scenario.mjs"
Cohesion: 0.25
Nodes (13): acquireVite(), availablePort(), isRingWorldWar(), once(), probeBrowser(), benchmarkBrowserScenario(), captureVisualScenario(), decodeScreenshot() (+5 more)

### Community 62 - "BTStatus"
Cohesion: 0.24
Nodes (14): executeDoctor(), loadTarget(), printDoctor(), buildDoctorReport(), check(), evaluateTarget(), parseTarget(), probeSystem() (+6 more)

### Community 63 - "AudioBackend"
Cohesion: 0.16
Nodes (7): BTStatus, issueMove(), clamp(), deterministicAngle(), DodgeIncoming, Retreat, ScriptedNode

### Community 64 - "audioEngine.test.ts"
Cohesion: 0.19
Nodes (3): surfaceDistSq(), structure(), unit()

### Community 66 - "visual-signature.mjs"
Cohesion: 0.18
Nodes (3): AudioCue, frame(), RecordingBackend

### Community 69 - "parseCoreMatchManifest"
Cohesion: 0.29
Nodes (11): averageHash(), bitsToHex(), buildGrid(), check(), compareVisualSignatures(), computeVisualSignature(), differenceHash(), edgeDensity() (+3 more)

### Community 70 - "doctor.mjs"
Cohesion: 0.17
Nodes (12): Headless 40m Qualification, Pinned Headless Runner, Canonical Headless Workload, Headless Performance Gate, Protected Headless Qualification Workflow, Protected Qualification Evidence, T480s Reference Runner, Requirement 17.5 (+4 more)

### Community 71 - "webAudioBackend.ts"
Cohesion: 0.41
Nodes (12): fail(), parseCoreMatchManifest(), readArray(), readDifficulty(), readFinite(), readGates(), readInteger(), readNonEmptyString() (+4 more)

### Community 72 - "write-delivery-receipt.mjs"
Cohesion: 0.24
Nodes (8): createWebAudioBackend(), noiseRate(), oscillatorType(), pitchDrop(), preloadRank(), SpeechRecord, usesNoise(), VoiceRecord

### Community 73 - "Chord Shot"
Cohesion: 0.18
Nodes (9): assets, DELIVERY_DIRS, EXTRA_FILES, files, IMAGE_REQUEST_IDS, OUTPUT, PUBLIC, receipt (+1 more)

### Community 74 - "audioEngine.ts"
Cohesion: 0.20
Nodes (10): Counter-Battery Flash, Silo, Chord Shot, Authoritative Projectile ID, Compact Rocket Battery, Counterfire Objective 6, Standard Rocket, Cruise Missile (+2 more)

### Community 75 - "validation/core-match.test.ts"
Cohesion: 0.31
Nodes (8): AudioBackendFactory, AudioCueKind, AudioState, clamp(), cue(), cueForEvent(), cuePriority(), hashUnit()

### Community 76 - "abilities.ts"
Cohesion: 0.20
Nodes (7): collectCoreMatchTimeline(), CoreMatchTimelineCollector, createExpandedMatch(), expandCoreMatchManifest(), formatCoreMatchJson(), runCoreMatchCohort(), manifestPath

### Community 77 - ".isEntityVisible"
Cohesion: 0.29
Nodes (9): AbilityDef, AbilityId, AbilityState, BaseAbilityDef, CloakDef, createAbilityState(), ShieldWallDef, SiegeModeDef (+1 more)

### Community 78 - "shot.mjs"
Cohesion: 0.20
Nodes (8): args, height, logs, out, panS, url, width, zoomNotches

### Community 79 - "Direction Is Territory"
Cohesion: 0.22
Nodes (9): Direction Is Territory, Physics Guardrails, Product Thesis, Ring USP Slice, Launch Validation Gates, Directional Artillery Authority, Directional Artillery High Ground, Revised Core Loop (+1 more)

### Community 81 - "Ability System"
Cohesion: 0.25
Nodes (8): Mech Damage States, Ability System, AI Systems, Data Layer Extensions, Headless Balance Runner, Phase 2 Implementation Plan, Task Dependency Graph, Weapon Systems

### Community 82 - "Sensor Coverage"
Cohesion: 0.25
Nodes (8): Artillery Authority, Minimap and Selection Inputs, Sensor Coverage, Directional Artillery Comprehension, Minimap Commands, Structured Fire Command Reasons, Terrain Line of Sight, Tactical UI Task

### Community 83 - "Battlefield Memory"
Cohesion: 0.25
Nodes (8): Aftermath Authority Boundary, Chord Launch and Impact Sequence, Transient Aftermath Pools, Battlefield Memory, Phase 3D and 3E Risks, Presentation-Only Boundary, Tactical HUD, Phase 3D and 3E Checklist

### Community 85 - "StructureKind"
Cohesion: 0.25
Nodes (7): FactionMatchResult, HeadlessStructureObservation, RuntimeScenarioStructure, StructureKind, Order, PlayerState, WorldPlayerPersistenceState

### Community 86 - "lint.mjs"
Cohesion: 0.39
Nodes (6): auditRepository(), auditSource(), boundaries, formatViolation(), walk(), worldAuthority

### Community 87 - "Launch-Scope Ship-First Execution Policy"
Cohesion: 0.29
Nodes (7): Absolute Acceptance Rubric, Bounded Review and Remediation, Class-Specific Acceptance, Launch-Scope Ship-First Execution Policy, Launch-Scope Quality Ladder, Stop and Reopen Rules, Validation Gate Lanes

### Community 88 - "Last Rotation Transmission Alert Poster"
Cohesion: 0.38
Nodes (7): AES-256 Encryption Malfunction, Degraded Signal, Industrial Communications Site, Terminal 04-B, Last Rotation Transmission Alert Poster, Unknown Source, Urgent Transmission

### Community 89 - "browser-metrics.mjs"
Cohesion: 0.33
Nodes (6): Ring Space, Rotating-frame Ballistics, Deterministic Rng, Module Contracts, RenderAnchor, VfxSystem

### Community 90 - "RenderAnchor"
Cohesion: 0.33
Nodes (6): G-01 Human Comprehension Gate, Five Directional Artillery Questions, Initial Human Cohort, Player Observation Protocol, Privacy-Preserving Observation Evidence, Uncoached Directional Artillery Session

### Community 91 - "Player Observation Protocol"
Cohesion: 0.33
Nodes (6): Deposit Placement Guidance, Directional Artillery Comprehension Finding, First Contact Completion Playtest, Inertial Starfield, Low-Quality Presentation Findings, Outward Procedural Hull Winding

### Community 93 - "title-screen.spec.ts"
Cohesion: 0.60
Nodes (4): distribution(), percentile(), summarizeDistributions(), summarizeFrameMetrics()

### Community 94 - "AI Strategist"
Cohesion: 0.50
Nodes (5): AI Tactician, AI Strategist, AI Tactician, Behavior Tree, AI Difficulty Tiers

### Community 95 - "AI Strategist"
Cohesion: 0.40
Nodes (5): Bounded Combat Atmosphere, Fog-Safe Procedural Audio, Presentation-Only Boundary, Render-Only Mech Weight, Signature Battlefield

### Community 96 - "Presentation-Only Boundary"
Cohesion: 0.40
Nodes (5): Axiom Choir Visual Language, Faction Geometry Variants, Meridian Compact Visual Language, Neutral Spinal Infrastructure, Render-Derived Damage Surfaces

### Community 97 - "Faction Geometry Variants"
Cohesion: 0.40
Nodes (5): Available Engine Qualification, Cross-Browser Scenario Determinism, Device and Browser Matrix Contract, Unavailable Matrix Cells, WebKit Recovery Fix

### Community 98 - "Device and Browser Matrix Contract"
Cohesion: 0.40
Nodes (5): Faction Voice Identity, Offline Media Authoring, Phase 5 Voice and Visual Identity, Presentation Media Manifest, VoiceDirector

### Community 99 - "Phase 5 Voice and Visual Identity"
Cohesion: 0.40
Nodes (5): Developer Review, Directional Artillery Criteria, G-01 Gate, Uncoached Human Tester, Human Playtesting Evidence

### Community 101 - "campaign.spec.ts"
Cohesion: 0.40
Nodes (5): Central Luminary, Damaged Superstructure, Habitat Ring Interior, Inhabited Cityscape, Observation Deck

### Community 102 - "Habitat Ring Interior"
Cohesion: 0.40
Nodes (5): Central Signal Tower, Industrial Settlement, Orange Signal Aperture, Ring Superstructure, Signal Briefing

### Community 103 - "Central Signal Tower"
Cohesion: 0.40
Nodes (5): Central Signal Spire, Industrial Settlement, Ring Habitat Interior, Signal Hunter Drone, Signal Tracking Overlay

### Community 104 - "Central Signal Spire"
Cohesion: 0.60
Nodes (5): Central Energy Discharge, Habitat Ring, Last Correction, Perimeter Correction Signal, Signal Last Correction Illustration

### Community 105 - "Perimeter Correction Signal"
Cohesion: 0.60
Nodes (5): Holographic Transmission Path, Ring Infrastructure, Signal Emitter, Signal Migration, Stellar Focal Point

### Community 106 - "Holographic Transmission Path"
Cohesion: 0.40
Nodes (5): Axiom Choir Vanguard, Bipedal Combat Mech, Dual Heavy Armament, Industrial Staging Bay, Axiom Choir Vanguard Unit Dossier

### Community 107 - "Axiom Choir Vanguard"
Cohesion: 0.40
Nodes (5): Long-Range Cannon, Longbow, Quadrupedal Chassis, Self-Propelled Artillery Platform, Sensor Module

### Community 108 - "Self-Propelled Artillery Platform"
Cohesion: 0.70
Nodes (4): abilityWorld(), dodgeWorld(), emptyWorld(), focusWorld()

### Community 109 - "tactician.test.ts"
Cohesion: 0.50
Nodes (4): Bulwark, Narrative Layer, Needle, Story Mission

### Community 110 - "Story Mission"
Cohesion: 0.50
Nodes (4): Browser Scenarios, Headless Qualification, RWW CLI, Versioned Receipts

### Community 111 - "Versioned Receipts"
Cohesion: 0.50
Nodes (4): Azure OpenAI GPT-image-2, Deepgram Aura-2, Phase 5 Tactical Media Delivery, Media Review Gates

### Community 112 - "Phase 5 Tactical Media Delivery"
Cohesion: 0.50
Nodes (4): HeyGen Video Agent, Last Rotation Opening, Reviewed Last Rotation Media, Generated Media Usage Rights Basis

### Community 113 - "Last Rotation Opening"
Cohesion: 0.50
Nodes (4): Authoritative Artillery Targeting, Directional Artillery Advantage, Directional Range Footprint, First Contact Directional Objective

### Community 114 - "Directional Artillery Advantage"
Cohesion: 0.50
Nodes (4): Current Gameplay Mechanics, Proposed Future Mechanics, Skirmish Theater, Theater Commander

### Community 115 - "Current Gameplay Mechanics"
Cohesion: 0.50
Nodes (4): Canonical Ballistic Verification, Failed Ballistic Attempts, Failed AI Plan Cache, Signed Ring Reach Envelope

### Community 116 - "Failed Ballistic Attempts"
Cohesion: 0.50
Nodes (4): Analytic Ring Atmosphere, Direct Renderer Boundary, Environmental Quality Budgets, PBR Calibration Scene

### Community 117 - "Analytic Ring Atmosphere"
Cohesion: 0.50
Nodes (4): Bounded Visibility-Filtered Event Rail, HUD Authority Boundary, Responsive HUD Zones, Tactical HUD and Command Feedback

### Community 118 - "Tactical HUD and Command Feedback"
Cohesion: 0.50
Nodes (4): Hardware Doctor, Headless 40-Minute Profile, Phase 4A Provisional Baseline, T480s Heavy Combat Profile

### Community 119 - "Phase 4A Provisional Baseline"
Cohesion: 0.50
Nodes (4): Procedural PBR Terrain GPU Bottleneck, Heavy-Combat Renderer Profile, Renderer Attribution, Active Quality Shader Prewarm

### Community 120 - "Heavy-Combat Renderer Profile"
Cohesion: 0.50
Nodes (4): Launch Scope Control, Plan Freshness, Progress Endpoint, Remaining Work Dashboard

### Community 121 - "Launch Scope Control"
Cohesion: 0.50
Nodes (4): Articulated Bipedal Chassis, Choir Engineer, Cyan Illuminated Accents, Tool Appendages

### Community 122 - "Choir Engineer"
Cohesion: 0.50
Nodes (4): Armored Weapon Platform, Articulated Quadrupedal Chassis, Choir Longbow, Elevated Tubular Launcher

### Community 123 - "Choir Longbow"
Cohesion: 0.50
Nodes (4): Axiom Choir Needle, Faceted Dark Armor, Humanoid Combat Construct, Integrated Lance Weapon

### Community 124 - "Axiom Choir Needle"
Cohesion: 0.50
Nodes (4): Aegis, Armored Bipedal Combat Walker, Dual Sensor Dish Array, Shoulder Mounted Weapon Turrets

### Community 125 - "Armored Bipedal Combat Walker"
Cohesion: 0.50
Nodes (4): Compact Bulwark, Dual Cannon Armament, Frontal Shield Armor, Quadrupedal Combat Chassis

### Community 126 - "Compact Bulwark"
Cohesion: 0.50
Nodes (4): Armored Biped Chassis, Articulated Tool Arm, Cable Spool, Compact Engineer Unit

### Community 127 - "Compact Engineer Unit"
Cohesion: 0.50
Nodes (4): Armored Bipedal Combat Chassis, Compact Vanguard, Dual Rotary Cannon Armament, Layered Heavy Armor

### Community 129 - ".tick"
Cohesion: 0.67
Nodes (3): Cinematic Presentation Layer, Optional Media Boundary, Title Screen

### Community 130 - "Cinematic Presentation Layer"
Cohesion: 0.67
Nodes (3): Balance Gates, Core Match Validation, Validation Observer

### Community 131 - "Core Match Validation"
Cohesion: 0.67
Nodes (3): Authoritative Preview/Fire Agreement, Directional Artillery USP, Directional Reach Profile

### Community 132 - "Directional Reach Profile"
Cohesion: 0.67
Nodes (3): First Contact Tutorial, Mission Persistence, Objective Sequence

### Community 133 - "First Contact Tutorial"
Cohesion: 0.67
Nodes (3): AI Opponent, Mech Combat, Rocket Warfare

### Community 134 - "Rocket Warfare"
Cohesion: 0.67
Nodes (3): Gate 1 Playable Slice, Human Gate, Locked Decisions

### Community 135 - "Gate 1 Playable Slice"
Cohesion: 0.67
Nodes (3): LS-09 Automation Acceptance, Strategic Contacts, Strategic Contact Authority Boundary

### Community 136 - "Strategic Contacts"
Cohesion: 0.67
Nodes (3): Accelerated Lifecycle Soak, Bounded Memory Indexes, First Playable Frame Measurement

### Community 137 - "Accelerated Lifecycle Soak"
Cohesion: 0.67
Nodes (3): Application Bootstrap, Boot Loading Screen, Ring World War Title

### Community 138 - "Boot Loading Screen"
Cohesion: 0.67
Nodes (3): Aegis, Illuminated Sensor Arrays, Quadruped Armored Walker

### Community 139 - "Aegis"
Cohesion: 0.67
Nodes (3): Bipedal Walker, Compact Wisp Unit, Sensor Communications Mast

### Community 140 - "Compact Wisp Unit"
Cohesion: 0.67
Nodes (3): Delivered Phase 2 Systems, Phase 2 Design Corrections, Verified Vertical Increments

### Community 141 - "Delivered Phase 2 Systems"
Cohesion: 0.67
Nodes (3): Audio Expansion, Cinematic Presentation, Optional Media Manifest

## Knowledge Gaps
- **597 isolated node(s):** `POST_MISSION_VISUAL_PROFILE`, `StartupMetrics`, `QUALITY_THRASH_SEQUENCE`, `execFileAsync`, `TimerQueryExtension` (+592 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **43 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Faction` connect `Hud` to `serialize.ts`, `mission.ts`, `world.ts`, `game.ts`, `World`, `constants.ts`, `runtimeScenario.ts`, `rww.test.ts`, `Spinal Alignment`, `Phase 2 Systems Depth`, `Terrain`, `settings.ts`, `RING_CIRCUMFERENCE`, `.structureById`, `startSession`, `runner.ts`, `SimEvent`, `Renderer`, `BTNode`, `deltaS`, `UnitKind`, `campaignRoute.ts`, `.stepUnits`, `titleScreen.ts`, `performance-profile.test.ts`, `headless/core-match.test.ts`, `WholeRingModeController`, `strategicAnnulus.ts`, `missionRegistry.ts`, `audioEngine.test.ts`, `visual-signature.mjs`, `surfaceDistSq`, `write-delivery-receipt.mjs`, `validation/core-match.test.ts`, `StructureKind`, `Self-Propelled Artillery Platform`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `World` connect `Hud` to `serialize.ts`, `mission.ts`, `world.ts`, `game.ts`, `World`, `constants.ts`, `Spinal Alignment`, `Phase 2 Systems Depth`, `Terrain`, `wireKeys`, `main.ts`, `RING_CIRCUMFERENCE`, `.structureById`, `startSession`, `runner.ts`, `SimEvent`, `BTNode`, `deltaS`, `UnitKind`, `.emit`, `.stepUnits`, `performance-profile.test.ts`, `headless/core-match.test.ts`, `strategicAnnulus.ts`, `Rng`, `audioEngine.test.ts`, `visual-signature.mjs`, `surfaceDistSq`, `validation/core-match.test.ts`, `EntityRenderer`, `Self-Propelled Artillery Platform`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `Game` connect `Game` to `AiOpponent`, `mission.ts`, `calibration.ts`, `startSession`, `Renderer`, `scenario-driver.ts`, `game.ts`, `World`, `constants.ts`, `entityRenderer.ts`, `Phase 2 Systems Depth`, `campaignProfile.ts`, `terrain.ts`, `settings.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `POST_MISSION_VISUAL_PROFILE`, `StartupMetrics`, `QUALITY_THRASH_SEQUENCE` to the rest of the system?**
  _597 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `serialize.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06373626373626373 - nodes in this community are weakly interconnected._
- **Should `mission.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05570175438596491 - nodes in this community are weakly interconnected._
- **Should `vite.config.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07253086419753087 - nodes in this community are weakly interconnected._