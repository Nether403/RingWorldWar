import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World, type SimEvent } from '@sim/world';
import { MissionController } from '../../src/tutorial/mission';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('Counterfire mission', () => {
  it('distinguishes interception from penetration and produces a persistent debrief', () => {
    const world = new World(terrain, 61);
    const protectedAsset = world.spawnStructure(Faction.Compact, 'fabricator', 0, 0, 1);
    const defensePower = world.spawnStructure(Faction.Compact, 'fusionCore', -150, 0, 0.25);
    const aegis = world.spawnUnit(Faction.Compact, 'aegis', 20, 0);
    const wisp = world.spawnUnit(Faction.Compact, 'wisp', 1_000, 0);
    const playerBattery = world.spawnStructure(Faction.Compact, 'rocketBattery', 1_500, 100, 1);
    const enemyLauncher = world.spawnUnit(Faction.Choir, 'longbow', 1_000, 0);
    const enemyGrid = world.spawnStructure(Faction.Choir, 'laserGrid', 1_350, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', -250, 200, 1);
    world.spawnStructure(Faction.Choir, 'fusionCore', 800, 200, 1);
    world.spawnStructure(Faction.Choir, 'radarMast', 500, 0, 1);
    const mission = MissionController.start('counterfire', world.tick, {
      protectedAsset: protectedAsset.id,
      defensePower: defensePower.id,
      aegis: aegis.id,
      wisp: wisp.id,
      playerBattery: playerBattery.id,
      enemyLauncher: enemyLauncher.id,
      enemyGrid: enemyGrid.id,
    });

    enemyLauncher.ability!.active = true;
    enemyLauncher.ability!.transitionTimer = 0;
    expect(world.fireBallisticCommand(
      enemyLauncher.id, protectedAsset.s, protectedAsset.z, Faction.Choir, 'siegeMortar',
    )).toMatchObject({ ok: true });
    mission.advanceTick(world, world.drainEvents());
    expect(mission.hudModel().objectiveId).toBe('restore-defensive-power');
    defensePower.progress = 1;
    mission.advanceTick(world, []);
    expect(mission.hudModel().objectiveId).toBe('raise-umbrella');
    aegis.ability!.active = true;
    mission.advanceTick(world, []);
    const hostileProjectile = world.projectiles.find((projectile) => projectile.faction === Faction.Choir)!;
    const intercepted = event('intercepted', Faction.Compact, hostileProjectile.id, 'siegeMortar');
    intercepted.actorId = aegis.id;
    mission.advanceTick(world, [
      intercepted,
      event('impact', Faction.Choir, hostileProjectile.id, 'siegeMortar'),
    ]);
    expect(mission.hudModel().objectiveId).toBe('test-grid');

    const alternateBattery = world.spawnStructure(Faction.Compact, 'rocketBattery', 1_470, 100, 1);
    const standardResult = world.fireBallisticCommand(
      alternateBattery.id, enemyLauncher.s, enemyLauncher.z, Faction.Compact, 'batteryGun',
    );
    expect(standardResult.reason).toBe('success');
    mission.observePlayerAction({
      kind: 'artillery-fired', sourceId: alternateBattery.id, weaponId: 'batteryGun',
      projectileId: standardResult.projectileId,
      // Ground targeting remains valid even when the player clicks near rather
      // than exactly on the visible launcher.
      targetS: enemyLauncher.s + 200, targetZ: enemyLauncher.z,
    }, world);
    const standard = world.projectiles.find((projectile) => projectile.weapon === 'batteryGun')!;
    const gridIntercept = event('intercepted', Faction.Choir, standard.id, 'batteryGun');
    gridIntercept.actorId = enemyGrid.id;
    mission.advanceTick(world, [gridIntercept]);
    expect(mission.hudModel().objectiveId).toBe('adapt-ammunition');

    const cruiseResult = world.fireBallisticCommand(
      playerBattery.id, enemyLauncher.s, enemyLauncher.z, Faction.Compact, 'cruiseMissile',
    );
    expect(cruiseResult).toMatchObject({ ok: true });
    mission.observePlayerAction({
      kind: 'artillery-fired', sourceId: playerBattery.id, weaponId: 'cruiseMissile',
      projectileId: cruiseResult.projectileId, targetS: enemyLauncher.s, targetZ: enemyLauncher.z,
    }, world);
    expect(mission.hudModel().objectiveId).toBe('neutralize-launcher');
    enemyLauncher.alive = false;
    mission.advanceTick(world, []);

    expect(mission.hudModel().status).toBe('completed');
    expect(mission.snapshot().milestones.counterfire?.hostilePenetrations).toBe(0);
    expect(mission.debriefModel()).toMatchObject({
      outcome: 'success',
      rows: expect.arrayContaining([
        { label: 'Intercepted', value: '1' },
        { label: 'Counterfire rounds', value: '2' },
      ]),
    });
  });
});

function event(kind: SimEvent['kind'], faction: SimEvent['faction'], id: number, weapon: string): SimEvent {
  return { kind, faction, id, weapon, s: 0, z: 0, h: 0, scale: 1 };
}
