import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Effects } from '../../src/render/effects';
import { RenderAnchor } from '../../src/render/anchor';
import { Faction } from '../../src/sim/data';
import type { SimEvent, World } from '../../src/sim/world';

describe('Effects Phase 3A pools', () => {
  it('submits only the configured particle capacity and live line vertices', () => {
    const effects = new Effects(7);
    const exact = effects as unknown as {
      puffs: THREE.Points;
      trailMesh: THREE.LineSegments;
      tracerMesh: THREE.LineSegments;
    };
    effects.setParticleCap(225);
    effects.update(1 / 60, world(), new RenderAnchor(), Faction.Compact);

    expect(exact.puffs.geometry.drawRange.count).toBe(0);
    expect(exact.trailMesh.geometry.drawRange.count).toBe(0);
    expect(exact.tracerMesh.geometry.drawRange.count).toBe(0);
  });

  it('lets a major explosion preempt low-priority muzzle lights on Low', () => {
    const effects = new Effects(8);
    const exact = effects as unknown as {
      lights: THREE.PointLight[];
      lightPriority: number[];
    };
    const anchor = new RenderAnchor();
    effects.setLightCap(2);
    effects.consume([
      event('weaponFired', 1, { weapon: 'autocannon' }),
      event('weaponFired', 2, { weapon: 'autocannon' }),
      event('structureDied', 3, { scale: 3 }),
    ], world(), anchor, Faction.Compact, 0, 0);

    expect(exact.lightPriority.slice(0, 2)).toContain(3);
    expect(Math.max(...exact.lights.slice(0, 2).map((light) => light.intensity))).toBeGreaterThan(500);
  });

  it('uses the shared pool for footfall dust and attenuates its shake by distance', () => {
    const anchor = new RenderAnchor();
    const near = new Effects(9);
    const exact = near as unknown as { puffData: Float32Array };
    const far = new Effects(9);
    const footfall = event('footfall', 4, { s: 20, scale: 1.4 });
    near.footfall(footfall, anchor, 0, 0);
    far.footfall(footfall, anchor, 1_000, 0);

    expect(activeParticles(exact.puffData)).toBeGreaterThan(0);
    expect(near.shake).toBeGreaterThan(far.shake);
  });

  it('clears transient particles and lights when a session is restored', () => {
    const effects = new Effects(10);
    const exact = effects as unknown as {
      puffData: Float32Array;
      lightLife: number[];
    };
    effects.consume([event('impact', 5, { scale: 2 })], world(), new RenderAnchor(), Faction.Compact);
    expect(activeParticles(exact.puffData)).toBeGreaterThan(0);
    expect(exact.lightLife.some((life) => life > 0)).toBe(true);

    effects.resetTransientState();

    expect(activeParticles(exact.puffData)).toBe(0);
    expect(exact.lightLife.every((life) => life === 0)).toBe(true);
  });

  it('reprojects transient effects exactly when the ring tangent anchor changes', () => {
    const effects = new Effects(11);
    const exact = effects as unknown as { puffPos: Float32Array; puffData: Float32Array };
    const oldAnchor = new RenderAnchor();
    oldAnchor.set(0, 0);
    const footfall = event('footfall', 6, { s: 100, z: 25, h: 3 });
    effects.footfall(footfall, oldAnchor, 0, 0);

    const newAnchor = new RenderAnchor();
    newAnchor.set(1_900, -40);
    effects.rebase(0, 0, newAnchor);
    const expected = new THREE.Vector3();
    newAnchor.toVector(footfall.s, footfall.h, footfall.z, expected);

    expect(exact.puffData[1]).toBeGreaterThan(0);
    expect(exact.puffPos[0]).toBeCloseTo(expected.x, 4);
    expect(exact.puffPos[1]).toBeCloseTo(expected.y, 4);
    expect(exact.puffPos[2]).toBeCloseTo(expected.z, 4);
  });
});

function world(): World {
  return {
    projectiles: [],
    isEntityVisible: () => true,
    isVisible: () => true,
    isProjectileVisible: () => true,
  } as unknown as World;
}

function event(kind: SimEvent['kind'], id: number, overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    kind,
    id,
    faction: Faction.Compact,
    s: 0,
    z: 0,
    h: 0,
    scale: 1,
    ...overrides,
  };
}

function activeParticles(data: Float32Array): number {
  let count = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 1]! > 0) count++;
  return count;
}
