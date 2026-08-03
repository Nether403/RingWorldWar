import { RING_CIRCUMFERENCE } from '@core/constants';

/**
 * Game data.
 *
 * Every balance number in the game lives here, so tuning never requires
 * touching a system. The systems read these tables and nothing else.
 *
 * Ranges are chosen around the ring's physics rather than the other way round.
 * Artillery reaches roughly 4x further antispinward than spinward, so the
 * numbers below are the *nominal* launch speed; the actual reachable footprint
 * is lopsided and is computed by the aim solver at runtime.
 */

export const enum Faction {
  Compact = 0,
  Choir = 1,
}

export const FACTION_COLOR: Record<Faction, number> = {
  [Faction.Compact]: 0xf0821e,
  [Faction.Choir]: 0x3fd0e8,
};

export const FACTION_NAME: Record<Faction, string> = {
  [Faction.Compact]: 'Meridian Compact',
  [Faction.Choir]: 'Axiom Choir',
};

export interface FactionModifiers {
  buildTimeMultiplier: number;
  visionMultiplier: number;
  mechHpMultiplier: number;
  ballisticCostMultiplier: number;
}

export const FACTION_MODS: Record<Faction, FactionModifiers> = {
  [Faction.Compact]: {
    buildTimeMultiplier: 1,
    visionMultiplier: 1,
    mechHpMultiplier: 1.15,
    ballisticCostMultiplier: 0.85,
  },
  [Faction.Choir]: {
    buildTimeMultiplier: 0.85,
    visionMultiplier: 1.2,
    mechHpMultiplier: 0.85,
    ballisticCostMultiplier: 1,
  },
};

export function other(f: Faction): Faction {
  return f === Faction.Compact ? Faction.Choir : Faction.Compact;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface Cost {
  /** Scrith salvage: the general build currency. */
  salvage?: number;
  /** Command points: the cap on fielded mechs. Refunded on death. */
  command?: number;
}

/** Starting stockpile. Enough to open with a choice, not enough to skip one. */
export const STARTING_SALVAGE = 850;
export const STARTING_COMMAND = 4;

/** Energy is a rate, not a stockpile: production must exceed draw. */
export const BASE_ENERGY = 6;

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type DamageType = 'kinetic' | 'explosive' | 'energy';
export type ArmorClass = 'light' | 'medium' | 'heavy' | 'structure';

/**
 * Damage multiplier table. Kinetic shreds light armour but struggles against
 * heavy; explosives are the reverse; energy is even but costs power. This is
 * what makes unit composition matter rather than raw unit count.
 */
export const DAMAGE_TABLE: Record<DamageType, Record<ArmorClass, number>> = {
  kinetic: { light: 1.35, medium: 1.0, heavy: 0.6, structure: 0.55 },
  explosive: { light: 0.8, medium: 1.05, heavy: 1.3, structure: 1.5 },
  energy: { light: 1.0, medium: 1.0, heavy: 1.0, structure: 0.85 },
};

export type WeaponKind = 'direct' | 'ballistic' | 'interceptor';

export interface WeaponDef {
  id: string;
  kind: WeaponKind;
  damage: number;
  damageType: DamageType;
  /** Seconds between shots. */
  cooldown: number;
  /** Metres. For ballistic weapons this is advisory; the solver decides. */
  range: number;
  /** Shots fired per trigger pull. */
  burst?: number;
  burstDelay?: number;
  /** Ballistic only: nominal launch speed, m/s. */
  launchSpeed?: number;
  /** Ballistic only: splash radius, metres. */
  splash?: number;
  /** Projectile travel speed for direct fire, m/s. 0 = hitscan. */
  projectileSpeed?: number;
  /** One-second transient power draw added by each accepted shot. */
  energyPerShot?: number;
  /** Degrees of spread. */
  spread?: number;
  muzzleFlashScale?: number;
  /** Non-standard ballistic propagation. Omitted means a conventional arc. */
  flightMode?: 'cruise' | 'chord';
  /** Cruise only: height maintained above the local terrain. */
  cruiseAltitude?: number;
  /** Interceptors may require a healthy power network rather than degrading. */
  minPowerRatio?: number;
  /** Optional per-weapon drag resistance; larger values retain speed better. */
  ballisticCoefficient?: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  autocannon: {
    id: 'autocannon',
    kind: 'direct',
    damage: 34,
    damageType: 'kinetic',
    cooldown: 1.5,
    range: 190,
    burst: 3,
    burstDelay: 0.11,
    projectileSpeed: 420,
    spread: 1.4,
    muzzleFlashScale: 1,
  },
  siegeMortar: {
    id: 'siegeMortar',
    kind: 'ballistic',
    damage: 190,
    damageType: 'explosive',
    cooldown: 7.5,
    range: 2600,
    launchSpeed: 118,
    splash: 26,
    energyPerShot: 4,
    muzzleFlashScale: 2.2,
  },
  scoutRepeater: {
    id: 'scoutRepeater',
    kind: 'direct',
    damage: 14,
    damageType: 'kinetic',
    cooldown: 0.85,
    range: 140,
    burst: 4,
    burstDelay: 0.07,
    projectileSpeed: 520,
    spread: 2.2,
    muzzleFlashScale: 0.6,
  },
  interceptorBattery: {
    id: 'interceptorBattery',
    kind: 'interceptor',
    damage: 100,
    damageType: 'energy',
    cooldown: 0.7,
    range: 260,
    energyPerShot: 2,
    muzzleFlashScale: 0.5,
  },
  aegisCannon: {
    id: 'aegisCannon',
    kind: 'direct',
    damage: 26,
    damageType: 'energy',
    cooldown: 1.1,
    range: 165,
    burst: 2,
    burstDelay: 0.1,
    projectileSpeed: 600,
    energyPerShot: 1,
    muzzleFlashScale: 0.8,
  },
  needleLance: {
    id: 'needleLance',
    kind: 'direct',
    damage: 22,
    damageType: 'energy',
    cooldown: 0.7,
    range: 175,
    burst: 2,
    burstDelay: 0.08,
    projectileSpeed: 680,
    energyPerShot: 1,
    spread: 0.7,
    muzzleFlashScale: 0.55,
  },
  batteryGun: {
    id: 'batteryGun',
    kind: 'ballistic',
    damage: 240,
    damageType: 'explosive',
    cooldown: 9,
    range: 4200,
    launchSpeed: 132,
    splash: 34,
    energyPerShot: 6,
    muzzleFlashScale: 3,
  },
  cruiseMissile: {
    id: 'cruiseMissile',
    kind: 'ballistic',
    damage: 380,
    damageType: 'explosive',
    cooldown: 18,
    range: 3800,
    launchSpeed: 55,
    splash: 30,
    energyPerShot: 10,
    muzzleFlashScale: 2.5,
    flightMode: 'cruise',
    cruiseAltitude: 50,
  },
  chordShot: {
    id: 'chordShot',
    kind: 'ballistic',
    damage: 1200,
    damageType: 'explosive',
    cooldown: 45,
    range: RING_CIRCUMFERENCE * 0.5,
    // Verified against the 1400 m atmosphere with the heavy-round drag profile.
    launchSpeed: 400,
    splash: 50,
    energyPerShot: 30,
    muzzleFlashScale: 4,
    flightMode: 'chord',
    ballisticCoefficient: 60_000,
  },
  gridLaser: {
    id: 'gridLaser',
    kind: 'interceptor',
    damage: 100,
    damageType: 'energy',
    cooldown: 1.25,
    range: 800,
    energyPerShot: 8,
    muzzleFlashScale: 1.5,
    minPowerRatio: 0.75,
  },
  pdLaser: {
    id: 'pdLaser',
    kind: 'interceptor',
    damage: 100,
    damageType: 'energy',
    cooldown: 0.45,
    range: 330,
    energyPerShot: 2,
    muzzleFlashScale: 0.4,
  },
  bastionGun: {
    id: 'bastionGun',
    kind: 'direct',
    damage: 44,
    damageType: 'kinetic',
    cooldown: 1.4,
    range: 230,
    burst: 2,
    burstDelay: 0.12,
    projectileSpeed: 460,
    muzzleFlashScale: 1.2,
  },
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type UnitKind =
  | 'vanguard'
  | 'longbow'
  | 'wisp'
  | 'aegis'
  | 'bulwark'
  | 'needle'
  | 'engineer';

export interface UnitDef {
  kind: UnitKind;
  name: string;
  /** One line the UI shows. Says what it is FOR, not what it is. */
  role: string;
  cost: Cost;
  buildTime: number;
  hp: number;
  armor: ArmorClass;
  /** Metres per second. */
  speed: number;
  /** Radians per second. */
  turnRate: number;
  /** Sight radius, metres. */
  vision: number;
  /** Collision / selection radius, metres. */
  radius: number;
  height: number;
  weapons: string[];
  /** True for the four mech classes; engineers are support. */
  isMech: boolean;
  /** Can construct structures. */
  canBuild?: boolean;
  /** Passive energy draw while alive. */
  upkeep?: number;
  /** Omitted means both factions. */
  availableTo?: readonly Faction[];
}

export const UNITS: Record<UnitKind, UnitDef> = {
  engineer: {
    kind: 'engineer',
    name: 'Engineer',
    role: 'Builds structures and repairs. Unarmed and fragile.',
    cost: { salvage: 90 },
    buildTime: 7,
    hp: 240,
    armor: 'light',
    speed: 17,
    turnRate: 2.6,
    vision: 180,
    radius: 3,
    height: 4,
    weapons: [],
    isMech: false,
    canBuild: true,
  },
  vanguard: {
    kind: 'vanguard',
    name: 'Vanguard',
    role: 'Front-line brawler. Absorbs damage and holds chokepoints.',
    cost: { salvage: 420, command: 2 },
    buildTime: 22,
    hp: 2600,
    armor: 'heavy',
    speed: 10.5,
    turnRate: 1.0,
    vision: 240,
    radius: 5.5,
    height: 11,
    weapons: ['autocannon', 'autocannon'],
    isMech: true,
    upkeep: 1,
  },
  longbow: {
    kind: 'longbow',
    name: 'Longbow',
    role: 'Mobile artillery. Outranges everything, dies to anything fast.',
    cost: { salvage: 520, command: 2 },
    buildTime: 26,
    hp: 1250,
    armor: 'medium',
    speed: 8.5,
    turnRate: 0.8,
    vision: 300,
    radius: 5,
    height: 10,
    weapons: ['siegeMortar'],
    isMech: true,
    upkeep: 3,
  },
  wisp: {
    kind: 'wisp',
    name: 'Wisp',
    role: 'Scout. Spots for artillery and finds the flank.',
    cost: { salvage: 220, command: 1 },
    buildTime: 12,
    hp: 620,
    armor: 'light',
    speed: 23,
    turnRate: 3.0,
    vision: 520,
    radius: 3.4,
    height: 7,
    weapons: ['scoutRepeater'],
    isMech: true,
    upkeep: 1,
  },
  aegis: {
    kind: 'aegis',
    name: 'Aegis',
    role: 'Mobile point defence. Escorts a push through incoming fire.',
    cost: { salvage: 470, command: 2 },
    buildTime: 24,
    hp: 1700,
    armor: 'medium',
    speed: 11,
    turnRate: 1.2,
    vision: 300,
    radius: 5,
    height: 9,
    weapons: ['aegisCannon', 'interceptorBattery'],
    isMech: true,
    upkeep: 4,
  },
  bulwark: {
    kind: 'bulwark',
    name: 'Bulwark',
    role: 'Compact escort walker. Locks down a corridor and shields a restoration team.',
    cost: { salvage: 610, command: 3 },
    buildTime: 30,
    hp: 3600,
    armor: 'heavy',
    speed: 7.8,
    turnRate: 0.78,
    vision: 230,
    radius: 6.3,
    height: 12,
    weapons: ['autocannon', 'autocannon'],
    isMech: true,
    upkeep: 3,
    availableTo: [Faction.Compact],
  },
  needle: {
    kind: 'needle',
    name: 'Needle',
    role: 'Choir cloaked hunter. Raids Engineers, spotters, and artillery.',
    cost: { salvage: 330, command: 1 },
    buildTime: 16,
    hp: 760,
    armor: 'light',
    speed: 25,
    turnRate: 3.2,
    vision: 420,
    radius: 3.2,
    height: 8,
    weapons: ['needleLance'],
    isMech: true,
    upkeep: 2,
    availableTo: [Faction.Choir],
  },
};

export function canFactionFieldUnit(faction: Faction, kind: UnitKind): boolean {
  return UNITS[kind].availableTo?.includes(faction) ?? true;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export type StructureKind =
  | 'bastion'
  | 'extractor'
  | 'solarArray'
  | 'fusionCore'
  | 'fabricator'
  | 'mechFoundry'
  | 'rocketBattery'
  | 'pointDefense'
  | 'laserGrid'
  | 'radarMast'
  | 'silo'
  | 'spinalNode';

export interface StructureDef {
  kind: StructureKind;
  name: string;
  role: string;
  cost: Cost;
  buildTime: number;
  hp: number;
  armor: ArmorClass;
  radius: number;
  height: number;
  vision: number;
  weapons: string[];
  /** Energy produced (positive) or consumed (negative) per second. */
  energy: number;
  /** Salvage produced per second when on a deposit. */
  salvageRate?: number;
  /** What this structure can produce. */
  produces?: UnitKind[];
  /** Must be placed on a salvage deposit. */
  needsDeposit?: boolean;
  /** Neutral capture point; not buildable. */
  neutral?: boolean;
  /** Solar output scales with daylight. */
  solar?: boolean;
  /** Unlocks these structures for building once one exists. */
  unlocks?: StructureKind[];
  /** Completed structure required before this can be placed. */
  requires?: StructureKind;
  hotkey?: string;
  /** Laser-grid coverage in either arc direction, metres. */
  coverageArc?: number;
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  bastion: {
    kind: 'bastion',
    name: 'Bastion',
    role: 'Command headquarters. Lose it and you lose the match.',
    cost: { salvage: 1400 },
    buildTime: 60,
    hp: 9000,
    armor: 'structure',
    radius: 22,
    height: 34,
    vision: 340,
    weapons: ['bastionGun'],
    energy: 6,
    produces: ['engineer'],
  },
  extractor: {
    kind: 'extractor',
    name: 'Extractor',
    role: 'Mines scrith salvage. Must sit on a deposit.',
    cost: { salvage: 160 },
    buildTime: 12,
    hp: 900,
    armor: 'structure',
    radius: 11,
    height: 14,
    vision: 130,
    weapons: [],
    energy: -2,
    salvageRate: 7.5,
    needsDeposit: true,
    hotkey: 'E',
  },
  solarArray: {
    kind: 'solarArray',
    name: 'Solar Array',
    role: 'Cheap power, but it stops when a shadow square passes over.',
    cost: { salvage: 130 },
    buildTime: 10,
    hp: 620,
    armor: 'structure',
    radius: 13,
    height: 8,
    vision: 90,
    weapons: [],
    energy: 9,
    solar: true,
    hotkey: 'S',
  },
  fusionCore: {
    kind: 'fusionCore',
    name: 'Fusion Core',
    role: 'Expensive power that never stops. Explodes impressively.',
    cost: { salvage: 480 },
    buildTime: 24,
    hp: 1500,
    armor: 'structure',
    radius: 12,
    height: 20,
    vision: 110,
    weapons: [],
    energy: 26,
    hotkey: 'F',
  },
  fabricator: {
    kind: 'fabricator',
    name: 'Fabricator',
    role: 'Produces engineers. Unlocks the mech foundry.',
    cost: { salvage: 250 },
    buildTime: 16,
    hp: 1300,
    armor: 'structure',
    radius: 14,
    height: 15,
    vision: 140,
    weapons: [],
    energy: -3,
    produces: ['engineer'],
    unlocks: ['mechFoundry', 'rocketBattery'],
    hotkey: 'B',
  },
  mechFoundry: {
    kind: 'mechFoundry',
    name: 'Mech Foundry',
    role: 'Builds battle mechs. The centre of any real army.',
    cost: { salvage: 620 },
    buildTime: 30,
    hp: 2400,
    armor: 'structure',
    radius: 18,
    height: 22,
    vision: 160,
    weapons: [],
    energy: -8,
    produces: ['wisp', 'vanguard', 'aegis', 'longbow', 'bulwark', 'needle'],
    requires: 'fabricator',
    hotkey: 'M',
  },
  rocketBattery: {
    kind: 'rocketBattery',
    name: 'Rocket Battery',
    role: 'Static artillery. Range depends heavily on firing direction.',
    cost: { salvage: 400 },
    buildTime: 20,
    hp: 1100,
    armor: 'structure',
    radius: 12,
    height: 16,
    vision: 150,
    weapons: ['batteryGun', 'cruiseMissile'],
    energy: -6,
    requires: 'fabricator',
    hotkey: 'R',
  },
  pointDefense: {
    kind: 'pointDefense',
    name: 'Point Defence',
    role: 'Shoots down incoming rockets. Draws power to do it.',
    cost: { salvage: 220 },
    buildTime: 14,
    hp: 800,
    armor: 'structure',
    radius: 8,
    height: 12,
    vision: 220,
    weapons: ['pdLaser'],
    energy: -5,
    hotkey: 'D',
  },
  laserGrid: {
    kind: 'laserGrid',
    name: 'Laser Grid',
    role: 'Burns ballistic rockets at midcourse. Cruise missiles fly under it.',
    cost: { salvage: 350 },
    buildTime: 18,
    hp: 900,
    armor: 'structure',
    radius: 10,
    height: 24,
    vision: 200,
    weapons: ['gridLaser'],
    energy: -8,
    requires: 'fabricator',
    coverageArc: 800,
    hotkey: 'L',
  },
  radarMast: {
    kind: 'radarMast',
    name: 'Radar Mast',
    role: 'Wide vision. Artillery cannot hit what it cannot see.',
    cost: { salvage: 190 },
    buildTime: 12,
    hp: 500,
    armor: 'structure',
    radius: 7,
    height: 28,
    vision: 900,
    weapons: [],
    energy: -4,
    hotkey: 'V',
  },
  silo: {
    kind: 'silo',
    name: 'Silo',
    role: 'Endgame cross-ring weapon. Expensive, visible, devastating.',
    cost: { salvage: 1200 },
    buildTime: 45,
    hp: 2000,
    armor: 'structure',
    radius: 16,
    height: 30,
    vision: 180,
    weapons: ['chordShot'],
    energy: -12,
    requires: 'mechFoundry',
    hotkey: 'C',
  },
  spinalNode: {
    kind: 'spinalNode',
    name: 'Spinal Node',
    role: 'Neutral control tower. Holding it raises your command cap.',
    cost: {},
    buildTime: 0,
    hp: 3000,
    armor: 'structure',
    radius: 15,
    height: 40,
    vision: 260,
    weapons: [],
    energy: 0,
    neutral: true,
  },
};

/** Structures the player can place from the build bar, in display order. */
export const BUILDABLE: StructureKind[] = [
  'extractor',
  'solarArray',
  'fabricator',
  'mechFoundry',
  'rocketBattery',
  'pointDefense',
  'laserGrid',
  'radarMast',
  'fusionCore',
  'silo',
];

/** Command points granted per captured Spinal Node. */
export const COMMAND_PER_NODE = 3;

/** Dominance ticks up for whoever holds more nodes; breaks stalemates. */
export const DOMINANCE_PER_NODE_PER_SEC = 1;
export const MATCH_TIME_LIMIT = 45 * 60;

/** How long a launcher stays revealed after firing (counter-battery flash). */
export const FIRING_REVEAL_TIME = 6;

export const WRECK_LIFETIME = 60;
export const WRECK_HP_MULTIPLIER = 0.3;

export interface EffectiveEntityStats {
  maxHp: number;
  vision: number;
  buildDuration: number;
  salvageCost: number;
}

export function effectiveUnitStats(faction: Faction, kind: UnitKind): EffectiveEntityStats {
  const def = UNITS[kind];
  const mods = FACTION_MODS[faction];
  return {
    maxHp: Math.round(def.hp * (def.isMech ? mods.mechHpMultiplier : 1)),
    vision: Math.round(def.vision * mods.visionMultiplier),
    buildDuration: def.buildTime * mods.buildTimeMultiplier,
    salvageCost: effectiveSalvageCost(faction, def.cost.salvage ?? 0, def.weapons),
  };
}

export function effectiveStructureStats(
  faction: Faction | -1,
  kind: StructureKind,
): EffectiveEntityStats {
  const def = STRUCTURES[kind];
  if (faction < 0) {
    return {
      maxHp: def.hp,
      vision: def.vision,
      buildDuration: def.buildTime,
      salvageCost: def.cost.salvage ?? 0,
    };
  }
  const mods = FACTION_MODS[faction as Faction];
  return {
    maxHp: def.hp,
    vision: Math.round(def.vision * mods.visionMultiplier),
    buildDuration: def.buildTime * mods.buildTimeMultiplier,
    salvageCost: effectiveSalvageCost(faction as Faction, def.cost.salvage ?? 0, def.weapons),
  };
}

function effectiveSalvageCost(faction: Faction, base: number, weapons: string[]): number {
  const hasBallisticWeapon = weapons.some((weaponId) => WEAPONS[weaponId]?.kind === 'ballistic');
  const multiplier = hasBallisticWeapon ? FACTION_MODS[faction].ballisticCostMultiplier : 1;
  return Math.round(base * multiplier);
}
