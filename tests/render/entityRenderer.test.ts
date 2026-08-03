import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EntityRenderer } from '../../src/render/entityRenderer';

describe('EntityRenderer quality materials', () => {
  it('toggles the cheap hull path for ordinary and cloaked Wisp materials', () => {
    const entities = new EntityRenderer(42);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    for (const child of entities.object.children) {
      if (!(child instanceof THREE.InstancedMesh) || !(child.material instanceof THREE.MeshStandardMaterial)) continue;
      if (child.name.startsWith('cloak:wisp:')) materials.set('cloak', child.material);
      if (child.name.startsWith('structure:')) materials.set('ordinary', child.material);
    }

    const qualityValues = (): number[] => [...materials.values()].map((material) => {
      const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
      material.onBeforeCompile(shader as never, {} as never);
      return (shader.uniforms as { uLowQuality: { value: number } }).uLowQuality.value;
    });

    expect([...materials.keys()].sort()).toEqual(['cloak', 'ordinary']);
    entities.setLowQuality(true);
    expect(qualityValues()).toEqual([1, 1]);
    entities.setLowQuality(false);
    expect(qualityValues()).toEqual([0, 0]);
  });

  it('creates Needle cloak and both exclusive-unit wreck buckets', () => {
    const renderer = new EntityRenderer(19) as unknown as {
      cloakMeshes: Map<string, THREE.InstancedMesh>;
      wreckMeshes: Map<string, THREE.InstancedMesh>;
    };
    expect(renderer.cloakMeshes.has('needle|torso|1')).toBe(true);
    expect(renderer.wreckMeshes.has('bulwark')).toBe(true);
    expect(renderer.wreckMeshes.has('needle')).toBe(true);
  });
});
