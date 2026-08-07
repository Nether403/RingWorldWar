import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
  '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
  '@gen': fileURLToPath(new URL('./src/gen', import.meta.url)),
  '@ai': fileURLToPath(new URL('./src/ai', import.meta.url)),
  '@headless': fileURLToPath(new URL('./src/headless', import.meta.url)),
  '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
};

export { alias };

const root = fileURLToPath(new URL('.', import.meta.url));
const progressFile = resolve(root, 'docs/launch-scope-progress.json');
const roadmapFiles = [
  resolve(root, 'docs/publishable-game-roadmap.md'),
  resolve(root, 'docs/roadmap.md'),
] as const;
const goalsFile = resolve(root, '.opencode/goals/state.json');
const loopsDirectory = resolve(root, '.opencode/opencode-loop');
const runsDirectory = resolve(root, 'output/runs');
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_EVIDENCE_SOURCE_BYTES = 2 * 1024 * 1024;
const RECEIPT_LIMIT = 8;
const LOOP_FILE_LIMIT = 3;
const RECEIPT_COMMANDS = new Set([
  'doctor',
  'perf',
  'phase4e-browser-qualification',
  'play',
  'run',
  'visual',
]);
const RECEIPT_STATUSES = new Set(['error', 'failed', 'failure', 'success']);
const SLICE_STATES = new Set(['complete', 'active', 'queued']);
const SLICE_QUALIFICATIONS = new Set(['not-run', 'pending', 'automation-passed']);
const SLICE_DISPOSITIONS = new Set(['pending', 'clean', 'polish-backlog']);
const COMPLETE_DISPOSITIONS = new Set(['clean', 'polish-backlog']);
const GATE_STATES = new Set(['passed', 'in-progress', 'open']);
const CLAIM_EVIDENCE_POLICY = Object.freeze({
  'LS-01': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-01.json',
    sourcePaths: Object.freeze(['docs/publishable-game-roadmap.md']),
    checkIds: Object.freeze(['authoritative-launch-contract']),
  }),
  'LS-02': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-02.json',
    sourcePaths: Object.freeze([
      'docs/gate-1.md',
      'docs/roadmap.md',
      'validation/evidence/full-suite-2026-08-05.json',
    ]),
    checkIds: Object.freeze(['technical-baseline-reproducible']),
  }),
  'LS-03': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-03.json',
    sourcePaths: Object.freeze(['docs/roadmap.md']),
    checkIds: Object.freeze(['faction-perspective-authority']),
  }),
  'LS-04': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-04.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-04-runtime-scenario-2026-08-07.json',
      'validation/references/sc2-wings-of-liberty.json',
    ]),
    checkIds: Object.freeze(['runtime-scenario-world-factory']),
  }),
  'LS-05': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-05.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-05-campaign-platform-2026-08-07.json',
      'validation/evidence/reviews/ls-05-criterion-review-2026-08-07.json',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['campaign-registry-profile-lifecycle']),
  }),
  'LS-06': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-06.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-06-camera-controller-2026-08-07.json',
      'validation/evidence/reviews/ls-06-criterion-review-2026-08-07.json',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['camera-controller-lifecycle']),
  }),
  'G-07': Object.freeze({
    acceptedState: 'passed',
    receiptPath: 'validation/evidence/launch-scope/G-07.json',
    sourcePaths: Object.freeze([
      'docs/t480s-low-performance.md',
      'validation/evidence/phase-4c-t480s-quality-2026-08-05.json',
    ]),
    checkIds: Object.freeze(['t480s-720p-low-contract']),
  }),
} as const);

type ClaimEvidenceId = keyof typeof CLAIM_EVIDENCE_POLICY;

function evidencePolicy(claimId: string) {
  return Object.prototype.hasOwnProperty.call(CLAIM_EVIDENCE_POLICY, claimId)
    ? CLAIM_EVIDENCE_POLICY[claimId as ClaimEvidenceId]
    : null;
}

async function readBoundedText(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Progress source is not a bounded file');
  return readFile(path, 'utf8');
}

async function readJson(path: string, maxBytes = MAX_TEXT_BYTES): Promise<Record<string, unknown>> {
  return JSON.parse(await readBoundedText(path, maxBytes)) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireExactKeys(record: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an invalid schema`);
  }
}

function isSafeRepositoryPath(path: string): boolean {
  const segments = path.split('/');
  return !path.includes('\\')
    && !path.startsWith('/')
    && !segments.includes('..')
    && /^(?:docs|validation)\/[A-Za-z0-9._/-]+$/.test(path);
}

async function sha256File(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_EVIDENCE_SOURCE_BYTES) {
    throw new Error('Evidence source is not a bounded file');
  }
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function validateOrderedIds(items: Record<string, unknown>[], prefix: string, count: number, label: string) {
  if (items.length !== count) throw new Error(`Manifest must contain exactly ${count} ${label}`);
  const ids = items.map((item, index) => requireNonEmptyString(item.id, `${label}[${index}].id`));
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`Duplicate ${label} ID: ${duplicate}`);
  ids.forEach((id, index) => {
    const expected = `${prefix}-${String(index + 1).padStart(2, '0')}`;
    if (id !== expected) throw new Error(`Invalid ${label} order: expected ${expected}, received ${id}`);
  });
}

export async function validateClaimEvidenceReceipt(
  itemValue: unknown,
  receiptValue: unknown,
): Promise<Record<string, unknown>> {
  const item = requireRecord(itemValue, 'claim');
  const claimId = requireNonEmptyString(item.id, 'claim.id');
  const acceptedState = requireNonEmptyString(item.state, `${claimId}.state`);
  const policy = evidencePolicy(claimId);
  if (policy === null) throw new Error(`${claimId} has no claim evidence policy`);
  if (acceptedState !== policy.acceptedState) {
    throw new Error(`${claimId} state does not match its evidence policy`);
  }
  const receipt = requireRecord(receiptValue, `${claimId} evidence receipt`);
  requireExactKeys(
    receipt,
    ['schema', 'version', 'claimId', 'acceptedState', 'issuedAt', 'sourceRefs', 'checks'],
    `${claimId} evidence receipt`,
  );
  if (receipt.schema !== 'rww.launch-scope-evidence') throw new Error(`${claimId} receipt has an invalid schema`);
  if (receipt.version !== 1) throw new Error(`${claimId} receipt has an invalid version`);
  if (receipt.claimId !== claimId) throw new Error(`${claimId} receipt claimId does not match the claim`);
  if (receipt.acceptedState !== acceptedState) {
    throw new Error(`${claimId} receipt acceptedState does not match ${acceptedState}`);
  }
  const issuedAt = requireNonEmptyString(receipt.issuedAt, `${claimId} receipt issuedAt`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt)
    || Number.isNaN(Date.parse(issuedAt))
    || new Date(issuedAt).toISOString() !== issuedAt) {
    throw new Error(`${claimId} receipt has an invalid issuedAt`);
  }

  const sourceRefs = asArray(receipt.sourceRefs).map((source, index) =>
    requireRecord(source, `${claimId}.sourceRefs[${index}]`));
  if (sourceRefs.length === 0) throw new Error(`${claimId} receipt must contain sourceRefs`);
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `${claimId}.sourceRefs[${index}]`);
    return requireNonEmptyString(source.path, `${claimId}.sourceRefs[${index}].path`);
  });
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error(`${claimId} receipt has duplicate sourceRefs`);
  if (JSON.stringify(sourcePaths) !== JSON.stringify(policy.sourcePaths)) {
    throw new Error(`${claimId} receipt source paths do not match its evidence policy`);
  }
  await Promise.all(sourceRefs.map(async (source, index) => {
    const sourcePath = sourcePaths[index]!;
    if (!isSafeRepositoryPath(sourcePath)) throw new Error(`Unsafe evidence source path: ${sourcePath}`);
    const digest = requireNonEmptyString(source.sha256, `${claimId}.sourceRefs[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${claimId} has an invalid source SHA-256`);
    let actualDigest: string;
    try {
      actualDigest = await sha256File(resolve(root, sourcePath));
    } catch {
      throw new Error(`Evidence source is absent or unbounded: ${sourcePath}`);
    }
    if (actualDigest !== digest) throw new Error(`Evidence source SHA-256 mismatch: ${sourcePath}`);
  }));

  const checks = asArray(receipt.checks).map((check, index) =>
    requireRecord(check, `${claimId}.checks[${index}]`));
  if (checks.length === 0) throw new Error(`${claimId} receipt must contain at least one check`);
  const checkIds = checks.map((check, index) =>
    requireNonEmptyString(check.id, `${claimId}.checks[${index}].id`));
  if (new Set(checkIds).size !== checkIds.length) throw new Error(`${claimId} receipt has duplicate check IDs`);
  if (JSON.stringify(checkIds) !== JSON.stringify(policy.checkIds)) {
    throw new Error(`${claimId} receipt check IDs do not match its evidence policy`);
  }
  for (const [index, check] of checks.entries()) {
    requireExactKeys(check, ['id', 'result', 'summary'], `${claimId}.checks[${index}]`);
    requireNonEmptyString(check.summary, `${claimId}.checks[${index}].summary`);
    if (check.result !== 'passed') throw new Error(`${claimId}.checks[${index}] did not pass`);
  }
  return receipt;
}

async function validateEvidenceRefs(item: Record<string, unknown>, required: boolean, label: string) {
  const value = item.evidenceRefs;
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`${label} must contain exactly one claim evidence receipt in evidenceRefs`);
  }
  const reference = requireNonEmptyString(value[0], `${label}.evidenceRefs[0]`);
  if (!isSafeRepositoryPath(reference)) throw new Error(`Unsafe evidence reference: ${reference}`);
  const policy = evidencePolicy(label);
  if (policy === null) throw new Error(`${label} has no policy for an exact claim receipt`);
  if (String(item.state) !== policy.acceptedState) {
    throw new Error(`${label} state does not match its evidence policy`);
  }
  if (reference !== policy.receiptPath) {
    throw new Error(`${label} must reference its exact claim receipt: ${policy.receiptPath}`);
  }
  let receipt: Record<string, unknown>;
  try {
    receipt = await readJson(resolve(root, reference));
  } catch {
    throw new Error(`Claim evidence receipt is absent or invalid: ${reference}`);
  }
  await validateClaimEvidenceReceipt(item, receipt);
}

export async function validateLaunchProgressManifest(value: unknown): Promise<Record<string, unknown>> {
  const plan = requireRecord(value, 'manifest');
  requireExactKeys(
    plan,
    [
      'schema',
      'version',
      'statusDate',
      'activeSlice',
      'states',
      'qualifications',
      'dispositions',
      'reviewPolicy',
      'slices',
      'gates',
      'references',
    ],
    'manifest',
  );
  if (plan.schema !== 'rww.launch-scope-progress') throw new Error('Invalid manifest schema');
  if (plan.version !== 2) throw new Error('Invalid manifest version');
  const statusDate = requireNonEmptyString(plan.statusDate, 'statusDate');
  const parsedDate = new Date(`${statusDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statusDate)
    || Number.isNaN(parsedDate.valueOf())
    || parsedDate.toISOString().slice(0, 10) !== statusDate) {
    throw new Error('Invalid manifest statusDate');
  }
  if (JSON.stringify(plan.states) !== JSON.stringify([...SLICE_STATES])) {
    throw new Error('Manifest states must match the allowed slice states');
  }
  if (JSON.stringify(plan.qualifications) !== JSON.stringify([...SLICE_QUALIFICATIONS])) {
    throw new Error('Manifest qualification values must match the allowed values');
  }
  if (JSON.stringify(plan.dispositions) !== JSON.stringify([...SLICE_DISPOSITIONS])) {
    throw new Error('Manifest disposition values must match the allowed values');
  }
  const reviewPolicy = requireRecord(plan.reviewPolicy, 'reviewPolicy');
  requireExactKeys(
    reviewPolicy,
    ['maxRemediationRounds', 'maxVisualRemediationRounds'],
    'reviewPolicy',
  );
  if (reviewPolicy.maxRemediationRounds !== 2 || reviewPolicy.maxVisualRemediationRounds !== 1) {
    throw new Error('reviewPolicy must keep remediation rounds bounded at 2 total and 1 visual-only');
  }

  const slices = asArray(plan.slices).map((slice, index) => requireRecord(slice, `slices[${index}]`));
  validateOrderedIds(slices, 'LS', 37, 'slices');
  let previousMilestone = -1;
  for (const slice of slices) {
    const id = String(slice.id);
    requireExactKeys(
      slice,
      slice.evidenceRefs === undefined
        ? ['id', 'milestone', 'title', 'state', 'qualification', 'disposition', 'evidence']
        : ['id', 'milestone', 'title', 'state', 'qualification', 'disposition', 'evidence', 'evidenceRefs'],
      id,
    );
    requireNonEmptyString(slice.title, `${id}.title`);
    requireNonEmptyString(slice.evidence, `${id}.evidence`);
    const state = String(slice.state);
    const qualification = String(slice.qualification);
    const disposition = String(slice.disposition);
    if (!SLICE_STATES.has(state)) throw new Error(`${id} has an invalid state`);
    if (!SLICE_QUALIFICATIONS.has(qualification)) throw new Error(`${id} has an invalid qualification`);
    if (!SLICE_DISPOSITIONS.has(disposition)) throw new Error(`${id} has an invalid disposition`);
    if (state === 'complete' && qualification !== 'automation-passed') {
      throw new Error(`${id} qualification is invalid for complete state`);
    }
    if (state === 'complete' && !COMPLETE_DISPOSITIONS.has(disposition)) {
      throw new Error(`${id} disposition is invalid for complete state`);
    }
    if (state === 'active' && !['pending', 'automation-passed'].includes(qualification)) {
      throw new Error(`${id} qualification is invalid for active state`);
    }
    if (state === 'active' && disposition !== 'pending') {
      throw new Error(`${id} disposition is invalid for active state`);
    }
    if (state === 'queued' && qualification !== 'not-run') {
      throw new Error(`${id} qualification is invalid for queued state`);
    }
    if (state === 'queued' && disposition !== 'pending') {
      throw new Error(`${id} disposition is invalid for queued state`);
    }
    if (!Number.isInteger(slice.milestone)
      || Number(slice.milestone) < 0
      || Number(slice.milestone) < previousMilestone) {
      throw new Error(`${id} has an invalid or decreasing milestone`);
    }
    previousMilestone = Number(slice.milestone);
    await validateEvidenceRefs(slice, state === 'complete', id);
  }
  const activeSlices = slices.filter((slice) => slice.state === 'active');
  if (activeSlices.length !== 1) throw new Error('Manifest must contain exactly one active slice');
  const activeSlice = requireNonEmptyString(plan.activeSlice, 'activeSlice');
  if (activeSlices[0]?.id !== activeSlice) throw new Error('activeSlice must match the sole active slice');

  const gates = asArray(plan.gates).map((gate, index) => requireRecord(gate, `gates[${index}]`));
  validateOrderedIds(gates, 'G', 8, 'gates');
  for (const gate of gates) {
    const id = String(gate.id);
    requireNonEmptyString(gate.title, `${id}.title`);
    requireNonEmptyString(gate.target, `${id}.target`);
    requireNonEmptyString(gate.evidence, `${id}.evidence`);
    if (!GATE_STATES.has(String(gate.state))) throw new Error(`${id} has an invalid state`);
    await validateEvidenceRefs(gate, gate.state === 'passed', id);
  }

  const references = asArray(plan.references).map((reference, index) =>
    requireRecord(reference, `references[${index}]`));
  if (references.length !== 3) throw new Error('Manifest must contain exactly 3 references');
  const referenceIds = references.map((reference, index) =>
    requireNonEmptyString(reference.id, `references[${index}].id`));
  if (new Set(referenceIds).size !== referenceIds.length) throw new Error('Reference IDs must be unique');
  for (const reference of references) {
    requireNonEmptyString(reference.label, `${reference.id}.label`);
    requireNonEmptyString(reference.use, `${reference.id}.use`);
    const urlText = requireNonEmptyString(reference.url, `${reference.id}.url`);
    try {
      const url = new URL(urlText);
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('unsafe URL');
    } catch {
      throw new Error(`${reference.id} has an invalid reference URL`);
    }
  }
  return plan;
}

function allowlistedString(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function isoDateString(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    ? value
    : null;
}

async function summarizeRoadmap(path: string) {
  const [content, info] = await Promise.all([readBoundedText(path, MAX_TEXT_BYTES), stat(path)]);
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? basename(path);
  const status = content.match(/^\*\*Status(?: date)?[:*]*\*\*\s*:?\s*(.+)$/mi)?.[1] ?? null;
  return {
    path: `docs/${basename(path)}`,
    heading,
    status,
    sections: (content.match(/^##\s+/gm) ?? []).length,
    modifiedAt: info.mtime.toISOString(),
  };
}

async function summarizeGoals() {
  try {
    const state = await readJson(goalsFile);
    const goals = asArray(state.goals).map(asRecord);
    return {
      available: true,
      total: goals.length,
      active: goals.filter((goal) => ['active', 'running', 'in_progress'].includes(String(goal.status))).length,
      results: asArray(state.results).length,
      archives: asArray(state.archives).length,
    };
  } catch {
    return { available: false, total: 0, active: 0, results: 0, archives: 0 };
  }
}

async function summarizeLoops() {
  try {
    const names = (await readdir(loopsDirectory))
      .filter((name) => /^ses_[A-Za-z0-9]+\.json$/.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, LOOP_FILE_LIMIT);
    const files = await Promise.all(names.map(async (name) => {
      const state = await readJson(resolve(loopsDirectory, name));
      const jobs = asArray(state.jobs).map(asRecord);
      return {
        jobs: jobs.length,
        running: jobs.filter((job) => ['active', 'running', 'in_progress'].includes(String(job.status))).length,
      };
    }));
    return {
      available: true,
      sessions: files.length,
      jobs: files.reduce((sum, file) => sum + file.jobs, 0),
      running: files.reduce((sum, file) => sum + file.running, 0),
    };
  } catch {
    return { available: false, sessions: 0, jobs: 0, running: 0 };
  }
}

async function newestReceipts() {
  try {
    const runIds = (await readdir(runsDirectory))
      .filter((name) => /^\d{8}T\d{6}(?:\.\d+)?Z-[A-Za-z0-9._-]+$/.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, RECEIPT_LIMIT);
    const summaries = await Promise.all(runIds.map(async (runId) => {
      try {
        const receipt = await readJson(resolve(runsDirectory, runId, 'receipt.json'), MAX_RECEIPT_BYTES);
        const command = asRecord(receipt.command);
        const outcome = asRecord(receipt.outcome);
        const environmental = asRecord(receipt.environmental);
        return {
          runId,
          command: allowlistedString(command.name, RECEIPT_COMMANDS) ?? 'other',
          status: allowlistedString(outcome.status, RECEIPT_STATUSES) ?? 'unknown',
          startedAt: isoDateString(environmental.startedAt),
          durationMilliseconds: typeof environmental.durationMilliseconds === 'number'
            ? environmental.durationMilliseconds
            : null,
          path: `output/runs/${runId}/receipt.json`,
        };
      } catch {
        return null;
      }
    }));
    return summaries.filter((receipt) => receipt !== null);
  } catch {
    return [];
  }
}

async function buildProgressPayload() {
  const [[rawPlan, planInfo], roadmaps, goals, loops, receipts] = await Promise.all([
    Promise.all([readJson(progressFile), stat(progressFile)]),
    Promise.all(roadmapFiles.map(summarizeRoadmap)),
    summarizeGoals(),
    summarizeLoops(),
    newestReceipts(),
  ]);
  const plan = await validateLaunchProgressManifest(rawPlan);
  return {
    generatedAt: new Date().toISOString(),
    planModifiedAt: planInfo.mtime.toISOString(),
    plan,
    roadmaps,
    goals,
    loops,
    receipts,
  };
}

function progressEndpoint(): Plugin {
  return {
    name: 'rww-progress-endpoint',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname !== '/__rww/progress') return next();
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          return response.end(JSON.stringify({ error: 'Method not allowed' }));
        }
        try {
          const body = JSON.stringify(await buildProgressPayload());
          response.statusCode = 200;
          return response.end(request.method === 'HEAD' ? undefined : body);
        } catch {
          response.statusCode = 500;
          return response.end(JSON.stringify({ error: 'Progress data unavailable' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [progressEndpoint()],
  resolve: { alias },
  server: { port: 5180, open: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
