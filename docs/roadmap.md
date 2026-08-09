# Current Roadmap And Status

**Status date:** 2026-08-09

This is the authoritative source for current delivery status and near-term sequencing. `tasks/plan.md` and `tasks/todo.md` preserve earlier planning history; unchecked or future-looking items there do not override this document.

## Publishable Game Direction

The project now targets a solo/AI-assisted PC release with a browser demo. The approved expansion roadmap is recorded in `docs/publishable-game-roadmap.md`.

The current implementation milestone is the Ring USP slice. LS-04 delivered the strict runtime scenario definition and deterministic world factory, LS-05 delivered the twelve-mission registry and versioned campaign profile, and LS-06 delivered the transactional camera-controller interface. Their exact receipts are tracked in `validation/evidence/launch-scope/`.

LS-07 is complete under the bounded contract in `docs/launch-scope/ls-07-paired-spinal-nodes.md`: explicit operational pairs, reversible local Spinal Alignment, pair-only Dominance, deterministic pair-aware AI, v1/v2 persistence, and visibility-safe HUD/minimap representation passed. LS-08 directional advantage overlay and onboarding is complete under `docs/launch-scope/ls-08-directional-advantage.md`: automation, the developer review, and the initial uncoached human tester passed G-01. LS-09 shadow timing and overhead intelligence, LS-10's dedicated whole-ring strategic side view, LS-11's production Gravity Range, LS-12's layered district/scatter foundation, and LS-13's four reusable environmental palettes are also complete. LS-14 habitation, vegetation, transit, and ambient life is the active inhabited-ring slice.

## Current Status

| Area | Status | Evidence or boundary |
| --- | --- | --- |
| Launch execution policy | Approved and enforced | `docs/launch-scope-execution-policy.md` and progress-manifest schema version 2 bound remediation, qualification, and claim receipts |
| LS-04 runtime scenarios/world factory | Complete | Exact claim receipt in `validation/evidence/launch-scope/LS-04.json` |
| LS-05 mission registry/campaign profile | Complete, polish backlog | Exact claim receipt in `validation/evidence/launch-scope/LS-05.json`; conventional listbox arrow navigation remains optional polish |
| LS-06 camera controller interface | Complete, polish backlog | Exact claim receipt in `validation/evidence/launch-scope/LS-06.json`; one consolidated fault-injection integration test remains optional polish |
| LS-07 paired Spinal Nodes | Complete, polish backlog | Exact claim receipt in `validation/evidence/launch-scope/LS-07.json`; compact desktop ALIGN wrapping remains optional polish |
| LS-08 directional overlay/onboarding | Complete | G-01 passed with the developer review and one initial uncoached human tester; the developer may request one to three further uncoached sessions if needed |
| LS-09 shadow timing/overhead intelligence | Complete | Canonical shadow timing, bounded strategic contacts, authority separation, AI routing, persistence, and accessible presentation passed |
| LS-10 whole-ring strategic side view | Complete, polish backlog | Dedicated strategic-only camera, fixed-budget annulus, live simulation, non-color landmark semantics, command isolation, lifecycle, 1280x720 Low presentation, predecessor regressions, and core match passed; classifier centralization is optional polish |
| LS-11 Gravity Range | Complete, polish backlog | Production title/direct launch, deterministic two-shot directional exercise, canonical impact scoring, keyboard/pointer completion, whole-ring observation, responsive accessibility, full check, core match, and independent review passed |
| LS-12 layered district/scatter foundation | Complete, polish backlog | Strict authored plans, deterministic three-scale spatial composition, seam-safe terrain planting, fixed buckets, Low budgets, production preview, full check, core match, and independent review passed; palette-specific identity was delivered by LS-13 |
| LS-13 environmental district palettes | Complete, polish backlog | Four strict reusable palettes, deterministic identity, fixed colored buckets, Low readability, full check, core match, and independent review passed; primitive art refinement remains optional polish |
| LS-14 habitation, vegetation, transit, and ambient life | Active | The four palette identities are qualified; dynamic inhabited-ring cues remain unqualified |
| Gate 1 technical playable slice | Passed | Automated and technical receipt in `docs/gate-1.md` |
| Phase 2 systems implementation | Delivered | AI tiers, weapons, abilities, faction modifiers, save/load, quality settings, and headless orchestration are summarized in `tasks/phase-2-systems-depth/execution-report.md` |
| Gate 2 gameplay cohorts | Passed | Veteran mirror, Veteran vs Recruit, and Commander vs Veteran cohorts all pass the configured gameplay gates in `docs/core-match-validation-results.md` |
| Requirement 17.5 | Passed | Protected run `30990813691` passed at a 9.369-second warm median with clean stable source and matching timeline/result hashes |
| Human playtesting | Initial directional gate passed | The developer review and one uncoached human tester passed G-01; the developer retains discretion to require one to three additional uncoached sessions |
| Validation CLI and visual scenario tooling | Completed | Direct `doctor`, `run`, `visual`, `play`, and `perf` workflows are documented in `docs/cli.md` |
| T480s 720p Low rendering gate | Completed | The candidate hard gate passes with evidence in `docs/t480s-low-performance.md` |
| Directional artillery prototype | Initial comprehension gate passed | Automated validation, developer review, and an uncoached human tester are recorded; optional additional sessions remain a developer decision |
| First Contact tutorial alpha | Internal completion pass | One tester reported completing all ten objectives with zero gameplay confusion or mechanical faults; broader pacing/copy cohort remains open |
| Break the Line core-loop mission | Automated completion pass | Normal commands complete the established-base loop in 15:45; human pacing runs now determine whether a speed experiment is warranted |
| Counterfire defensive mission | Internal completion pass | Human play completed without blockers; defensive power, interception, ammunition adaptation, and debrief behavior are accepted in baseline `2cf2727` |
| A Signal in the Spine story slice | Internal completion pass | Human play completed without bugs; Bulwark, Needle, narrative pacing, and the Last Rotation revelation are accepted in frozen baseline `a67ef74` |
| Phase 3A signature battlefield | Internal completion pass | Procedural audio, mech weight, bounded VFX, battlefield dressing, and the signature battle passed human play and T480s Low qualification in frozen baseline `f599edf` |
| Phase 3B ring atmosphere and calibration | Internal completion pass | Atmosphere, axial rim, terrain lighting, and production calibration passed human review in frozen baseline `0178d61` |
| Phase 3C faction and structure identity | Internal completion pass | Faction, class, structure, and damage readability passed human review in frozen baseline `31de325` |
| Phase 3D battlefield memory | Internal completion pass | Scars, debris, smoke, wreck staging, and strategic Chord presentation passed combined human review in baseline `01261e8` |
| Phase 3E tactical HUD | Internal completion pass | Command hierarchy, feedback, accessibility, compact layouts, and controls reference passed combined review in baseline `a0c72a2` |
| Phase 4 performance and hardening | In progress | Measurement, Requirement 17.5, renderer, memory/startup, device, and CI sequencing is defined in `docs/phase-4-performance-hardening.md` |
| Phase 5 voice and visual identity | Delivered | 68 tactical voices, 12 unit cards, four narrative portraits, and the title poster are human reviewed, budgeted, hashed, and enabled with complete fallbacks |
| Phase 2 overall | Technical qualification passed | Gameplay cohorts and Requirement 17.5 pass; broader human observation remains open |

## Historical Immediate Sequence

Work proceeds in this order. Later steps must not be pulled forward when they depend on evidence from an earlier step.

1. **Completed - CLI and visual scenario tooling:** direct reproducible validation, visual capture, play, and profiling workflows are available.
2. **Completed - T480s Low rendering gate:** the measured 720p Low candidate hard gate passes.
3. **Completed - directional artillery prototype:** the antispinward long-range territorial question is implemented and technically validated.
4. **Completed - first internal USP observation:** the tester understood sensor coverage versus LOS, blocked previews, minimap commands, and direction-dependent artillery velocity.
5. **Completed - First Contact tutorial alpha:** deterministic onboarding passed one tester-reported internal completion; broader copy validation remains open.
6. **Completed - Break the Line pacing validation:** the tester completed in roughly 12–15 minutes and chose to keep current movement and projectile speeds.
7. **Completed - Counterfire validation:** defensive power, interception, ammunition adaptation, and debrief behavior passed internal human play.
8. **Completed - story expansion validation:** Bulwark escort identity, Needle hunter readability, narrative pacing, and the Last Rotation revelation passed internal human play.
9. **Completed - Phase 3A signature battlefield:** procedural mech weight, combat atmosphere, audio, and the busy signature battle passed human review and T480s qualification.
10. **Completed - Phase 3B ring atmosphere and calibration:** axial space, ringward atmosphere, terrain lighting, and production PBR calibration passed human review.
11. **Completed - Phase 3C faction and structure identity:** faction, class, structure, and damage readability passed human review.
12. **Completed - Phase 3D battlefield memory:** observed combat leaves bounded scars, debris, smoke, wrecks, and strategic Chord presentation.
13. **Completed - Phase 3E tactical HUD:** final command hierarchy and controls reference passed combined human review.
14. **Completed - Phase 4A measurement foundation:** source-current hardware, browser, wall, phase, and detail baselines are recorded provisionally.
15. **Completed - Phase 4B simulation:** Requirement 17.5 passed on the protected reference runner without changing accepted gameplay semantics.
16. **Completed - Phase 4C renderer and GPU:** quality tiers, GPU timing, terrain attribution, active-quality prewarm, uploads, transparency, and HUD costs are characterized.
17. **Completed - Phase 4D hardening:** bounded caches, complete session disposal, startup, accelerated heap/resource stability, and WebGL recovery are qualified on the T480s reference machine.
18. **Current - Phase 4E device and browser matrix:** Chromium, Chrome stable, Firefox, and Playwright WebKit pass on the T480s; unavailable physical GPU classes, Edge, and Safari remain open without weakening the accepted T480s Low gate.
19. **Completed - Cinematic front door:** the neutral Last Rotation title screen and reviewed archive intro ship behind missing-media, reduced-motion, Low-capability, caption, and skip fallbacks while gameplay remains frozen.
20. **Current - Presentation audio expansion:** inventory and improve menu ambience, faction transmissions, and gameplay audio one reviewed category at a time.
21. **Completed - Phase 5 voice and visual identity:** approved Orion/Luna tactical voices, title poster, class dossiers, and Signal narrative portraits are enabled through typed manifests with delivery hashes and fallbacks.

## Direction Decisions

- **Authoritative artillery direction:** antispinward is the long-range direction; spinward is the short-range direction.
- **Faction state:** mechanical asymmetry between the Meridian Compact and Axiom Choir is implemented. Further silhouette, roster, or doctrine differentiation remains future work.
- **Asset policy:** gameplay terrain, units, structures, and effects remain procedural-only. Human-reviewed generated presentation video, poster, captions, voices, audio, and DOM-only tactical dossier/transmission images are allowed with provenance and complete fallbacks. A Blender/glTF gameplay pipeline remains a proposed future option requiring an explicit asset-constraint decision.
- **Phase 3A balance boundary:** presentation-only. Unit and structure statistics, weapons, abilities, economy, movement, AI, navigation, ballistics, visibility, and victory rules remain frozen.
- **Gate 3 artifact policy:** generated screenshots remain ignored artifacts. Their deterministic scenario, visual signature, renderer identity, source hashes, artifact hashes, and receipt digest are durable evidence.
- **Phase 3B renderer boundary:** one analytic atmosphere draw on Medium through Ultra; Low keeps a zero-draw dark-space/fog fallback. No post-processing composer, atmosphere render target, volumetric raymarch, or dynamic environment-map rebuild.
- **Phase 3C geometry boundary:** faction detail is merged into geometry already owned by existing faction buckets; no accessory draw calls, gameplay footprint changes, or binary assets.
- **Tutorial sequencing:** tutorial work follows directional-USP validation and first-time-player observation rather than preceding them.
- **Evidence standard:** automated cohorts establish deterministic gameplay and AI-proxy results. They do not establish human comprehension, enjoyment, or first-time-player difficulty.

## Open Exit Evidence

- Developer-requested follow-up first-time-player sessions when later evidence warrants one to three additional uncoached observations.
- A go, rebalance, or re-scope decision based on that human evidence.

## Historical Sources

- `tasks/plan.md` records the original phase-and-gate plan.
- `tasks/todo.md` records the original Phase 0 and Phase 1 task breakdown.
- `tasks/phase-2-systems-depth/` records Phase 2 requirements, design, execution planning, and the implementation-era report.
- `docs/phase-2-headless-performance.md` preserves measured performance observations and the reason Requirement 17.5 remains open.
- `docs/core-match-validation-results.md` is the evidence receipt for the accepted gameplay cohorts.
