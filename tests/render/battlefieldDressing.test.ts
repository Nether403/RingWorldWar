import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain } from '../../src/gen/terrain';
import { RenderAnchor } from '../../src/render/anchor';
import { BattlefieldDressing } from '../../src/render/battlefieldDressing';
import { QUALITY } from '../../src/render/renderer';

describe('BattlefieldDressing', () => {
  it('rebuilds the same presentation-only ruin field for the same seed and anchor', () => {
    const anchor = new RenderAnchor();
    anchor.set(1_900, 0);
    const terrain = { heightAt: () => 0 } as unknown as Terrain;
    const first = new BattlefieldDressing(42);
    const second = new BattlefieldDressing(42);
    first.update(anchor, terrain);
    second.update(anchor, terrain);

    expect(signature(first)).toEqual(signature(second));
    expect(signature(first).counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
  });

  it('applies bounded quality density and shadow budgets', () => {
    const anchor = new RenderAnchor();
    anchor.set(1_900, 0);
    const terrain = { heightAt: () => 0 } as unknown as Terrain;
    const dressing = new BattlefieldDressing(43);
    const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);

    dressing.setQuality(QUALITY.low.dressingDistance, QUALITY.low.dressingCap, QUALITY.low.dressingShadows);
    dressing.update(anchor, terrain);
    const lowCount = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    expect(lowCount).toBeLessThanOrEqual(QUALITY.low.dressingCap);
    expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);

    dressing.setQuality(QUALITY.ultra.dressingDistance, QUALITY.ultra.dressingCap, QUALITY.ultra.dressingShadows);
    dressing.update(anchor, terrain);
    const ultraCount = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    expect(ultraCount).toBeGreaterThan(lowCount);
    expect(ultraCount).toBeLessThanOrEqual(QUALITY.ultra.dressingCap);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);
  });
});

function signature(dressing: BattlefieldDressing): { counts: number[]; matrices: number[] } {
  const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const matrix = new THREE.Matrix4();
  const matrices: number[] = [];
  for (const mesh of meshes) {
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrices.push(...matrix.elements.map((value) => Number(value.toFixed(5))));
    }
  }
  return { counts: meshes.map((mesh) => mesh.count), matrices };
}
