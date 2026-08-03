import { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import type { PlayerAction } from './mission';

export interface CounterfireBindings {
  protectedAsset: number;
  defensePower: number;
  aegis: number;
  wisp: number;
  playerBattery: number;
  enemyLauncher: number;
  enemyGrid: number;
}

export interface CounterfireMilestones {
  incomingDetected: boolean;
  powerRestored: boolean;
  umbrellaActivated: boolean;
  defenseIntercepted: boolean;
  launcherScouted: boolean;
  standardFired: boolean;
  standardIntercepted: boolean;
  cruiseFired: boolean;
  launcherDestroyed: boolean;
  hostileShots: number;
  friendlyInterceptions: number;
  hostilePenetrations: number;
  counterfireShots: number;
  brownoutTicks: number;
  minimumPowerRatio: number;
  protectedStartHp: number;
  protectedEndHp: number;
  trackedStandardProjectileIds: number[];
  hostileProjectileIds: number[];
  milestoneTicks: Array<number | null>;
  failureReason: 'protected-asset-destroyed' | 'match-ended' | null;
}

export const COUNTERFIRE_OBJECTIVES = [
  {
    id: 'detect-barrage',
    title: 'Incoming fire',
    body: 'Identify the first Choir mortar launch against the forward works.',
    hint: 'The launch flash reveals the firing Longbow. Do not move the defence group out of position.',
  },
  {
    id: 'restore-defensive-power',
    title: 'Restore defensive power',
    body: 'Complete the emergency Fusion Core so powered interceptors can fire.',
    hint: 'Select the Engineer and right-click the unfinished Fusion Core to assist construction.',
  },
  {
    id: 'raise-umbrella',
    title: 'Raise the Umbrella',
    body: 'Activate the Aegis Umbrella around the protected Fabricator.',
    hint: 'Select the Aegis and press X. Keep it close enough to cover the Fabricator footprint.',
  },
  {
    id: 'intercept-barrage',
    title: 'Break the barrage',
    body: 'Intercept one hostile mortar while Umbrella is active.',
    hint: 'Power reserve must cover both the Umbrella rate and the interceptor pulse.',
  },
  {
    id: 'locate-launcher',
    title: 'Locate the launcher',
    body: 'Move the Wisp forward until the Choir Longbow is inside exact sensor visibility.',
    hint: 'Use the launch reveal as a bearing, then confirm the source with the Wisp.',
  },
  {
    id: 'test-grid',
    title: 'Test the grid',
    body: 'Fire a Standard Rocket at the Longbow and observe the Laser Grid interception.',
    hint: 'Select the Rocket Battery, choose Standard Rocket, and target the revealed launcher.',
  },
  {
    id: 'adapt-ammunition',
    title: 'Change the flight profile',
    body: 'Fire a Cruise Missile beneath the Laser Grid envelope.',
    hint: 'Cruise Missiles follow the surface below the grid interception altitude.',
  },
  {
    id: 'neutralize-launcher',
    title: 'End the counterfire duel',
    body: 'Destroy the Choir Longbow before the protected Fabricator falls.',
    hint: 'Continue Cruise Missile fire when ready. Standard and Cruise cooldowns are independent.',
  },
] as const;

export function emptyCounterfireMilestones(protectedStartHp = 0): CounterfireMilestones {
  return {
    incomingDetected: false,
    powerRestored: false,
    umbrellaActivated: false,
    defenseIntercepted: false,
    launcherScouted: false,
    standardFired: false,
    standardIntercepted: false,
    cruiseFired: false,
    launcherDestroyed: false,
    hostileShots: 0,
    friendlyInterceptions: 0,
    hostilePenetrations: 0,
    counterfireShots: 0,
    brownoutTicks: 0,
    minimumPowerRatio: 1,
    protectedStartHp,
    protectedEndHp: protectedStartHp,
    trackedStandardProjectileIds: [],
    hostileProjectileIds: [],
    milestoneTicks: Array.from({ length: COUNTERFIRE_OBJECTIVES.length }, () => null),
    failureReason: null,
  };
}

export function updateCounterfireMilestones(
  milestones: CounterfireMilestones,
  bindings: CounterfireBindings,
  world: World,
  events: readonly SimEvent[],
): CounterfireMilestones['failureReason'] {
  const asset = world.structureById(bindings.protectedAsset);
  if (asset && milestones.protectedStartHp <= 0) milestones.protectedStartHp = asset.maxHp;
  milestones.protectedEndHp = asset?.hp ?? 0;
  const powerRatio = world.powerRatio(Faction.Compact);
  milestones.minimumPowerRatio = Math.min(milestones.minimumPowerRatio, powerRatio);
  if (world.players[Faction.Compact].energyDrawn > world.players[Faction.Compact].energyProduced) {
    milestones.brownoutTicks++;
  }

  const interceptedIds = new Set(events.filter((event) => event.kind === 'intercepted').map((event) => event.id));
  for (const event of events) {
    if (event.kind === 'weaponFired' && event.id === bindings.enemyLauncher) {
      milestones.incomingDetected = true;
      milestones.hostileShots++;
      const projectileId = event.projectileId;
      if (projectileId && !milestones.hostileProjectileIds.includes(projectileId)) {
        if (milestones.hostileProjectileIds.length >= 64) milestones.hostileProjectileIds.shift();
        milestones.hostileProjectileIds.push(projectileId);
      }
    }
    const hostileProjectile = milestones.hostileProjectileIds.includes(event.id);
    if (event.kind === 'intercepted' && hostileProjectile &&
        event.faction === Faction.Compact && event.actorId === bindings.aegis) {
      milestones.defenseIntercepted = true;
      milestones.friendlyInterceptions++;
    }
    if (event.kind === 'intercepted' && event.actorId === bindings.enemyGrid &&
        milestones.trackedStandardProjectileIds.includes(event.id)) {
      milestones.standardIntercepted = true;
    }
    if (event.kind === 'impact' && hostileProjectile && !interceptedIds.has(event.id)) {
      milestones.hostilePenetrations++;
    }
    if (event.kind === 'structureDied' && event.id === bindings.enemyLauncher) {
      milestones.launcherDestroyed = true;
    }
    if (event.kind === 'unitDied' && event.id === bindings.enemyLauncher) {
      milestones.launcherDestroyed = true;
    }
  }
  milestones.trackedStandardProjectileIds = milestones.trackedStandardProjectileIds.filter((id) =>
    !interceptedIds.has(id) && world.projectiles.some((projectile) => projectile.alive && projectile.id === id));
  const resolvedHostile = new Set(events.filter((event) => event.kind === 'impact').map((event) => event.id));
  milestones.hostileProjectileIds = milestones.hostileProjectileIds.filter((id) =>
    !resolvedHostile.has(id) && world.projectiles.some((projectile) => projectile.alive && projectile.id === id));
  const power = world.structureById(bindings.defensePower);
  milestones.powerRestored ||= Boolean(power?.progress === 1);
  const aegis = world.unitById(bindings.aegis);
  milestones.umbrellaActivated ||= Boolean(aegis?.ability?.id === 'umbrella' && aegis.ability.active);
  const launcher = world.unitById(bindings.enemyLauncher) ?? world.structureById(bindings.enemyLauncher);
  if (launcher) milestones.launcherScouted ||= world.hasExactSensorContactFrom(
    bindings.wisp, Faction.Compact, launcher.s, launcher.z,
  );
  milestones.launcherDestroyed ||= !launcher;

  const states = [
    milestones.incomingDetected,
    milestones.powerRestored,
    milestones.umbrellaActivated,
    milestones.defenseIntercepted,
    milestones.launcherScouted,
    milestones.standardFired && milestones.standardIntercepted,
    milestones.cruiseFired,
    milestones.launcherDestroyed,
  ];
  for (let index = 0; index < states.length; index++) {
    if (states[index] && milestones.milestoneTicks[index] === null) milestones.milestoneTicks[index] = world.tick;
  }
  if (!asset) return (milestones.failureReason = 'protected-asset-destroyed');
  if (world.status === 'completed') return (milestones.failureReason = 'match-ended');
  return null;
}

export function observeCounterfireAction(
  milestones: CounterfireMilestones,
  action: PlayerAction,
  world: World,
): void {
  if (action.kind !== 'artillery-fired') return;
  const source = world.structureById(action.sourceId);
  if (!source?.alive || source.faction !== Faction.Compact ||
      source.kind !== 'rocketBattery' || source.progress < 1) return;
  milestones.counterfireShots++;
  if (action.weaponId === 'batteryGun') {
    milestones.standardFired = true;
    const projectile = action.projectileId === undefined
      ? undefined
      : world.projectiles.find((candidate) => candidate.id === action.projectileId);
    if (projectile && !milestones.trackedStandardProjectileIds.includes(projectile.id)) {
      milestones.trackedStandardProjectileIds = milestones.trackedStandardProjectileIds.filter((id) =>
        world.projectiles.some((candidate) => candidate.alive && candidate.id === id));
      if (milestones.trackedStandardProjectileIds.length >= 64) milestones.trackedStandardProjectileIds.shift();
      milestones.trackedStandardProjectileIds.push(projectile.id);
    }
  } else if (action.weaponId === 'cruiseMissile') {
    milestones.cruiseFired = true;
    if (milestones.milestoneTicks[6] === null) milestones.milestoneTicks[6] = world.tick;
  }
}

export function counterfireObjectiveMet(milestones: CounterfireMilestones, objectiveIndex: number): boolean {
  switch (COUNTERFIRE_OBJECTIVES[objectiveIndex]?.id) {
    case 'detect-barrage': return milestones.incomingDetected;
    case 'restore-defensive-power': return milestones.powerRestored;
    case 'raise-umbrella': return milestones.umbrellaActivated;
    case 'intercept-barrage': return milestones.defenseIntercepted;
    case 'locate-launcher': return milestones.launcherScouted;
    case 'test-grid': return milestones.standardFired && milestones.standardIntercepted;
    case 'adapt-ammunition': return milestones.cruiseFired;
    case 'neutralize-launcher': return milestones.launcherDestroyed;
    default: return false;
  }
}
