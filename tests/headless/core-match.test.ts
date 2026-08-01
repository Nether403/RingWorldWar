import type { Difficulty } from '@ai/opponent';
import {
  CORE_MATCH_MANIFEST_SCHEMA,
  CORE_MATCH_MANIFEST_VERSION,
  collectCoreMatchTimeline,
  createCoreMatchReport,
  evaluateCoreMatchGates,
  expandCoreMatchManifest,
  formatCoreMatchJson,
  formatCoreMatchMarkdown,
  parseCoreMatchManifest,
  summarizeCoreMatches,
  type CoreMatchManifest,
  type CoreMatchRecord,
} from '@headless/coreMatch';
import type { HeadlessMatchObservation, MatchResult } from '@headless/runner';
import { Faction, STRUCTURES, UNITS } from '@sim/data';
import type { SimEvent, Structure, Unit } from '@sim/world';
import { describe, expect, it } from 'vitest';
import commanderVeteranManifest from '../../validation/manifests/commander-vs-veteran.json';
import veteranMirrorManifest from '../../validation/manifests/veteran-mirror.json';
import veteranRecruitManifest from '../../validation/manifests/veteran-vs-recruit.json';

const manifest: CoreMatchManifest = {
  schema: CORE_MATCH_MANIFEST_SCHEMA,
  version: CORE_MATCH_MANIFEST_VERSION,
  id: 'unit-cohort',
  description: 'Synthetic paired cohort',
  pairSeeds: [101, 202],
  legsPerSeed: 2,
  tickLimit: 81_000,
  telemetryCadenceTicks: 900,
  roles: [
    { id: 'veteran', difficulty: 'veteran' },
    { id: 'recruit', difficulty: 'recruit' },
  ],
  gates: {
    expectedMatches: 4,
    meanDurationSeconds: { minimum: 1_200, maximum: 2_400 },
    maximumFactionWinRate: 0.7,
    maximumDrawRate: 0.3,
    roleWinRates: [{ roleId: 'veteran', minimum: 0.5 }],
  },
};

describe('core-match manifest', () => {
  it('checks all committed manifests without running their cohorts', () => {
    for (const input of [veteranMirrorManifest, veteranRecruitManifest, commanderVeteranManifest]) {
      const parsed = parseCoreMatchManifest(input);
      expect(expandCoreMatchManifest(parsed)).toHaveLength(20);
      expect(parsed.tickLimit).toBe(81_000);
      expect(parsed.telemetryCadenceTicks).toBe(900);
    }
    const mirror = parseCoreMatchManifest(veteranMirrorManifest);
    const veteranRecruit = parseCoreMatchManifest(veteranRecruitManifest);
    const commanderVeteran = parseCoreMatchManifest(commanderVeteranManifest);
    expect(mirror).toMatchObject({ legsPerSeed: 1, gates: { expectedMatches: 20 } });
    expect(mirror.pairSeeds).toHaveLength(20);
    expect(veteranRecruit).toMatchObject({ legsPerSeed: 2, gates: { expectedMatches: 20 } });
    expect(veteranRecruit.pairSeeds).toHaveLength(10);
    expect(commanderVeteran).toMatchObject({ legsPerSeed: 2, gates: { expectedMatches: 20 } });
    expect(commanderVeteran.pairSeeds).toHaveLength(10);
  });

  it('expands exact seeds into deterministic paired assignments', () => {
    const first = expandCoreMatchManifest(manifest);
    const second = expandCoreMatchManifest(manifest);

    expect(second).toEqual(first);
    expect(first.map((match) => match.seed)).toEqual([101, 101, 202, 202]);
    expect(first[0]).toMatchObject({
      matchId: 'unit-cohort-p01-a',
      difficulties: ['veteran', 'recruit'],
      roleByFaction: { [Faction.Compact]: 'veteran', [Faction.Choir]: 'recruit' },
    });
    expect(first[1]).toMatchObject({
      matchId: 'unit-cohort-p01-b',
      difficulties: ['recruit', 'veteran'],
      roleByFaction: { [Faction.Compact]: 'recruit', [Faction.Choir]: 'veteran' },
    });
  });

  it('expands one deterministic assignment per seed when configured for one leg', () => {
    const singleLeg = { ...manifest, legsPerSeed: 1 as const, gates: { ...manifest.gates, expectedMatches: 2 } };

    const expanded = expandCoreMatchManifest(singleLeg);

    expect(expanded.map((match) => match.seed)).toEqual([101, 202]);
    expect(expanded.map((match) => match.leg)).toEqual(['a', 'a']);
    expect(expanded.map((match) => match.difficulties)).toEqual([
      ['veteran', 'recruit'],
      ['veteran', 'recruit'],
    ]);
  });

  it('rejects malformed and internally inconsistent manifests', () => {
    expect(() => parseCoreMatchManifest({ ...manifest, pairSeeds: [101, 101] }))
      .toThrow(/pairSeeds.*unique/i);
    expect(() => parseCoreMatchManifest({ ...manifest, tickLimit: 0 }))
      .toThrow(/tickLimit/i);
    expect(() => parseCoreMatchManifest({ ...manifest, legsPerSeed: 0 }))
      .toThrow(/legsPerSeed/i);
    expect(() => parseCoreMatchManifest({ ...manifest, legsPerSeed: 3 }))
      .toThrow(/legsPerSeed/i);
    expect(() => parseCoreMatchManifest({
      ...manifest,
      gates: { ...manifest.gates, expectedMatches: 3 },
    })).toThrow(/expectedMatches/i);
    expect(() => parseCoreMatchManifest({ ...manifest, unexpected: true }))
      .toThrow(/unexpected/i);
  });
});

describe('core-match telemetry', () => {
  it('records milestones, cadence samples, last progress, and terminal inactivity', () => {
    const collector = collectCoreMatchTimeline(900);
    collector.observe(observation(1, {
      units: [unit(1, Faction.Compact, 'vanguard', 2), unit(2, Faction.Choir, 'wisp', 1)],
      events: [event('unitComplete', Faction.Compact, 1, 'vanguard')],
    }));
    collector.observe(observation(2, {
      units: [unit(1, Faction.Compact, 'vanguard', 2), unit(2, Faction.Choir, 'wisp', 1)],
      events: [event('weaponFired', Faction.Compact, 1)],
      bastionHp: { [Faction.Compact]: 9_000, [Faction.Choir]: 8_900 },
    }));
    collector.observe(observation(900, {
      units: [unit(1, Faction.Compact, 'vanguard', 0), unit(2, Faction.Choir, 'wisp', 0)],
      queues: { [Faction.Compact]: 2, [Faction.Choir]: 1 },
      status: 'completed',
    }));

    const timeline = collector.finish();
    expect(timeline.milestones.firstContact?.tick).toBe(1);
    expect(timeline.milestones.firstProduction).toMatchObject({ tick: 1, faction: Faction.Compact });
    expect(timeline.milestones.firstCombat).toMatchObject({ tick: 2, faction: Faction.Compact });
    expect(timeline.milestones.firstBastionDamage).toMatchObject({ tick: 2, faction: Faction.Choir });
    expect(timeline.samples).toHaveLength(1);
    expect(timeline.samples[0]?.factions[Faction.Compact]).toMatchObject({
      aliveCombatUnits: 1,
      idleCombatUnits: 1,
      queuedUnits: 2,
      bastionHp: 9_000,
    });
    expect(timeline.lastProgressTick).toBe(2);
    expect(timeline.terminalInactivity[Faction.Compact]).toEqual({
      noCombatUnits: false,
      allCombatUnitsIdle: true,
      productionQueuesEmpty: false,
    });
    expect(timeline.noProgressForTelemetryWindow).toBe(false);
  });
});

describe('core-match summary and gates', () => {
  it('summarizes faction and role outcomes and evaluates only deterministic values', () => {
    const expanded = expandCoreMatchManifest(manifest);
    const records = expanded.map((match, index): CoreMatchRecord => ({
      match,
      result: result(match.seed, index < 2 ? Faction.Compact : Faction.Choir, 1_800),
      timeline: emptyTimeline(),
      wallClockMilliseconds: index * 10,
    }));

    const summary = summarizeCoreMatches(manifest, records);
    const gates = evaluateCoreMatchGates(manifest, summary);

    expect(summary.matches).toBe(4);
    expect(summary.meanDurationSeconds).toBe(1_800);
    expect(summary.factions[Faction.Compact].winRate).toBe(0.5);
    expect(summary.roles.veteran).toMatchObject({ difficulty: 'veteran', wins: 2, winRate: 0.5 });
    expect(gates.passed).toBe(true);
    expect(gates.checks.map((check) => check.id)).toContain('role:veteran:minimum-win-rate');
  });

  it('fails cohort, duration, faction, draw, and role policies independently', () => {
    const summary = {
      matches: 3,
      draws: 2,
      drawRate: 2 / 3,
      meanDurationSeconds: 900,
      factions: {
        [Faction.Compact]: { wins: 3, winRate: 1 },
        [Faction.Choir]: { wins: 0, winRate: 0 },
      },
      roles: {
        veteran: { difficulty: 'veteran' as Difficulty, matches: 3, wins: 1, winRate: 1 / 3 },
        recruit: { difficulty: 'recruit' as Difficulty, matches: 3, wins: 0, winRate: 0 },
      },
      endReasons: {},
    };

    const gates = evaluateCoreMatchGates(manifest, summary);
    expect(gates.passed).toBe(false);
    expect(gates.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      'cohort-size',
      'mean-duration-minimum',
      'faction:compact:maximum-win-rate',
      'maximum-draw-rate',
      'role:veteran:minimum-win-rate',
    ]);
  });

  it('formats a manifest-backed reproducible per-match table as JSON and Markdown', () => {
    const match = expandCoreMatchManifest(manifest)[0]!;
    const record: CoreMatchRecord = {
      match,
      result: result(match.seed, Faction.Compact, 1_800),
      timeline: emptyTimeline(),
    };
    const report = createCoreMatchReport(manifest, [record]);

    const json = JSON.parse(formatCoreMatchJson(report)) as { manifest: { id: string } };
    const markdown = formatCoreMatchMarkdown(report);
    expect(json.manifest.id).toBe(manifest.id);
    expect(markdown).toContain('| Match | Pair | Seed | Compact role | Choir role |');
    expect(markdown).toContain(match.matchId);
    expect(markdown).toContain('101');
  });
});

function observation(
  tick: number,
  options: {
    units?: Unit[];
    events?: SimEvent[];
    queues?: Record<Faction, number>;
    bastionHp?: Record<Faction, number>;
    status?: 'running' | 'completed';
  } = {},
): HeadlessMatchObservation {
  const queues = options.queues ?? { [Faction.Compact]: 0, [Faction.Choir]: 0 };
  const bastionHp = options.bastionHp ?? { [Faction.Compact]: 9_000, [Faction.Choir]: 9_000 };
  return {
    tick,
    time: tick / 30,
    status: options.status ?? 'running',
    winner: null,
    endReason: '',
    players: {
      [Faction.Compact]: player(1_000, 20, 5, 40),
      [Faction.Choir]: player(900, 18, 6, 35),
    },
    units: options.units ?? [],
    structures: [
      structure(10, Faction.Compact, 'bastion', bastionHp[Faction.Compact], queues[Faction.Compact]),
      structure(20, Faction.Choir, 'bastion', bastionHp[Faction.Choir], queues[Faction.Choir]),
    ],
    events: options.events ?? [],
  };
}

function player(salvage: number, energyProduced: number, energyDrawn: number, dominance: number) {
  return {
    salvage,
    commandUsed: 0,
    commandCap: 10,
    energyProduced,
    energyDrawn,
    weaponEnergyLoad: 2,
    weaponEnergySchedule: [],
    dominance,
    unlocked: new Set<keyof typeof STRUCTURES>(),
  };
}

function unit(id: number, faction: Faction, kind: keyof typeof UNITS, targetId: number): Unit {
  return {
    id, faction, kind, targetId, alive: true, s: 0, z: 0, prevS: 0, prevZ: 0,
    yaw: 0, prevYaw: 0, aimYaw: 0, prevAimYaw: 0, speed: 0,
    hp: 100, maxHp: 100, vision: 100, buildDuration: 0, salvageCost: 0,
    order: { kind: targetId === 0 ? 'idle' : 'attack', s: 0, z: 0, targetId },
    cd: [], burst: [], burstTimer: [], revealed: 0, gait: 0, manualAimYaw: null,
    buildTimer: 0, buildTargetId: 0, ability: null, cloaked: false,
    stationaryTime: 0, damageState: 0, speedMultiplier: 1,
  };
}

function structure(
  id: number,
  faction: Faction,
  kind: keyof typeof STRUCTURES,
  hp: number,
  queuedUnits: number,
): Structure {
  return {
    id, faction, kind, hp, maxHp: 9_000, alive: true, s: 0, z: 0, yaw: 0,
    vision: 0, buildDuration: 0, salvageCost: 0, progress: 1, cd: [], burst: [],
    burstTimer: [], targetId: 0, revealed: 0,
    queue: Array.from({ length: queuedUnits }, () => 'engineer'), queueTimer: 0, capture: 0,
  };
}

function event(
  kind: SimEvent['kind'],
  faction: Faction,
  id: number,
  entityKind?: SimEvent['entityKind'],
): SimEvent {
  return { kind, faction, id, entityKind, s: 0, z: 0, h: 0, scale: 1 };
}

function result(seed: number, winner: Faction | null, durationSeconds: number): MatchResult {
  const factionResult = () => ({
    economy: {
      startingSalvage: 850, salvageGathered: 1_000, salvageSpent: 900,
      endingSalvage: 950, endingEnergyProduced: 20, endingEnergyDrawn: 10, dominance: 50,
    },
    unitsProduced: { engineer: 1, vanguard: 1, longbow: 0, wisp: 1, aegis: 0 },
    unitsLost: { engineer: 0, vanguard: 0, longbow: 0, wisp: 1, aegis: 0 },
    structuresDestroyed: Object.fromEntries(Object.keys(STRUCTURES).map((kind) => [kind, 0])) as MatchResult['factions'][Faction]['structuresDestroyed'],
  });
  return {
    seed,
    status: 'completed',
    winner,
    durationTicks: durationSeconds * 30,
    durationSeconds,
    endReason: winner === null ? 'Draw' : 'Bastion destroyed',
    factions: { [Faction.Compact]: factionResult(), [Faction.Choir]: factionResult() },
  };
}

function emptyTimeline(): CoreMatchRecord['timeline'] {
  const inactive = { noCombatUnits: false, allCombatUnitsIdle: false, productionQueuesEmpty: false };
  return {
    milestones: {},
    samples: [],
    lastProgressTick: 0,
    noProgressForTelemetryWindow: false,
    terminalInactivity: { [Faction.Compact]: inactive, [Faction.Choir]: inactive },
  };
}
