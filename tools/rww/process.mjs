import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { sanitizeSecrets } from './receipt.mjs';
import { sha256, sha256Json } from './hash.mjs';

const execFileAsync = promisify(execFile);

export async function runChild(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnChild = options.spawn ?? spawn;
    const child = spawnChild(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const stdout = sanitizeSecrets(Buffer.concat(stdoutChunks).toString());
      const stderr = sanitizeSecrets(Buffer.concat(stderrChunks).toString());
      if (options.echo !== false) {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
      }
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

export async function collectGit(cwd) {
  const run = async (args) => (await execFileAsync('git', args, { cwd, windowsHide: true })).stdout.trim();
  try {
    const [sourceBaseSha, branch, trackedPatch, untrackedPaths] = await Promise.all([
      run(['rev-parse', 'HEAD']),
      run(['branch', '--show-current']),
      hashGitOutput(cwd, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
      collectGitPaths(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const sourcePaths = untrackedPaths
      .map((path) => path.replaceAll('\\', '/'))
      .filter((path) => !isEvidencePath(path))
      .sort(comparePaths);
    const untrackedSourceManifest = [];
    for (const path of sourcePaths) {
      untrackedSourceManifest.push({ path, sha256: await hashUntrackedPath(cwd, path) });
    }
    return {
      sha: sourceBaseSha,
      sourceBaseSha,
      branch: branch || null,
      dirty: trackedPatch.bytes > 0 || untrackedPaths.length > 0,
      trackedPatchSha256: trackedPatch.sha256,
      untrackedSourceManifest,
      untrackedSourceManifestSha256: sha256Json(untrackedSourceManifest),
      untrackedSourceCount: untrackedSourceManifest.length,
      untrackedSourceExclusions: ['validation/evidence/**'],
    };
  } catch (error) {
    return {
      sha: null,
      sourceBaseSha: null,
      branch: null,
      dirty: null,
      trackedPatchSha256: null,
      untrackedSourceManifest: [],
      untrackedSourceManifestSha256: null,
      untrackedSourceCount: null,
      untrackedSourceExclusions: ['validation/evidence/**'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function hashGitOutput(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr = [];
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(sanitizeSecrets(Buffer.concat(stderr).toString().trim() || `git exited ${code}`)));
        return;
      }
      resolvePromise({ sha256: hash.digest('hex'), bytes });
    });
  });
}

function collectGitPaths(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(sanitizeSecrets(Buffer.concat(stderr).toString().trim() || `git exited ${code}`)));
        return;
      }
      const paths = Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean);
      resolvePromise(paths);
    });
  });
}

async function hashUntrackedPath(cwd, path) {
  const root = resolve(cwd);
  const absolute = resolve(root, path);
  const child = relative(root, absolute);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`Unsafe untracked path: ${path}`);
  const details = await lstat(absolute);
  if (details.isSymbolicLink()) return sha256(`symlink\0${await readlink(absolute)}`);
  if (!details.isFile()) throw new Error(`Unsupported untracked source type: ${path}`);
  return sha256(await readFile(absolute));
}

function isEvidencePath(path) {
  return path === 'validation/evidence' || path.startsWith('validation/evidence/');
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function collectRuntime() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpu: { model: cpus[0]?.model?.trim() ?? 'unknown', logicalCpus: cpus.length },
    totalRamBytes: os.totalmem(),
  };
}
