import { Faction } from '@sim/data';

export interface NarrativeBeat {
  id: string;
  kind: 'briefing' | 'transmission';
  speaker: string;
  faction: Faction | -1;
  title: string;
  body: string;
  blocking: boolean;
}

export interface NarrativeState {
  activeId: string | null;
  pendingIds: string[];
  deliveredIds: string[];
  acknowledgedIds: string[];
}

export interface NarrativeHudModel extends NarrativeBeat {}

export function emptyNarrativeState(): NarrativeState {
  return { activeId: null, pendingIds: [], deliveredIds: [], acknowledgedIds: [] };
}

export function enqueueNarrative(state: NarrativeState, id: string): void {
  if (state.deliveredIds.includes(id) || state.pendingIds.includes(id) || state.activeId === id) return;
  if (state.activeId === null) {
    state.activeId = id;
    state.deliveredIds.push(id);
  } else state.pendingIds.push(id);
}

export function acknowledgeNarrative(state: NarrativeState): void {
  if (state.activeId === null) return;
  state.acknowledgedIds.push(state.activeId);
  state.activeId = state.pendingIds.shift() ?? null;
  if (state.activeId !== null) state.deliveredIds.push(state.activeId);
}

export function validateNarrativeState(
  state: NarrativeState,
  knownIds: readonly string[],
  path: string,
  fail: (path: string, message: string) => never,
): NarrativeState {
  const all = [state.activeId, ...state.pendingIds, ...state.deliveredIds, ...state.acknowledgedIds]
    .filter((id): id is string => id !== null);
  if (all.length > 64) fail(path, 'contains too many narrative ids');
  if (all.some((id) => !knownIds.includes(id))) fail(path, 'contains an unknown narrative id');
  if (new Set(state.pendingIds).size !== state.pendingIds.length) fail(`${path}.pendingIds`, 'contains duplicates');
  if (new Set(state.deliveredIds).size !== state.deliveredIds.length) fail(`${path}.deliveredIds`, 'contains duplicates');
  if (new Set(state.acknowledgedIds).size !== state.acknowledgedIds.length) fail(`${path}.acknowledgedIds`, 'contains duplicates');
  if (state.activeId === null && state.pendingIds.length > 0) fail(path, 'pending narrative requires an active beat');
  if (state.pendingIds.some((id) => state.deliveredIds.includes(id))) {
    fail(`${path}.pendingIds`, 'pending beats must not already be delivered');
  }
  if (state.activeId !== null && !state.deliveredIds.includes(state.activeId)) {
    fail(`${path}.activeId`, 'must be delivered');
  }
  if (state.acknowledgedIds.some((id) => !state.deliveredIds.includes(id))) {
    fail(`${path}.acknowledgedIds`, 'must be delivered first');
  }
  if (state.activeId !== null && state.acknowledgedIds.includes(state.activeId)) {
    fail(`${path}.activeId`, 'cannot already be acknowledged');
  }
  if (state.pendingIds.some((id) => state.acknowledgedIds.includes(id))) {
    fail(`${path}.pendingIds`, 'cannot contain acknowledged beats');
  }
  const expectedDelivered = new Set([
    ...state.acknowledgedIds,
    ...(state.activeId === null ? [] : [state.activeId]),
  ]);
  if (state.deliveredIds.length !== expectedDelivered.size ||
      state.deliveredIds.some((id) => !expectedDelivered.has(id))) {
    fail(`${path}.deliveredIds`, 'must contain exactly acknowledged beats plus the active beat');
  }
  const scheduled = [...state.deliveredIds, ...state.pendingIds];
  const canonical = knownIds.filter((id) => scheduled.includes(id));
  if (scheduled.length !== canonical.length || scheduled.some((id, index) => id !== canonical[index])) {
    fail(path, 'narrative beats must remain in canonical order');
  }
  return structuredClone(state);
}
