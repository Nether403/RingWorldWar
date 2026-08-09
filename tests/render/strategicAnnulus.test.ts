import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RING_CIRCUMFERENCE, RING_RADIUS, SHADOW_SQUARE_COUNT } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { RenderAnchor } from '@render/anchor';
import {
  STRATEGIC_LAYER,
  StrategicAnnulus,
  projectSurfaceToAnnulus,
} from '@render/strategicAnnulus';
import { Faction } from '@sim/data';
import { World } from '@sim/world';

describe('StrategicAnnulus', () => {
  it('[whole-ring-projection] closes the surface seam and keeps the tactical focus at the nadir', () => {
    const a = projectSurfaceToAnnulus(0, 0, RING_RADIUS);
    const seam = projectSurfaceToAnnulus(RING_CIRCUMFERENCE, 0, RING_RADIUS);
    const focus = projectSurfaceToAnnulus(4_200, 4_200, RING_RADIUS);

    expect(seam.x).toBeCloseTo(a.x, 8);
    expect(seam.y).toBeCloseTo(a.y, 8);
    expect(focus.x).toBeCloseTo(0, 8);
    expect(focus.y).toBeCloseTo(-RING_RADIUS, 8);
  });

  it('[strategic-annulus-authority] draws canonical shadow sectors and only bounded strategic marks', () => {
    const world = new World(flatTerrain(), 10);
    world.spawnStructure(Faction.Choir, 'bastion', 1_000, 700, 1);
    world.spawnStructure(Faction.Choir, 'silo', 2_000, -700, 1);
    world.spawnStructure(Faction.Choir, 'extractor', 3_000, 0, 1);
    world.spawnUnit(Faction.Choir, 'needle', 4_000, 0);
    world.spawnStructure(Faction.Compact, 'bastion', 5_000, 0, 1);
    const anchor = new RenderAnchor();
    anchor.set(400, 0);
    const annulus = new StrategicAnnulus();

    annulus.update(world, Faction.Compact, anchor, 400);

    expect(annulus.object.layers.isEnabled(STRATEGIC_LAYER)).toBe(true);
    expect(annulus.snapshot.shadowPanelCount).toBe(SHADOW_SQUARE_COUNT);
    expect(annulus.snapshot.hostileContactCount).toBe(2);
    expect(annulus.snapshot.hostileCategories).toEqual(['bastion', 'launch-site']);
    expect(annulus.snapshot.friendlyLandmarkCount).toBe(1);
    expect(annulus.snapshot.markerCount).toBe(4); // focus + two hostile + one friendly
    expect(annulus.snapshot.renderables).toBeLessThanOrEqual(12);
  });

  it('reuses its fixed scene graph and disposes every GPU resource', () => {
    const annulus = new StrategicAnnulus();
    const resources = resourcesIn(annulus.object);
    const disposals = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    const childCount = annulus.object.children.length;

    annulus.update(new World(flatTerrain(), 11), Faction.Compact, new RenderAnchor(), 0);
    expect(annulus.object.children).toHaveLength(childCount);

    annulus.dispose();

    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(annulus.object.children).toHaveLength(0);
  });
});

function resourcesIn(root: THREE.Object3D): Array<THREE.BufferGeometry | THREE.Material> {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) resources.add(renderable.geometry);
    const materials = renderable.material
      ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
      : [];
    for (const material of materials) resources.add(material);
  });
  return [...resources];
}

function flatTerrain(): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
    normalAt: (_s: number, _z: number, out: { x: number; y: number; z: number }) => {
      out.x = 0;
      out.y = 1;
      out.z = 0;
      return out;
    },
  } as unknown as Terrain;
}
