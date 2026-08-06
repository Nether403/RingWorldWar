import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateManifests } from './manifests.mjs';

export async function main() {
  const manifests = await loadAndValidateManifests();
  const summary = {
    valid: true,
    voiceLines: manifests.voices.lines.length,
    factionGroups: manifests.voices.groups.length,
    imagePrompts: manifests.images.prompts.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
