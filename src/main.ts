/**
 * Entry point.
 *
 * Boots the world in stages so the loading screen can report progress, then
 * runs the frame loop: fixed-timestep simulation, then rendering.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { RenderAnchor } from '@render/anchor';
import { CameraRig } from '@render/cameraRig';
import { Environment } from '@render/environment';
import { InputController } from '@render/input';
import { Renderer, type QualityLevel } from '@render/renderer';
import { RingMesh } from '@render/ringMesh';
import { BUILDABLE, STRUCTURES } from '@sim/data';
import { Game } from './game';
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
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? '20260731') || 20260731;

  await boot.step(0.08, 'surveying the ring');
  const anchor = new RenderAnchor();
  const rig = new CameraRig(container.clientWidth / container.clientHeight);
  rig.setFocus(0, 0);
  anchor.set(0, 0);

  const renderer = new Renderer(
    container,
    rig.camera,
    pickQuality(params),
    params.get('post') === '1',
  );

  await boot.step(0.3, 'generating terrain');
  const game = new Game(seed, anchor, rig);

  await boot.step(0.62, 'tessellating the floor');
  const ringMesh = new RingMesh(game.terrain);
  renderer.scene.add(ringMesh.object);

  await boot.step(0.86, 'igniting the solar filament');
  const environment = new Environment(seed);
  renderer.scene.add(environment.group);
  environment.buildEnvironment(renderer.gl, renderer.scene);
  environment.keyLight.shadow.mapSize.setScalar(renderer.currentSettings.shadowMapSize);
  for (const o of game.objects) renderer.scene.add(o);

  // Aerial perspective. Inside a ring you are always looking through kilometres
  // of air at more world, so haze does most of the depth cueing.
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), 0.000105);
  renderer.scene.fog = fog;
  ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;

  const input = new InputController(renderer.gl.domElement, rig);
  const overlay = new DebugOverlay();

  wireCommands(renderer.gl.domElement, game, rig);
  wireKeys(game, renderer, environment, ringMesh, overlay);

  await boot.step(1.0, 'ready');
  boot.hide();
  game.hud.alert('Select an engineer — build extractors, then a Fabricator');

  // ---------------------------------------------------------------- loop ----
  let last = performance.now();
  let time = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;

    input.update(dt);
    rig.update(dt, anchor, game.terrain);

    // Re-base the floating origin onto the camera when it drifts far enough.
    const prevS = anchor.s;
    const prevZ = anchor.z;
    if (anchor.update(rig.s, rig.z)) {
      ringMesh.syncToAnchor(anchor);
      game.onRebase(prevS, prevZ);
    }

    game.effects.viewportHeight = renderer.gl.getContext().drawingBufferHeight;
    game.update(dt, time);
    environment.update(dt, anchor, rig.camera.position);

    ringMesh.uniforms.uTime.value = time;
    ringMesh.uniforms.uPanelPhase.value = environment.cycle.filamentAngle;
    ringMesh.uniforms.uAmbientTint.value.copy(environment.cycle.hazeColor);
    renderer.setBloomBoost(game.effects.flash);

    fog.color.copy(environment.fogColor);
    (renderer.scene.background as THREE.Color).copy(environment.fogColor).multiplyScalar(0.5);

    renderer.render(dt);
    overlay.update(dt, renderer, rig, environment);

    if (game.hud.restartRequested) location.reload();
  }

  // Exposed for debugging and for the screenshot tool to interrogate.
  (window as unknown as { RWW: unknown }).RWW = {
    game,
    rig,
    anchor,
    renderer,
    environment,
    ringMesh,
    probe: () => ({
      camPos: rig.camera.position.toArray(),
      camUp: rig.camera.up.toArray(),
      near: rig.camera.near,
      far: rig.camera.far,
      fov: rig.camera.fov,
      dist: rig.distance,
      pitch: rig.pitch,
      anchorS: anchor.s,
      focusS: rig.s,
      ringPos: ringMesh.object.position.toArray(),
      ringRotZ: ringMesh.object.rotation.z,
      units: game.world.units.length,
      structures: game.world.structures.length,
    }),
  };

  ringMesh.syncToAnchor(anchor);
  frame();

  window.addEventListener('resize', () =>
    renderer.resize(container.clientWidth, container.clientHeight),
  );
}

/**
 * Mouse commands. Left selects (click or drag box), right issues orders, and
 * while a structure is held the left button places it instead.
 */
function wireCommands(canvas: HTMLElement, game: Game, rig: CameraRig): void {
  let dragging = false;
  let dragStart: { s: number; z: number } | null = null;
  let downX = 0;
  let downY = 0;

  const ndc = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    };
  };

  canvas.addEventListener('pointermove', (e) => {
    const p = ndc(e);
    const hit = game.pickGround(p.x, p.y, rig.camera);
    if (hit) {
      game.cursor.s = hit.s;
      game.cursor.z = hit.z;
      game.cursor.valid = true;
    } else {
      game.cursor.valid = false;
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      downX = e.clientX;
      downY = e.clientY;
      const p = ndc(e);
      const hit = game.pickGround(p.x, p.y, rig.camera);
      if (hit) {
        dragging = true;
        dragStart = hit;
      }
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 2) {
      const p = ndc(e);
      const hit = game.pickGround(p.x, p.y, rig.camera);
      if (hit) {
        if (game.hud.placing) game.hud.placing = null;
        else game.issueOrder(hit.s, hit.z, e.ctrlKey);
      }
      return;
    }
    if (e.button !== 0 || !dragging || !dragStart) return;
    dragging = false;

    const p = ndc(e);
    const hit = game.pickGround(p.x, p.y, rig.camera);
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);

    if (game.hud.placing && hit) {
      game.tryBuild(hit.s, hit.z);
    } else if (hit && moved > 6) {
      game.selectBox(dragStart.s, dragStart.z, hit.s, hit.z, e.shiftKey);
    } else if (hit) {
      game.selectAt(hit.s, hit.z, e.shiftKey);
    }
    dragStart = null;
  });
}

function wireKeys(
  game: Game,
  renderer: Renderer,
  environment: Environment,
  ringMesh: RingMesh,
  overlay: DebugOverlay,
): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (game.hud.placing) game.hud.placing = null;
      else game.selection.clear();
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      overlay.toggle();
      return;
    }
    if (e.code === 'KeyG' && e.ctrlKey) {
      e.preventDefault();
      game.selectAllCombat();
      return;
    }

    // Build hotkeys, but only when an engineer is selected so that they do not
    // fight with the camera's WASD.
    const hasEngineer = [...game.selection].some((id) => {
      const u = game.world.unitById(id);
      return u && u.kind === 'engineer';
    });
    if (hasEngineer && !e.ctrlKey && !e.shiftKey) {
      for (const kind of BUILDABLE) {
        const hk = STRUCTURES[kind].hotkey;
        if (hk && e.code === `Key${hk}`) {
          e.preventDefault();
          game.setBuild(game.hud.placing === kind ? null : kind);
          return;
        }
      }
    }

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
  });
}

function pickQuality(params: URLSearchParams): QualityLevel {
  const forced = params.get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high' || forced === 'ultra') {
    return forced;
  }
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

function checkWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
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
