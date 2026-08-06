import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const OUTPUT = join(ROOT, 'docs', 'phase-5-media-receipt.json');
const DELIVERY_DIRS = [
  join(PUBLIC, 'media', 'voices'),
  join(PUBLIC, 'media', 'presentation', 'units'),
  join(PUBLIC, 'media', 'presentation', 'narrative'),
];
const EXTRA_FILES = [join(PUBLIC, 'media', 'presentation', 'last-rotation-title.webp')];
const IMAGE_REQUEST_IDS = {
  'last-rotation-title': '4534b63e-db23-4878-af25-4333c0262628',
  'dossier.compact.engineer': 'af88c976-6954-4fbf-9be2-51417d141731',
  'dossier.compact.vanguard': '40b208a2-153a-4ca6-b8cf-6b5b4864274f',
  'dossier.compact.longbow': '615eafdc-d9e8-4de3-8b8b-2cfd2fd2f519',
  'dossier.compact.wisp': '991efb61-7aca-40f3-a5da-e3de0b46245c',
  'dossier.compact.aegis': '4a26a10e-5852-4d99-aeea-9b84fe970971',
  'dossier.compact.bulwark': '1517daec-52a5-4646-9edb-8f74a86b914e',
  'dossier.choir.engineer': '7dc70709-9ed2-4d13-ba60-6b1c95eeaaca',
  'dossier.choir.vanguard': '6b64daf6-5885-4958-9d0e-64ee23da1b3e',
  'dossier.choir.longbow': '526a6376-3f00-40cb-9b3f-9295d8d72ff8',
  'dossier.choir.wisp': '15d53318-2e11-4fb3-a1d3-108cbf0d7357',
  'dossier.choir.aegis': 'd0234e88-697e-4803-a498-38566f1799d9',
  'dossier.choir.needle': '953f2268-fa65-414a-a359-5635839dc5fd',
  'signal-briefing': '367fb502-dbba-4785-9c92-ea783b4ad2f8',
  'signal-hunters': '10faa43f-1d9f-400d-93f5-ff3285cdc1bb',
  'signal-migration': 'd3f5bd60-42ff-4ecc-b1d4-5dfee14ba7ab',
  'signal-last-correction': '55cc8157-4f25-4084-b7fd-c423f9c6c3bd',
};

const files = [...EXTRA_FILES];
for (const directory of DELIVERY_DIRS) {
  for (const name of await readdir(directory)) files.push(join(directory, name));
}
const assets = [];
for (const path of files.sort()) {
  const [bytes, contents] = await Promise.all([stat(path), readFile(path)]);
  const id = deliveryId(path);
  assets.push({
    path: relative(ROOT, path).replaceAll('\\', '/'),
    bytes: bytes.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
    ...(IMAGE_REQUEST_IDS[id] ? { generationRequestId: IMAGE_REQUEST_IDS[id] } : {}),
  });
}
if (assets.length !== 85) throw new Error(`Expected 85 Phase 5 delivery assets, found ${assets.length}`);
const receipt = {
  schema: 'rww.phase-5-media-receipt',
  version: 1,
  reviewedAt: '2026-08-06',
  providers: {
    voices: { provider: 'Deepgram', compactModel: 'aura-2-orion-en', choirModel: 'aura-2-luna-en' },
    images: { provider: 'Azure OpenAI', deployment: 'gpt-image-2-2' },
  },
  assets,
  totals: {
    files: assets.length,
    bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  },
};
await writeFile(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt.totals));

function deliveryId(path) {
  return path.split(/[\\/]/).pop().replace(/\.(?:mp3|webp)$/, '');
}
