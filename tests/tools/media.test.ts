import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error The media tools are intentionally plain Node ESM.
import { FACTION_UNITS, GROUP_TRIGGERS, SIGNAL_NARRATIVE_IDS, TACTICAL_TRIGGERS, loadAndValidateManifests, validateImageManifest, validateVoiceManifest } from '../../tools/media/manifests.mjs';
// @ts-expect-error The media tools are intentionally plain Node ESM.
import { buildSpeakCommand, main as voiceMain, sanitizeCliMetadata, validateMp3 } from '../../tools/media/generate-voice-lines.mjs';
// @ts-expect-error The media tools are intentionally plain Node ESM.
import { buildImageRequest, decodeImage, main as imageMain } from '../../tools/media/generate-images.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..', '..');

describe('media authoring manifests', () => {
  it('contains every valid faction/unit tactical line and no invalid combination', async () => {
    const { voices } = await loadAndValidateManifests();
    const factionUnits = Object.values(FACTION_UNITS) as string[][];
    const expectedLineCount = factionUnits
      .reduce((count, units) => count + units.length * TACTICAL_TRIGGERS.length, 0);

    expect(voices.lines).toHaveLength(expectedLineCount);
    expect(voices.groups).toHaveLength(Object.keys(FACTION_UNITS).length * GROUP_TRIGGERS.length);
    expect(voices.lines.some((line: { faction: string; unit: string }) =>
      line.faction === 'compact' && line.unit === 'needle')).toBe(false);
    expect(voices.lines.some((line: { faction: string; unit: string }) =>
      line.faction === 'choir' && line.unit === 'bulwark')).toBe(false);
  });

  it('contains title, faction and valid unit dossiers, and the four canonical signal IDs', async () => {
    const { images } = await loadAndValidateManifests();
    const ids = new Set(images.prompts.map((entry: { id: string }) => entry.id));

    expect(ids).toContain('title.last-rotation');
    for (const [faction, units] of Object.entries(FACTION_UNITS) as Array<[string, string[]]>) {
      expect(ids).toContain(`dossier.${faction}`);
      for (const unit of units) expect(ids).toContain(`dossier.${faction}.${unit}`);
    }
    expect(SIGNAL_NARRATIVE_IDS.every((id: string) => ids.has(id))).toBe(true);
  });

  it('rejects missing combinations and duplicate stable IDs', async () => {
    const { voices, images } = await loadAndValidateManifests();
    const missingLine = structuredClone(voices);
    missingLine.lines.pop();
    expect(() => validateVoiceManifest(missingLine)).toThrow(/canonical IDs/);

    const duplicateImage = structuredClone(images);
    duplicateImage.prompts[1].id = duplicateImage.prompts[0].id;
    expect(() => validateImageManifest(duplicateImage)).toThrow(/duplicated/);
  });
});

describe('offline media generation commands', () => {
  it('builds Deepgram argv without invoking a shell and stays dry by default', async () => {
    const command = buildSpeakCommand(
      { text: 'Hold this line; do not expand $HOME.' },
      'aura-2-orion-en',
      'candidate.mp3',
    );
    expect(command).toEqual({
      file: 'dg',
      args: [
        'speak', 'Hold this line; do not expand $HOME.',
        '--output', 'candidate.mp3',
        '--model', 'aura-2-orion-en',
        '--encoding', 'mp3',
        '--non-interactive',
      ],
    });

    const execute = vi.fn();
    const plans = await withMutedConsole(() => voiceMain(['--id', 'compact.engineer.selected'], { run: execute }));
    expect(execute).not.toHaveBeenCalled();
    expect(plans).toHaveLength(1);
  });

  it('builds a GPT-image-2 Azure request from inherited environment names and stays dry by default', async () => {
    const request = buildImageRequest(
      { prompt: 'A ring habitat', size: '1536x1024' },
      {
        AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'image-deployment',
      },
    );
    expect(request).toMatchObject({
      method: 'POST',
      url: 'https://example.openai.azure.com/openai/deployments/image-deployment/images/generations?api-version=2025-04-01-preview',
      deployment: 'image-deployment',
      body: { n: 1, output_format: 'png' },
    });

    const fetch = vi.fn();
    const plans = await withMutedConsole(() => imageMain(['--id', 'signal-briefing'], { fetch }));
    expect(fetch).not.toHaveBeenCalled();
    expect(plans).toHaveLength(1);
  });

  it('rejects non-Azure endpoints before credentials can be sent', () => {
    expect(() => buildImageRequest(
      { prompt: 'A ring habitat', size: '1536x1024' },
      {
        AZURE_OPENAI_ENDPOINT: 'https://attacker.example/',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'image-deployment',
      },
    )).toThrow(/valid HTTPS Azure endpoint/);
  });

  it('uses the v1 request shape for Foundry-style Azure endpoints', () => {
    const request = buildImageRequest(
      { prompt: 'A ring habitat', size: '1536x1024' },
      {
        AZURE_OPENAI_ENDPOINT: 'https://example.services.ai.azure.com/openai/v1',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-image-2-deployment',
      },
    );

    expect(request).toMatchObject({
      url: 'https://example.services.ai.azure.com/openai/v1/images/generations?api-version=preview',
      body: { model: 'gpt-image-2-deployment', output_format: 'png' },
    });
  });

  it('binds approved faction style and no-text constraints into unit-card requests', () => {
    const request = buildImageRequest(
      {
        kind: 'unit-dossier',
        faction: 'choir',
        prompt: 'Axiom Choir Needle dossier.',
        size: '1024x1536',
      },
      {
        AZURE_OPENAI_ENDPOINT: 'https://example.services.ai.azure.com/openai/v1',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-image-2-deployment',
      },
    );

    expect(request.body.prompt).toContain('approved Axiom Choir style');
    expect(request.body.prompt).toContain('No people, emblem');
    expect(request.body.prompt).toContain('pseudo-text');
  });

  it('requires unmistakable scope before any paid bulk generation', async () => {
    await expect(withMutedConsole(() => voiceMain(['--generate']))).rejects.toThrow(/requires --id/);
    await expect(withMutedConsole(() => imageMain(['--generate']))).rejects.toThrow(/requires --id/);
  });

  it('redacts structured Deepgram metadata before writing receipts', () => {
    const metadata = sanitizeCliMetadata(JSON.stringify({
      requestId: 'request-1',
      token: 'structured-secret',
      nested: { authorization: 'Bearer bearer-secret', note: 'contains exact-key-value' },
    }), 'exact-key-value');

    expect(metadata).toEqual({
      requestId: 'request-1',
      token: '[REDACTED]',
      nested: { authorization: '[REDACTED]', note: 'contains [REDACTED]' },
    });
  });

  it('removes invalid paid candidates instead of leaving orphaned files', async () => {
    const id = 'compact.engineer.selected';
    const output = resolve(root, 'tools', 'media-candidates', 'voice', `${id}.mp3`);
    const receipt = `${output}.receipt.json`;
    const previousKey = process.env.DEEPGRAM_API_KEY;
    await rm(output, { force: true });
    await rm(receipt, { force: true });
    process.env.DEEPGRAM_API_KEY = 'test-only-key';
    try {
      await expect(withMutedConsole(() => voiceMain(['--generate', '--id', id], {
        run: async (_file: string, args: string[]) => {
          const outputIndex = args.indexOf('--output') + 1;
          await writeFile(args[outputIndex]!, Buffer.from('invalid candidate'));
          return JSON.stringify({ requestId: 'request-1' });
        },
      }))).rejects.toThrow(/MP3/);
      await expect(access(output)).rejects.toThrow();
      await expect(access(receipt)).rejects.toThrow();
    } finally {
      if (previousKey === undefined) delete process.env.DEEPGRAM_API_KEY;
      else process.env.DEEPGRAM_API_KEY = previousKey;
      await rm(output, { force: true });
      await rm(receipt, { force: true });
    }
  });

  it('validates external audio and image bytes before accepting candidates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rww-media-'));
    try {
      const invalidMp3 = join(directory, 'invalid.mp3');
      await writeFile(invalidMp3, Buffer.alloc(64));
      await expect(validateMp3(invalidMp3)).rejects.toThrow(/MP3/);

      expect(() => decodeImage({ data: [{ b64_json: Buffer.from('not png').toString('base64') }] }))
        .toThrow(/PNG/);
      expect(() => decodeImage({ data: [] })).toThrow(/exactly one/);
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('candidate'),
      ]);
      expect(decodeImage({ data: [{ b64_json: png.toString('base64') }] })).toEqual(png);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs validation and dry-run CLIs without credentials or network', async () => {
    const env = {
      ...process.env,
      DEEPGRAM_API_KEY: 'must-not-print-deepgram',
      AZURE_OPENAI_API_KEY: 'must-not-print-azure',
      AZURE_OPENAI_ENDPOINT: 'https://secret-endpoint.invalid',
      AZURE_OPENAI_DEPLOYMENT_NAME: 'secret-deployment',
    };
    const validation = await run(process.execPath, ['tools/media/validate-manifests.mjs'], { cwd: root, env });
    expect(JSON.parse(validation.stdout)).toMatchObject({ valid: true, voiceLines: 60, factionGroups: 8 });

    const voice = await run(process.execPath, [
      'tools/media/generate-voice-lines.mjs', '--id', 'compact.engineer.selected',
    ], { cwd: root, env });
    const image = await run(process.execPath, [
      'tools/media/generate-images.mjs', '--id', 'signal-briefing',
    ], { cwd: root, env });
    for (const output of [voice.stdout, image.stdout]) {
      expect(JSON.parse(output)).toMatchObject({ mode: 'dry-run', generated: false });
      expect(output).not.toMatch(/must-not-print|secret-endpoint|secret-deployment/);
    }
  });
});

async function withMutedConsole<T>(operation: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    return await operation();
  } finally {
    spy.mockRestore();
  }
}
