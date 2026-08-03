import * as THREE from 'three';
import { RING_OMEGA, RING_RADIUS } from '@core/constants';
import { RenderAnchor } from '@render/anchor';
import { Environment } from '@render/environment';
import { describe, expect, it } from 'vitest';

describe('inertial starfield', () => {
  it('moves opposite physical ring rotation around the ring axis', () => {
    const environment = new Environment(27);
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const camera = new THREE.Vector3();
    const pivot = environment.group.getObjectByName('environment:star-pivot');
    const stars = environment.group.getObjectByName('environment:stars') as THREE.Points;

    expect(pivot).toBeDefined();
    expect((stars.material as THREE.ShaderMaterial).vertexShader).toContain('mat3(viewMatrix)');
    environment.update(0, anchor, camera);
    const initial = pivot!.rotation.z;
    environment.update(10, anchor, camera);

    expect(pivot!.position.y).toBeCloseTo(RING_RADIUS, 6);
    expect(pivot!.rotation.z - initial).toBeCloseTo(-RING_OMEGA * 10, 6);
  });
});
