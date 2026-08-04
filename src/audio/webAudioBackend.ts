import type { AudioBackend, AudioCue } from './audioEngine';

const MAX_VOICES = 24;

interface VoiceRecord {
  readonly sources: AudioScheduledSourceNode[];
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly pan: StereoPannerNode;
  readonly priority: number;
}

export class WebAudioBackend implements AudioBackend {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly ambience: GainNode;
  private readonly ambienceFilter: BiquadFilterNode;
  private readonly activeVoices = new Set<VoiceRecord>();
  private readonly ambientSources: AudioScheduledSourceNode[] = [];
  private readonly noise: AudioBuffer;

  constructor(seed: number) {
    const AudioContextClass = globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error('WebAudio is unavailable');

    this.context = new AudioContextClass({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.sfx = this.context.createGain();
    this.ambience = this.context.createGain();
    this.ambienceFilter = this.context.createBiquadFilter();
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.22;
    this.sfx.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(compressor).connect(this.context.destination);
    this.noise = createNoiseBuffer(this.context, seed);
    this.startAmbience(seed);
  }

  async resume(): Promise<boolean> {
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  setVolumes(master: number, sfx: number, ambience: number): void {
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(master, now, 0.025);
    this.sfx.gain.setTargetAtTime(sfx, now, 0.025);
    this.ambience.gain.setTargetAtTime(ambience, now, 0.08);
  }

  play(cue: AudioCue): void {
    if (cue.gain <= 0.002) return;
    if (this.activeVoices.size >= MAX_VOICES) {
      let victim: VoiceRecord | null = null;
      let victimPriority = Infinity;
      for (const voice of this.activeVoices) {
        if (voice.priority < victimPriority) {
          victim = voice;
          victimPriority = voice.priority;
        }
      }
      if (!victim || victimPriority >= cue.priority) return;
      this.stopVoice(victim);
    }
    const at = this.context.currentTime + cue.delaySeconds;
    const end = at + cue.durationSeconds;
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cue.lowpassHz, at);
    pan.pan.setValueAtTime(cue.pan, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, cue.gain), at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(filter).connect(pan).connect(this.sfx);

    const oscillator = this.context.createOscillator();
    oscillator.type = oscillatorType(cue.kind);
    oscillator.frequency.setValueAtTime(cue.pitchHz, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, cue.pitchHz * pitchDrop(cue.kind)), end);
    oscillator.connect(gain);
    const sources: AudioScheduledSourceNode[] = [oscillator];
    if (usesNoise(cue.kind)) {
      const noise = this.context.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      noise.playbackRate.setValueAtTime(noiseRate(cue.kind), at);
      noise.connect(gain);
      sources.push(noise);
      noise.start(at, (cue.pitchHz % 1) * this.noise.duration);
      noise.stop(end + 0.01);
    }
    const voice: VoiceRecord = { sources, gain, filter, pan, priority: cue.priority };
    this.trackVoice(voice, oscillator);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
  }

  update(_dt: number, tension: number): void {
    const now = this.context.currentTime;
    this.ambienceFilter.frequency.setTargetAtTime(180 + tension * 720, now, 0.3);
  }

  reset(): void {
    for (const voice of [...this.activeVoices]) this.stopVoice(voice);
  }

  dispose(): void {
    this.reset();
    for (const source of this.ambientSources) stopQuietly(source);
    this.ambientSources.length = 0;
    void this.context.close();
  }

  private trackVoice(voice: VoiceRecord, lifetimeSource: AudioScheduledSourceNode): void {
    this.activeVoices.add(voice);
    lifetimeSource.addEventListener('ended', () => {
      if (!this.activeVoices.delete(voice)) return;
      for (const source of voice.sources) source.disconnect();
      voice.gain.disconnect();
      voice.filter.disconnect();
      voice.pan.disconnect();
    }, { once: true });
  }

  private stopVoice(voice: VoiceRecord): void {
    if (!this.activeVoices.delete(voice)) return;
    for (const source of voice.sources) stopQuietly(source);
    voice.gain.disconnect();
    voice.filter.disconnect();
    voice.pan.disconnect();
  }

  private startAmbience(seed: number): void {
    const bed = this.context.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    bed.playbackRate.value = 0.23;
    this.ambienceFilter.type = 'lowpass';
    this.ambienceFilter.frequency.value = 180;
    const bedGain = this.context.createGain();
    bedGain.gain.value = 0.12;
    bed.connect(this.ambienceFilter).connect(bedGain).connect(this.ambience);

    const hum = this.context.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 34 + (seed % 7);
    const humGain = this.context.createGain();
    humGain.gain.value = 0.07;
    hum.connect(humGain).connect(this.ambience);
    bed.start();
    hum.start();
    this.ambientSources.push(bed, hum);
  }
}

export function createWebAudioBackend(seed: number): AudioBackend {
  return new WebAudioBackend(seed);
}

function createNoiseBuffer(context: AudioContext, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * 2));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = (seed ^ 0xa53c9e17) >>> 0;
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const white = state / 0x1_0000_0000 * 2 - 1;
    brown = brown * 0.985 + white * 0.08;
    data[i] = Math.max(-1, Math.min(1, brown));
  }
  return buffer;
}

function oscillatorType(kind: AudioCue['kind']): OscillatorType {
  if (kind === 'chord-impact' || kind === 'chord-launch') return 'sine';
  if (kind === 'energy-shot' || kind === 'intercept' || kind === 'capture') return 'sine';
  if (kind === 'completion' || kind === 'warning') return 'triangle';
  return 'sawtooth';
}

function pitchDrop(kind: AudioCue['kind']): number {
  if (kind === 'chord-launch') return 0.18;
  if (kind === 'chord-impact') return 0.08;
  if (kind === 'energy-shot' || kind === 'intercept') return 1.8;
  if (kind === 'completion' || kind === 'capture') return 1.25;
  return 0.35;
}

function usesNoise(kind: AudioCue['kind']): boolean {
  return kind === 'kinetic-shot' || kind === 'ballistic-launch' || kind === 'impact' ||
    kind === 'destruction' || kind === 'footfall' || kind === 'chord-launch' || kind === 'chord-impact';
}

function noiseRate(kind: AudioCue['kind']): number {
  return kind === 'chord-impact' ? 0.22 : kind === 'chord-launch' ? 0.32 :
    kind === 'destruction' ? 0.42 : kind === 'impact' ? 0.7 : kind === 'ballistic-launch' ? 0.55 : 1.1;
}

function stopQuietly(source: AudioScheduledSourceNode): void {
  try { source.stop(); } catch { /* already stopped */ }
  source.disconnect();
}
