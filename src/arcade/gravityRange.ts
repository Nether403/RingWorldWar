import { deltaS, surfaceDist } from '@core/ringMath';
import type { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import type { GravityRangeBindings } from './gravityRangeScenario';

const TARGET_TOLERANCE_METERS = 60;

export type GravityRangeStage = 'spinward' | 'antispinward' | 'complete';

export interface GravityRangeHudModel {
  readonly status: 'active' | 'completed';
  readonly stage: GravityRangeStage;
  readonly completedImpacts: number;
  readonly totalImpacts: 2;
  readonly directionLabel: 'Spinward' | 'Antispinward' | 'Exercise complete';
  readonly distanceMeters: number;
  readonly instruction: string;
}

export class GravityRangeController {
  private stage: GravityRangeStage = 'spinward';
  private readonly scoredProjectiles = new Map<number, Exclude<GravityRangeStage, 'complete'>>();
  private readonly targets: Record<'spinward' | 'antispinward', Readonly<{ s: number; z: number }>>;

  constructor(
    private readonly world: World,
    private readonly playerFaction: Faction,
    readonly bindings: GravityRangeBindings,
  ) {
    const launcher = this.requireStructure(bindings.launcherId, 'launcher');
    const spinward = this.requireStructure(bindings.spinwardTargetId, 'spinward target');
    const antispinward = this.requireStructure(bindings.antispinwardTargetId, 'antispinward target');
    if (launcher.kind !== 'rocketBattery' || launcher.faction !== playerFaction) {
      throw new Error('Gravity Range launcher must be the player Rocket Battery');
    }
    if (Math.abs(deltaS(launcher.s, spinward.s) - 800) > 0.001 || spinward.z !== launcher.z) {
      throw new Error('Gravity Range spinward target must be 800 m from the launcher');
    }
    if (Math.abs(deltaS(launcher.s, antispinward.s) + 1_800) > 0.001 || antispinward.z !== launcher.z) {
      throw new Error('Gravity Range antispinward target must be 1,800 m from the launcher');
    }
    this.targets = {
      spinward: Object.freeze({ s: spinward.s, z: spinward.z }),
      antispinward: Object.freeze({ s: antispinward.s, z: antispinward.z }),
    };
  }

  get currentTarget(): Readonly<{ s: number; z: number }> | null {
    return this.stage === 'complete' ? null : this.targets[this.stage];
  }

  acceptsArtillery(sourceId: number, weaponId: string): boolean {
    return this.stage !== 'complete' && sourceId === this.bindings.launcherId && weaponId === 'batteryGun';
  }

  get model(): GravityRangeHudModel {
    if (this.stage === 'complete') {
      return Object.freeze({
        status: 'completed',
        stage: 'complete',
        completedImpacts: 2,
        totalImpacts: 2,
        directionLabel: 'Exercise complete',
        distanceMeters: 0,
        instruction: 'Both markers struck. Antispinward carried the farther shot.',
      });
    }
    const antispinward = this.stage === 'antispinward';
    return Object.freeze({
      status: 'active',
      stage: this.stage,
      completedImpacts: antispinward ? 1 : 0,
      totalImpacts: 2,
      directionLabel: antispinward ? 'Antispinward' : 'Spinward',
      distanceMeters: antispinward ? 1_800 : 800,
      instruction: antispinward
        ? 'Strike the farther antispinward marker. Wait for reload, then use the minimap or terrain.'
        : 'Strike the nearer spinward marker using the minimap or terrain.',
    });
  }

  observe(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.kind === 'weaponFired' && event.projectileId !== undefined
        && event.id === this.bindings.launcherId && event.faction === this.playerFaction
        && event.weapon === 'batteryGun' && this.stage !== 'complete') {
        this.scoredProjectiles.set(event.projectileId, this.stage);
        continue;
      }
      if (event.kind === 'intercepted') {
        this.scoredProjectiles.delete(event.id);
        continue;
      }
      if (event.kind !== 'impact' || this.stage === 'complete') continue;
      const launchStage = this.scoredProjectiles.get(event.id);
      this.scoredProjectiles.delete(event.id);
      if (launchStage !== this.stage) continue;
      const target = this.targets[this.stage];
      if (event.faction !== this.playerFaction || event.weapon !== 'batteryGun'
        || surfaceDist(event.s, event.z, target.s, target.z) > TARGET_TOLERANCE_METERS) continue;
      this.stage = this.stage === 'spinward' ? 'antispinward' : 'complete';
    }
  }

  private requireStructure(id: number, label: string) {
    const structure = this.world.structureById(id);
    if (!structure) throw new Error(`Gravity Range ${label} binding is invalid`);
    return structure;
  }
}
