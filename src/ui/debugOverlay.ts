/**
 * F3 overlay: frame timings, draw calls, camera state, world state.
 *
 * Performance budgets are only real if they are visible while you work, so this
 * is wired up from the first playable frame rather than added at the end.
 */

import { RING_CIRCUMFERENCE, RING_PERIOD, RING_RADIUS } from '@core/constants';
import type { CameraRig } from '@render/cameraRig';
import type { CameraController } from '@render/cameraController';
import type { Environment } from '@render/environment';
import type { Renderer } from '@render/renderer';
import type { Game } from '../game';

export class DebugOverlay {
  private el: HTMLDivElement;
  private toast: HTMLDivElement;
  private visible = false;
  private frames = 0;
  private elapsed = 0;
  private fps = 0;
  private frameMsTotal = 0;
  private simStepMsTotal = 0;
  private worstMs = 0;
  private toastTimer = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; top: 10px; left: 12px; z-index: 40;
      font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #b9c6d4; background: rgba(6, 10, 16, 0.62);
      border: 1px solid rgba(150, 180, 210, 0.14); border-left: 2px solid #f0821e;
      padding: 8px 12px; white-space: pre; pointer-events: none;
      backdrop-filter: blur(6px); letter-spacing: 0.02em;
      display: none;
    `;
    this.el.setAttribute('data-rww-debug-overlay', '');
    this.el.textContent = [
      'RING WORLD WAR                    F3 to hide',
      '',
      'Frame      n/a',
      'FPS        n/a',
      'Render     n/a',
      'Draw calls n/a',
      'Active entities n/a',
      'Sim step   n/a',
      'Memory     n/a',
    ].join('\n');
    document.body.appendChild(this.el);

    this.toast = document.createElement('div');
    this.toast.style.cssText = `
      position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
      z-index: 40; font: 12px/1 system-ui, sans-serif; letter-spacing: 0.18em;
      text-transform: uppercase; color: #e8eef5;
      background: rgba(6, 10, 16, 0.78); padding: 10px 20px;
      border: 1px solid rgba(150, 180, 210, 0.2);
      opacity: 0; transition: opacity 0.25s ease; pointer-events: none;
    `;
    document.body.appendChild(this.toast);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  flash(message: string): void {
    this.toast.textContent = message;
    this.toast.style.opacity = '1';
    this.toastTimer = 1.6;
  }

  update(
    dt: number,
    renderer: Renderer,
    game: Game,
    rig: CameraRig,
    cameraController: CameraController,
    env: Environment,
  ): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.style.opacity = '0';
    }

    this.frames++;
    this.elapsed += dt;
    const frameMs = dt * 1000;
    this.frameMsTotal += frameMs;
    this.simStepMsTotal += game.simStepMs;
    this.worstMs = Math.max(this.worstMs, frameMs);
    let activeEntities = 0;
    for (const unit of game.world.units) if (unit.alive) activeEntities++;
    for (const structure of game.world.structures) if (structure.alive) activeEntities++;
    const memory = readMemory();
    if (this.elapsed < 0.4) return;
    this.fps = this.frames / this.elapsed;
    const averageFrameMs = this.frameMsTotal / this.frames;
    const averageSimStepMs = this.simStepMsTotal / this.frames;
    const worst = this.worstMs;
    this.frames = 0;
    this.elapsed = 0;
    this.frameMsTotal = 0;
    this.simStepMsTotal = 0;
    this.worstMs = 0;

    if (!this.visible) return;

    const info = renderer.gl.info;
    const pct = ((rig.s / RING_CIRCUMFERENCE) * 100).toFixed(1);
    const tris = renderer.triangles;

    this.el.textContent = [
      `RING WORLD WAR                    F3 to hide`,
      ``,
      `Frame      ${averageFrameMs.toFixed(2)} ms   worst ${worst.toFixed(1)} ms`,
      `FPS        ${this.fps.toFixed(0).padStart(4)}`,
      `Render     ${renderer.frameMs.toFixed(2)} ms`,
      `Draw calls ${String(renderer.drawCalls).padStart(4)}   tris ${(tris / 1000).toFixed(0)}k`,
      `Active entities ${String(activeEntities).padStart(4)}`,
      `Sim step   ${averageSimStepMs.toFixed(2)} ms`,
      `Memory     ${memory}`,
      `programs   ${info.programs?.length ?? 0}   textures ${info.memory.textures}`,
      `quality    ${renderer.quality}   (shift+1..4)`,
      ``,
      `camera     ${cameraController.mode}  s ${rig.s.toFixed(0)}m  z ${rig.z.toFixed(0)}m  (${pct}% round)`,
      `zoom       ${rig.distance.toFixed(0)}m   pitch ${((rig.pitch * 180) / Math.PI).toFixed(0)}deg`,
      ``,
      `daylight   ${(env.cycle.daylight * 100).toFixed(0)}%`,
      `clock      ${env.cycle.time.toFixed(0)}s`,
      ``,
      `ring       R ${RING_RADIUS}m  C ${(RING_CIRCUMFERENCE / 1000).toFixed(2)}km`,
      `           spin ${RING_PERIOD.toFixed(0)}s  far side ${(2 * RING_RADIUS) / 1000}km up`,
    ].join('\n');
  }

  dispose(): void {
    this.el.remove();
    this.toast.remove();
  }
}

function readMemory(): string {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  const bytes = memory?.usedJSHeapSize;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'n/a';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
