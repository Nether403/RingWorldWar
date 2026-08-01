import { AiOpponent, type Difficulty } from '@ai/opponent';
import { SIM_DT } from '@core/constants';
import { createTerrain, type Terrain } from '@gen/terrain';
import { Faction, type StructureKind, type UnitKind } from '@sim/data';
import {
  World,
  type MatchStatus,
  type OrderKind,
  type SimEvent,
} from '@sim/world';

export interface HeadlessMatchConfig {
  seed: number;
  factions: readonly [Faction, Faction];
  difficulties: readonly [Difficulty, Difficulty];
  tickLimit: number;
}

export interface EconomyResult {
  startingSalvage: number;
  salvageGathered: number;
  salvageSpent: number;
  endingSalvage: number;
  endingEnergyProduced: number;
  endingEnergyDrawn: number;
  dominance: number;
}

export interface FactionMatchResult {
  economy: EconomyResult;
  unitsProduced: Record<UnitKind, number>;
  unitsLost: Record<UnitKind, number>;
  structuresDestroyed: Record<StructureKind, number>;
}

export interface MatchResult {
  seed: number;
  status: MatchStatus;
  winner: Faction | null;
  durationTicks: number;
  durationSeconds: number;
  endReason: string;
  factions: Record<Faction, FactionMatchResult>;
}

export interface HeadlessPlayerObservation {
  readonly salvage: number;
  readonly energyProduced: number;
  readonly energyDrawn: number;
  readonly weaponEnergyLoad: number;
  readonly dominance: number;
}

export interface HeadlessUnitObservation {
  readonly id: number;
  readonly alive: boolean;
  readonly faction: Faction;
  readonly kind: UnitKind;
  readonly targetId: number;
  readonly order: {
    readonly kind: OrderKind;
    readonly targetId: number;
  };
}

export interface HeadlessStructureObservation {
  readonly id: number;
  readonly alive: boolean;
  readonly faction: Faction | -1;
  readonly kind: StructureKind;
  readonly hp: number;
  readonly maxHp: number;
  readonly targetId: number;
  readonly queue: readonly UnitKind[];
}

export interface HeadlessMatchObservation {
  readonly tick: number;
  readonly time: number;
  readonly status: MatchStatus;
  readonly winner: Faction | null;
  readonly endReason: string;
  readonly players: Readonly<Record<Faction, HeadlessPlayerObservation>>;
  readonly units: readonly HeadlessUnitObservation[];
  readonly structures: readonly HeadlessStructureObservation[];
  readonly events: readonly Readonly<SimEvent>[];
}

export type HeadlessMatchObserver = (observation: HeadlessMatchObservation) => void;

export interface HeadlessBatchSummary {
  matches: number;
  wins: Record<Faction, number>;
  draws: number;
  averageDurationSeconds: number;
  averageSalvageGathered: Record<Faction, number>;
  averageUnitsProduced: Record<Faction, number>;
  averageUnitsLost: Record<Faction, number>;
  averageStructuresDestroyed: Record<Faction, number>;
  endReasons: Record<string, number>;
}

export type TerrainFactory = (seed: number) => Terrain;

export function runHeadlessMatch(
  config: HeadlessMatchConfig,
  terrain: Terrain = createTerrain(config.seed),
  observer?: HeadlessMatchObserver,
): MatchResult {
  validateConfig(config);
  const world = new World(terrain, config.seed, config.tickLimit * SIM_DT);
  world.setup();
  const controllers: [AiOpponent, AiOpponent] = [
    new AiOpponent(
      config.factions[0],
      config.difficulties[0],
      controllerSeed(config.seed, config.factions[0], 0),
    ),
    new AiOpponent(
      config.factions[1],
      config.difficulties[1],
      controllerSeed(config.seed, config.factions[1], 1),
    ),
  ];
  const factions = createFactionResults(world);

  for (let tick = 0; tick < config.tickLimit && world.status === 'running'; tick++) {
    const compactBeforeStep = world.players[Faction.Compact].salvage;
    const choirBeforeStep = world.players[Faction.Choir].salvage;
    world.step();
    recordSalvageChange(factions, world, compactBeforeStep, choirBeforeStep);

    if (world.status === 'running') {
      const compactBeforeControllers = world.players[Faction.Compact].salvage;
      const choirBeforeControllers = world.players[Faction.Choir].salvage;
      for (const controller of controllers) controller.update(world, SIM_DT);
      recordSalvageChange(factions, world, compactBeforeControllers, choirBeforeControllers);
    }
    const events = world.drainEvents();
    recordEvents(factions, events);
    observer?.({
      tick: world.tick,
      time: world.time,
      status: world.status,
      winner: world.winner,
      endReason: world.endReason,
      players: world.players,
      units: world.units,
      structures: world.structures,
      events,
    });
  }

  if (world.status !== 'completed') {
    throw new Error('World did not resolve the configured headless time cap');
  }
  for (const faction of [Faction.Compact, Faction.Choir]) {
    const player = world.players[faction];
    const economy = factions[faction].economy;
    economy.endingSalvage = player.salvage;
    economy.endingEnergyProduced = player.energyProduced;
    economy.endingEnergyDrawn = player.energyDrawn;
    economy.dominance = player.dominance;
  }

  return {
    seed: config.seed,
    status: world.status,
    winner: world.winner,
    durationTicks: world.tick,
    durationSeconds: world.time,
    endReason: world.endReason,
    factions,
  };
}

export function runHeadlessBatch(
  configs: readonly HeadlessMatchConfig[],
  terrainFactory: TerrainFactory = createTerrain,
): MatchResult[] {
  return configs.map((config) => runHeadlessMatch(config, terrainFactory(config.seed)));
}

export function summarizeHeadlessResults(results: readonly MatchResult[]): HeadlessBatchSummary {
  const wins: Record<Faction, number> = {
    [Faction.Compact]: 0,
    [Faction.Choir]: 0,
  };
  const endReasons: Record<string, number> = {};
  const salvageGathered = emptyFactionTotals();
  const unitsProduced = emptyFactionTotals();
  const unitsLost = emptyFactionTotals();
  const structuresDestroyed = emptyFactionTotals();
  let duration = 0;
  let draws = 0;
  for (const result of results) {
    if (result.winner === null) draws++;
    else wins[result.winner]++;
    duration += result.durationSeconds;
    endReasons[result.endReason] = (endReasons[result.endReason] ?? 0) + 1;
    for (const faction of [Faction.Compact, Faction.Choir]) {
      const factionResult = result.factions[faction];
      salvageGathered[faction] += factionResult.economy.salvageGathered;
      unitsProduced[faction] += countTotal(factionResult.unitsProduced);
      unitsLost[faction] += countTotal(factionResult.unitsLost);
      structuresDestroyed[faction] += countTotal(factionResult.structuresDestroyed);
    }
  }
  return {
    matches: results.length,
    wins,
    draws,
    averageDurationSeconds: results.length === 0 ? 0 : duration / results.length,
    averageSalvageGathered: averages(salvageGathered, results.length),
    averageUnitsProduced: averages(unitsProduced, results.length),
    averageUnitsLost: averages(unitsLost, results.length),
    averageStructuresDestroyed: averages(structuresDestroyed, results.length),
    endReasons,
  };
}

function createFactionResults(world: World): Record<Faction, FactionMatchResult> {
  return {
    [Faction.Compact]: createFactionResult(world.players[Faction.Compact].salvage),
    [Faction.Choir]: createFactionResult(world.players[Faction.Choir].salvage),
  };
}

function createFactionResult(startingSalvage: number): FactionMatchResult {
  return {
    economy: {
      startingSalvage,
      salvageGathered: 0,
      salvageSpent: 0,
      endingSalvage: startingSalvage,
      endingEnergyProduced: 0,
      endingEnergyDrawn: 0,
      dominance: 0,
    },
    unitsProduced: emptyUnitCounts(),
    unitsLost: emptyUnitCounts(),
    structuresDestroyed: emptyStructureCounts(),
  };
}

function recordSalvageChange(
  results: Record<Faction, FactionMatchResult>,
  world: World,
  compactBefore: number,
  choirBefore: number,
): void {
  recordFactionSalvageChange(
    results[Faction.Compact],
    world.players[Faction.Compact].salvage - compactBefore,
  );
  recordFactionSalvageChange(
    results[Faction.Choir],
    world.players[Faction.Choir].salvage - choirBefore,
  );
}

function recordFactionSalvageChange(result: FactionMatchResult, delta: number): void {
  if (delta > 0) result.economy.salvageGathered += delta;
  else if (delta < 0) result.economy.salvageSpent -= delta;
}

function recordEvents(results: Record<Faction, FactionMatchResult>, events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'unitComplete' && isFaction(event.faction) && isUnitKind(event.entityKind)) {
      results[event.faction].unitsProduced[event.entityKind]++;
    } else if (event.kind === 'unitDied' && isFaction(event.faction) && isUnitKind(event.entityKind)) {
      results[event.faction].unitsLost[event.entityKind]++;
    } else if (
      event.kind === 'structureDied' &&
      event.sourceFaction !== undefined &&
      isStructureKind(event.entityKind)
    ) {
      results[event.sourceFaction].structuresDestroyed[event.entityKind]++;
    }
  }
}

function emptyUnitCounts(): Record<UnitKind, number> {
  return { engineer: 0, vanguard: 0, longbow: 0, wisp: 0, aegis: 0 };
}

function emptyStructureCounts(): Record<StructureKind, number> {
  return {
    bastion: 0,
    extractor: 0,
    solarArray: 0,
    fusionCore: 0,
    fabricator: 0,
    mechFoundry: 0,
    rocketBattery: 0,
    pointDefense: 0,
    laserGrid: 0,
    radarMast: 0,
    silo: 0,
    spinalNode: 0,
  };
}

function emptyFactionTotals(): Record<Faction, number> {
  return { [Faction.Compact]: 0, [Faction.Choir]: 0 };
}

function averages(totals: Record<Faction, number>, count: number): Record<Faction, number> {
  if (count === 0) return emptyFactionTotals();
  return {
    [Faction.Compact]: totals[Faction.Compact] / count,
    [Faction.Choir]: totals[Faction.Choir] / count,
  };
}

function countTotal(counts: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const count of Object.values(counts)) total += count;
  return total;
}

function isFaction(value: Faction | -1): value is Faction {
  return value === Faction.Compact || value === Faction.Choir;
}

function isUnitKind(value: SimEvent['entityKind']): value is UnitKind {
  return value === 'engineer' || value === 'vanguard' || value === 'longbow' || value === 'wisp' || value === 'aegis';
}

function isStructureKind(value: SimEvent['entityKind']): value is StructureKind {
  return value === 'bastion' || value === 'extractor' || value === 'solarArray' ||
    value === 'fusionCore' || value === 'fabricator' || value === 'mechFoundry' ||
    value === 'rocketBattery' || value === 'pointDefense' || value === 'laserGrid' ||
    value === 'radarMast' || value === 'silo' || value === 'spinalNode';
}

function validateConfig(config: HeadlessMatchConfig): void {
  if (!Number.isSafeInteger(config.seed)) throw new TypeError('Headless seed must be a safe integer');
  if (!Number.isSafeInteger(config.tickLimit) || config.tickLimit <= 0) {
    throw new TypeError('Headless tickLimit must be a positive safe integer');
  }
  if (config.factions[0] === config.factions[1]) {
    throw new TypeError('Headless matches require the two distinct factions');
  }
  for (const faction of config.factions) {
    if (faction !== Faction.Compact && faction !== Faction.Choir) throw new TypeError('Invalid faction');
  }
  for (const difficulty of config.difficulties) {
    if (difficulty !== 'recruit' && difficulty !== 'veteran' && difficulty !== 'commander') {
      throw new TypeError('Invalid difficulty');
    }
  }
}

function controllerSeed(seed: number, faction: Faction, index: number): number {
  return (seed ^ Math.imul(faction + 1, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
}
