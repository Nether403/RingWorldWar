import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/render/renderer';
import { Settings, SETTINGS_STORAGE_KEY, type StorageAdapter } from '../../src/render/settings';

class MemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('Settings', () => {
  it('uses the renderer quality table for every Phase 2 quality knob', () => {
    expect(QUALITY.low.particleCap).toBe(QUALITY.ultra.particleCap * 0.25);
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.drawDistance).toBeLessThan(QUALITY.medium.drawDistance);
    expect(QUALITY.medium.drawDistance).toBeLessThan(QUALITY.high.drawDistance);
    expect(QUALITY.high.drawDistance).toBeLessThan(QUALITY.ultra.drawDistance);
    expect(Object.values(QUALITY).every((quality) => quality.postProcessingLevel === 'none')).toBe(true);
  });

  it('round-trips quality and volume through storage', () => {
    const storage = new MemoryStorage();
    const settings = new Settings({ storage });

    settings.setQuality('ultra');
    settings.setVolume(0.35);

    const restored = new Settings({ storage });
    expect(restored.quality).toBe('ultra');
    expect(restored.volume).toBe(0.35);
    expect(restored.adaptiveQuality).toBe(false);
  });

  it('falls back safely when persisted settings are malformed', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{not json');

    const settings = new Settings({ storage });

    expect(settings.quality).toBe('high');
    expect(settings.volume).toBe(0.8);
    expect(settings.adaptiveQuality).toBe(true);
  });

  it('validates persisted fields independently', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ quality: 'cinematic', volume: 0.25 }));

    const settings = new Settings({ storage });

    expect(settings.quality).toBe('high');
    expect(settings.volume).toBe(0.25);
    expect(settings.adaptiveQuality).toBe(true);
  });

  it('gives a valid URL quality precedence without overwriting persistence', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ quality: 'medium', volume: 0.6 }));

    const settings = new Settings({ storage, search: '?quality=low' });

    expect(settings.quality).toBe('low');
    expect(settings.volume).toBe(0.6);
    expect(settings.adaptiveQuality).toBe(false);
    settings.setVolume(0.4);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
      quality: 'medium',
      volume: 0.4,
    });
  });

  it('does not turn a volume-only preference into a manual quality lock', () => {
    const storage = new MemoryStorage();
    const settings = new Settings({ storage });

    settings.setVolume(0.2);

    const restored = new Settings({ storage });
    expect(restored.quality).toBe('high');
    expect(restored.volume).toBe(0.2);
    expect(restored.adaptiveQuality).toBe(true);
  });

  it('survives unavailable browser storage', () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    const settings = new Settings({ storage });
    expect(() => settings.setQuality('low')).not.toThrow();
    expect(() => settings.setVolume(2)).not.toThrow();
    expect(settings.quality).toBe('low');
    expect(settings.volume).toBe(1);
  });
});
