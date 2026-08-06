import { mkdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { sha256File } from './rww/hash.mjs';
import { collectGit, collectRuntime, runChild } from './rww/process.mjs';
import {
  buildReceipt,
  classifyExit,
  createRunId,
  resolveRunDirectory,
  writeReceipt,
} from './rww/receipt.mjs';

const EXPECTED_TESTS = 79;
const cwd = process.cwd();
const runsRoot = resolve(cwd, 'output', 'runs');
const runId = createRunId();
const runDirectory = resolveRunDirectory(runsRoot, runId);
const reportPath = resolve(runDirectory, 'playwright-report.json');
const source = await collectGit(cwd);

await mkdir(runDirectory, { recursive: true });
const startedAt = new Date();
const result = await runChild(
  process.execPath,
  [resolve(cwd, 'node_modules', 'playwright', 'cli.js'), 'test'],
  {
    cwd,
    env: {
      ...process.env,
      RWW_PLAYWRIGHT_JSON_OUTPUT: reportPath,
      RWW_PLAYWRIGHT_METADATA: JSON.stringify({ source }),
    },
    timeoutMs: 30 * 60 * 1000,
    maximumOutputBytes: 64 * 1024 * 1024,
  },
);

let report = null;
let reportError = null;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  reportError = error instanceof Error ? error.message : String(error);
}

const stats = report?.stats ?? null;
const sourceInReport = report?.config?.metadata?.source ?? null;
const sourceMatched = sourceInReport !== null &&
  sourceInReport.sourceBaseSha === source.sourceBaseSha &&
  sourceInReport.trackedPatchSha256 === source.trackedPatchSha256 &&
  sourceInReport.untrackedSourceManifestSha256 === source.untrackedSourceManifestSha256;
const passed = result.code === 0 &&
  stats?.expected === EXPECTED_TESTS &&
  stats?.unexpected === 0 &&
  sourceMatched;
const classification = passed ? 'success' : result.code === 0 ? 'gate' : 'runtime';
const reportSha256 = report === null ? null : await sha256File(reportPath);
const receipt = buildReceipt({
  runId,
  command: {
    name: 'phase4e-browser-qualification',
    normalizedArgs: ['test:e2e:qualify'],
  },
  deterministic: {
    expectedTests: EXPECTED_TESTS,
    source,
  },
  environmental: {
    git: source,
    runtime: collectRuntime(),
    playwright: {
      startedAt: startedAt.toISOString(),
      durationMilliseconds: Date.now() - startedAt.getTime(),
      report: relative(cwd, reportPath).replaceAll('\\', '/'),
      reportSha256,
      reportError,
      stats,
      sourceMatched,
      processExitCode: result.code,
      timedOut: result.timedOut,
      outputLimitExceeded: result.outputLimitExceeded,
    },
  },
  outcome: {
    status: passed ? 'success' : 'failure',
    ...classifyExit(classification),
  },
  reproduction: {
    argv: ['npm', 'run', 'test:e2e:qualify'],
    powershell: 'npm run test:e2e:qualify',
    posix: 'npm run test:e2e:qualify',
  },
});
const written = await writeReceipt({ runsRoot, receipt });

console.log(`Phase 4E qualification ${passed ? 'passed' : 'failed'}: ${written.path}`);
if (!passed) process.exitCode = receipt.outcome.exitCode;
