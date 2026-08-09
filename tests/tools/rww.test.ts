import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseCliArgs, normalizeCommand, reproductionCommand, reproductionCommands } from '../../tools/rww/args.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { buildDoctorReport, parseTarget } from '../../tools/rww/doctor.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { sha256, sha256Json } from '../../tools/rww/hash.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { buildReceipt, classifyExit, deterministicReceiptDigest, resolveRunDirectory, sanitizeSecrets } from '../../tools/rww/receipt.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { buildPlaytestNotes, waitForPlaySession } from '../../tools/rww/play.mjs';
import { EventEmitter } from 'node:events';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { collectGit, hasUsableGitProvenance, runChild } from '../../tools/rww/process.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseHeadlessDeterminismReport, parseHeadlessPerformanceReport, referenceRunnerFailures, selectBrowserBudget, writeSanitizedErrorArtifact } from '../../tools/rww/commands.mjs';

describe('RWW CLI argument parsing', () => {
  it('parses and normalizes doctor options in a stable order', () => {
    const parsed = parseCliArgs([
      'doctor', '--json', '--target', 'validation\\hardware\\t480s-low.json', '--browser',
    ]);

    expect(parsed).toEqual({
      command: 'doctor',
      browser: true,
      json: true,
      target: 'validation/hardware/t480s-low.json',
    });
    expect(normalizeCommand(parsed)).toEqual([
      'doctor', '--browser', '--target', 'validation/hardware/t480s-low.json', '--json',
    ]);
  });

  it('parses run and performance defaults without aliases', () => {
    expect(parseCliArgs(['run', 'validation/manifests/veteran-mirror.json'])).toEqual({
      command: 'run',
      manifest: 'validation/manifests/veteran-mirror.json',
      repeat: 1,
    });
    expect(parseCliArgs(['perf', 'headless-40m'])).toEqual({
      command: 'perf',
      profile: 'headless-40m',
      terrain: 'flat',
      runs: 1,
      warmupRuns: 0,
      maxMedianMs: null,
      requireClean: false,
      qualify: false,
      ticks: 72_000,
    });
    expect(parseCliArgs(['visual', 'signature-lance', '--compare'])).toEqual({
      command: 'visual', scenario: 'signature-lance', compare: true,
    });
    expect(parseCliArgs(['perf', 'browser-heavy', '--seconds', '5', '--json'])).toEqual({
      command: 'perf', profile: 'browser-heavy', scenario: 'heavy-combat',
      target: 'validation/hardware/t480s-low.json', quality: 'low', variant: 'default', seconds: 5, json: true,
    });
  });

  it('parses benchmark-only renderer variants', () => {
    expect(parseCliArgs(['perf', 'browser-heavy', '--variant', 'no-shadows'])).toMatchObject({
      variant: 'no-shadows',
    });
    const parsed = parseCliArgs(['perf', 'browser-heavy', '--variant', 'low-terrain']);
    expect(parsed).toMatchObject({ variant: 'low-terrain' });
    expect(normalizeCommand(parsed)).toContain('low-terrain');
    expect(parseCliArgs(['perf', 'browser-heavy', '--variant', 'no-terrain-shadows'])).toMatchObject({
      variant: 'no-terrain-shadows',
    });
    expect(parseCliArgs(['perf', 'browser-heavy', '--variant', 'no-transparent-effects'])).toMatchObject({
      variant: 'no-transparent-effects',
    });
    expect(parseCliArgs(['perf', 'browser-heavy', '--variant', 'no-markers'])).toMatchObject({
      variant: 'no-markers',
    });
    expect(() => parseCliArgs(['perf', 'browser-heavy', '--variant', 'blank-scene'])).toThrow(/variant/i);
  });

  it('parses and normalizes browser performance quality', () => {
    const parsed = parseCliArgs(['perf', 'browser-heavy', '--quality', 'ultra', '--seconds', '10']);
    expect(parsed).toMatchObject({ quality: 'ultra', seconds: 10 });
    expect(normalizeCommand(parsed)).toContain('ultra');
    expect(parseCliArgs(['perf', 'browser-heavy', '--quality', 'high'])).toMatchObject({ quality: 'high' });
    expect(parseCliArgs(['perf', 'browser-heavy', '--quality', 'medium'])).toMatchObject({ quality: 'medium' });
    expect(() => parseCliArgs(['perf', 'browser-heavy', '--quality', 'cinematic'])).toThrow(/quality/i);
    expect(() => parseCliArgs(['perf', 'browser-heavy', '--seconds', '601'])).toThrow(/seconds/i);
  });

  it('selects a budget matching the requested quality', () => {
    const target = {
      id: 'quality-target',
      frameBudgets: [
        { id: 'low-hard', quality: 'low', classification: 'candidate-hard', resolution: [1280, 720] },
        { id: 'medium-advisory', quality: 'medium', classification: 'advisory', resolution: [1280, 720] },
        { id: 'high-advisory', quality: 'high', classification: 'advisory', resolution: [1280, 720] },
        { id: 'ultra-advisory', quality: 'ultra', classification: 'advisory', resolution: [1280, 720] },
      ],
    };
    expect(selectBrowserBudget(target, 'low').id).toBe('low-hard');
    expect(selectBrowserBudget(target, 'medium').id).toBe('medium-advisory');
    expect(selectBrowserBudget(target, 'high').id).toBe('high-advisory');
    expect(selectBrowserBudget(target, 'ultra').id).toBe('ultra-advisory');
    expect(() => selectBrowserBudget(target, 'cinematic')).toThrow(/cinematic/i);
  });

  it('parses and normalizes the headless qualification policy', () => {
    const parsed = parseCliArgs(['perf', 'headless-40m', '--qualify']);
    expect(parsed).toEqual({
      command: 'perf',
      profile: 'headless-40m',
      terrain: 'standard',
      runs: 5,
      warmupRuns: 1,
      maxMedianMs: 15_000,
      requireClean: true,
      qualify: true,
      ticks: 72_000,
    });
    expect(normalizeCommand(parsed)).toEqual(['perf', 'headless-40m', '--qualify']);
  });

  it('extracts a structured headless report from Vitest output', () => {
    const report = {
      schema: 'rww.headless-performance-report',
      version: 1,
      mode: 'wall',
      simulationMilliseconds: [14_000],
      medianSimulationMilliseconds: 14_000,
      medianBudgetPassed: true,
      qualificationResultPassed: null,
      measuredResultsMatch: true,
      resultHashes: ['a'.repeat(64)],
    };
    expect(parseHeadlessPerformanceReport(`prefix\u001b[32m${JSON.stringify(report)}\nsummary`)).toEqual(report);
    expect(parseHeadlessPerformanceReport('no report')).toBeNull();
    expect(parseHeadlessPerformanceReport(`${JSON.stringify({ mode: 'wall' })}\n`)).toBeNull();
  });

  it('extracts a versioned determinism report', () => {
    const report = {
      schema: 'rww.headless-determinism-report',
      version: 1,
      periodicHashes: [{ tick: 9_000, world: 'a'.repeat(64), controllers: ['b'.repeat(64)] }],
      eventTranscriptHash: 'c'.repeat(64),
      timelineHash: 'd'.repeat(64),
      qualificationTimelinePassed: true,
    };
    expect(parseHeadlessDeterminismReport(`${JSON.stringify(report)}\n`)).toEqual(report);
    expect(parseHeadlessDeterminismReport(`${JSON.stringify({ schema: report.schema })}\n`)).toBeNull();
  });

  it('validates the pinned headless runner identity', () => {
    const runtime = {
      node: 'v26.4.0',
      platform: 'win32',
      arch: 'x64',
      release: '10.0.26220',
      cpu: { model: 'Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz', logicalCpus: 8 },
      totalRamBytes: 25_600_958_464,
    };
    const attestation = {
      RWW_PINNED_RUNNER_ID: 't480s-headless-01',
      RWW_RUNNER_DEDICATED: '1',
      RWW_RUNNER_AC_POWER: '1',
      RWW_RUNNER_POWER_POLICY: 'fixed-performance',
      RWW_RUNNER_IMMUTABLE_WORKSPACE: '1',
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'self-hosted',
      RUNNER_NAME: 't480s-headless-01',
      GITHUB_REPOSITORY: 'Nether403/RingWorldWar',
      GITHUB_REF: 'refs/heads/master',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_RUN_ID: '12345',
      GITHUB_WORKFLOW_REF: 'Nether403/RingWorldWar/.github/workflows/headless-qualification.yml@refs/heads/master',
    };
    expect(referenceRunnerFailures(runtime, attestation)).toEqual([]);
    expect(referenceRunnerFailures({ ...runtime, node: 'v25.0.0' }, attestation)).toContain('Node v25.0.0 is not v26.x');
    expect(referenceRunnerFailures(runtime, {})).toContain(
      'RWW_PINNED_RUNNER_ID is not the registered t480s-headless-01 runner',
    );
  });

  it('parses and normalizes human playtest options', () => {
    expect(parseCliArgs(['play', 'directional-artillery'])).toEqual({
      command: 'play', scenario: 'directional-artillery', seconds: null, headless: false,
    });
    const parsed = parseCliArgs(['play', 'directional-artillery', '--headless', '--seconds', '2']);
    expect(parsed).toEqual({
      command: 'play', scenario: 'directional-artillery', seconds: 2, headless: true,
    });
    expect(normalizeCommand(parsed)).toEqual([
      'play', 'directional-artillery', '--seconds', '2', '--headless',
    ]);
  });

  it('rejects unknown commands and invalid numeric options', () => {
    expect(() => parseCliArgs(['test'])).toThrow(/unknown command/i);
    expect(() => parseCliArgs(['run', 'x.json', '--repeat', '0'])).toThrow(/repeat/i);
    expect(() => parseCliArgs(['perf', 'headless-40m', '--terrain', 'ocean'])).toThrow(/terrain/i);
    expect(() => parseCliArgs(['perf', 'headless-40m', '--runs', '26'])).toThrow(/runs/i);
    expect(() => parseCliArgs(['perf', 'headless-40m', '--warmup-runs', '6'])).toThrow(/warmup/i);
    expect(() => parseCliArgs(['perf', 'headless-40m', '--ticks', '1000001'])).toThrow(/ticks/i);
    expect(() => parseCliArgs(['play'])).toThrow(/scenario/i);
    expect(() => parseCliArgs(['play', 'directional-artillery', '--seconds', '0'])).toThrow(/seconds/i);
    expect(() => parseCliArgs(['play', 'directional-artillery', '--json'])).toThrow(/play option/i);
  });

  it('renders inert PowerShell and POSIX reproduction commands plus structured argv', () => {
    const path = 'validation/$(touch injected) ` "quoted" \'single\' &.json';
    const commands = reproductionCommands(['run', path, '--repeat', '1']);
    expect(commands.argv).toEqual(['npm', 'run', 'rww', '--', 'run', path, '--repeat', '1']);
    expect(commands.powershell).toContain(`'validation/$(touch injected) ` + '` "quoted" \'\'single\'\' &.json\'');
    expect(commands.posix).toContain(`'validation/$(touch injected) ` + '` "quoted" \'"\'"\'single\'"\'"\' &.json\'');
    expect(reproductionCommand(['run', path], 'win32')).toBe(reproductionCommands(['run', path]).powershell);
    expect(reproductionCommand(['run', path], 'linux')).toBe(reproductionCommands(['run', path]).posix);
  });
});

describe('playtest session lifecycle', () => {
  it('builds a local observation template with all five approved questions', () => {
    const notes = buildPlaytestNotes({
      scenarioId: 'directional-artillery',
      reproductionCommand: 'npm run rww -- play directional-artillery',
    });
    expect(notes.match(/^\d\. /gm)).toHaveLength(5);
    expect(notes).toContain('Tester ID:');
    expect(notes).toContain('Confusion points:');
    expect(notes).toContain('Chosen route/direction:');
    expect(notes).toContain('Unprompted explanation');
    expect(notes).toContain('does not collect or transmit');
  });

  it('builds First Contact notes around tutorial comprehension and completion', () => {
    const notes = buildPlaytestNotes({
      scenarioId: 'first-contact',
      reproductionCommand: 'npm run rww -- play first-contact',
    });
    expect(notes).toContain('First Contact Questions');
    expect(notes).toContain('objective sequence');
    expect(notes).toContain('Spinal Node');
    expect(notes).toContain('antispinward');
    expect(notes).not.toContain('Directional-Artillery Questions');
  });

  it('builds Break the Line notes around pacing evidence', () => {
    const notes = buildPlaytestNotes({
      scenarioId: 'break-the-line',
      reproductionCommand: 'npm run rww -- play break-the-line',
    });
    expect(notes).toContain('Break the Line Questions');
    expect(notes).toContain('Time to first contact');
    expect(notes).toContain('travel without a meaningful decision');
    expect(notes).toContain('movement speed');
  });

  it('ends timed sessions and removes lifecycle listeners', async () => {
    const page = new EventEmitter();
    const browser = new EventEmitter();
    const signals = new EventEmitter();

    await expect(waitForPlaySession({ page, browser, seconds: 0.001, signals })).resolves.toBe('timeout');
    expect(page.listenerCount('close')).toBe(0);
    expect(browser.listenerCount('disconnected')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it.each([
    ['page', 'close', 'page-closed'],
    ['browser', 'disconnected', 'browser-closed'],
    ['signals', 'SIGINT', 'interrupted'],
  ] as const)('ends when %s emits %s', async (source, event, reason) => {
    const page = new EventEmitter();
    const browser = new EventEmitter();
    const signals = new EventEmitter();
    const waiting = waitForPlaySession({ page, browser, seconds: null, signals });
    ({ page, browser, signals })[source].emit(event);
    await expect(waiting).resolves.toBe(reason);
  });
});

describe('RWW hashing and receipts', () => {
  it('computes standard SHA-256 hashes', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Json({ b: 2, a: 1 })).toBe(sha256Json({ a: 1, b: 2 }));
  });

  it('keeps the deterministic receipt digest independent of environmental payloads', () => {
    const deterministic = { command: 'doctor', args: [], result: { checks: ['cpu'] } };
    const first = buildReceipt({
      runId: 'first', command: { name: 'doctor' }, deterministic,
      environmental: { cpu: 'A' }, outcome: {}, reproduction: {},
    });
    const second = buildReceipt({
      runId: 'second', command: { name: 'doctor' }, deterministic,
      environmental: { cpu: 'B' }, outcome: {}, reproduction: {},
    });

    expect(deterministicReceiptDigest(deterministic)).toBe(
      deterministicReceiptDigest(JSON.parse(JSON.stringify(deterministic))),
    );
    expect(first.deterministic.digest).toBe(second.deterministic.digest);
    expect(first).toMatchObject({
      schema: 'rww.run-receipt', version: 1, runId: 'first',
      outcome: {}, reproduction: {},
    });
  });

  it('allows safe run IDs and rejects path traversal', () => {
    expect(resolveRunDirectory('C:/repo/output/runs', '20260802T120000Z-1234-abcd'))
      .toMatch(/output[\\/]runs[\\/]20260802T120000Z-1234-abcd$/);
    expect(() => resolveRunDirectory('C:/repo/output/runs', '../escape')).toThrow(/run id/i);
    expect(() => resolveRunDirectory('C:/repo/output/runs', 'nested/escape')).toThrow(/run id/i);
  });

  it('classifies stable exit codes by failure boundary', () => {
    expect(classifyExit('success')).toEqual({ exitCode: 0, failureCategory: null });
    expect(classifyExit('usage')).toEqual({ exitCode: 2, failureCategory: 'usage/config' });
    expect(classifyExit('gate')).toEqual({ exitCode: 3, failureCategory: 'deterministic/gate' });
    expect(classifyExit('runtime')).toEqual({ exitCode: 4, failureCategory: 'infrastructure/runtime' });
  });

  it('redacts secret fields and secret-like strings without reading the environment', () => {
    expect(sanitizeSecrets({ apiKey: 'abc', message: 'token=xyz Bearer visible' })).toEqual({
      apiKey: '[REDACTED]',
      message: 'token=[REDACTED] Bearer [REDACTED]',
    });
  });

  it('recursively sanitizes adversarial receipt, error, and browser log forms without hiding metadata', () => {
    const sanitized = sanitizeSecrets({
      receipt: {
        env: 'AWS_SECRET_ACCESS_KEY=hunter2 API_KEY=abc GPU_PATH=C:/gpu/0',
        database: 'postgresql://admin:p@ss@db.internal/rww',
        url: 'https://example.test/run?seed=7&access_token=visible&quality=low',
      },
      errors: ['Authorization: Basic dXNlcjpwYXNz', 'failure Bearer abc.def-123'],
      browser: { logs: ['Cookie: session=secret; Path=/', 'Set-Cookie: auth=secret; HttpOnly'] },
      renderer: 'ANGLE (Intel UHD Graphics 620) path=C:/drivers/igfx',
    });
    expect(sanitized).toEqual({
      receipt: {
        env: 'AWS_SECRET_ACCESS_KEY=[REDACTED] API_KEY=[REDACTED] GPU_PATH=C:/gpu/0',
        database: 'postgresql://[REDACTED]@db.internal/rww',
        url: 'https://example.test/run?seed=7&access_token=[REDACTED]&quality=low',
      },
      errors: ['Authorization: [REDACTED]', 'failure Bearer [REDACTED]'],
      browser: { logs: ['Cookie: [REDACTED]', 'Set-Cookie: [REDACTED]'] },
      renderer: 'ANGLE (Intel UHD Graphics 620) path=C:/drivers/igfx',
    });
    const receipt = buildReceipt({
      runId: 'redaction', command: {}, deterministic: {}, outcome: {}, reproduction: {},
      environmental: { nested: { consoleErrors: ['mongodb://user:pass@host/db'] } },
    });
    expect(receipt.environmental.nested.consoleErrors).toEqual(['mongodb://[REDACTED]@host/db']);
  });

  it('redacts nested secret subtrees as a whole while preserving ordinary collections', () => {
    expect(sanitizeSecrets({
      tokens: ['first', { nested: 'second' }],
      authorization: { credentials: { user: 'pilot', password: 'visible' } },
      cookie: { session: 'visible', flags: ['HttpOnly'] },
      integrations: { apiKeys: [{ value: 'visible' }] },
      ordinary: { arrays: [1, { name: 'safe' }], enabled: true },
    })).toEqual({
      tokens: '[REDACTED]',
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      integrations: { apiKeys: '[REDACTED]' },
      ordinary: { arrays: [1, { name: 'safe' }], enabled: true },
    });
  });

  it('redacts complete quoted assignments and multiline PEM values', () => {
    const sanitized = sanitizeSecrets([
      'PASSWORD="two word secret"',
      "API_KEY='another spaced secret'",
      'PRIVATE_KEY=-----BEGIN PRIVATE KEY-----',
      'line-one',
      'line two',
      '-----END PRIVATE KEY-----',
      'safe=value',
    ].join('\n'));

    expect(sanitized).not.toContain('two word secret');
    expect(sanitized).not.toContain('another spaced secret');
    expect(sanitized).not.toContain('line-one');
    expect(sanitized).not.toContain('line two');
    expect(sanitized).not.toContain('BEGIN PRIVATE KEY');
    expect(sanitized).toContain('PASSWORD=[REDACTED]');
    expect(sanitized).toContain('API_KEY=[REDACTED]');
    expect(sanitized).toContain('PRIVATE_KEY=[REDACTED]');
    expect(sanitized).toContain('safe=value');
  });

  it('content-addresses tracked and untracked dirty sources without evidence self-reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rww-git-provenance-'));
    const runGit = promisify(execFile);
    try {
      await runGit('git', ['init'], { cwd: directory });
      await writeFile(join(directory, 'tracked.bin'), Buffer.from([0, 1, 2, 3]));
      await mkdir(join(directory, 'validation', 'evidence'), { recursive: true });
      await writeFile(join(directory, 'validation', 'evidence', 'receipt.json'), '{"status":"baseline"}\n');
      await runGit('git', ['add', 'tracked.bin', 'validation/evidence/receipt.json'], { cwd: directory });
      await runGit('git', ['-c', 'user.name=RWW Test', '-c', 'user.email=rww@example.test', 'commit', '-m', 'base'], {
        cwd: directory,
      });
      await writeFile(join(directory, 'tracked.bin'), Buffer.from([0, 1, 9, 3]));
      await writeFile(join(directory, 'source.ts'), 'export const source = 1;\n');
      await writeFile(join(directory, 'validation', 'evidence', 'receipt.json'), '{"self":"reference"}\n');

      const first = await collectGit(directory);
      expect(hasUsableGitProvenance(first)).toBe(true);
      expect(first).toMatchObject({
        dirty: true,
        untrackedSourceCount: 1,
        trackedPatchExclusions: ['validation/evidence/**'],
        untrackedSourceExclusions: ['validation/evidence/**'],
      });
      expect(first.sourceBaseSha).toMatch(/^[0-9a-f]{40}$/);
      expect(first.trackedPatchSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.untrackedSourceManifestSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.untrackedSourceManifest).toEqual([{
        path: 'source.ts',
        sha256: sha256('export const source = 1;\n'),
      }]);

      const second = await collectGit(directory);
      expect(second.trackedPatchSha256).toBe(first.trackedPatchSha256);
      expect(second.untrackedSourceManifestSha256).toBe(first.untrackedSourceManifestSha256);

      await writeFile(join(directory, 'validation', 'evidence', 'receipt.json'), '{"self":"changed again"}\n');
      const evidenceChanged = await collectGit(directory);
      expect(evidenceChanged.trackedPatchSha256).toBe(first.trackedPatchSha256);
      expect(evidenceChanged.untrackedSourceManifestSha256).toBe(first.untrackedSourceManifestSha256);

      const evidenceIncluded = await collectGit(directory, { includeEvidence: true });
      expect(hasUsableGitProvenance(evidenceIncluded)).toBe(true);
      expect(evidenceIncluded.trackedPatchExclusions).toEqual([]);
      expect(evidenceIncluded.untrackedSourceExclusions).toEqual([]);
      expect(evidenceIncluded.trackedPatchSha256).not.toBe(first.trackedPatchSha256);

      expect(hasUsableGitProvenance({
        sourceBaseSha: null,
        trackedPatchSha256: null,
        untrackedSourceManifestSha256: null,
        dirty: null,
        untrackedSourceManifest: [],
        hiddenTrackedEntries: [],
        topLevel: null,
        gitVersion: null,
        error: 'git unavailable',
      })).toBe(false);

      const originalGitDirectory = process.env.GIT_DIR;
      process.env.GIT_DIR = join(directory, 'adversarial-git-dir');
      try {
        const hostileEnvironment = await collectGit(directory);
        expect(hostileEnvironment.sourceBaseSha).toBe(first.sourceBaseSha);
        expect(hostileEnvironment.trackedPatchSha256).toBe(first.trackedPatchSha256);
      } finally {
        if (originalGitDirectory === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = originalGitDirectory;
      }

      await runGit('git', ['update-index', '--assume-unchanged', 'tracked.bin'], { cwd: directory });
      const hidden = await collectGit(directory);
      expect(hidden.hiddenTrackedEntries).toEqual(['tracked.bin']);
      expect(hidden.dirty).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('RWW child process redaction', () => {
  it('redacts secrets split across chunks before echoing or returning output', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let echoedStdout = '';
    let echoedStderr = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      echoedStdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      echoedStderr += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    const stdoutChunks = [
      '\u001b[32mPASS\u001b[0m AWS_SECRET_ACCESS_KEY=aws-spl',
      'it-secret\nCookie: session=cookie-secret\nAuthorization: Basic auth-secret\n',
      'DATABASE_URL=postgresql://admin:database-secret@db.internal/rww\n',
      'https://example.test/run?seed=7&access_token=query-secret&quality=low\n',
    ];
    const stderrChunks = ['failure Bearer bearer-', 'secret\n'];

    try {
      const result = await runChild('fake-child', [], {
        spawn: () => {
          queueMicrotask(() => {
            for (const chunk of stdoutChunks) child.stdout.emit('data', Buffer.from(chunk));
            for (const chunk of stderrChunks) child.stderr.emit('data', Buffer.from(chunk));
            child.emit('close', 1, null);
          });
          return child;
        },
      });

      for (const output of [result.stdout, result.stderr, echoedStdout, echoedStderr]) {
        expect(output).not.toMatch(/aws-split-secret|cookie-secret|auth-secret|database-secret|query-secret|bearer-secret/);
      }
      expect(result.stdout).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED]');
      expect(result.stdout).toContain('Cookie: [REDACTED]');
      expect(result.stdout).toContain('Authorization: [REDACTED]');
      expect(result.stdout).toContain('postgresql://[REDACTED]@db.internal/rww');
      expect(result.stdout).toContain('access_token=[REDACTED]');
      expect(result.stderr).toContain('Bearer [REDACTED]');
      expect(result.stdout).toContain('\u001b[32mPASS\u001b[0m');
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  });

  it('sanitizes caught exception stacks before writing artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rww-redaction-'));
    const path = join(directory, 'failure.log');
    const error = new Error('Authorization: Bearer exception-secret');
    error.stack = `Error: DATABASE_URL=mongodb://user:artifact-secret@host/db\nCookie: session=stack-secret`;
    try {
      await writeSanitizedErrorArtifact(path, error);
      const artifact = await readFile(path, 'utf8');
      expect(artifact).not.toMatch(/exception-secret|artifact-secret|stack-secret/);
      expect(artifact).toContain('mongodb://[REDACTED]@host/db');
      expect(artifact).toContain('Cookie: [REDACTED]');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('RWW doctor targets', () => {
  const targetInput = {
    schema: 'rww.hardware-target',
    version: 1,
    id: 'fake-low',
    system: { minimumLogicalCpus: 4, minimumRamGiB: 8 },
    browser: {
      requireWebgl2: true,
      minimumDrawingBuffer: { width: 1280, height: 720 },
      minimumLimits: { maxTextureSize: 4096 },
    },
    privateGpu: { minimumDedicatedMemoryGiB: 1 },
    frameBudgets: [{
      id: '720p-low', resolution: [1280, 720], quality: 'low',
      targetFps: 30, classification: 'advisory',
    }],
  };

  it('parses a versioned target and rejects unsupported versions', () => {
    expect(parseTarget(targetInput).id).toBe('fake-low');
    expect(() => parseTarget({ ...targetInput, version: 2 })).toThrow(/version/i);
    expect(() => parseTarget({
      ...targetInput,
      frameBudgets: [{ id: 'broken', resolution: [1280, 720], quality: 'low', classification: 'candidate-hard' }],
    })).toThrow(/targetFps/i);
  });

  it('builds a stable JSON report from injected process and browser data', () => {
    const report = buildDoctorReport({
      system: {
        platform: 'win32', arch: 'x64', release: 'test',
        node: 'v24.0.0', logicalCpus: 8, cpuModel: 'Fake CPU', totalRamBytes: 16 * 2 ** 30,
      },
      browser: {
        status: 'available', name: 'chromium', version: '1',
        viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
        drawingBuffer: { width: 1280, height: 720 }, webgl2: true,
        vendor: 'Fake', renderer: 'Fake GPU', softwareRenderer: false,
        limits: { maxTextureSize: 8192 }, extensions: [],
        quality: { level: 'low', adaptive: false }, consoleErrors: [], pageErrors: [],
      },
      target: parseTarget(targetInput),
    });

    expect(report).toMatchObject({
      schema: 'rww.doctor-report',
      version: 1,
      status: 'warn',
      system: { logicalCpus: 8 },
      browser: { webgl2: true, quality: { level: 'low', adaptive: false } },
      target: { id: 'fake-low' },
    });
    expect(report.checks.some((check: { id: string; status: string }) =>
      check.id === 'frame-budget:720p-low' && check.status === 'not-measured')).toBe(true);
    expect(report.checks.some((check: { id: string; status: string }) =>
      check.id === 'private-gpu-memory' && check.status === 'warn')).toBe(true);
  });
});
