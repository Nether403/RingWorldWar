import { describe, expect, it } from 'vitest';
import { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';
import {
  ProceduralAudio,
  armAudioUnlock,
  type AudioBackend,
  type AudioCue,
} from '../../src/audio/audioEngine';

describe('ProceduralAudio', () => {
  it('constructs its backend only after a trusted gesture and never replays earlier events', async () => {
    const backend = new RecordingBackend();
    let constructions = 0;
    const audio = new ProceduralAudio(9, () => {
      constructions++;
      return backend;
    });

    audio.consume([event('impact', Faction.Compact)], frame());
    expect(constructions).toBe(0);
    expect(backend.cues).toEqual([]);

    const target = new EventTarget();
    const disarm = armAudioUnlock(target, audio);
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();

    expect(audio.state).toBe('idle');
    expect(constructions).toBe(0);
    await audio.resumeFromGesture();

    expect(audio.state).toBe('running');
    expect(constructions).toBe(1);
    expect(backend.cues).toEqual([]);
    await audio.resumeFromGesture();
    expect(constructions).toBe(1);
    disarm();
  });

  it('maps authoritative events to deterministic, distance-aware cues', async () => {
    const first = new RecordingBackend();
    const second = new RecordingBackend();
    const audioA = new ProceduralAudio(17, () => first);
    const audioB = new ProceduralAudio(17, () => second);
    await audioA.resumeFromGesture();
    await audioB.resumeFromGesture();

    const events = [
      event('weaponFired', Faction.Compact, { weapon: 'siegeMortar', s: 340, z: 40 }),
      event('impact', Faction.Compact, { scale: 2.5, s: 680, z: -80 }),
      event('intercepted', Faction.Choir, { id: 4, s: 180, z: 0 }),
    ];
    const visible = frame({ visibleIds: new Set([4]) });
    audioA.consume(events, visible);
    audioB.consume(events, visible);

    expect(first.cues).toEqual(second.cues);
    expect(first.cues.map((cue) => cue.kind)).toEqual(['impact', 'intercept', 'ballistic-launch']);
    const impact = first.cues.find((cue) => cue.kind === 'impact')!;
    const launch = first.cues.find((cue) => cue.kind === 'ballistic-launch')!;
    expect(impact.delaySeconds).toBeGreaterThan(launch.delaySeconds);
    expect(impact.lowpassHz).toBeLessThan(launch.lowpassHz);
  });

  it('shares fog-of-war eligibility and clamps live bus volumes', async () => {
    const backend = new RecordingBackend();
    const audio = new ProceduralAudio(23, () => backend);
    audio.setMasterVolume(3);
    audio.setSfxVolume(-2);
    audio.setAmbienceVolume(0.35);
    await audio.resumeFromGesture();

    audio.consume([event('weaponFired', Faction.Choir, { id: 91 })], frame());
    expect(backend.cues).toEqual([]);
    expect(backend.volumes).toEqual({ master: 1, sfx: 0, ambience: 0.35 });

    audio.setSfxVolume(0.6);
    audio.consume(
      [event('weaponFired', Faction.Choir, { id: 91 })],
      frame({ visibleIds: new Set([91]) }),
    );
    expect(backend.cues).toHaveLength(1);

    audio.reset();
    expect(backend.resetCount).toBe(1);
  });

  it('fails closed when browser audio is unavailable', async () => {
    const audio = new ProceduralAudio(2, () => {
      throw new Error('unsupported');
    });
    await expect(audio.resumeFromGesture()).resolves.toBe(false);
    expect(audio.state).toBe('unavailable');
  });

  it('keeps destruction cues when a catch-up frame exceeds the voice budget', async () => {
    const backend = new RecordingBackend();
    const audio = new ProceduralAudio(31, () => backend);
    await audio.resumeFromGesture();
    const events = Array.from({ length: 12 }, (_, index) =>
      event('weaponFired', Faction.Compact, { id: index + 1 }));
    events.push(event('structureDied', Faction.Compact, { id: 99, scale: 3 }));

    audio.consume(events, frame());

    expect(backend.cues).toHaveLength(12);
    expect(backend.cues.some((cue) => cue.kind === 'destruction')).toBe(true);
  });

  it('gives Chord launch and strike unique highest-priority cues', async () => {
    const backend = new RecordingBackend();
    const audio = new ProceduralAudio(32, () => backend);
    await audio.resumeFromGesture();
    audio.consume([
      event('weaponFired', Faction.Compact, { id: 200, weapon: 'chordShot', scale: 4 }),
      event('impact', Faction.Compact, { id: 201, weapon: 'chordShot', scale: 4.2 }),
      event('impact', Faction.Compact, { id: 202, weapon: 'chordShot', scale: 0.6 }),
    ], frame());

    expect(backend.cues.map((cue) => cue.kind)).toEqual(['chord-impact', 'chord-launch']);
    expect(backend.cues[0]!.durationSeconds).toBeGreaterThan(backend.cues[1]!.durationSeconds);
  });
});

class RecordingBackend implements AudioBackend {
  readonly cues: AudioCue[] = [];
  volumes = { master: 0, sfx: 0, ambience: 0 };
  resetCount = 0;

  async resume(): Promise<boolean> { return true; }
  setVolumes(master: number, sfx: number, ambience: number): void {
    this.volumes = { master, sfx, ambience };
  }
  play(cue: AudioCue): void { this.cues.push({ ...cue }); }
  update(): void {}
  reset(): void { this.resetCount++; }
  dispose(): void {}
}

function frame(options: { visibleIds?: Set<number> } = {}) {
  const visibleIds = options.visibleIds ?? new Set<number>();
  const world = {
    isEntityVisible: (_viewer: Faction, id: number) => visibleIds.has(id),
    isVisible: () => false,
  } as unknown as World;
  return {
    world,
    viewer: Faction.Compact,
    anchorS: 0,
    listenerS: 0,
    listenerZ: 0,
    listenerYaw: 0,
  };
}

function event(
  kind: SimEvent['kind'],
  faction: Faction | -1,
  overrides: Partial<SimEvent> = {},
): SimEvent {
  return {
    kind,
    faction,
    id: 1,
    s: 100,
    z: 0,
    h: 0,
    scale: 1,
    ...overrides,
  };
}
