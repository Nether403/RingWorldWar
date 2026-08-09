import { deltaS } from '@core/ringMath';
import { WEAPONS, type Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import { isPresentationEventEligible } from '@render/presentationEvents';
import type { VoiceClip } from './voiceDirector';

export type AudioState = 'idle' | 'starting' | 'running' | 'unavailable';

export type AudioCueKind =
  | 'kinetic-shot'
  | 'energy-shot'
  | 'ballistic-launch'
  | 'chord-launch'
  | 'chord-impact'
  | 'impact'
  | 'destruction'
  | 'intercept'
  | 'completion'
  | 'capture'
  | 'warning'
  | 'footfall';

export interface AudioCue {
  kind: AudioCueKind;
  gain: number;
  pitchHz: number;
  pan: number;
  delaySeconds: number;
  lowpassHz: number;
  durationSeconds: number;
  priority: number;
}

export interface AudioFrame {
  world: World;
  viewer: Faction;
  anchorS: number;
  listenerS: number;
  listenerZ: number;
  listenerYaw: number;
}

export interface AudioBackend {
  readonly loadedVoiceCount?: number;
  resume(): Promise<boolean>;
  setVolumes(master: number, sfx: number, ambience: number, voice: number): void;
  play(cue: AudioCue): void;
  preloadVoices(clips: readonly VoiceClip[]): Promise<void>;
  playVoice(clip: VoiceClip): boolean;
  update(dt: number, tension: number): void;
  reset(): void;
  dispose(): void;
}

export type AudioBackendFactory = (seed: number) => AudioBackend;

export class ProceduralAudio {
  state: AudioState = 'idle';
  masterVolume = 0.8;
  sfxVolume = 1;
  ambienceVolume = 0.42;
  voiceVolume = 0.8;
  cueCount = 0;

  get loadedVoiceCount(): number {
    return this.backend?.loadedVoiceCount ?? 0;
  }

  private backend: AudioBackend | null = null;
  private starting: Promise<boolean> | null = null;
  private tension = 0;
  private voiceClips: readonly VoiceClip[] = [];

  constructor(
    private readonly seed: number,
    private readonly backendFactory: AudioBackendFactory,
  ) {}

  resumeFromGesture(): Promise<boolean> {
    if (this.state === 'running') return Promise.resolve(true);
    if (this.state === 'unavailable') return Promise.resolve(false);
    if (this.starting) return this.starting;

    this.state = 'starting';
    this.starting = this.startBackend();
    return this.starting;
  }

  setMasterVolume(value: number): void {
    this.masterVolume = clamp01(value);
    this.syncVolumes();
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = clamp01(value);
    this.syncVolumes();
  }

  setAmbienceVolume(value: number): void {
    this.ambienceVolume = clamp01(value);
    this.syncVolumes();
  }

  setVoiceVolume(value: number): void {
    this.voiceVolume = clamp01(value);
    this.syncVolumes();
  }

  setVoiceClips(clips: readonly VoiceClip[]): void {
    this.voiceClips = clips;
    if (this.state === 'running') void this.backend?.preloadVoices(clips);
  }

  playVoice(clip: VoiceClip): boolean {
    if (this.state !== 'running' || !this.backend || this.voiceVolume <= 0) return false;
    return this.backend.playVoice(clip);
  }

  consume(events: readonly SimEvent[], frame: AudioFrame, visibilityPrevalidated = false): void {
    if (this.state !== 'running' || !this.backend) return;
    const cues: AudioCue[] = [];
    for (const event of events) {
      const eligible = visibilityPrevalidated
        ? true
        : isPresentationEventEligible(event, frame.world, frame.anchorS, frame.viewer);
      if (!eligible) continue;
      const cue = cueForEvent(this.seed, event, frame);
      if (!cue) continue;
      cues.push(cue);
    }
    cues.sort((a, b) => cuePriority(b.kind) - cuePriority(a.kind));
    for (const cue of cues.slice(0, 12)) {
      this.backend.play(cue);
      this.cueCount++;
      this.tension = Math.min(1, this.tension + cue.gain * 0.16);
    }
  }

  update(dt: number): void {
    if (this.state !== 'running' || !this.backend) return;
    this.tension = Math.max(0, this.tension - Math.max(0, dt) * 0.055);
    this.backend.update(dt, this.tension);
  }

  reset(): void {
    this.tension = 0;
    this.backend?.reset();
  }

  dispose(): void {
    this.backend?.dispose();
    this.backend = null;
    this.starting = null;
    this.state = 'unavailable';
  }

  private async startBackend(): Promise<boolean> {
    try {
      const backend = this.backendFactory(this.seed);
      this.backend = backend;
      this.syncVolumes();
      const resumed = await backend.resume();
      if (resumed) await backend.preloadVoices(this.voiceClips);
      const running = resumed && this.backend === backend;
      this.state = running ? 'running' : 'unavailable';
      if (!running) {
        backend.dispose();
        this.backend = null;
      }
      return running;
    } catch {
      this.backend = null;
      this.state = 'unavailable';
      return false;
    } finally {
      this.starting = null;
    }
  }

  private syncVolumes(): void {
    this.backend?.setVolumes(this.masterVolume, this.sfxVolume, this.ambienceVolume, this.voiceVolume);
  }
}

export function armAudioUnlock(target: EventTarget, audio: ProceduralAudio): () => void {
  const resume = (event: Event): void => {
    if (!event.isTrusted) return;
    void audio.resumeFromGesture();
  };
  target.addEventListener('pointerdown', resume, { capture: true });
  target.addEventListener('keydown', resume, { capture: true });
  return () => {
    target.removeEventListener('pointerdown', resume, { capture: true });
    target.removeEventListener('keydown', resume, { capture: true });
  };
}

function cueForEvent(seed: number, event: SimEvent, frame: AudioFrame): AudioCue | null {
  const ds = deltaS(frame.listenerS, event.s);
  const dz = event.z - frame.listenerZ;
  const distance = Math.hypot(ds, dz);
  const right = -ds * Math.sin(frame.listenerYaw) + dz * Math.cos(frame.listenerYaw);
  const attenuation = 1 / (1 + Math.pow(distance / 360, 1.35));
  const spatial = {
    gain: attenuation,
    pan: clamp(right / Math.max(180, distance), -1, 1),
    delaySeconds: Math.min(2.5, distance / 340),
    lowpassHz: Math.max(850, 16_000 / (1 + distance / 620)),
  };
  const variation = 0.92 + hashUnit(seed, event.id, event.kind.length) * 0.16;
  const scale = Math.max(0.2, event.scale || 1);

  if (event.weapon === 'chordShot') {
    if (event.kind === 'weaponFired') return cue('chord-launch', spatial, 1, 38 * variation, 1.6);
    if (event.kind === 'impact') {
      if (event.scale <= 0.7) return null;
      return cue('chord-impact', spatial, 1, 26 * variation, 3.2);
    }
  }

  switch (event.kind) {
    case 'weaponFired': {
      const weapon = event.weapon ? WEAPONS[event.weapon] : undefined;
      if (weapon?.kind === 'ballistic') {
        return cue('ballistic-launch', spatial, Math.min(1, 0.5 * scale), 62 * variation, 0.72);
      }
      if (weapon?.damageType === 'energy' || weapon?.kind === 'interceptor') {
        return cue('energy-shot', spatial, Math.min(0.72, 0.31 * scale), 510 * variation, 0.18);
      }
      return cue('kinetic-shot', spatial, Math.min(0.75, 0.36 * scale), 145 * variation, 0.16);
    }
    case 'impact':
      return cue('impact', spatial, Math.min(1, 0.42 + scale * 0.16), 72 * variation / Math.sqrt(scale), 0.62 + scale * 0.12);
    case 'unitDied':
    case 'structureDied':
      return cue('destruction', spatial, Math.min(1, 0.58 + scale * 0.12), 48 * variation / Math.sqrt(scale), 1.1 + scale * 0.16);
    case 'intercepted':
      return cue('intercept', spatial, 0.42, 920 * variation, 0.24);
    case 'unitComplete':
    case 'structureComplete':
      return cue('completion', spatial, 0.28, 330 * variation, 0.45);
    case 'nodeCaptured':
      return cue('capture', spatial, 0.5, event.faction === 0 ? 220 : 294, 0.8);
    case 'nodeNeutralized':
      return cue('warning', spatial, 0.42, 148 * variation, 0.62);
    case 'alignmentStarted':
      return cue('capture', spatial, 0.62, event.faction === 0 ? 246 : 330, 1.05);
    case 'alignmentBroken':
      return cue('warning', spatial, 0.52, 118 * variation, 0.9);
    case 'damageStateChanged':
      return event.scale > 0 ? cue('warning', spatial, 0.3, 180 * variation, 0.42) : null;
    case 'footfall':
      return cue('footfall', spatial, Math.min(0.42, 0.14 * scale), 52 * variation, 0.24);
  }
}

function cue(
  kind: AudioCueKind,
  spatial: { gain: number; pan: number; delaySeconds: number; lowpassHz: number },
  gain: number,
  pitchHz: number,
  durationSeconds: number,
): AudioCue {
  return {
    kind,
    gain: gain * spatial.gain,
    pitchHz,
    pan: spatial.pan,
    delaySeconds: spatial.delaySeconds,
    lowpassHz: spatial.lowpassHz,
    durationSeconds,
    priority: cuePriority(kind),
  };
}

function hashUnit(seed: number, id: number, salt: number): number {
  let value = (seed ^ Math.imul(id, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function cuePriority(kind: AudioCueKind): number {
  if (kind === 'chord-impact') return 7;
  if (kind === 'chord-launch') return 6;
  if (kind === 'destruction') return 5;
  if (kind === 'impact' || kind === 'capture') return 4;
  if (kind === 'intercept' || kind === 'warning') return 3;
  if (kind === 'ballistic-launch' || kind === 'completion') return 2;
  return 1;
}
