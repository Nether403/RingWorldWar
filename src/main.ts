/**
 * Entry point.
 *
 * Boots the world in stages so the loading screen can report progress, then
 * runs the frame loop. Simulation and rendering are kept separate from here on:
 * the sim advances on a fixed timestep and the renderer interpolates between
 * its states.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { createTerrain } from '@gen/terrain';
import { RenderAnchor } from '@render/anchor';
import { CameraRig } from '@render/cameraRig';
import { Environment } from '@render/environment';
import { Renderer, type QualityLevel } from '@render/renderer';
import { RingMesh } from '@render/ringMesh';
import { InputController } from '@render/input';
import { DebugOverlay } from '@ui/debugOverlay';

const boot = {
  el: document.getElementById('boot')!,
  bar: document.querySelector<HTMLElement>('#bootbar > i')!,
  msg: document.getElementById('bootmsg')!,
  step(fraction: number, message: string): Promise<void> {
    this.bar.style.right = `${(1 - fraction) * 100}%`;
    this.msg.textContent = message;
    // Yield so the browser can actually paint the progress update.
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  },
  fail(err: unknown): void {
    this.msg.className = 'err';
    this.msg.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    // eslint-disable-next-line no-console
    console.error(err);
  },
  hide(): void {
    this.el.classList.add('hidden');
    setTimeout(() => this.el.remove(), 900);
  },
};

async function start(): Promise<void> {
  const container = document.getElementById('app')!;
  const seed = 20260731;

  await boot.step(0.05, 'surveying the ring');
  const terrain = createTerrain(seed);

  await boot.step(0.35, 'raising the megastructure');
  const anchor = new RenderAnchor();
  const rig = new CameraRig(container.clientWidth / container.clientHeight);
  // Start looking at the spinward base.
  rig.setFocus(0, 0);
  anchor.set(0, 0);

  const quality = pickQuality();
  const renderer = new Renderer(container, rig.camera, quality);

  await boot.step(0.6, 'tessellating the floor');
  const ringMesh = new RingMesh(terrain);
  renderer.scene.add(ringMesh.object);

  await boot.step(0.85, 'igniting the solar filament');
  const environment = new Environment(seed);
  renderer.scene.add(environment.group);
  environment.keyLight.shadow.mapSize.setScalar(renderer.currentSettings.shadowMapSize);

  // Aerial perspective. Inside a ring you are always looking through kilometres
  // of air at more world, so haze is doing a lot of the depth cueing.
  // Tuned so the far side of the ring, 7.2 km overhead, sits at roughly 60%
  // haze: clearly distant, but you can still make out terrain and bases on it.
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), 0.000105);
  renderer.scene.fog = fog;

  ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;

  const input = new InputController(renderer.gl.domElement, rig);
  const overlay = new DebugOverlay();

  await boot.step(1.0, 'ready');
  boot.hide();

  // ---------------------------------------------------------------- loop ----
  let last = performance.now();
  let acc = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;

    input.update(dt);
    rig.update(dt, anchor, terrain);

    // Re-base the floating origin onto the camera's focus when it drifts.
    if (anchor.update(rig.s, rig.z)) {
      ringMesh.syncToAnchor(anchor);
    }

    environment.update(dt, anchor, rig.camera.position);

    // Keep the terrain shader in step with the shadow squares.
    ringMesh.uniforms.uTime.value = acc;
    ringMesh.uniforms.uPanelPhase.value = environment.cycle.filamentAngle;
    ringMesh.uniforms.uAmbientTint.value.copy(environment.cycle.hazeColor);

    fog.color.copy(environment.fogColor);
    (renderer.scene.background as THREE.Color).copy(environment.fogColor).multiplyScalar(0.55);

    renderer.render(dt);
    overlay.update(dt, renderer, rig, environment);
  }

  ringMesh.syncToAnchor(anchor);
  frame();

  // ------------------------------------------------------------- resize ----
  const onResize = (): void => renderer.resize(container.clientWidth, container.clientHeight);
  window.addEventListener('resize', onResize);

  // Quality hotkeys, useful while tuning.
  window.addEventListener('keydown', (e) => {
    const levels: Record<string, QualityLevel> = {
      Digit1: 'low',
      Digit2: 'medium',
      Digit3: 'high',
      Digit4: 'ultra',
    };
    const level = levels[e.code];
    if (level && e.shiftKey) {
      renderer.setQuality(level);
      environment.keyLight.shadow.mapSize.setScalar(renderer.currentSettings.shadowMapSize);
      environment.keyLight.shadow.map?.dispose();
      environment.keyLight.shadow.map = null;
      ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;
      overlay.flash(`quality: ${level}`);
    }
    if (e.code === 'F3') {
      e.preventDefault();
      overlay.toggle();
    }
  });
}

/** Guess a sensible starting quality from the device, unless overridden. */
function pickQuality(): QualityLevel {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high' || forced === 'ultra') {
    return forced;
  }
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

/** Sanity check before we try to create a context. */
function checkWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!checkWebGL2()) {
  boot.fail(new Error('This game needs WebGL 2, which this browser did not provide.'));
} else {
  start().catch((e) => boot.fail(e));
}

/** Arc distance between the two starting bases, for reference. */
export const BASE_SEPARATION = RING_CIRCUMFERENCE / 2;
