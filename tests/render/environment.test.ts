import * as THREE from 'three';
import { RING_OMEGA, RING_RADIUS } from '@core/constants';
import { RenderAnchor } from '@render/anchor';
import { Environment, sampleAtmosphere, shadowFactor } from '@render/environment';
import { shadowFactorAtAngle } from '@core/shadow';
import { describe, expect, it, vi } from 'vitest';

describe('inertial starfield', () => {
  it('[render-shadow-parity] delegates every render sample to the core shadow authority', () => {
    for (const time of [0, 91, 420, 839.5]) {
      for (const theta of [0, 0.1, 1.7, Math.PI * 2]) {
        expect(shadowFactor(theta, time)).toBe(shadowFactorAtAngle(theta, time));
      }
    }
  });

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

  it('builds one stable depth-safe atmosphere mesh matched to bounded fog', () => {
    const environment = new Environment(28);
    const atmosphere = environment.group.getObjectByName('environment:atmosphere') as THREE.Mesh;
    const material = atmosphere.material as THREE.ShaderMaterial;
    const geometry = atmosphere.geometry;
    const anchor = new RenderAnchor();
    const camera = new THREE.Vector3(12, 40, -8);

    expect(atmosphere).toBeDefined();
    expect(material.side).toBe(THREE.BackSide);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(material.transparent).toBe(false);
    expect(material.fragmentShader).toContain('tonemapping_fragment');
    expect(material.fragmentShader).toContain('colorspace_fragment');
    expect(material.fragmentShader).toContain('abs(direction.z)');
    expect(material.fragmentShader).toContain('mix(gl_FragColor.rgb, uHorizonOutput, horizon)');

    environment.update(0, anchor, camera);
    environment.update(30, anchor, camera);
    expect(atmosphere.geometry).toBe(geometry);
    expect(atmosphere.material).toBe(material);
    expect(atmosphere.position.toArray()).toEqual(camera.toArray());
    environment.setLowQuality(true);
    expect(atmosphere.visible).toBe(false);
    environment.setLowQuality(false);
    expect(atmosphere.visible).toBe(true);
  });

  it('keeps atmosphere endpoints finite, desaturated, and fog-readable', () => {
    const day = sampleAtmosphere(1);
    const shadow = sampleAtmosphere(0.28);
    for (const sample of [day, shadow]) {
      expect(sample.fogDensity).toBeGreaterThanOrEqual(0.00011);
      expect(sample.fogDensity).toBeLessThanOrEqual(0.00014);
      expect(sample.space.getHex()).not.toBe(sample.horizon.getHex());
      expect(sample.horizon.r).toBeGreaterThan(sample.space.r);
      expect(sample.horizon.g).toBeGreaterThan(sample.space.g);
      expect(sample.horizon.b).toBeGreaterThan(sample.space.b);
    }
    expect(day.horizon.getHex()).not.toBe(shadow.horizon.getHex());
    expect(shadow.fogDensity).toBeGreaterThan(day.fogDensity);
  });

  it('abandons render targets from a lost context without disposing them', () => {
    const environment = new Environment(29);
    const target = new THREE.WebGLRenderTarget(4, 4);
    const scene = new THREE.Scene();
    scene.environment = target.texture;
    const dispose = vi.spyOn(target, 'dispose');
    const shadowTarget = new THREE.WebGLRenderTarget(4, 4);
    const disposeShadow = vi.spyOn(shadowTarget, 'dispose');
    const exact = environment as unknown as {
      envTarget: THREE.WebGLRenderTarget | null;
      environmentScene: THREE.Scene | null;
    };
    exact.envTarget = target;
    exact.environmentScene = scene;
    environment.keyLight.shadow.map = shadowTarget;

    environment.handleContextLoss();

    expect(scene.environment).toBeNull();
    expect(exact.envTarget).toBeNull();
    expect(environment.keyLight.shadow.map).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    expect(disposeShadow).not.toHaveBeenCalled();
    environment.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(disposeShadow).not.toHaveBeenCalled();
  });
});
