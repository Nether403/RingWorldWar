# Headless Performance Policy

**Status:** passed on the protected reference runner at commit `5427c3f`.

## Purpose

Requirement 17.5 measures deterministic simulation throughput without rewarding
gameplay, solver, or balance changes. The gate uses the accepted canonical
ballistic solver and a named runner. Results from arbitrary developer machines,
dirty source trees, concurrent workloads, or changed match timelines are
diagnostic only.

## Reference Runner

The first pinned reference is the current T480s-class development machine:

- Windows 11 Pro x64, build family `10.0.26220`.
- Intel Core i7-8650U at 1.90 GHz.
- 8 logical processors.
- At least 24 GB nominal RAM.
- Node.js 26.x x64.
- AC power, fixed performance policy, no concurrent validation workload.

The planned dedicated runner identity is `t480s-headless-01`. Its protected CI
environment must attest `RWW_PINNED_RUNNER_ID=t480s-headless-01`,
`RWW_RUNNER_DEDICATED=1`, `RWW_RUNNER_AC_POWER=1`, and
`RWW_RUNNER_POWER_POLICY=fixed-performance`, and
`RWW_RUNNER_IMMUTABLE_WORKSPACE=1`. Developer-set values are not final
evidence; qualification depends on the protected runner environment.

The protected entry point is `.github/workflows/headless-qualification.yml`.
GitHub must report `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=self-hosted`, and
`RUNNER_NAME=t480s-headless-01`; local environment variables alone cannot satisfy
the final qualification contract. The workflow is master-only, uses the protected
`headless-qualification` GitHub Environment, checks AC power and the active power
plan against High Performance GUID `8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`, and
records the GitHub run URL. A CLI success is final evidence only when
the uploaded receipt can be verified against that protected workflow run.

A CI result is qualifying only when produced by a dedicated/self-hosted runner
matching this identity. A faster hosted runner may provide advisory evidence but
does not silently redefine the baseline.

## Workload

- Canonical gameplay and ballistic solver.
- Seed 501, Veteran Compact versus Veteran Choir.
- Standard procedural terrain.
- 72,000-tick / 40-simulated-minute cap.
- One excluded warmup match for process/JIT stabilization.
- Five measured matches in the same process and against the same generated terrain.
- Terrain generation reported separately from simulation wall time.
- One excluded deterministic guard match that verifies approved SHA-256 periodic
  world/controller snapshots and the event transcript before timing begins.

## Gate

- Warm measured median: at most 15,000 ms.
- Every measured match must complete and remain deterministic.
- The deterministic guard timeline must match
  `6bbc10ac09b7cb6f21bcdba907d4dc57ef8134d6383cabe9d534d171e061f5db`,
  and every measured MatchResult must match
  `6cbce1c53391f33b78949037500c429fc1b59b2c74ee051ed9cebce001fac9c0`.
- The receipt must identify source provenance, dirty state, runtime, normalized
  command, timing artifact hash, terrain, tick cap, warmup count, measured count,
  and median budget.
- The source tree must be clean. Dirty-tree runs are provisional even when the
  timing assertion passes.
- The excluded warmup duration, measured CPU times, and measured wall times stay
  in the artifact for diagnosis. They are not individually hard gates.

Qualification command:

```powershell
npm run rww -- perf headless-40m --qualify
```

## Rationale

The original ten-second criterion did not name hardware, warmup policy, sample
count, statistic, terrain, or cold-start boundary. Exact-solver measurements on
the reference machine cluster around 11.9-12.0 seconds but include substantial
JIT and shared-machine variance. Multiple faster solver experiments were rejected
because they changed deterministic outcomes or faction balance. A sustained
sample after one warmup produced a 14.021-second median, while a later contended
developer-machine sample produced 16.115 seconds. The 15-second warm median is a
candidate dedicated-runner budget that preserves accepted gameplay and targets
more than 110x real-time throughput; local non-dedicated runs cannot establish
its final margin.

## Change Control

Changing the runner, Node major version, workload, sample policy, or budget
requires a new baseline receipt and an explicit update to this document and
Requirement 17.5. Performance improvements may tighten the budget only after the
canonical deterministic and gameplay cohorts pass.

## Current Evidence

The protected workflow passed on 2026-08-05 with a 9,369.218 ms warm median,
matching timeline/event/result hashes, and stable clean source. GitHub run:
`https://github.com/Nether403/RingWorldWar/actions/runs/30990813691`.
Tracked evidence: `validation/evidence/headless-qualification-2026-08-05.json`.
Earlier dirty, non-dedicated calibration remains preserved separately as
inconclusive evidence.
