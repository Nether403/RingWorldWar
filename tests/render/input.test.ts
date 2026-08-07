import { describe, expect, it } from 'vitest';
import { InputController } from '@render/input';
import type { CameraControlSurface } from '@render/cameraController';

describe('InputController camera capability isolation', () => {
  it('does not leak tactical pan or rotate into a non-tactical camera mode', () => {
    const calls: string[] = [];
    const camera: CameraControlSurface = {
      mode: 'direct',
      capabilities: { pan: false, zoom: false, rotate: false, directMovement: true },
      pan: () => calls.push('pan'),
      zoom: () => calls.push('zoom'),
      rotate: () => calls.push('rotate'),
    };
    const input = Object.create(InputController.prototype) as InputController;
    Object.assign(input, {
      camera,
      enabled: true,
      keys: new Set(['KeyW', 'KeyQ', 'KeyR']),
      pointerInside: false,
      edgePanArmed: false,
      rotating: false,
    });

    input.update(1 / 60);

    expect(calls).toEqual([]);
    expect(input.moveForward).toBe(1);
  });

  it('evaluates each modal capability independently and gates direct movement', () => {
    const calls: string[] = [];
    const capabilities = { pan: false, zoom: true, rotate: true, directMovement: false };
    const camera: CameraControlSurface = {
      mode: 'briefing',
      capabilities,
      pan: () => calls.push('pan'),
      zoom: () => calls.push('zoom'),
      rotate: () => calls.push('rotate'),
    };
    const input = Object.create(InputController.prototype) as InputController;
    Object.assign(input, {
      camera,
      enabled: true,
      keys: new Set(['KeyW', 'KeyQ', 'KeyR']),
      pointerInside: false,
      edgePanArmed: false,
      rotating: false,
    });

    input.update(1 / 60);

    expect(calls).toEqual(['rotate', 'zoom']);
    expect(input.moveForward).toBe(0);
  });
});
