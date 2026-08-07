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
import { CameraController } from '@render/cameraController';
import { Environment } from '@render/environment';
import { InputController } from '@render/input';
import { BASE_EXPOSURE, QUALITY, Renderer, type QualityLevel } from '@render/renderer';
import { Settings } from '@render/settings';
import { RingMesh } from '@render/ringMesh';
import { BattlefieldDressing } from '@render/battlefieldDressing';
import { BUILDABLE, Faction, STRUCTURES } from '@sim/data';
import { Game, SAVE_SLOT_KEY } from './game';
import { DebugOverlay } from '@ui/debugOverlay';
import { SettingsMenu } from '@ui/settingsMenu';
import { TitleScreen, type TitleAction } from '@ui/titleScreen';
import { ProceduralAudio, armAudioUnlock } from './audio/audioEngine';
import { createWebAudioBackend } from './audio/webAudioBackend';
import { VoiceDirector } from './audio/voiceDirector';
import { REVIEWED_VOICE_CLIPS } from './presentation/voiceMedia';
import { PRESENTATION_MEDIA, type PresentationMedia } from './presentation/media';
import { parseGameSaveSnapshot } from './gameSave';
import {
  resolveFirstContactMissionBindings,
} from './scenario/firstContact';
import { runtimeScenarioById, runtimeScenarioFromParams } from './scenario/route';
import type { RuntimeScenario } from './scenario/runtimeScenario';
import {
  completeCampaignMission,
  continueCampaign,
  loadCampaignProfile,
  recordCampaignFailure,
  recordCampaignReplayResult,
  replayCampaignMission,
  retryCampaignMission,
  saveCampaignProfile,
  startCampaignMission,
  type CampaignTransition,
} from './campaign/campaignProfile';
import { campaignMission } from './campaign/missionRegistry';
import {
  applyCampaignRouteContext,
  campaignRouteContextFromParams,
  type CampaignRouteContext,
  type CampaignRouteIntent,
} from './campaign/campaignRoute';

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

interface StartupMetrics {
  startedAt: number;
  firstPlayableAt: number | null;
  durationMilliseconds: number | null;
  shaderPrewarmMilliseconds: number | null;
}

class CleanupStack {
  private callbacks: Array<() => void> = [];
  isDisposed = false;

  defer(callback: () => void): void {
    if (this.isDisposed) {
      callback();
      return;
    }
    this.callbacks.push(callback);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (let index = this.callbacks.length - 1; index >= 0; index--) {
      try {
        this.callbacks[index]!();
      } catch (error) {
        // Complete the remaining teardown even when one owner is defective.
        // eslint-disable-next-line no-console
        console.error('Session teardown failed', error);
      }
    }
    this.callbacks.length = 0;
  }
}

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const routedRuntimeScenario = runtimeScenarioFromParams(params);
  const settings = new Settings({ search: params });
  const navigation = performance.getEntriesByType('navigation')[0];
  const startup: StartupMetrics = {
    startedAt: navigation?.startTime ?? 0,
    firstPlayableAt: null,
    durationMilliseconds: null,
    shaderPrewarmMilliseconds: null,
  };
  let titleError = '';
  while (true) {
    const cleanup = new CleanupStack();
    const titleScreenShown = routedRuntimeScenario === null && shouldShowTitleScreen(params);
    const campaignProfile = loadCampaignProfile(localStorage).profile;
    const routedCampaignSession = campaignRouteContextFromParams(
      params,
      routedRuntimeScenario?.id ?? null,
      campaignProfile,
    );
    const titleAction = titleScreenShown
      ? await showTitleScreen(settings, params, titleError, campaignProfile)
      : { kind: 'new-skirmish' as const, playerFaction: factionFromParams(params) };
    if (titleScreenShown) startup.startedAt = performance.now();
    try {
      let runtimeScenario = routedRuntimeScenario;
      let campaignSession = routedCampaignSession;
      if (titleAction.kind === 'campaign') {
        const transition = titleAction.intent === 'replay'
          ? replayCampaignMission(campaignProfile, titleAction.missionId)
          : titleAction.intent === 'continue'
            ? continueCampaign(campaignProfile)
            : startCampaignMission(campaignProfile, titleAction.missionId);
        saveCampaignProfile(localStorage, transition.profile);
        runtimeScenario = runtimeScenarioById(transition.launch.runtimeScenarioId);
        campaignSession = { missionId: transition.launch.missionId, intent: titleAction.intent };
        const route = new URL(location.href);
        route.searchParams.set('menu', '0');
        route.searchParams.set('scenario', transition.launch.runtimeScenarioId);
        applyCampaignRouteContext(route.searchParams, transition.launch, titleAction.intent);
        route.searchParams.delete('campaign');
        route.searchParams.delete('campaignMessage');
        history.replaceState(null, '', route);
      }
      await startSession(cleanup, startup, params, settings, titleAction, runtimeScenario, campaignSession);
      return;
    } catch (error) {
      cleanup.dispose();
      if (titleScreenShown && (titleAction.kind === 'continue' || titleAction.kind === 'campaign')) {
        titleError = error instanceof Error ? error.message : String(error);
        continue;
      }
      throw error;
    }
  }
}

async function startSession(
  cleanup: CleanupStack,
  startup: StartupMetrics,
  params: URLSearchParams,
  settings: Settings,
  titleAction: TitleAction,
  runtimeScenario: RuntimeScenario | null,
  campaignSession: CampaignRouteContext | null,
): Promise<void> {
  const container = document.getElementById('app')!;
  const scenarioDriverEnabled = import.meta.env.DEV && params.get('scenarioDriver') === '1';
  const requestedSeed = Number(params.get('seed') ?? '20260731') || 20260731;
  const seed = runtimeScenario?.worldSeed ?? requestedSeed;
  const playerFaction = runtimeScenario?.playerFaction ?? (titleAction.kind === 'continue'
    ? savedPlayerFaction()
    : titleAction.kind === 'campaign'
      ? campaignMission(titleAction.missionId).faction
      : titleAction.playerFaction);
  const startS = playerFaction === Faction.Compact ? 0 : RING_CIRCUMFERENCE * 0.5;

  await boot.step(0.08, 'surveying the ring');
  const anchor = new RenderAnchor();
  const rig = new CameraRig(container.clientWidth / container.clientHeight);
  const cameraController = new CameraController(rig);
  if (runtimeScenario) {
    const view = runtimeScenario.openingView;
    rig.setView(view.focusS, view.focusZ, view.yawRadians, view.zoom);
  } else {
    rig.setFocus(startS, 0);
  }
  anchor.set(rig.s, rig.z);

  const renderer = new Renderer(container, rig.camera, settings.quality);
  cleanup.defer(() => renderer.dispose());
  cleanup.defer(() => cameraController.dispose());
  cameraController.resize(container.clientWidth, container.clientHeight);
  renderer.autoQuality = settings.adaptiveQuality;

  await boot.step(0.3, 'generating terrain');
  const game = runtimeScenario
    ? Game.fromRuntimeScenario(runtimeScenario, anchor, rig, cameraController)
    : new Game(seed, anchor, rig, cameraController, playerFaction);
  cleanup.defer(() => game.dispose());
  if (runtimeScenario) {
    if (runtimeScenario.id !== 'first-contact') {
      throw new Error(`Runtime scenario has no mission bootstrap: ${runtimeScenario.id}`);
    }
    game.startMission('first-contact', resolveFirstContactMissionBindings(game.scenarioBindings));
  }
  if (campaignSession) wireCampaignSession(game, campaignSession);
  const audio = new ProceduralAudio(seed, createWebAudioBackend);
  cleanup.defer(() => audio.dispose());
  audio.setMasterVolume(settings.volume);
  audio.setVoiceVolume(settings.voiceVolume);
  // Every player clip must be decoded before its first event. Tactical events are
  // intentionally never replayed after an asynchronous load completes.
  audio.setVoiceClips(REVIEWED_VOICE_CLIPS.filter((clip) => clip.faction === game.playerFaction));
  const voiceDirector = new VoiceDirector(
    ({ clip }) => { audio.playVoice(clip); },
    REVIEWED_VOICE_CLIPS,
  );
  game.onPlayerVoiceAction = (action) => {
    if (action.kind === 'selection') voiceDirector.observeSelection(action.faction, action.units);
    else voiceDirector.observeOrder(action.faction, action.units, action.order);
  };
  game.onPresentationEvents = (events) => {
    audio.consume(events, {
      world: game.world,
      viewer: game.playerFaction,
      anchorS: anchor.s,
      listenerS: rig.s,
      listenerZ: rig.z,
      listenerYaw: rig.yaw,
    }, true);
    voiceDirector.consumePresentation(events, game.world, game.playerFaction);
  };
  game.onTransientReset = () => {
    audio.reset();
    voiceDirector.reset();
  };
  if (titleAction.kind === 'continue') {
    const loaded = game.loadGame();
    if (!loaded.ok) throw new Error(loaded.message);
  }

  await boot.step(0.62, 'tessellating the floor');
  const ringMesh = new RingMesh(game.terrain, renderer.quality);
  cleanup.defer(() => ringMesh.dispose());
  renderer.scene.add(ringMesh.object);
  const dressing = new BattlefieldDressing(seed);
  cleanup.defer(() => dressing.dispose());
  renderer.scene.add(dressing.object);

  await boot.step(0.86, 'igniting the solar filament');
  const environment = new Environment(seed);
  cleanup.defer(() => environment.dispose());
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
    ringMesh.setQuality(renderer.quality);
    game.effects.setParticleCap(quality.particleCap);
    game.effects.setLightCap(quality.effectLightCap);
    game.effects.setAftermathCaps(quality.scarCap, quality.debrisCap, quality.smokeEmitterCap);
    game.entities.setLowQuality(renderer.quality === 'low');
    dressing.setQuality(quality.dressingDistance, quality.dressingCap, quality.dressingShadows);
    environment.setLowQuality(renderer.quality === 'low');
  };
  renderer.onQualityChange = applyRenderQuality;
  applyRenderQuality();
  for (const o of game.objects) renderer.scene.add(o);

  // Aerial perspective. Inside a ring you are always looking through kilometres
  // of air at more world, so haze does most of the depth cueing.
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), environment.fogDensity);
  renderer.scene.fog = fog;
  ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;

  await boot.step(0.94, 'prewarming combat shaders');
  startup.shaderPrewarmMilliseconds = (await renderer.prewarmActiveQuality()).durationMilliseconds;

  const input = new InputController(renderer.gl.domElement, cameraController);
  cleanup.defer(() => input.dispose());
  const overlay = new DebugOverlay();
  cleanup.defer(() => overlay.dispose());
  let commandWiring: CommandWiring | null = null;
  const menu = new SettingsMenu(settings, renderer, (open) => {
    input.setEnabled(!open && !game.hud.blocksGameplayInput);
    game.hud.root.inert = open;
    renderer.gl.domElement.inert = open || game.hud.blocksGameplayInput;
    game.hud.root.setAttribute('aria-hidden', String(open));
    if (open) commandWiring?.cancel();
  }, (volume) => audio.setMasterVolume(volume), (volume) => audio.setVoiceVolume(volume));
  cleanup.defer(() => menu.dispose());
  game.hud.onBlockingOverlayChange = (blocked) => {
    renderer.gl.domElement.inert = blocked || menu.isOpen;
    input.setEnabled(!blocked && !menu.isOpen);
  };
  menu.onSave = () => game.saveGame();
  menu.onLoad = () => game.loadGame();

  commandWiring = wireCommands(
    renderer.gl.domElement,
    game,
    rig,
    () => !menu.isOpen && !game.hud.blocksGameplayInput,
  );
  cleanup.defer(() => commandWiring?.dispose());
  cleanup.defer(wireKeys(game, renderer, overlay, input, settings, menu));

  await boot.step(1.0, 'ready');
  cleanup.defer(armAudioUnlock(window, audio));
  boot.hide();
  if (!scenarioDriverEnabled) {
    game.hud.alert(runtimeScenario
      ? 'First Contact: Choir raiders inbound — keep one engineer alive'
      : 'Select an engineer — build extractors, then a Fabricator');
  }

  // ---------------------------------------------------------------- loop ----
  let last = performance.now();
  let time = 0;
  let animationFrame = 0;
  // Scenario initialization must own tick zero, even if its module import is delayed.
  let loopStopped = scenarioDriverEnabled;
  const markFirstPlayable = (): void => {
    if (startup.firstPlayableAt !== null) return;
    startup.firstPlayableAt = performance.now();
    startup.durationMilliseconds = startup.firstPlayableAt - startup.startedAt;
    performance.mark('rww-first-playable');
  };

  function renderFrame(
    dt: number,
    visualTime: number,
    fixedVisualClock = false,
    advanceSimulation = true,
  ): void {
    input.setEnabled(!menu.isOpen && !game.hud.blocksGameplayInput);
    input.update(dt);
    if (advanceSimulation) game.updateDirectControl(input.moveForward, input.moveRight);
    cameraController.update(dt, { anchor, terrain: game.terrain });

    // Re-base the floating origin onto the camera when it drifts far enough.
    const prevS = anchor.s;
    const prevZ = anchor.z;
    if (anchor.update(rig.s, rig.z)) {
      ringMesh.syncToAnchor(anchor);
      game.onRebase(prevS, prevZ);
      cameraController.update(0, { anchor, terrain: game.terrain });
    }
    dressing.update(anchor, game.terrain);

    game.effects.viewportHeight = renderer.gl.getContext().drawingBufferHeight;
    if (advanceSimulation) game.update(dt, visualTime);
    else game.updatePresentation(dt, visualTime);
    audio.update(dt);
    environment.update(fixedVisualClock ? visualTime : game.world.time, anchor, rig.camera.position);

    ringMesh.uniforms.uTime.value = visualTime;
    ringMesh.uniforms.uPanelPhase.value = environment.cycle.filamentAngle;
    ringMesh.uniforms.uAmbientTint.value.copy(environment.cycle.hazeColor);
    ringMesh.uniforms.uDetailFade.value = renderer.currentSettings.detailFade;
    fog.color.copy(environment.fogColor);
    fog.density = environment.fogDensity;
    (renderer.scene.background as THREE.Color).copy(environment.spaceColor);

    renderer.gl.toneMappingExposure = BASE_EXPOSURE + Math.min(0.38, game.effects.flash * 0.22);
    renderer.render(dt);
    overlay.update(dt, renderer, game, rig, cameraController, environment);
    markFirstPlayable();

    if (game.hud.restartRequested) {
      game.hud.restartRequested = false;
      const restart = new URL(location.href);
      restart.searchParams.set('menu', '0');
      restart.searchParams.set('faction', factionSlug(game.playerFaction));
      location.assign(restart);
    }
  }

  function frame(): void {
    if (loopStopped) return;
    animationFrame = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;
    renderFrame(dt, time);
  }

  cleanup.defer(() => {
    loopStopped = true;
    cancelAnimationFrame(animationFrame);
  });

  let resumeAfterContextRestore = false;
  let recoveryGeneration = 0;
  let recoveryTimer = 0;
  let recoveryOverlay: HTMLDivElement | null = null;
  const showRecovery = (failed = false): void => {
    recoveryOverlay ??= document.createElement('div');
    recoveryOverlay.dataset.rwwContextRecovery = '';
    recoveryOverlay.setAttribute('role', failed ? 'alert' : 'status');
    recoveryOverlay.setAttribute('aria-live', 'assertive');
    recoveryOverlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:120', 'display:grid', 'place-items:center',
      'background:rgba(3,6,10,.94)', 'color:#dbe3ec',
      "font:600 13px/1.5 'Rajdhani','Segoe UI',sans-serif", 'letter-spacing:.14em',
      'text-transform:uppercase', 'text-align:center', 'padding:24px',
    ].join(';');
    recoveryOverlay.replaceChildren();
    const message = document.createElement('p');
    message.textContent = failed
      ? 'Graphics recovery stalled. Your match remains in memory.'
      : 'Graphics device reset detected. Rebuilding the battlefield.';
    recoveryOverlay.appendChild(message);
    if (failed) {
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload game';
      reload.style.cssText = 'padding:10px 18px;color:#f0a052;background:#101720;border:1px solid #f0821e;cursor:pointer';
      reload.addEventListener('click', () => location.reload(), { once: true });
      recoveryOverlay.appendChild(reload);
    }
    if (!recoveryOverlay.isConnected) document.body.appendChild(recoveryOverlay);
  };
  const clearRecoveryTimer = (): void => {
    if (recoveryTimer) window.clearTimeout(recoveryTimer);
    recoveryTimer = 0;
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    recoveryGeneration++;
    resumeAfterContextRestore ||= !loopStopped;
    loopStopped = true;
    cancelAnimationFrame(animationFrame);
    environment.handleContextLoss();
    input.setEnabled(false);
    showRecovery();
    clearRecoveryTimer();
    recoveryTimer = window.setTimeout(() => showRecovery(true), 10_000);
  };
  const onContextRestored = (): void => {
    const generation = recoveryGeneration;
    void (async () => {
      try {
        applyRenderQuality();
        environment.buildEnvironment(renderer.gl, renderer.scene);
        await renderer.prewarmActiveQuality(false);
        if (cleanup.isDisposed || generation !== recoveryGeneration) return;
        clearRecoveryTimer();
        recoveryOverlay?.remove();
        recoveryOverlay = null;
        input.setEnabled(!menu.isOpen && !game.hud.blocksGameplayInput);
        if (resumeAfterContextRestore) {
          loopStopped = false;
          last = performance.now();
          animationFrame = requestAnimationFrame(frame);
        }
        resumeAfterContextRestore = false;
      } catch {
        if (!cleanup.isDisposed && generation === recoveryGeneration) showRecovery(true);
      }
    })();
  };
  renderer.gl.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.gl.domElement.addEventListener('webglcontextrestored', onContextRestored);
  cleanup.defer(() => {
    clearRecoveryTimer();
    renderer.gl.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer.gl.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    recoveryOverlay?.remove();
    recoveryOverlay = null;
  });

  // Exposed for debugging and for the screenshot tool to interrogate.
  const exposed: Record<string, unknown> = {
    game,
    rig,
    cameraController,
    anchor,
    renderer,
    settings,
    audio,
    menu,
    environment,
    ringMesh,
    dressing,
    startup: () => ({ ...startup }),
    dispose: () => cleanup.dispose(),
    probe: () => ({
      camPos: rig.camera.position.toArray(),
      camUp: rig.camera.up.toArray(),
      near: rig.camera.near,
      far: rig.camera.far,
      fov: rig.camera.fov,
      dist: rig.distance,
      pitch: rig.pitch,
      cameraMode: cameraController.mode,
      anchorS: anchor.s,
      focusS: rig.s,
      ringPos: ringMesh.object.position.toArray(),
      ringRotZ: ringMesh.object.rotation.z,
      runtimeScenario: runtimeScenario?.id ?? null,
      scenarioBindings: game.scenarioBindings.size,
      mission: game.missionHudModel?.missionId ?? null,
      aiEnabled: game.isAiEnabled,
      units: game.world.units.length,
      structures: game.world.structures.length,
    }),
  };
  // Browser validation gets a deliberately narrow control surface. It only
  // exists for an explicit query flag and is never consulted by gameplay.
  if (scenarioDriverEnabled) {
    exposed.testDriver = {
      stopLoop: (): void => {
        if (loopStopped) return;
        loopStopped = true;
        cancelAnimationFrame(animationFrame);
      },
      resumeLoop: (): void => {
        if (!loopStopped) return;
        loopStopped = false;
        last = performance.now();
        animationFrame = requestAnimationFrame(frame);
      },
      setAiEnabled: (enabled: boolean): void => game.setAiEnabled(enabled),
      setBenchmarkVariant: (variant: string): void => {
        applyRenderQuality();
        renderer.gl.shadowMap.enabled = renderer.currentSettings.shadows;
        environment.keyLight.castShadow = true;
        if (!ringMesh.mesh.receiveShadow) {
          ringMesh.mesh.receiveShadow = true;
          const materials = Array.isArray(ringMesh.mesh.material)
            ? ringMesh.mesh.material
            : [ringMesh.mesh.material];
          for (const material of materials) material.needsUpdate = true;
        }
        game.markers.object.visible = true;
        for (const name of ['effects:trails', 'effects:tracers', 'effects:puffs', 'effects:scars']) {
          const object = game.effects.object.getObjectByName(name);
          if (object) object.visible = true;
        }
        if (variant === 'no-shadows') {
          renderer.gl.shadowMap.enabled = false;
          environment.keyLight.castShadow = false;
        } else if (variant === 'low-terrain') {
          ringMesh.uniforms.uDetailFade.value = QUALITY.low.detailFade;
          ringMesh.setQuality('low');
        } else if (variant === 'no-terrain-shadows') {
          ringMesh.mesh.receiveShadow = false;
          const materials = Array.isArray(ringMesh.mesh.material)
            ? ringMesh.mesh.material
            : [ringMesh.mesh.material];
          for (const material of materials) material.needsUpdate = true;
        } else if (variant === 'no-transparent-effects') {
          for (const name of ['effects:trails', 'effects:tracers', 'effects:puffs', 'effects:scars']) {
            const object = game.effects.object.getObjectByName(name);
            if (object) object.visible = false;
          }
        } else if (variant === 'no-markers') {
          game.markers.object.visible = false;
        }
      },
      stepWorldTo: (targetTick: number): void => {
        if (!Number.isSafeInteger(targetTick) || targetTick < game.world.tick) {
          throw new Error(`Invalid target tick ${targetTick}`);
        }
        while (game.world.tick < targetTick) {
          const previousTick = game.world.tick;
          game.stepSimulationExactlyOnce();
          if (game.world.tick === previousTick) throw new Error(`World stopped before target tick ${targetTick}`);
        }
      },
      setCamera: (focusS: number, focusZ: number, yaw: number, zoom: number): void => {
        rig.setFocus(focusS, focusZ);
        rig.yaw = yaw;
        rig.distance = zoom;
        const exactRig = rig as unknown as {
          targetDistance: number; smoothS: number; smoothZ: number; smoothYaw: number; focusHeight: number;
        };
        exactRig.targetDistance = zoom;
        exactRig.smoothS = rig.s;
        exactRig.smoothZ = rig.z;
        exactRig.smoothYaw = yaw;
        exactRig.focusHeight = game.terrain.heightAt(rig.s, rig.z);
      },
      renderFrame: (dt: number, visualTime: number): void => renderFrame(dt, visualTime, true),
      presentFrame: (dt: number, visualTime: number): void => renderFrame(dt, visualTime, true, false),
    };
  }
  if (import.meta.env.DEV) {
    (window as unknown as { RWW: unknown }).RWW = exposed;
    cleanup.defer(() => {
      const target = window as unknown as { RWW?: unknown };
      if (target.RWW === exposed) delete target.RWW;
    });
  } else {
    const probe = exposed.probe as () => Record<string, unknown>;
    (window as unknown as { RWWDiagnostics: unknown }).RWWDiagnostics = Object.freeze(probe());
    cleanup.defer(() => {
      delete (window as unknown as { RWWDiagnostics?: unknown }).RWWDiagnostics;
    });
  }

  ringMesh.syncToAnchor(anchor);
  frame();

  const onResize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.resize(width, height);
    cameraController.resize(width, height);
  };
  window.addEventListener('resize', onResize);
  cleanup.defer(() => window.removeEventListener('resize', onResize));
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) cleanup.dispose();
  };
  window.addEventListener('pagehide', onPageHide);
  cleanup.defer(() => window.removeEventListener('pagehide', onPageHide));
}

async function showTitleScreen(
  settings: Settings,
  params: URLSearchParams,
  errorMessage: string,
  campaignProfile: ReturnType<typeof loadCampaignProfile>['profile'],
): Promise<TitleAction> {
  boot.msg.textContent = 'awaiting command';
  boot.el.setAttribute('aria-hidden', 'true');
  const title = new TitleScreen({
    settings,
    hasSave: hasSavedGame() && !errorMessage,
    campaignProfile,
    media: presentationMediaForSession(params),
    statusMessage: errorMessage,
    campaignStatusMessage: params.get('campaignMessage') ?? undefined,
    openCampaign: params.get('campaign') === '1',
  });
  const action = await title.show();
  boot.el.removeAttribute('aria-hidden');
  return action;
}

function wireCampaignSession(game: Game, session: CampaignRouteContext): void {
  game.onMissionResult = (result) => {
    if (result.missionId !== 'first-contact' || session.missionId !== 'compact-01') return;
    try {
      const profile = loadCampaignProfile(localStorage).profile;
      const updated = session.intent === 'replay'
        ? recordCampaignReplayResult(profile, session.missionId, result.status === 'completed' ? 'completed' : 'failed')
        : result.status === 'completed'
          ? completeCampaignMission(profile, session.missionId)
          : recordCampaignFailure(profile, session.missionId);
      saveCampaignProfile(localStorage, updated);
    } catch (error) {
      game.hud.alert(`Campaign profile update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  game.hud.onMissionDebriefAction = (action) => {
    try {
      const profile = loadCampaignProfile(localStorage).profile;
      const transition = action === 'replay'
        ? replayCampaignMission(profile, session.missionId)
        : action === 'retry'
          ? session.intent === 'replay'
            ? replayCampaignMission(profile, session.missionId)
            : retryCampaignMission(profile)
          : continueCampaign(profile);
      const intent: CampaignRouteIntent = action === 'replay'
        ? 'replay'
        : action === 'retry' ? session.intent === 'replay' ? 'replay' : 'retry' : 'continue';
      navigateToCampaignLaunch(transition, intent);
    } catch (error) {
      navigateToCampaignBrowser(error instanceof Error ? error.message : String(error));
    }
  };
}

function navigateToCampaignLaunch(transition: CampaignTransition, intent: CampaignRouteIntent): void {
  saveCampaignProfile(localStorage, transition.profile);
  const route = new URL(location.href);
  route.search = '';
  route.searchParams.set('menu', '0');
  route.searchParams.set('scenario', transition.launch.runtimeScenarioId);
  applyCampaignRouteContext(route.searchParams, transition.launch, intent);
  location.assign(route);
}

function navigateToCampaignBrowser(message: string): void {
  const route = new URL(location.href);
  route.search = '';
  route.searchParams.set('menu', '1');
  route.searchParams.set('campaign', '1');
  route.searchParams.set('campaignMessage', message);
  location.assign(route);
}

function presentationMediaForSession(params: URLSearchParams): PresentationMedia {
  if (import.meta.env.DEV && params.get('mediaTest') === 'missing-intro') {
    return { ...PRESENTATION_MEDIA, introVideo: '/media/presentation/missing-intro.mp4' };
  }
  if (import.meta.env.DEV && params.get('mediaTest') === 'missing-campaign') {
    return {
      ...PRESENTATION_MEDIA,
      menuPoster: '/media/presentation/missing-campaign-backdrop.webp',
      campaignMissionArt: {
        ...PRESENTATION_MEDIA.campaignMissionArt,
        'compact-01': '/media/presentation/missing-campaign-mission.webp',
      },
    };
  }
  return PRESENTATION_MEDIA;
}

function shouldShowTitleScreen(params: URLSearchParams): boolean {
  if (params.get('scenarioDriver') === '1' || params.get('menu') === '0') return false;
  if (import.meta.env.DEV && navigator.webdriver && params.get('menu') !== '1') return false;
  return true;
}

function hasSavedGame(): boolean {
  try {
    const saved = localStorage.getItem(SAVE_SLOT_KEY);
    if (!saved) return false;
    parseGameSaveSnapshot(saved);
    return true;
  } catch {
    return false;
  }
}

function savedPlayerFaction(): Faction {
  const saved = localStorage.getItem(SAVE_SLOT_KEY);
  if (!saved) throw new Error('no saved game in this browser');
  return parseGameSaveSnapshot(saved).playerFaction;
}

function factionFromParams(params: URLSearchParams): Faction {
  return params.get('faction') === 'choir' ? Faction.Choir : Faction.Compact;
}

function factionSlug(faction: Faction): 'compact' | 'choir' {
  return faction === Faction.Choir ? 'choir' : 'compact';
}

/**
 * Mouse commands. Left selects (click or drag box), right issues orders, and
 * while a structure is held the left button places it instead.
 */
export interface CommandWiring {
  cancel(): void;
  dispose(): void;
}

export function wireCommands(
  canvas: HTMLElement,
  game: Game,
  rig: CameraRig,
  gameplayInputEnabled: () => boolean,
): CommandWiring {
  let dragging = false;
  let dragStart: { s: number; z: number } | null = null;
  let downX = 0;
  let downY = 0;
  let activePointer = -1;
  let suppressCommand = false;
  let selectionRectangleVisible = false;

  const clearDrag = (): void => {
    const pointer = activePointer;
    activePointer = -1;
    dragging = false;
    dragStart = null;
    suppressCommand = false;
    selectionRectangleVisible = false;
    game.hud.hideSelectionRectangle();
    if (pointer >= 0 && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  };

  const ndc = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    };
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!gameplayInputEnabled()) {
      clearDrag();
      return;
    }
    const p = ndc(e);
    const hit = game.pickGround(p.x, p.y, rig.camera);
    if (hit) {
      game.updateCursor(hit.s, hit.z);
    } else {
      game.invalidateCursor();
    }
    if (dragging && dragStart) {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6) {
        selectionRectangleVisible = true;
        game.hud.showSelectionRectangle(downX, downY, e.clientX, e.clientY);
      }
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
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
        dragging = !game.directControlActive && !game.artilleryTargeting && !game.hud.placing;
        dragStart = hit;
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!gameplayInputEnabled()) {
      clearDrag();
      return;
    }
    if (e.pointerId !== activePointer) return;
    activePointer = -1;
    if (selectionRectangleVisible) game.hud.hideSelectionRectangle();
    selectionRectangleVisible = false;
    if (suppressCommand) {
      clearDrag();
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
      clearDrag();
      return;
    }
    if (e.button !== 0 || !dragStart) {
      clearDrag();
      return;
    }
    const selectionDrag = dragging;
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
    } else if (selectionDrag && hit && moved > 6) {
      game.selectBox(dragStart.s, dragStart.z, hit.s, hit.z, e.shiftKey);
    } else if (hit) {
      game.selectAt(hit.s, hit.z, e.shiftKey);
    }
    clearDrag();
  };

  const onContextMenu = (event: Event): void => {
    event.preventDefault();
    clearDrag();
  };

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', clearDrag);
  window.addEventListener('blur', clearDrag);
  canvas.addEventListener('lostpointercapture', clearDrag);
  canvas.addEventListener('contextmenu', onContextMenu);
  return {
    cancel: clearDrag,
    dispose: () => {
      clearDrag();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
      canvas.removeEventListener('lostpointercapture', clearDrag);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

function wireKeys(
  game: Game,
  renderer: Renderer,
  overlay: DebugOverlay,
  input: InputController,
  settings: Settings,
  menu: SettingsMenu,
): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (game.hud.blocksGameplayInput) return;
    if (e.code === 'F1' && !menu.isOpen) {
      input.consume(e.code);
      e.preventDefault();
      game.hud.toggleControls();
      return;
    }
    if (e.code === 'Escape') {
      input.consume(e.code);
      e.preventDefault();
      if (game.hud.controlsOpen) {
        game.hud.toggleControls(false);
      } else if (menu.isOpen) {
        menu.close();
      } else {
        game.cancelInteractions();
        menu.open();
      }
      return;
    }
    if (e.code === 'KeyV' && !e.ctrlKey && !e.shiftKey && !game.directControlActive) {
      if (game.enterDirectControl()) {
        input.consume(e.code);
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
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function checkWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';

if (!checkWebGL2()) {
  boot.fail(new Error('This game needs WebGL 2, which this browser did not provide.'));
} else if (normalizedPath === '/dev/calibration') {
  import('./dev/calibration')
    .then(({ startCalibration }) => startCalibration(document.getElementById('app')!))
    .then(() => boot.hide())
    .catch((error: unknown) => boot.fail(error));
} else {
  start().catch((e) => boot.fail(e));
}

/** Arc distance between the two starting bases, for reference. */
export const BASE_SEPARATION = RING_CIRCUMFERENCE / 2;
