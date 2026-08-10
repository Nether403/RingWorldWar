import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Faction } from '@sim/data';
import { PRESENTATION_MEDIA } from '../../src/presentation/media';
import { REVIEWED_VOICE_CLIPS } from '../../src/presentation/voiceMedia';

describe('reviewed Phase 5 delivery media', () => {
  it('contains the complete valid voice catalog with playable MP3 files', async () => {
    expect(REVIEWED_VOICE_CLIPS).toHaveLength(68);
    expect(new Set(REVIEWED_VOICE_CLIPS.map((clip) => clip.id)).size).toBe(68);
    expect(REVIEWED_VOICE_CLIPS.some((clip) =>
      clip.faction === Faction.Compact && clip.unit === 'needle')).toBe(false);
    expect(REVIEWED_VOICE_CLIPS.some((clip) =>
      clip.faction === Faction.Choir && clip.unit === 'bulwark')).toBe(false);

    for (const clip of REVIEWED_VOICE_CLIPS) {
      const file = await readPublic(clip.src);
      const hasId3 = file.subarray(0, 3).toString('ascii') === 'ID3';
      const hasFrameSync = file[0] === 0xff && ((file[1] ?? 0) & 0xe0) === 0xe0;
      expect(hasId3 || hasFrameSync, clip.id).toBe(true);
      expect(file.byteLength, clip.id).toBeLessThan(32_000);
    }
  });

  it('contains every approved dossier and narrative image within delivery budgets', async () => {
    const dossiers = PRESENTATION_MEDIA.unitDossiers!;
    expect(Object.keys(dossiers[Faction.Compact] ?? {})).toHaveLength(6);
    expect(Object.keys(dossiers[Faction.Choir] ?? {})).toHaveLength(6);
    expect(dossiers[Faction.Compact]?.needle).toBeUndefined();
    expect(dossiers[Faction.Choir]?.bulwark).toBeUndefined();
    expect(Object.keys(PRESENTATION_MEDIA.campaignMissionArt ?? {})).toEqual([
      'compact-01', 'compact-02', 'compact-03', 'compact-04', 'compact-05', 'compact-06',
      'choir-01', 'choir-02', 'choir-03', 'choir-04', 'choir-05', 'choir-06',
    ]);
    const images = [...new Set([
      PRESENTATION_MEDIA.menuPoster!,
      ...Object.values(dossiers).flatMap((faction) => Object.values(faction ?? {})),
      ...Object.values(PRESENTATION_MEDIA.narrativePortraits ?? {}),
      ...Object.values(PRESENTATION_MEDIA.campaignMissionArt ?? {}),
    ])];
    expect(images).toHaveLength(17);

    for (const source of images) {
      const path = publicPath(source);
      const info = await stat(path);
      const header = await readFile(path).then((file) => file.subarray(0, 12));
      expect(header.subarray(0, 4).toString('ascii'), source).toBe('RIFF');
      expect(header.subarray(8, 12).toString('ascii'), source).toBe('WEBP');
      expect(info.size, source).toBeLessThan(150_000);
    }
  });

  it('matches the committed delivery receipt byte-for-byte', async () => {
    const receipt = JSON.parse(await readFile(resolve(process.cwd(), 'docs/phase-5-media-receipt.json'), 'utf8')) as {
      assets: Array<{ path: string; bytes: number; sha256: string }>;
      totals: { files: number; bytes: number };
    };
    expect(receipt.assets).toHaveLength(85);
    let bytes = 0;
    for (const asset of receipt.assets) {
      const contents = await readFile(resolve(process.cwd(), asset.path));
      bytes += contents.byteLength;
      expect(contents.byteLength, asset.path).toBe(asset.bytes);
      expect(createHash('sha256').update(contents).digest('hex'), asset.path).toBe(asset.sha256);
    }
    expect(receipt.totals).toEqual({ files: 85, bytes });
  }, 15_000);
});

function readPublic(source: string): Promise<Buffer> {
  return readFile(publicPath(source));
}

function publicPath(source: string): string {
  return resolve(process.cwd(), 'public', source.replace(/^\//, ''));
}
