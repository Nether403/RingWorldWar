import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEDIA_DIR = dirname(fileURLToPath(import.meta.url));
export const CANDIDATE_DIR = join(MEDIA_DIR, '..', 'media-candidates');

export const FACTIONS = ['compact', 'choir'];
export const SHARED_UNITS = ['engineer', 'vanguard', 'longbow', 'wisp', 'aegis'];
export const FACTION_UNITS = {
  compact: [...SHARED_UNITS, 'bulwark'],
  choir: [...SHARED_UNITS, 'needle'],
};
export const TACTICAL_TRIGGERS = ['selected', 'move', 'attack', 'ready', 'critical'];
export const GROUP_TRIGGERS = ['group-selected', 'group-move', 'group-attack', 'group-lost'];
export const SIGNAL_NARRATIVE_IDS = [
  'signal-briefing',
  'signal-hunters',
  'signal-migration',
  'signal-last-correction',
];

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);

export async function loadJson(name) {
  return JSON.parse(await readFile(join(MEDIA_DIR, name), 'utf8'));
}

export function validateVoiceManifest(manifest) {
  assertManifestHeader(manifest, 'rww.media.voice-lines');
  assertPlainObject(manifest.voices, '$.voices');
  assertArray(manifest.lines, '$.lines');
  assertArray(manifest.groups, '$.groups');

  for (const faction of FACTIONS) {
    const voice = manifest.voices[faction];
    assertPlainObject(voice, `$.voices.${faction}`);
    assertText(voice.model, `$.voices.${faction}.model`);
    assertText(voice.direction, `$.voices.${faction}.direction`);
  }
  assertExactKeys(manifest.voices, FACTIONS, '$.voices');

  const expectedLines = new Set();
  for (const faction of FACTIONS) {
    for (const unit of FACTION_UNITS[faction]) {
      for (const trigger of TACTICAL_TRIGGERS) expectedLines.add(`${faction}.${unit}.${trigger}`);
    }
  }
  validateEntries(manifest.lines, expectedLines, '$.lines', (line, path) => {
    assertOneOf(line.faction, FACTIONS, `${path}.faction`);
    assertOneOf(line.unit, FACTION_UNITS[line.faction], `${path}.unit`);
    assertOneOf(line.trigger, TACTICAL_TRIGGERS, `${path}.trigger`);
    if (line.id !== `${line.faction}.${line.unit}.${line.trigger}`) {
      fail(`${path}.id`, 'must match faction.unit.trigger');
    }
    assertText(line.text, `${path}.text`);
  });

  const expectedGroups = new Set(FACTIONS.flatMap((faction) =>
    GROUP_TRIGGERS.map((trigger) => `${faction}.${trigger}`)));
  validateEntries(manifest.groups, expectedGroups, '$.groups', (line, path) => {
    assertOneOf(line.faction, FACTIONS, `${path}.faction`);
    assertOneOf(line.trigger, GROUP_TRIGGERS, `${path}.trigger`);
    if (line.id !== `${line.faction}.${line.trigger}`) fail(`${path}.id`, 'must match faction.trigger');
    assertText(line.text, `${path}.text`);
  });

  return manifest;
}

export function validateImageManifest(manifest) {
  assertManifestHeader(manifest, 'rww.media.image-prompts');
  assertArray(manifest.prompts, '$.prompts');

  const expected = new Set(['title.last-rotation']);
  for (const faction of FACTIONS) {
    expected.add(`dossier.${faction}`);
    for (const unit of FACTION_UNITS[faction]) expected.add(`dossier.${faction}.${unit}`);
  }
  for (const id of SIGNAL_NARRATIVE_IDS) expected.add(id);

  validateEntries(manifest.prompts, expected, '$.prompts', (entry, path) => {
    assertOneOf(entry.kind, ['title', 'faction-dossier', 'unit-dossier', 'signal-narrative'], `${path}.kind`);
    assertText(entry.prompt, `${path}.prompt`);
    assertOneOf(entry.size, [...IMAGE_SIZES], `${path}.size`);
    if (entry.faction !== undefined) assertOneOf(entry.faction, FACTIONS, `${path}.faction`);
    if (entry.unit !== undefined) {
      assertOneOf(entry.faction, FACTIONS, `${path}.faction`);
      assertOneOf(entry.unit, FACTION_UNITS[entry.faction], `${path}.unit`);
    }
    if (entry.kind === 'title' && entry.id !== 'title.last-rotation') fail(`${path}.id`, 'is not the title ID');
    if (entry.kind === 'faction-dossier' && entry.id !== `dossier.${entry.faction}`) {
      fail(`${path}.id`, 'must match dossier.faction');
    }
    if (entry.kind === 'unit-dossier' && entry.id !== `dossier.${entry.faction}.${entry.unit}`) {
      fail(`${path}.id`, 'must match dossier.faction.unit');
    }
    if (entry.kind === 'signal-narrative' && !SIGNAL_NARRATIVE_IDS.includes(entry.id)) {
      fail(`${path}.id`, 'is not a canonical signal narrative ID');
    }
  });

  return manifest;
}

export async function loadAndValidateManifests() {
  const [voices, images] = await Promise.all([
    loadJson('voice-lines.json'),
    loadJson('image-prompts.json'),
  ]);
  return {
    voices: validateVoiceManifest(voices),
    images: validateImageManifest(images),
  };
}

function validateEntries(entries, expected, path, validate) {
  const found = new Set();
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    assertPlainObject(entry, entryPath);
    assertId(entry.id, `${entryPath}.id`);
    if (found.has(entry.id)) fail(`${entryPath}.id`, 'is duplicated');
    found.add(entry.id);
    validate(entry, entryPath);
  });
  const missing = [...expected].filter((id) => !found.has(id));
  const extra = [...found].filter((id) => !expected.has(id));
  if (missing.length || extra.length) {
    fail(path, `does not match the canonical IDs (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }
}

function assertManifestHeader(value, schema) {
  assertPlainObject(value, '$');
  if (value.schema !== schema) fail('$.schema', `must be ${schema}`);
  if (value.version !== 1) fail('$.version', 'must be 1');
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
}

function assertText(value, path) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 2 || /[\u0000-\u001f]/.test(value)) {
    fail(path, 'must be trimmed, non-empty text without control characters');
  }
}

function assertId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(path, 'must be a stable lowercase ID');
}

function assertOneOf(value, allowed, path) {
  if (!allowed.includes(value)) fail(path, `must be one of: ${allowed.join(', ')}`);
}

function assertExactKeys(value, expected, path) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    fail(path, `must contain exactly: ${expected.join(', ')}`);
  }
}

function fail(path, message) {
  throw new Error(`${path} ${message}`);
}
