import * as THREE from 'three';
import { buildStructure } from '@gen/models';
import { describe, expect, it } from 'vitest';

describe('procedural hull geometry', () => {
  it('presents the near exterior of a structure to FrontSide rendering', () => {
    const model = buildStructure('extractor', 17);
    const mesh = new THREE.Mesh(
      model.geometry,
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    );
    mesh.updateMatrixWorld(true);
    const normals = model.geometry.getAttribute('normal');

    const sideHits = new THREE.Raycaster(
      new THREE.Vector3(100, 7, 0),
      new THREE.Vector3(-1, 0, 0),
    ).intersectObject(mesh);
    const topHits = new THREE.Raycaster(
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh);

    expect(sideHits[0]?.point.x).toBeGreaterThan(0);
    expect(topHits[0]?.point.y).toBeGreaterThan(5);
    expect(normals.getY(0)).toBeLessThan(0);
    expect(normals.getY(4)).toBeGreaterThan(0);
    for (let index = 0; index < normals.count; index++) {
      expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeGreaterThan(0.99);
    }
  });
});
