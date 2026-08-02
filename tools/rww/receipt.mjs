import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Json } from './hash.mjs';

export const RECEIPT_SCHEMA = 'rww.run-receipt';
export const RECEIPT_VERSION = 1;

const EXIT_RESULTS = {
  success: { exitCode: 0, failureCategory: null },
  usage: { exitCode: 2, failureCategory: 'usage/config' },
  gate: { exitCode: 3, failureCategory: 'deterministic/gate' },
  runtime: { exitCode: 4, failureCategory: 'infrastructure/runtime' },
};

export function classifyExit(kind) {
  const result = EXIT_RESULTS[kind];
  if (result === undefined) throw new Error(`Unknown exit classification: ${kind}`);
  return { ...result };
}

export function deterministicReceiptDigest(deterministic) {
  return sha256Json(deterministic);
}

export function createRunId(now = new Date(), suffix = `${process.pid}-${randomUUID().slice(0, 8)}`) {
  return `${now.toISOString().replace(/[-:]/g, '').replace('.000', '')}-${suffix}`;
}

export function resolveRunDirectory(runsRoot, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new Error(`Unsafe run ID: ${runId}`);
  }
  const root = resolve(runsRoot);
  const directory = resolve(root, runId);
  const child = relative(root, directory);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`Unsafe run ID: ${runId}`);
  return directory;
}

export async function writeReceipt({ runsRoot, receipt }) {
  const directory = resolveRunDirectory(runsRoot, receipt.runId);
  await mkdir(directory, { recursive: true });
  const sanitized = sanitizeSecrets(receipt);
  const path = resolve(directory, 'receipt.json');
  await writeFile(path, `${JSON.stringify(sanitized, null, 2)}\n`, { flag: 'wx' });
  return { directory, path, receipt: sanitized };
}

export function buildReceipt({ runId, command, deterministic = {}, environmental = {}, outcome, reproduction }) {
  const safeDeterministic = sanitizeSecrets(deterministic);
  return {
    schema: RECEIPT_SCHEMA,
    version: RECEIPT_VERSION,
    runId,
    command: sanitizeSecrets(command),
    deterministic: {
      ...safeDeterministic,
      digest: deterministicReceiptDigest(safeDeterministic),
    },
    environmental: sanitizeSecrets(environmental),
    outcome,
    reproduction: sanitizeSecrets(reproduction),
  };
}

export function sanitizeSecrets(value, key = '') {
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeSecrets(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      sanitizeSecrets(child, childKey),
    ]));
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(
      /(\b(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|SECRET(?:_ACCESS_KEY)?|ACCESS_KEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY)\s*=\s*)(["'])([\s\S]*?)\2/gi,
      '$1[REDACTED]',
    )
    .replace(
      /(\b(?:[A-Z][A-Z0-9_]*_)?PRIVATE_KEY\s*=\s*)-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/gi,
      '$1[REDACTED]',
    )
    .replace(/-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/gi, '[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|SECRET(?:_ACCESS_KEY)?|ACCESS_KEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY))\s*=\s*([^\s,;&#]+)/gi, '$1=[REDACTED]')
    .replace(/\b(token|secret|password|passwd|api[-_]?key)(\s*[=:]\s*)[^\s,;&#]+/gi, '$1$2[REDACTED]')
    .replace(/([?&](?:access_token|auth|api[-_]?key|token|secret|password|passwd)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b((?:Bearer|Basic)\s+)[^\s,;]+/gi, '$1[REDACTED]');
}

function isSensitiveKey(key) {
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return /(?:^|[-_])(?:token|secret|password|passwd|api[-_]?key|authorization|cookie)(?:s|[-_]|$)/.test(normalizedKey);
}
