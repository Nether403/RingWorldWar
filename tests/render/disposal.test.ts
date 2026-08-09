import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { EntityRenderer } from '@render/entityRenderer';
import { Environment } from '@render/environment';
import { Markers } from '@render/markers';
import { RingMesh } from '@render/ringMesh';
import { BattlefieldDressing } from '@render/battlefieldDressing';

describe('render resource disposal', () => {
  it('releases every unique EntityRenderer geometry and material', () => {
    const renderer = new EntityRenderer(81);
    const resources = resourcesIn(renderer.object);
    const dispose = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    const instanceDispose = renderer.object.children
      .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
      .map((mesh) => vi.spyOn(mesh, 'dispose'));
    renderer.onFootfall = () => {};

    renderer.dispose();

    for (const spy of dispose) expect(spy).toHaveBeenCalledOnce();
    for (const spy of instanceDispose) expect(spy).toHaveBeenCalledOnce();
    expect(renderer.object.children).toHaveLength(0);
    expect(renderer.onFootfall).toBeNull();
  });

  it('releases cached terrain resources for every constructed quality', () => {
    const ring = new RingMesh(flatTerrain(), 'low');
    ring.setQuality('high');
    const exact = ring as unknown as {
      geometries: Map<string, THREE.BufferGeometry>;
      materials: Map<string, THREE.Material>;
    };
    const resources = [...exact.geometries.values(), ...exact.materials.values()];
    const dispose = resources.map((resource) => vi.spyOn(resource, 'dispose'));

    ring.dispose();

    for (const spy of dispose) expect(spy).toHaveBeenCalledOnce();
    expect(exact.geometries.size).toBe(0);
    expect(exact.materials.size).toBe(0);
    expect(ring.object.children).toHaveLength(0);
  });

  it('releases marker and environment scene resources', () => {
    const markers = new Markers();
    const environment = new Environment(82);
    const markerResources = resourcesIn(markers.object);
    const environmentResources = resourcesIn(environment.group);
    const markerDispose = markerResources.map((resource) => vi.spyOn(resource, 'dispose'));
    const environmentDispose = environmentResources.map((resource) => vi.spyOn(resource, 'dispose'));

    markers.dispose();
    environment.dispose();

    for (const spy of markerDispose) expect(spy).toHaveBeenCalledOnce();
    for (const spy of environmentDispose) expect(spy).toHaveBeenCalledOnce();
    expect(markers.object.children).toHaveLength(0);
    expect(environment.group.children).toHaveLength(0);
  });

  it('releases every fixed district scatter bucket and owned resource', () => {
    const dressing = new BattlefieldDressing(83);
    const resources = resourcesIn(dressing.object);
    const dispose = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    const instanceDispose = dressing.object.children
      .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
      .map((mesh) => vi.spyOn(mesh, 'dispose'));

    dressing.dispose();

    for (const spy of dispose) expect(spy).toHaveBeenCalledOnce();
    for (const spy of instanceDispose) expect(spy).toHaveBeenCalledOnce();
    expect(dressing.object.children).toHaveLength(0);
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
    if (renderable.material) {
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) resources.add(material);
    }
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
