import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATE_DIR, loadAndValidateManifests } from './manifests.mjs';
import { sanitizeSecrets } from '../rww/receipt.mjs';

const API_VERSION = '2025-04-01-preview';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function buildImageRequest(entry, environment = process.env, placeholders = false) {
  const endpoint = placeholders ? '$AZURE_OPENAI_ENDPOINT' : required(environment, 'AZURE_OPENAI_ENDPOINT');
  const deployment = placeholders ? '$AZURE_OPENAI_DEPLOYMENT_NAME' : required(environment, 'AZURE_OPENAI_DEPLOYMENT_NAME');
  const target = placeholders
    ? { base: endpoint.replace(/\/$/, ''), useV1: false }
    : validateAzureEndpoint(endpoint);
  const deploymentSegment = placeholders ? deployment : encodeURIComponent(deployment);
  const body = {
    prompt: finalPrompt(entry),
    n: 1,
    size: entry.size,
    quality: 'high',
    output_format: 'png',
  };
  if (target.useV1) body.model = deployment;
  return {
    method: 'POST',
    url: target.useV1
      ? `${target.base}/images/generations?api-version=preview`
      : `${target.base}/openai/deployments/${deploymentSegment}/images/generations?api-version=${API_VERSION}`,
    deployment,
    body,
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const { images } = await loadAndValidateManifests();
  const entries = images.prompts.filter((entry) => !options.id || entry.id === options.id);
  if (options.id && entries.length === 0) throw new Error(`Unknown image prompt ID: ${options.id}`);
  requireExplicitGenerationScope(options);

  if (!options.generate) {
    const plans = entries.map((entry) => ({
      id: entry.id,
      outputPath: join(CANDIDATE_DIR, 'images', `${entry.id}.png`),
      request: buildImageRequest(entry, process.env, true),
    }));
    console.log(JSON.stringify({ mode: 'dry-run', generated: false, plans }, null, 2));
    return plans;
  }

  const apiKey = required(process.env, 'AZURE_OPENAI_API_KEY');
  await mkdir(join(CANDIDATE_DIR, 'images'), { recursive: true });
  const request = dependencies.fetch ?? fetch;
  const plans = [];
  for (const entry of entries) {
    const plan = buildImageRequest(entry);
    const outputPath = join(CANDIDATE_DIR, 'images', `${entry.id}.png`);
    const receiptPath = `${outputPath}.receipt.json`;
    if (await pathExists(outputPath) || await pathExists(receiptPath)) {
      throw new Error(`Candidate already exists: ${entry.id}`);
    }
    const response = await request(plan.url, {
      method: plan.method,
      headers: { 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(plan.body),
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
    const payload = await readResponse(response);
    const image = decodeImage(payload);
    try {
      await writeFile(outputPath, image, { flag: 'wx' }).catch((error) => {
        if (error?.code === 'EEXIST') throw new Error(`Candidate already exists: ${entry.id}`);
        throw error;
      });
      await writeFile(receiptPath, `${JSON.stringify({
        provider: 'Azure OpenAI',
        id: entry.id,
        deployment: plan.deployment,
        created: typeof payload.created === 'number' ? payload.created : null,
        requestId: response.headers?.get?.('apim-request-id') ?? response.headers?.get?.('x-request-id') ?? null,
        format: plan.body.output_format,
        size: plan.body.size,
        quality: plan.body.quality,
        prompt: plan.body.prompt,
      }, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      await rm(outputPath, { force: true });
      await rm(receiptPath, { force: true });
      throw error;
    }
    plans.push({ id: entry.id, outputPath, request: plan });
    console.log(`Generated ${entry.id}`);
  }
  return plans;
}

function parseArgs(argv) {
  const options = { generate: false, id: null, all: false, confirmBulk: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--generate') options.generate = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--confirm-bulk') options.confirmBulk = true;
    else if (arg === '--id') {
      options.id = argv[++index];
      if (!options.id) throw new Error('--id requires a value');
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireExplicitGenerationScope(options) {
  if (!options.generate) return;
  if (options.id && options.all) throw new Error('--id and --all cannot be combined');
  if (!options.id && !(options.all && options.confirmBulk)) {
    throw new Error('Paid generation requires --id, or --all --confirm-bulk for an approved bulk run');
  }
}

async function readResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Azure image service returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const code = typeof payload?.error?.code === 'string' ? ` (${payload.error.code})` : '';
    const message = typeof payload?.error?.message === 'string'
      ? `: ${String(sanitizeSecrets(payload.error.message)).slice(0, 500)}`
      : '';
    throw new Error(`Azure image service failed with HTTP ${response.status}${code}${message}`);
  }
  return payload;
}

export function decodeImage(payload) {
  if (!payload || !Array.isArray(payload.data) || payload.data.length !== 1 ||
      typeof payload.data[0]?.b64_json !== 'string') {
    throw new Error('Azure image response does not contain exactly one base64 image');
  }
  const encoded = payload.data[0].b64_json;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('Azure image response contains malformed base64');
  }
  const image = Buffer.from(encoded, 'base64');
  if (image.length <= PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Azure image response is not a PNG file');
  }
  return image;
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required with --generate`);
  return value;
}

function finalPrompt(entry) {
  if (entry.kind !== 'unit-dossier') return entry.prompt;
  const style = entry.faction === 'compact'
    ? 'Match the approved Meridian Compact style: one machine only in a dark graphite maintenance bay, broad layered angular armor, external buttresses, weathered alloy, restrained amber recognition strips, low-key tactical HUD lighting.'
    : 'Match the approved Axiom Choir style: one machine only in a dark graphite fabrication bay, narrow asymmetric composite shells, articulated maintenance geometry, vertical sensor fins, deliberate negative space, restrained cyan recognition lights, low-key tactical HUD lighting.';
  return `${entry.prompt} ${style} Full machine visible, centered with generous negative space. No people, emblem, insignia, symbol column, logo, interface frame, blueprint board, diagram, label, readable text, or pseudo-text.`;
}

function pathExists(path) {
  return stat(path).then(() => true, () => false);
}

function validateAzureEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('AZURE_OPENAI_ENDPOINT must be a valid HTTPS Azure endpoint');
  }
  const allowedHost = endpoint.hostname.endsWith('.openai.azure.com') ||
    endpoint.hostname.endsWith('.services.ai.azure.com') ||
    endpoint.hostname.endsWith('.cognitiveservices.azure.com');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !allowedHost) {
    throw new Error('AZURE_OPENAI_ENDPOINT must be a valid HTTPS Azure endpoint');
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '/openai/v1') {
    throw new Error('AZURE_OPENAI_ENDPOINT must not contain an unexpected path');
  }
  return {
    base: endpoint.href.replace(/\/$/, ''),
    useV1: endpoint.pathname === '/openai/v1',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  loadLocalEnvironment();
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function loadLocalEnvironment() {
  try {
    process.loadEnvFile?.(resolve('.env'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Unable to load the local media environment');
  }
}
