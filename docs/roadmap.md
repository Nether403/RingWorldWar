# Current Roadmap And Status

**Status date:** 2026-08-02

This is the authoritative source for current delivery status and near-term sequencing. `tasks/plan.md` and `tasks/todo.md` preserve earlier planning history; unchecked or future-looking items there do not override this document.

## Current Status

| Area | Status | Evidence or boundary |
| --- | --- | --- |
| Gate 1 technical playable slice | Passed | Automated and technical receipt in `docs/gate-1.md` |
| Phase 2 systems implementation | Delivered | AI tiers, weapons, abilities, faction modifiers, save/load, quality settings, and headless orchestration are summarized in `tasks/phase-2-systems-depth/execution-report.md` |
| Gate 2 gameplay cohorts | Passed | Veteran mirror, Veteran vs Recruit, and Commander vs Veteran cohorts all pass the configured gameplay gates in `docs/core-match-validation-results.md` |
| Requirement 17.5 | Open | Current local receipt median is 13.884 seconds; the 40-simulated-minute match has not been robustly qualified under 10 seconds on pinned CI hardware |
| Human playtesting | Open | AI proxies are not human evidence; no completed first-time-player observation is claimed |
| Validation CLI and visual scenario tooling | Completed | Direct `doctor`, `run`, `visual`, `play`, and `perf` workflows are documented in `docs/cli.md` |
| T480s 720p Low rendering gate | Completed | The candidate hard gate passes with evidence in `docs/t480s-low-performance.md` |
| Directional artillery prototype | Completed | Automated behavior and rendering validation are recorded in `docs/directional-artillery-prototype.md`; human comprehension remains unverified |
| Phase 2 overall | Qualification in progress | Gameplay cohorts pass, but performance qualification and human observation remain open |

## Immediate Sequence

Work proceeds in this order. Later steps must not be pulled forward when they depend on evidence from an earlier step.

1. **Completed - CLI and visual scenario tooling:** direct reproducible validation, visual capture, play, and profiling workflows are available.
2. **Completed - T480s Low rendering gate:** the measured 720p Low candidate hard gate passes. Requirement 17.5 remains separately open at the current 13.884-second local median.
3. **Completed - directional artillery prototype:** the antispinward long-range territorial question is implemented and technically validated.
4. **Current - human USP observation:** observe a first-time player and record whether the direction and strategic value are legible without coaching the intended answer.
5. **Tutorial:** design and tune onboarding from the directional-artillery validation and player-observation evidence. Do not finalize tutorial copy or objective timing before those observations.

## Direction Decisions

- **Authoritative artillery direction:** antispinward is the long-range direction; spinward is the short-range direction.
- **Faction state:** mechanical asymmetry between the Meridian Compact and Axiom Choir is implemented. Further silhouette, roster, or doctrine differentiation remains future work.
- **Asset policy:** the current product remains procedural-only. A Blender/glTF pipeline is a proposed future option, not an active roadmap commitment, and would require an explicit change to the asset constraint.
- **Tutorial sequencing:** tutorial work follows directional-USP validation and first-time-player observation rather than preceding them.
- **Evidence standard:** automated cohorts establish deterministic gameplay and AI-proxy results. They do not establish human comprehension, enjoyment, or first-time-player difficulty.

## Open Exit Evidence

- A repeatable Requirement 17.5 result on the named target or stable pinned CI hardware.
- A recorded first-time-player session with match outcome, duration, points of confusion, artillery-direction comprehension, and unprompted observations.
- A go, rebalance, or re-scope decision based on that human evidence.

## Historical Sources

- `tasks/plan.md` records the original phase-and-gate plan.
- `tasks/todo.md` records the original Phase 0 and Phase 1 task breakdown.
- `tasks/phase-2-systems-depth/` records Phase 2 requirements, design, execution planning, and the implementation-era report.
- `docs/phase-2-headless-performance.md` preserves measured performance observations and the reason Requirement 17.5 remains open.
- `docs/core-match-validation-results.md` is the evidence receipt for the accepted gameplay cohorts.
