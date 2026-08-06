import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATE_DIR, loadAndValidateManifests } from './manifests.mjs';
import { sanitizeSecrets } from '../rww/receipt.mjs';

export function buildSpeakCommand(entry, model, outputPath) {
  return {
    file: 'dg',
    args: [
      'speak', entry.text,
      '--output', outputPath,
      '--model', model,
      '--encoding', 'mp3',
      '--non-interactive',
    ],
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const { voices } = await loadAndValidateManifests();
  const entries = [...voices.lines, ...voices.groups].filter((entry) => !options.id || entry.id === options.id);
  if (options.id && entries.length === 0) throw new Error(`Unknown voice line ID: ${options.id}`);

  const plans = entries.map((entry) => {
    const outputPath = join(CANDIDATE_DIR, 'voice', `${entry.id}.mp3`);
    return {
      id: entry.id,
      model: voices.voices[entry.faction].model,
      outputPath,
      receiptPath: `${outputPath}.receipt.json`,
      command: buildSpeakCommand(entry, voices.voices[entry.faction].model, outputPath),
    };
  });

  requireExplicitGenerationScope(options);

  if (!options.generate) {
    console.log(JSON.stringify({ mode: 'dry-run', generated: false, plans }, null, 2));
    return plans;
  }

  if (!process.env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is required with --generate');
  await mkdir(join(CANDIDATE_DIR, 'voice'), { recursive: true });
  const run = dependencies.run ?? runCommand;
  for (const plan of plans) {
    if (await pathExists(plan.outputPath) || await pathExists(plan.receiptPath)) {
      throw new Error(`Candidate already exists: ${plan.id}`);
    }
    try {
      const metadata = await run(plan.command.file, plan.command.args);
      await validateMp3(plan.outputPath);
      await writeFile(plan.receiptPath, `${JSON.stringify({
        provider: 'Deepgram',
        id: plan.id,
        model: plan.model,
        metadata: sanitizeCliMetadata(metadata, process.env.DEEPGRAM_API_KEY),
      }, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      await rm(plan.outputPath, { force: true });
      await rm(plan.receiptPath, { force: true });
      throw error;
    }
    console.log(`Generated ${plan.id}`);
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

function runCommand(file, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: deepgramEnvironment(process.env),
    });
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-64_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', () => reject(new Error('Unable to start the Deepgram CLI')));
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout || stderr);
      else reject(new Error(`Deepgram CLI exited with code ${code}${stderr ? `: ${redact(stderr, process.env.DEEPGRAM_API_KEY)}` : ''}`));
    });
  });
}

export function sanitizeCliMetadata(value, apiKey) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const exactRedacted = apiKey ? value.replaceAll(apiKey, '[REDACTED]') : value;
  try {
    return sanitizeSecrets(JSON.parse(exactRedacted));
  } catch {
    return sanitizeSecrets({ output: redact(exactRedacted) });
  }
}

function pathExists(path) {
  return stat(path).then(() => true, () => false);
}

function deepgramEnvironment(environment) {
  const allowed = [
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'USERPROFILE', 'HOME',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'DEEPGRAM_API_KEY',
  ];
  return Object.fromEntries(allowed
    .filter((name) => typeof environment[name] === 'string')
    .map((name) => [name, environment[name]]));
}

export async function validateMp3(path) {
  const file = await stat(path).catch(() => null);
  if (!file?.isFile() || file.size < 4) throw new Error('Deepgram did not produce a valid MP3 candidate');
  const header = (await readFile(path)).subarray(0, 4);
  const hasId3 = header.subarray(0, 3).toString('ascii') === 'ID3';
  const hasFrameSync = header[0] === 0xff && ((header[1] ?? 0) & 0xe0) === 0xe0;
  if (!hasId3 && !hasFrameSync) {
    throw new Error('Deepgram response is not an MP3 file');
  }
}

function redact(value, apiKey) {
  let redacted = value;
  if (apiKey) redacted = redacted.replaceAll(apiKey, '[REDACTED]');
  return redacted
    .replace(/(api[_-]?key|token|authorization)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .trim();
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
