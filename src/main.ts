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
import { Settings } from '@render/settings';
import { RingMesh } from '@render/ringMesh';
import { BUILDABLE, STRUCTURES } from '@sim/data';
import { Game } from './game';
import { DebugOverlay } from '@ui/debugOverlay';
import { SettingsMenu } from '@ui/settingsMenu';

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
  const settings = new Settings({ search: params });

  await boot.step(0.08, 'surveying the ring');
  const anchor = new RenderAnchor();
  const rig = new CameraRig(container.clientWidth / container.clientHeight);
  rig.setFocus(0, 0);
  anchor.set(0, 0);

  const renderer = new Renderer(container, rig.camera, settings.quality);
  renderer.autoQuality = settings.adaptiveQuality;

  await boot.step(0.3, 'generating terrain');
  const game = new Game(seed, anchor, rig);

  await boot.step(0.62, 'tessellating the floor');
  const ringMesh = new RingMesh(game.terrain);
  renderer.scene.add(ringMesh.object);

  await boot.step(0.86, 'igniting the solar filament');
  const environment = new Environment(seed);
  renderer.scene.add(environment.group);
  environment.buildEnvironment(renderer.gl, renderer.scene);
  const applyRenderQuality = (): void => {
    const quality = renderer.currentSettings;
    environment.keyLight.shadow.mapSize.setScalar(quality.shadowMapSize);
    // Three's shadow renderer can still reference the current target during a
    // quality transition. Disposing it after shadows were disabled invalidates
    // the following forward pass on some ANGLE backends, leaving only the
    // background and custom star shader. Keep the dormant map on Low; when
    // shadows are enabled, rebuilding it is safe and applies the new size.
    if (quality.shadows) {
      environment.keyLight.shadow.map?.dispose();
      environment.keyLight.shadow.map = null;
    }
    ringMesh.uniforms.uDetailFade.value = quality.detailFade;
    game.effects.setParticleCap(quality.particleCap);
  };
  renderer.onQualityChange = applyRenderQuality;
  applyRenderQuality();
  for (const o of game.objects) renderer.scene.add(o);

  // Aerial perspective. Inside a ring you are always looking through kilometres
  // of air at more world, so haze does most of the depth cueing.
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), 0.000105);
  renderer.scene.fog = fog;
  ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;

  const input = new InputController(renderer.gl.domElement, rig);
  const overlay = new DebugOverlay();
  const menu = new SettingsMenu(settings, renderer, (open) => input.setEnabled(!open));
  menu.onSave = () => game.saveGame();
  menu.onLoad = () => game.loadGame();

  wireCommands(renderer.gl.domElement, game, rig, () => !menu.isOpen);
  wireKeys(game, renderer, overlay, input, settings, menu);

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

    input.setDirectMode(game.directControlActive);
    input.update(dt);
    game.updateDirectControl(input.moveForward, input.moveRight);
    rig.update(dt, anchor, game.terrain);

    // Re-base the floating origin onto the camera when it drifts far enough.
    const prevS = anchor.s;
    const prevZ = anchor.z;
    if (anchor.update(rig.s, rig.z)) {
      ringMesh.syncToAnchor(anchor);
      game.onRebase(prevS, prevZ);
      rig.update(0, anchor, game.terrain);
    }

    game.effects.viewportHeight = renderer.gl.getContext().drawingBufferHeight;
    game.update(dt, time);
    environment.update(game.world.time, anchor, rig.camera.position);

    ringMesh.uniforms.uTime.value = time;
    ringMesh.uniforms.uPanelPhase.value = environment.cycle.filamentAngle;
    ringMesh.uniforms.uAmbientTint.value.copy(environment.cycle.hazeColor);
    ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;
    fog.color.copy(environment.fogColor);
    (renderer.scene.background as THREE.Color).copy(environment.fogColor).multiplyScalar(0.5);

    renderer.render(dt);
    overlay.update(dt, renderer, game, rig, environment);

    if (game.hud.restartRequested) location.reload();
  }

  // Exposed for debugging and for the screenshot tool to interrogate.
  (window as unknown as { RWW: unknown }).RWW = {
    game,
    rig,
    anchor,
    renderer,
    settings,
    menu,
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
function wireCommands(
  canvas: HTMLElement,
  game: Game,
  rig: CameraRig,
  gameplayInputEnabled: () => boolean,
): void {
  let dragging = false;
  let dragStart: { s: number; z: number } | null = null;
  let downX = 0;
  let downY = 0;
  let activePointer = -1;
  let suppressCommand = false;

  const ndc = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    };
  };

  canvas.addEventListener('pointermove', (e) => {
    if (!gameplayInputEnabled()) return;
    const p = ndc(e);
    const hit = game.pickGround(p.x, p.y, rig.camera);
    if (hit) {
      game.updateCursor(hit.s, hit.z);
    } else {
      game.cursor.valid = false;
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!gameplayInputEnabled()) return;
    activePointer = e.pointerId;
    suppressCommand = e.button === 2 && e.shiftKey;
    canvas.setPointerCapture(e.pointerId);
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
    if (!gameplayInputEnabled()) {
      activePointer = -1;
      dragging = false;
      dragStart = null;
      suppressCommand = false;
      return;
    }
    if (e.pointerId !== activePointer) return;
    activePointer = -1;
    if (suppressCommand) {
      suppressCommand = false;
      return;
    }
    if (e.button === 2) {
      const p = ndc(e);
      const hit = game.pickGround(p.x, p.y, rig.camera);
      if (hit) {
        if (game.directControlActive) return;
        if (game.hud.placing) game.hud.placing = null;
        else if (game.artilleryTargeting) game.cancelArtilleryTarget();
        else game.issueOrder(hit.s, hit.z, e.ctrlKey);
      }
      return;
    }
    if (e.button !== 0 || !dragging || !dragStart) return;
    dragging = false;

    const p = ndc(e);
    const hit = game.pickGround(p.x, p.y, rig.camera);
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);

    if (game.directControlActive && hit) {
      game.directAttack(hit.s, hit.z);
    } else if (game.artilleryTargeting && hit) {
      game.fireArtilleryTarget(hit.s, hit.z);
    } else if (game.hud.placing && hit) {
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
  overlay: DebugOverlay,
  input: InputController,
  settings: Settings,
  menu: SettingsMenu,
): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      input.consume(e.code);
      e.preventDefault();
      if (menu.isOpen) {
        menu.close();
      } else {
        game.cancelInteractions();
        input.setDirectMode(false);
        menu.open();
      }
      return;
    }
    if (e.code === 'KeyV' && !e.ctrlKey && !e.shiftKey && !game.directControlActive) {
      if (game.enterDirectControl()) {
        input.consume(e.code);
        input.setDirectMode(true);
        e.preventDefault();
        return;
      }
    }
    if (e.code === 'F3') {
      input.consume(e.code);
      e.preventDefault();
      overlay.toggle();
      return;
    }
    if (menu.isOpen) {
      input.consume(e.code);
      return;
    }
    if (e.code === 'KeyX' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      input.consume(e.code);
      e.preventDefault();
      game.toggleSelectedAbility();
      return;
    }
    if (game.directControlActive) return;
    if (e.code === 'KeyG' && e.ctrlKey) {
      input.consume(e.code);
      e.preventDefault();
      game.selectAllCombat();
      return;
    }

    const group = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (group && !e.shiftKey) {
      input.consume(e.code);
      e.preventDefault();
      if (e.ctrlKey || e.altKey) game.setControlGroup(Number(group));
      else game.recallControlGroup(Number(group));
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
          input.consume(e.code);
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
      // Choosing a preset by hand turns the governor off; the player has said
      // what they want and having it silently overridden would be maddening.
      settings.setQuality(level);
      settings.apply(renderer);
      input.consume(e.code);
      overlay.flash(`quality: ${level} (auto off)`);
    }
    if (e.code === 'KeyP' && e.shiftKey) {
      input.consume(e.code);
      settings.setAdaptiveQuality(!renderer.autoQuality, renderer.quality);
      settings.apply(renderer);
      overlay.flash(`adaptive quality: ${renderer.autoQuality ? 'on' : 'off'}`);
    }
  });
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
