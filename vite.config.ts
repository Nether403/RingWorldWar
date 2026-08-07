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
export const CLAIM_EVIDENCE_POLICY = Object.freeze({
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
  'LS-07': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-07.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-07-paired-nodes-2026-08-07.json',
      'validation/evidence/reviews/ls-07-criterion-review-2026-08-07.json',
      'docs/launch-scope/ls-07-paired-spinal-nodes.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['paired-spinal-node-alignment']),
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

export const LS07_ACCEPTANCE_IDS = Object.freeze([
  'topology',
  'capture',
  'alignment',
  'gameplay-consequence',
  'ai',
  'persistence',
  'presentation',
  'regression',
  'scope',
] as const);

export const LS07_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/sim/data.ts',
  'src/sim/world.ts',
  'src/sim/serialize.ts',
  'src/scenario/runtimeScenario.ts',
  'src/scenario/worldFactory.ts',
  'src/scenario/firstContact.ts',
  'src/ai/opponent.ts',
  'src/ui/hud.ts',
  'tests/sim/spinalAlignment.test.ts',
  'tests/sim/serialize.test.ts',
  'tests/ai/strategist.test.ts',
  'tests/scenario/runtimeScenario.test.ts',
  'e2e/spinal-alignment.spec.ts',
] as const);

export const LS07_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/sim/spinalAlignment.test.ts tests/sim/serialize.test.ts tests/ai/strategist.test.ts tests/scenario/runtimeScenario.test.ts',
    artifactPath: 'validation/evidence/runs/ls-07-focused-unit-2026-08-07.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/spinal-alignment.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-07-focused-browser-2026-08-07.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-07-full-check-2026-08-07.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-07-core-match-2026-08-07.json',
  }),
} as const);

type LS07RunId = keyof typeof LS07_RUN_POLICY;

export const LS07_CHECK_POLICY = Object.freeze({
  topology: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['canonical-pair-topology', 'scenario-pair-identity']),
  }),
  capture: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['two-phase-capture-timing', 'contested-freeze-friendly-repair', 'damage-neutralization']),
  }),
  alignment: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['alignment-event-order', 'unpaired-node-behavior']),
  }),
  'gameplay-consequence': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['pair-only-dominance', 'existing-victory-outcomes']),
  }),
  ai: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['ai-pair-completion', 'ai-pair-denial-defense']),
  }),
  persistence: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['world-v2-round-trip', 'world-v1-pair-migration', 'legacy-game-save-compatibility']),
  }),
  presentation: Object.freeze({
    runIds: Object.freeze(['focused-browser'] as LS07RunId[]),
    testIds: Object.freeze(['hud-minimap-pair-state', 'alignment-accessible-events', 'hidden-mate-no-leak']),
  }),
  regression: Object.freeze({
    runIds: Object.freeze(['full-check', 'core-match'] as LS07RunId[]),
    testIds: Object.freeze(['full-check', 'core-match-cohorts']),
  }),
  scope: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['ls07-scope-exclusions']),
  }),
} as const);

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

function isSafeImplementationPath(path: string): boolean {
  const segments = path.split('/');
  return !path.includes('\\')
    && !path.startsWith('/')
    && !segments.includes('..')
    && /^(?:src|tests|e2e)\/[A-Za-z0-9._/-]+$/.test(path);
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireNonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
  return digest;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => requireNonEmptyString(entry, `${label}[${index}]`));
}

export function ls07SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-07 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-07 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-07 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function validateLS07EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  requireExactKeys(
    machine,
    ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'],
    'LS-07 machine evidence',
  );
  if (machine.schema !== 'rww.ls-07-verification' || machine.version !== 1 || machine.sliceId !== 'LS-07') {
    throw new Error('LS-07 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-07 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-07 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-07 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-07 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-07 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-07 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-07 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error('LS-07 machine evidence has duplicate source paths');
  for (const requiredPath of LS07_REQUIRED_SOURCE_PATHS) {
    if (!sourcePaths.includes(requiredPath)) throw new Error(`LS-07 machine evidence is missing required source: ${requiredPath}`);
  }
  const sourceSnapshotSha256 = ls07SourceSnapshotSha256(sourceRefs);

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-07 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-07 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-07 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS07_RUN_POLICY))) {
    throw new Error('LS-07 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS07RunId;
    const runPolicy = LS07_RUN_POLICY[id];
    if (run.command !== runPolicy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-07 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-07 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-07 machine runs[${index}].artifact`);
    if (artifact.path !== runPolicy.artifactPath) throw new Error(`LS-07 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-07 machine runs[${index}].artifact.sha256`);

    const runArtifact = requireRecord(runArtifactValues[id], `LS-07 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-07 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id) {
      throw new Error(`LS-07 run artifact ${id} has an invalid identity`);
    }
    if (runArtifact.command !== runPolicy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-07 run artifact ${id} does not prove the exact passing command`);
    }
    requireSha256(runArtifact.sourceSnapshotSha256, `LS-07 run artifact ${id}.sourceSnapshotSha256`);
    if (runArtifact.sourceSnapshotSha256 !== sourceSnapshotSha256) {
      throw new Error(`LS-07 run artifact ${id} does not bind the implementation source snapshot`);
    }
    const runSummary = requireNonEmptyString(runArtifact.summary, `LS-07 run artifact ${id}.summary`);
    if (runSummary.length < 20) throw new Error(`LS-07 run artifact ${id} lacks a substantive summary`);
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-07 run artifact ${id}.passedTestIds`);
    if (new Set(passedTestIds).size !== passedTestIds.length) throw new Error(`LS-07 run artifact ${id} has duplicate test IDs`);
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }
  const expectedTestIdsByRun = new Map<string, string[]>();
  for (const policy of Object.values(LS07_CHECK_POLICY)) {
    for (const runId of policy.runIds) {
      const expected = expectedTestIdsByRun.get(runId) ?? [];
      for (const testId of policy.testIds) if (!expected.includes(testId)) expected.push(testId);
      expectedTestIdsByRun.set(runId, expected);
    }
  }
  for (const runId of Object.keys(LS07_RUN_POLICY)) {
    if (JSON.stringify([...passedTestIdsByRun.get(runId)!]) !== JSON.stringify(expectedTestIdsByRun.get(runId) ?? [])) {
      throw new Error(`LS-07 run artifact ${runId} does not contain the exact predeclared test IDs`);
    }
  }

  const checks = asArray(machine.checks).map((check, index) =>
    requireRecord(check, `LS-07 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-07 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-07 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-07 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS07_ACCEPTANCE_IDS)) {
    throw new Error('LS-07 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS07_CHECK_POLICY;
    const checkPolicy = LS07_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-07 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-07 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(checkPolicy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(checkPolicy.testIds)) {
      throw new Error(`LS-07 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-07 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }

  const review = requireRecord(reviewValue, 'LS-07 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-07 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-07') {
    throw new Error('LS-07 criterion review has an invalid identity');
  }
  requireNonEmptyString(review.reviewId, 'LS-07 criterion review reviewId');
  if (review.reviewType !== 'gameplay-system-acceptance' || review.independentContext !== true) {
    throw new Error('LS-07 criterion review is not an independent gameplay-system review');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-07 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-07 criterion review reviewer');
  if (reviewer.role !== 'independent-critic') throw new Error('LS-07 criterion review has the wrong reviewer role');
  const taskId = requireNonEmptyString(reviewer.taskId, 'LS-07 criterion review reviewer.taskId');
  if (!/^ses_[A-Za-z0-9]+$/.test(taskId)) throw new Error('LS-07 criterion review has invalid task provenance');
  requireNonEmptyString(reviewer.model, 'LS-07 criterion review reviewer.model');
  const completedAt = requireNonEmptyString(reviewer.completedAt, 'LS-07 criterion review reviewer.completedAt');
  if (!isoDateString(completedAt)) throw new Error('LS-07 criterion review has invalid completion time');
  if (requireSha256(reviewer.sourceSnapshotSha256, 'LS-07 criterion review reviewer.sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-07 criterion review does not bind the implementation source snapshot');
  }
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 3) {
    throw new Error('LS-07 criterion review exceeds the bounded review policy');
  }
  const reviewContractSha256 = requireSha256(review.contractSha256, 'LS-07 review contractSha256');
  const reviewPolicySha256 = requireSha256(review.policySha256, 'LS-07 review policySha256');
  if (expectedHashes && (
    reviewContractSha256 !== expectedHashes.contractSha256
    || reviewPolicySha256 !== expectedHashes.policySha256
  )) {
    throw new Error('LS-07 criterion review does not bind the current contract and execution policy');
  }

  const scores = requireRecord(review.scores, 'LS-07 criterion review scores');
  requireExactKeys(scores, [...LS07_ACCEPTANCE_IDS], 'LS-07 criterion review scores');
  for (const id of LS07_ACCEPTANCE_IDS) {
    const scoreRecord = requireRecord(scores[id], `LS-07 criterion review scores.${id}`);
    requireExactKeys(scoreRecord, ['score', 'checkId', 'rationale'], `LS-07 criterion review scores.${id}`);
    if (scoreRecord.checkId !== id) throw new Error(`LS-07 criterion ${id} is not linked to its machine check`);
    const rationale = requireNonEmptyString(scoreRecord.rationale, `LS-07 criterion review scores.${id}.rationale`);
    if (rationale.length < 20) throw new Error(`LS-07 criterion ${id} lacks a substantive rationale`);
    const score = scoreRecord.score;
    if (!Number.isInteger(score) || Number(score) < 3 || Number(score) > 4) {
      throw new Error(`LS-07 criterion ${id} is below ship-ready`);
    }
  }
  if (review.dependencyReady !== true) throw new Error('LS-07 criterion review is not dependency-ready');
  if (requireStringArray(review.blockers, 'LS-07 criterion review blockers').length !== 0) {
    throw new Error('LS-07 criterion review contains blockers');
  }
  if (requireStringArray(review.requiredQualityFindings, 'LS-07 criterion review requiredQualityFindings').length !== 0) {
    throw new Error('LS-07 criterion review contains required-quality findings');
  }
  if (requireStringArray(review.humanValidation, 'LS-07 criterion review humanValidation').length !== 0) {
    throw new Error('LS-07 criterion review must not claim human validation');
  }
  const polish = asArray(review.polish).map((finding, index) =>
    requireRecord(finding, `LS-07 criterion review polish[${index}]`));
  for (const [index, finding] of polish.entries()) {
    requireExactKeys(finding, ['id', 'summary', 'reopenTrigger'], `LS-07 criterion review polish[${index}]`);
    requireNonEmptyString(finding.id, `LS-07 criterion review polish[${index}].id`);
    requireNonEmptyString(finding.summary, `LS-07 criterion review polish[${index}].summary`);
    requireNonEmptyString(finding.reopenTrigger, `LS-07 criterion review polish[${index}].reopenTrigger`);
  }
}

async function validateLS07CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-07 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-07 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-07 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-07 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-07 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function loadLS07RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-07 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-07 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-07 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-07 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-07 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-07 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-07 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-07 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
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
  if (claimId === 'LS-07') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS07RunArtifacts(machine);
    validateLS07EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-07-paired-spinal-nodes.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS07CurrentSources(machine);
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
