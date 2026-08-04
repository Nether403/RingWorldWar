# Current Roadmap And Status

**Status date:** 2026-08-03

This is the authoritative source for current delivery status and near-term sequencing. `tasks/plan.md` and `tasks/todo.md` preserve earlier planning history; unchecked or future-looking items there do not override this document.

## Current Status

| Area | Status | Evidence or boundary |
| --- | --- | --- |
| Gate 1 technical playable slice | Passed | Automated and technical receipt in `docs/gate-1.md` |
| Phase 2 systems implementation | Delivered | AI tiers, weapons, abilities, faction modifiers, save/load, quality settings, and headless orchestration are summarized in `tasks/phase-2-systems-depth/execution-report.md` |
| Gate 2 gameplay cohorts | Passed | Veteran mirror, Veteran vs Recruit, and Commander vs Veteran cohorts all pass the configured gameplay gates in `docs/core-match-validation-results.md` |
| Requirement 17.5 | Open | Current local receipt median is 13.884 seconds; the 40-simulated-minute match has not been robustly qualified under 10 seconds on pinned CI hardware |
| Human playtesting | Internal pass | One follow-up internal observation passed the four first-player UX checks; the broader five-player cohort remains open |
| Validation CLI and visual scenario tooling | Completed | Direct `doctor`, `run`, `visual`, `play`, and `perf` workflows are documented in `docs/cli.md` |
| T480s 720p Low rendering gate | Completed | The candidate hard gate passes with evidence in `docs/t480s-low-performance.md` |
| Directional artillery prototype | Internal comprehension pass | Automated validation and the first successful internal observation are recorded; broader cohort validation remains open |
| First Contact tutorial alpha | Internal completion pass | One tester reported completing all ten objectives with zero gameplay confusion or mechanical faults; broader pacing/copy cohort remains open |
| Break the Line core-loop mission | Automated completion pass | Normal commands complete the established-base loop in 15:45; human pacing runs now determine whether a speed experiment is warranted |
| Counterfire defensive mission | Internal completion pass | Human play completed without blockers; defensive power, interception, ammunition adaptation, and debrief behavior are accepted in baseline `2cf2727` |
| A Signal in the Spine story slice | Internal completion pass | Human play completed without bugs; Bulwark, Needle, narrative pacing, and the Last Rotation revelation are accepted in frozen baseline `a67ef74` |
| Phase 3A signature battlefield | Internal completion pass | Procedural audio, mech weight, bounded VFX, battlefield dressing, and the signature battle passed human play and T480s Low qualification in frozen baseline `f599edf` |
| Phase 3B ring atmosphere and calibration | Internal completion pass | Atmosphere, axial rim, terrain lighting, and production calibration passed human review in frozen baseline `0178d61` |
| Phase 3C faction and structure identity | Internal completion pass | Faction, class, structure, and damage readability passed human review in frozen baseline `31de325` |
| Phase 3D battlefield memory | In progress | Bounded scars, debris, smoke, wreck staging, and Chord presentation are specified in `docs/phase-3d-battlefield-memory.md` |
| Phase 3E tactical HUD | Planned | Responsive command hierarchy and presentation-only feedback follow the Phase 3D checkpoint in `docs/phase-3e-tactical-hud.md` |
| Phase 2 overall | Qualification in progress | Gameplay cohorts pass, but performance qualification and human observation remain open |

## Immediate Sequence

Work proceeds in this order. Later steps must not be pulled forward when they depend on evidence from an earlier step.

1. **Completed - CLI and visual scenario tooling:** direct reproducible validation, visual capture, play, and profiling workflows are available.
2. **Completed - T480s Low rendering gate:** the measured 720p Low candidate hard gate passes. Requirement 17.5 remains separately open at the current 13.884-second local median.
3. **Completed - directional artillery prototype:** the antispinward long-range territorial question is implemented and technically validated.
4. **Completed - first internal USP observation:** the tester understood sensor coverage versus LOS, blocked previews, minimap commands, and direction-dependent artillery velocity.
5. **Completed - First Contact tutorial alpha:** deterministic onboarding passed one tester-reported internal completion; broader copy validation remains open.
6. **Completed - Break the Line pacing validation:** the tester completed in roughly 12–15 minutes and chose to keep current movement and projectile speeds.
7. **Completed - Counterfire validation:** defensive power, interception, ammunition adaptation, and debrief behavior passed internal human play.
8. **Completed - story expansion validation:** Bulwark escort identity, Needle hunter readability, narrative pacing, and the Last Rotation revelation passed internal human play.
9. **Completed - Phase 3A signature battlefield:** procedural mech weight, combat atmosphere, audio, and the busy signature battle passed human review and T480s qualification.
10. **Completed - Phase 3B ring atmosphere and calibration:** axial space, ringward atmosphere, terrain lighting, and production PBR calibration passed human review.
11. **Completed - Phase 3C faction and structure identity:** faction, class, structure, and damage readability passed human review.
12. **Current - Phase 3D battlefield memory:** make observed combat leave bounded scars, debris, smoke, and strategic destruction presentation.
13. **Next - Phase 3E tactical HUD:** calibrate the final command interface against the completed Phase 3D battlefield.

## Direction Decisions

- **Authoritative artillery direction:** antispinward is the long-range direction; spinward is the short-range direction.
- **Faction state:** mechanical asymmetry between the Meridian Compact and Axiom Choir is implemented. Further silhouette, roster, or doctrine differentiation remains future work.
- **Asset policy:** the current product remains procedural-only. A Blender/glTF pipeline is a proposed future option, not an active roadmap commitment, and would require an explicit change to the asset constraint.
- **Phase 3A balance boundary:** presentation-only. Unit and structure statistics, weapons, abilities, economy, movement, AI, navigation, ballistics, visibility, and victory rules remain frozen.
- **Gate 3 artifact policy:** generated screenshots remain ignored artifacts. Their deterministic scenario, visual signature, renderer identity, source hashes, artifact hashes, and receipt digest are durable evidence.
- **Phase 3B renderer boundary:** one analytic atmosphere draw on Medium through Ultra; Low keeps a zero-draw dark-space/fog fallback. No post-processing composer, atmosphere render target, volumetric raymarch, or dynamic environment-map rebuild.
- **Phase 3C geometry boundary:** faction detail is merged into geometry already owned by existing faction buckets; no accessory draw calls, gameplay footprint changes, or binary assets.
- **Tutorial sequencing:** tutorial work follows directional-USP validation and first-time-player observation rather than preceding them.
- **Evidence standard:** automated cohorts establish deterministic gameplay and AI-proxy results. They do not establish human comprehension, enjoyment, or first-time-player difficulty.

## Open Exit Evidence

- A repeatable Requirement 17.5 result on the named target or stable pinned CI hardware.
- A broader recorded first-time-player cohort with match outcomes, durations, points of confusion, artillery-direction comprehension, and unprompted observations.
- A go, rebalance, or re-scope decision based on that human evidence.

## Historical Sources

- `tasks/plan.md` records the original phase-and-gate plan.
- `tasks/todo.md` records the original Phase 0 and Phase 1 task breakdown.
- `tasks/phase-2-systems-depth/` records Phase 2 requirements, design, execution planning, and the implementation-era report.
- `docs/phase-2-headless-performance.md` preserves measured performance observations and the reason Requirement 17.5 remains open.
- `docs/core-match-validation-results.md` is the evidence receipt for the accepted gameplay cohorts.
