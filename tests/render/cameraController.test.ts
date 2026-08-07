import { describe, expect, it, vi } from 'vitest';
import { CameraController, type CameraCapabilities, type CameraModeController } from '@render/cameraController';
import { CameraRig } from '@render/cameraRig';

const tacticalCapabilities: CameraCapabilities = {
  pan: true,
  zoom: true,
  rotate: true,
  directMovement: false,
};

const directCapabilities: CameraCapabilities = {
  pan: false,
  zoom: false,
  rotate: false,
  directMovement: true,
};

function lifecycle(mode: CameraModeController['mode'], events: string[], enter = true): CameraModeController {
  return {
    mode,
    capabilities: tacticalCapabilities,
    enter: () => { events.push(`${mode}:enter`); return enter; },
    update: () => events.push(`${mode}:update`),
    exit: () => events.push(`${mode}:exit`),
    resize: (width, height) => events.push(`${mode}:resize:${width}x${height}`),
    dispose: () => events.push(`${mode}:dispose`),
  };
}

describe('CameraController', () => {
  it('names the frozen camera modes while only tactical and direct are registered', () => {
    const camera = new CameraController(new CameraRig(1));

    expect(camera.availableModes).toEqual(['tactical', 'direct']);
    expect(camera.requestMode('whole-ring')).toEqual({
      ok: false,
      mode: 'whole-ring',
      reason: 'unsupported-camera-mode',
    });
    expect(camera.mode).toBe('tactical');
  });

  it('is idempotent and exits the old owner before entering the new owner', () => {
    const events: string[] = [];
    const camera = new CameraController(new CameraRig(1), [
      lifecycle('tactical', events),
      lifecycle('direct', events),
    ]);
    events.length = 0;

    expect(camera.requestMode('tactical').ok).toBe(true);
    expect(events).toEqual([]);
    expect(camera.requestMode('direct').ok).toBe(true);
    expect(events).toEqual(['tactical:exit', 'direct:enter']);
    expect(camera.mode).toBe('direct');
    camera.update(0, {} as Parameters<CameraController['update']>[1]);
    expect(events.at(-1)).toBe('direct:update');
  });

  it('rolls a failed enter back to one defined tactical owner', () => {
    const events: string[] = [];
    const camera = new CameraController(new CameraRig(1), [
      lifecycle('tactical', events),
      lifecycle('direct', events, false),
    ]);
    events.length = 0;

    expect(camera.requestMode('direct')).toEqual({
      ok: false,
      mode: 'direct',
      reason: 'camera-mode-enter-failed',
    });
    expect(events).toEqual(['tactical:exit', 'direct:enter', 'direct:exit', 'tactical:enter']);
    expect(camera.mode).toBe('tactical');
    expect(camera.capabilities).toEqual(tacticalCapabilities);
  });

  it('keeps the direct owner and capabilities when its exit fails', () => {
    const events: string[] = [];
    const direct: CameraModeController = {
      ...lifecycle('direct', events),
      capabilities: directCapabilities,
      exit: () => {
        events.push('direct:exit');
        throw new Error('injected exit failure');
      },
    };
    const camera = new CameraController(new CameraRig(1), [
      lifecycle('tactical', events),
      direct,
    ]);
    camera.requestMode('direct');
    events.length = 0;

    expect(camera.requestMode('tactical')).toEqual({
      ok: false,
      mode: 'tactical',
      reason: 'camera-mode-exit-failed',
    });
    expect(events).toEqual(['direct:exit', 'direct:enter']);
    expect(camera.mode).toBe('direct');
    expect(camera.capabilities).toEqual(directCapabilities);
  });

  it('routes update and resize to the active owner and updates projection', () => {
    const rig = new CameraRig(1);
    const projection = vi.spyOn(rig.camera, 'updateProjectionMatrix');
    const camera = new CameraController(rig);

    camera.resize(1600, 800);

    expect(rig.camera.aspect).toBe(2);
    expect(projection).toHaveBeenCalledOnce();
  });

  it('disposes the active owner and every registered controller exactly once', () => {
    const events: string[] = [];
    const camera = new CameraController(new CameraRig(1), [
      lifecycle('tactical', events),
      lifecycle('direct', events),
    ]);
    camera.requestMode('direct');
    events.length = 0;

    camera.dispose();
    camera.dispose();

    expect(events).toEqual(['direct:exit', 'tactical:dispose', 'direct:dispose']);
  });

  it('restores tactical distance and preserves wrapped direct focus', () => {
    const rig = new CameraRig(1);
    const camera = new CameraController(rig);
    rig.zoom(2);
    const savedTarget = (rig as unknown as { targetDistance: number }).targetDistance;

    expect(camera.requestMode('direct').ok).toBe(true);
    camera.followDirect(2 * Math.PI * 3600 + 12, 25, 0.7);
    expect(rig.s).toBeCloseTo(12);
    expect(rig.z).toBe(25);
    expect(rig.yaw).toBe(0.7);

    expect(camera.requestMode('tactical').ok).toBe(true);
    expect((rig as unknown as { targetDistance: number }).targetDistance).toBe(savedTarget);
  });
});
