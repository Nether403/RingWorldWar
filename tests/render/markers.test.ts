import * as THREE from 'three';
import type { Terrain } from '@gen/terrain';
import { RenderAnchor } from '@render/anchor';
import { Markers } from '@render/markers';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('build guidance markers', () => {
  it('shows only available salvage deposits while placing an Extractor', () => {
    const world = new World(terrain, 91);
    world.spawnStructure(Faction.Compact, 'radarMast', 0, 0, 1);
    world.deposits.push(
      { s: 100, z: 0, amount: 1_000, claimedBy: 0 },
      { s: 200, z: 0, amount: 0, claimedBy: 0 },
      { s: 2_000, z: 0, amount: 1_000, claimedBy: 0 },
    );
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const markers = new Markers();
    const camera = new THREE.PerspectiveCamera();
    const update = (placing: 'extractor' | 'solarArray' | null): void => markers.update(
      world,
      anchor,
      new Set(),
      { s: 0, z: 0, valid: false },
      placing,
      Faction.Compact,
      null,
      false,
      null,
      camera,
    );

    update('solarArray');
    expect(markers.object.userData.depositGuidanceCount).toBe(0);
    update('extractor');
    expect(markers.object.userData.depositGuidanceCount).toBe(1);

    const extractor = world.spawnStructure(Faction.Compact, 'extractor', 100, 0, 1);
    world.deposits[0]!.claimedBy = extractor.id;
    update('extractor');
    expect(markers.object.userData.depositGuidanceCount).toBe(0);

    extractor.alive = false;
    update('extractor');
    expect(markers.object.userData.depositGuidanceCount).toBe(1);
  });
});
