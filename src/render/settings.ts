import type { QualityLevel, Renderer } from './renderer';

export const SETTINGS_STORAGE_KEY = 'rww-settings';
export const DEFAULT_VOLUME = 0.8;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsOptions {
  storage?: StorageAdapter | null;
  search?: string | URLSearchParams;
}

interface PersistedSettings {
  quality?: QualityLevel;
  volume: number;
}

export class Settings {
  quality: QualityLevel = 'high';
  volume = DEFAULT_VOLUME;
  adaptiveQuality = true;

  private readonly storage: StorageAdapter | null;
  private savedQuality: QualityLevel | null = null;

  constructor(options: SettingsOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    const persisted = this.read();
    if (persisted) {
      if (isQualityLevel(persisted.quality)) {
        this.quality = persisted.quality;
        this.savedQuality = persisted.quality;
        this.adaptiveQuality = false;
      }
      if (isVolume(persisted.volume)) this.volume = persisted.volume;
    }

    const urlQuality = readUrlQuality(options.search ?? browserSearch());
    if (urlQuality) {
      // URL overrides are session-only so benchmark/screenshot links do not
      // silently replace the player's saved preference.
      this.quality = urlQuality;
      this.adaptiveQuality = false;
    }
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.savedQuality = quality;
    this.adaptiveQuality = false;
    this.save();
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    this.save();
  }

  setAdaptiveQuality(enabled: boolean, currentQuality: QualityLevel = this.quality): void {
    this.adaptiveQuality = enabled;
    this.quality = currentQuality;
    this.savedQuality = enabled ? null : currentQuality;
    this.save();
  }

  apply(renderer: Renderer): void {
    renderer.autoQuality = this.adaptiveQuality;
    renderer.setQuality(this.quality);
  }

  save(): void {
    const value: PersistedSettings = { volume: this.volume };
    if (this.savedQuality) value.quality = this.savedQuality;
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in private/sandboxed browser contexts.
    }
  }

  private read(): Partial<PersistedSettings> | null {
    try {
      const raw = this.storage?.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }
}

export function isQualityLevel(value: unknown): value is QualityLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

function readUrlQuality(search: string | URLSearchParams): QualityLevel | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const quality = params.get('quality');
  return isQualityLevel(quality) ? quality : null;
}

function browserStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(value, 1));
}
