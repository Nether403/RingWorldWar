import type { Terrain } from '@gen/terrain';
import type { RenderAnchor } from './anchor';
import { CameraRig } from './cameraRig';

export type CameraMode =
  | 'tactical'
  | 'direct'
  | 'whole-ring'
  | 'briefing'
  | 'gravity-range'
  | 'cannon-arena';

export interface CameraCapabilities {
  readonly pan: boolean;
  readonly zoom: boolean;
  readonly rotate: boolean;
  readonly directMovement: boolean;
}

export interface CameraUpdateContext {
  readonly anchor: RenderAnchor;
  readonly terrain: Terrain;
}

export interface CameraModeController {
  readonly mode: CameraMode;
  readonly capabilities: CameraCapabilities;
  enter(): boolean;
  update(dt: number, context: CameraUpdateContext): void;
  exit(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface CameraControlSurface {
  readonly mode: CameraMode;
  readonly capabilities: CameraCapabilities;
  pan(right: number, forward: number): void;
  zoom(delta: number): void;
  rotate(delta: number): void;
}

export type CameraModeRequestResult =
  | { ok: true; mode: CameraMode }
  | {
    ok: false;
    mode: CameraMode;
    reason:
      | 'unsupported-camera-mode'
      | 'camera-mode-enter-failed'
      | 'camera-mode-exit-failed'
      | 'camera-controller-disposed';
  };

const TACTICAL_CAPABILITIES: CameraCapabilities = Object.freeze({
  pan: true,
  zoom: true,
  rotate: true,
  directMovement: false,
});

const DIRECT_CAPABILITIES: CameraCapabilities = Object.freeze({
  pan: false,
  zoom: false,
  rotate: false,
  directMovement: true,
});

class RigModeController implements CameraModeController {
  constructor(
    readonly mode: 'tactical' | 'direct',
    readonly capabilities: CameraCapabilities,
    private readonly rig: CameraRig,
  ) {}

  enter(): boolean {
    if (this.mode === 'direct') this.rig.enterDirect();
    return true;
  }

  update(dt: number, context: CameraUpdateContext): void {
    this.rig.update(dt, context.anchor, context.terrain);
  }

  exit(): void {
    if (this.mode === 'direct') this.rig.exitDirect();
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(2, Math.round(width));
    const safeHeight = Math.max(2, Math.round(height));
    this.rig.camera.aspect = safeWidth / safeHeight;
    this.rig.camera.updateProjectionMatrix();
  }

  dispose(): void {}
}

export class CameraController implements CameraControlSurface {
  private readonly controllers = new Map<CameraMode, CameraModeController>();
  private active: CameraModeController | null = null;
  private disposed = false;

  constructor(
    private readonly rig: CameraRig,
    controllers: readonly CameraModeController[] = [
      new RigModeController('tactical', TACTICAL_CAPABILITIES, rig),
      new RigModeController('direct', DIRECT_CAPABILITIES, rig),
    ],
  ) {
    for (const controller of controllers) {
      if (this.controllers.has(controller.mode)) throw new Error(`Duplicate camera mode: ${controller.mode}`);
      this.controllers.set(controller.mode, controller);
    }
    const tactical = this.controllers.get('tactical');
    if (!tactical || !this.tryEnter(tactical)) throw new Error('Camera controller requires an enterable tactical mode');
  }

  get mode(): CameraMode {
    return this.active?.mode ?? 'tactical';
  }

  get capabilities(): CameraCapabilities {
    return this.active?.capabilities ?? TACTICAL_CAPABILITIES;
  }

  get availableModes(): CameraMode[] {
    return [...this.controllers.keys()];
  }

  requestMode(mode: CameraMode): CameraModeRequestResult {
    if (this.disposed) return { ok: false, mode, reason: 'camera-controller-disposed' };
    const next = this.controllers.get(mode);
    if (!next) return { ok: false, mode, reason: 'unsupported-camera-mode' };
    if (this.active === next) return { ok: true, mode };

    const previous = this.active;
    try {
      previous?.exit();
    } catch {
      if (!previous || !this.tryEnter(previous)) {
        throw new Error(`Camera mode ${previous?.mode ?? 'unknown'} could not recover after exit failure`);
      }
      return { ok: false, mode, reason: 'camera-mode-exit-failed' };
    }
    this.active = null;
    if (this.tryEnter(next)) return { ok: true, mode };

    // A failed controller may have acquired resources before reporting failure.
    try {
      next.exit();
    } catch {
      // Rollback still has priority over a defective failed controller's cleanup.
    }
    const tactical = this.controllers.get('tactical');
    if (!tactical || !this.tryEnter(tactical)) {
      throw new Error(`Camera mode ${mode} failed and tactical rollback could not enter`);
    }
    return { ok: false, mode, reason: 'camera-mode-enter-failed' };
  }

  update(dt: number, context: CameraUpdateContext): void {
    this.active?.update(dt, context);
  }

  resize(width: number, height: number): void {
    this.active?.resize(width, height);
  }

  pan(right: number, forward: number): void {
    if (this.capabilities.pan) this.rig.pan(right, forward);
  }

  zoom(delta: number): void {
    if (this.capabilities.zoom) this.rig.zoom(delta);
  }

  rotate(delta: number): void {
    if (this.capabilities.rotate) this.rig.rotate(delta);
  }

  followDirect(s: number, z: number, yaw: number): void {
    if (this.mode === 'direct') this.rig.followDirect(s, z, yaw);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.active?.exit();
    } catch {
      // Continue releasing the remaining camera owners.
    }
    this.active = null;
    for (const controller of this.controllers.values()) {
      try {
        controller.dispose();
      } catch {
        // One defective mode must not retain every other controller.
      }
    }
    this.controllers.clear();
  }

  private tryEnter(controller: CameraModeController): boolean {
    try {
      if (!controller.enter()) return false;
      this.active = controller;
      return true;
    } catch {
      return false;
    }
  }
}
