import type { UnitKind } from './data';

export type AbilityId = 'shieldWall' | 'siegeMode' | 'cloak' | 'umbrella';

export interface AbilityState {
  id: AbilityId;
  active: boolean;
  cooldown: number;
  transitionTimer: number;
}

interface BaseAbilityDef {
  id: AbilityId;
  unitKinds: readonly UnitKind[];
  energyPerSecond: number;
  cooldownAfterDeactivation: number;
}

export interface ShieldWallDef extends BaseAbilityDef {
  id: 'shieldWall';
  speedMultiplier: number;
  damageMultiplier: number;
  forwardArc: number;
}

export interface SiegeModeDef extends BaseAbilityDef {
  id: 'siegeMode';
  rangeMultiplier: number;
  fireRateMultiplier: number;
  transitionDuration: number;
}

export interface CloakDef extends BaseAbilityDef {
  id: 'cloak';
  stationaryDelay: number;
  detectionRadius: number;
  breakRevealTime: number;
}

export interface UmbrellaDef extends BaseAbilityDef {
  id: 'umbrella';
  protectionRadius: number;
  baseProtectionRadius: number;
}

export type AbilityDef = ShieldWallDef | SiegeModeDef | CloakDef | UmbrellaDef;

export const ABILITIES = {
  shieldWall: {
    id: 'shieldWall',
    unitKinds: ['vanguard', 'bulwark'],
    energyPerSecond: 3,
    cooldownAfterDeactivation: 5,
    speedMultiplier: 0.6,
    damageMultiplier: 0.5,
    forwardArc: (Math.PI * 2) / 3,
  },
  siegeMode: {
    id: 'siegeMode',
    unitKinds: ['longbow'],
    energyPerSecond: 0,
    cooldownAfterDeactivation: 0,
    rangeMultiplier: 1.5,
    fireRateMultiplier: 1.5,
    transitionDuration: 3,
  },
  cloak: {
    id: 'cloak',
    unitKinds: ['wisp', 'needle'],
    energyPerSecond: 0,
    cooldownAfterDeactivation: 0,
    stationaryDelay: 1.5,
    detectionRadius: 30,
    breakRevealTime: 1.5,
  },
  umbrella: {
    id: 'umbrella',
    unitKinds: ['aegis'],
    energyPerSecond: 6,
    cooldownAfterDeactivation: 8,
    protectionRadius: 120,
    baseProtectionRadius: 35,
  },
} as const satisfies Record<AbilityId, AbilityDef>;

export function createAbilityState(kind: UnitKind): AbilityState | null {
  for (const ability of Object.values(ABILITIES)) {
    if ((ability.unitKinds as readonly UnitKind[]).includes(kind)) {
      return { id: ability.id, active: false, cooldown: 0, transitionTimer: 0 };
    }
  }
  return null;
}
