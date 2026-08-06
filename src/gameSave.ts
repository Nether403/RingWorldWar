import type { AiOpponent } from '@ai/opponent';
import {
  MATCH_SESSION_SCHEMA,
  createMatchSessionSnapshot,
  deserializeMatchSession,
  parseMatchSessionSnapshot,
  type MatchSessionSnapshot,
} from '@headless/session';
import type { Terrain } from '@gen/terrain';
import { Faction, other } from '@sim/data';
import { SnapshotValidationError } from '@sim/serialize';
import type { World } from '@sim/world';
import {
  MissionController,
  parseMissionSnapshot,
  type MissionSnapshot,
} from './tutorial/mission';

export const GAME_SAVE_SCHEMA = 'ring-world-war/game-save';
export const GAME_SAVE_VERSION = 2;
export const MAX_GAME_SAVE_BYTES = 2 * 1024 * 1024;

export interface GameSaveSnapshot {
  schema: typeof GAME_SAVE_SCHEMA;
  version: typeof GAME_SAVE_VERSION;
  session: MatchSessionSnapshot;
  aiEnabled: boolean;
  mission: MissionSnapshot | null;
  playerFaction: Faction;
  opponentFaction: Faction;
}

export interface RestoredGameSave {
  world: World;
  controllers: [AiOpponent, AiOpponent];
  aiEnabled: boolean;
  mission: MissionController | null;
  playerFaction: Faction;
  opponentFaction: Faction;
}

export function createGameSaveSnapshot(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
  aiEnabled: boolean,
  mission: MissionSnapshot | null,
  playerFaction: Faction,
  opponentFaction: Faction,
): GameSaveSnapshot {
  assertFactionPair(playerFaction, opponentFaction);
  return {
    schema: GAME_SAVE_SCHEMA,
    version: GAME_SAVE_VERSION,
    session: createMatchSessionSnapshot(world, controllers),
    aiEnabled,
    mission: mission ? structuredClone(mission) : null,
    playerFaction,
    opponentFaction,
  };
}

export function serializeGameSave(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
  aiEnabled: boolean,
  mission: MissionSnapshot | null,
  playerFaction: Faction,
  opponentFaction: Faction,
): string {
  const snapshot = createGameSaveSnapshot(
    world,
    controllers,
    aiEnabled,
    mission,
    playerFaction,
    opponentFaction,
  );
  // Saving must enforce every load-time structural bound before replacing the
  // browser's previous valid slot.
  parseGameSaveSnapshot(snapshot);
  const serialized = JSON.stringify(snapshot);
  assertGameSaveSize(serialized);
  return serialized;
}

export function parseGameSaveSnapshot(input: unknown): GameSaveSnapshot {
  if (typeof input === 'string' && input.length > MAX_GAME_SAVE_BYTES) {
    assertGameSaveSize(input);
  }
  const value = typeof input === 'string' ? parseJson(input) : input;
  if (isRecord(value) && value.schema === MATCH_SESSION_SCHEMA) {
    return {
      schema: GAME_SAVE_SCHEMA,
      version: GAME_SAVE_VERSION,
      session: parseMatchSessionSnapshot(value),
      aiEnabled: true,
      mission: null,
      playerFaction: Faction.Compact,
      opponentFaction: Faction.Choir,
    };
  }
  if (!isRecord(value)) fail('$', 'expected an object');
  const version = value.version;
  const fields = version === 1
    ? ['schema', 'version', 'session', 'aiEnabled', 'mission']
    : ['schema', 'version', 'session', 'aiEnabled', 'mission', 'playerFaction', 'opponentFaction'];
  const root = object(value, '$', fields);
  if (root.schema !== GAME_SAVE_SCHEMA) fail('$.schema', `expected ${GAME_SAVE_SCHEMA}`);
  if (version !== 1 && version !== GAME_SAVE_VERSION) {
    fail('$.version', `expected version 1 or ${GAME_SAVE_VERSION}`);
  }
  if (typeof root.aiEnabled !== 'boolean') fail('$.aiEnabled', 'expected a boolean');
  const playerFaction = version === 1
    ? Faction.Compact
    : faction(root.playerFaction, '$.playerFaction');
  const opponentFaction = version === 1
    ? Faction.Choir
    : faction(root.opponentFaction, '$.opponentFaction');
  assertFactionPair(playerFaction, opponentFaction);
  let mission: MissionSnapshot | null = null;
  if (root.mission !== null) {
    try {
      mission = parseMissionSnapshot(root.mission);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SnapshotValidationError(`$.mission: ${message}`);
    }
  }
  return {
    schema: GAME_SAVE_SCHEMA,
    version: GAME_SAVE_VERSION,
    session: parseMatchSessionSnapshot(root.session),
    aiEnabled: root.aiEnabled,
    mission,
    playerFaction,
    opponentFaction,
  };
}

function assertGameSaveSize(serialized: string): void {
  if (serialized.length > MAX_GAME_SAVE_BYTES) {
    throw new SnapshotValidationError(`$: save exceeds ${MAX_GAME_SAVE_BYTES} byte size limit`);
  }
}

export function deserializeGameSave(input: unknown, terrain: Terrain): RestoredGameSave {
  const snapshot = parseGameSaveSnapshot(input);
  const session = deserializeMatchSession(snapshot.session, terrain);
  return {
    ...session,
    aiEnabled: snapshot.aiEnabled,
    mission: snapshot.mission ? MissionController.fromSnapshot(snapshot.mission, session.world) : null,
    playerFaction: snapshot.playerFaction,
    opponentFaction: snapshot.opponentFaction,
  };
}

function faction(value: unknown, path: string): Faction {
  if (value !== Faction.Compact && value !== Faction.Choir) fail(path, 'expected a faction');
  return value;
}

function assertFactionPair(playerFaction: Faction, opponentFaction: Faction): void {
  faction(playerFaction, '$.playerFaction');
  faction(opponentFaction, '$.opponentFaction');
  if (opponentFaction !== other(playerFaction)) {
    fail('$.opponentFaction', 'must be the opposing faction');
  }
}

function object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of fields) if (!(key in value)) fail(`${path}.${key}`, 'missing field');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return fail('$', 'invalid JSON');
  }
}

function fail(path: string, message: string): never {
  throw new SnapshotValidationError(`${path}: ${message}`);
}
