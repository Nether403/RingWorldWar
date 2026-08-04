import * as THREE from 'three';
import { buildMech, buildStructure, makeHullMaterial } from '@gen/models';
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

  it('builds distinct valid Bulwark and Needle silhouettes', () => {
    const bulwark = buildMech('bulwark', 18);
    const needle = buildMech('needle', 18);

    expect(bulwark.height).toBeGreaterThan(needle.height);
    expect(bulwark.radius).toBeGreaterThan(needle.radius);
    expect(bulwark.parts.torso.getAttribute('position').count).toBeGreaterThan(0);
    expect(needle.parts.torso.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('adds faction geometry without changing mech rig authority metadata', () => {
    const compact = buildMech('vanguard', 19, 'compact');
    const choir = buildMech('vanguard', 19, 'choir');

    expect(compact.parts.torso.getAttribute('position').count)
      .not.toBe(choir.parts.torso.getAttribute('position').count);
    expect({
      height: compact.height,
      radius: compact.radius,
      hipOffset: compact.hipOffset,
      hipHeight: compact.hipHeight,
      legUpper: compact.legUpper,
      legLower: compact.legLower,
      muzzles: compact.muzzles.map((muzzle) => muzzle.toArray()),
    }).toEqual({
      height: choir.height,
      radius: choir.radius,
      hipOffset: choir.hipOffset,
      hipHeight: choir.hipHeight,
      legUpper: choir.legUpper,
      legLower: choir.legLower,
      muzzles: choir.muzzles.map((muzzle) => muzzle.toArray()),
    });
  });

  it('adds faction structure grammar without changing gameplay metadata', () => {
    const compact = buildStructure('fabricator', 20, 'compact');
    const choir = buildStructure('fabricator', 20, 'choir');
    const neutralNode = buildStructure('spinalNode', 20, 'neutral');

    expect(compact.geometry.getAttribute('position').count)
      .not.toBe(choir.geometry.getAttribute('position').count);
    expect({ radius: compact.radius, height: compact.height, muzzles: compact.muzzles })
      .toEqual({ radius: choir.radius, height: choir.height, muzzles: choir.muzzles });
    expect(neutralNode.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('compiles faction style and per-instance damage through one hull program', () => {
    const hull = makeHullMaterial(0xf0821e, -1);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <emissivemap_fragment>',
    ].join('\n') };
    hull.material.onBeforeCompile(shader as never, {} as never);

    expect(shader.vertexShader).toContain('attribute float instanceDamage');
    expect(shader.vertexShader).toContain('attribute float instancePhase');
    expect(shader.fragmentShader).toContain('uniform float uFactionStyle');
    expect(shader.fragmentShader).toContain('uniform float uTime');
    expect(shader.fragmentShader).toContain('flickerPulse');
    expect(shader.fragmentShader).toContain('rww_damage()');
    expect(hull.material.customProgramCacheKey()).toBe('rww-hull-v2');
  });
});
