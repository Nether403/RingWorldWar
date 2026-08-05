import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { probeSystem, parseTarget, buildDoctorReport } from './doctor.mjs';
import { probeBrowser } from './browser.mjs';
import { benchmarkBrowserScenario, captureVisualScenario, openBrowserScenario, readJsonFile } from './browser-scenario.mjs';
import { evaluateBrowserBudget, summarizeFrameMetrics } from './browser-metrics.mjs';
import { parseScenario, resolveScenarioPath } from './scenario.mjs';
import { compareVisualSignatures, computeVisualSignature } from './visual-signature.mjs';
import { sha256File, sha256Json } from './hash.mjs';
import { buildReceipt, classifyExit, createRunId, resolveRunDirectory, sanitizeSecrets, writeReceipt } from './receipt.mjs';
import { collectGit, collectRuntime, runChild } from './process.mjs';
import { normalizeCommand, reproductionCommand, reproductionCommands, UsageError } from './args.mjs';
import { buildPlaytestNotes, waitForPlaySession } from './play.mjs';

export async function executeCommand(parsed, cwd) {
  if (parsed.command === 'doctor') return executeDoctor(parsed, cwd);
  if (parsed.command === 'run') return executeRun(parsed, cwd);
  if (parsed.command === 'visual') return executeVisual(parsed, cwd);
  if (parsed.command === 'play') return executePlay(parsed, cwd);
  if (parsed.command === 'perf') return executePerf(parsed, cwd);
  throw new UsageError(`Unsupported command: ${parsed.command}`);
}

async function executePlay(parsed, cwd) {
  const started = Date.now();
  const runId = createRunId();
  const runDirectory = resolveRunDirectory(resolve(cwd, 'output/runs'), runId);
  await mkdir(runDirectory, { recursive: true });
  const scenarioPath = safeScenarioPath(cwd, parsed.scenario);
  const scenario = await loadScenario(scenarioPath);
  const scenarioHash = await sha256File(scenarioPath);
  const normalizedArgs = normalizeCommand(parsed);
  const reproduce = reproductionCommand(normalizedArgs);
  const notesPath = resolve(runDirectory, 'playtest-notes.md');
  await writeFile(notesPath, buildPlaytestNotes({ scenarioId: scenario.id, reproductionCommand: reproduce }), { flag: 'wx' });

  let session;
  let endReason = 'launch-failed';
  let postScenarioState = null;
  let sessionStarted = null;
  let observedDurationMilliseconds = 0;
  let runtimeError = null;
  try {
    session = await openBrowserScenario(cwd, scenario, { headless: parsed.headless, handleSignals: false });
    if (process.platform === 'win32' && session.browserDetails.softwareRenderer) {
      throw new Error(`Playtest requires hardware rendering; Chromium reported ${session.browserDetails.renderer}`);
    }
    await session.page.evaluate(async () => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      driver.resumeBrowserScenario();
    });
    sessionStarted = Date.now();
    let latestState = session.appliedScenarioState;
    let polling = false;
    const poll = setInterval(async () => {
      if (polling || session.page.isClosed()) return;
      polling = true;
      try {
        latestState = await captureBrowserState(session.page);
      } catch {
        // A user-closing page can race the final observation poll.
      } finally {
        polling = false;
      }
    }, 250);
    poll.unref();
    try {
      endReason = await waitForPlaySession({
        page: session.page,
        browser: session.browser,
        seconds: parsed.seconds,
      });
      observedDurationMilliseconds = Date.now() - sessionStarted;
    } finally {
      clearInterval(poll);
    }
    if (!session.page.isClosed()) {
      try {
        latestState = await captureBrowserState(session.page);
      } catch {
        // Keep the most recent successful local observation.
      }
    }
    postScenarioState = latestState;
  } catch (error) {
    runtimeError = sanitizeSecrets(error instanceof Error ? error.message : String(error));
  } finally {
    await session?.close();
  }

  const notesArtifact = await describeArtifact(runDirectory, notesPath, 'environmental');
  const browserErrors = session ? [...session.consoleErrors, ...session.pageErrors] : [];
  const classification = runtimeError || browserErrors.length > 0 ? classifyExit('runtime') : classifyExit('success');
  const finalized = await finalize({
    cwd, parsed, started, runId, classification,
    deterministic: {
      scenario: scenarioIdentity(cwd, scenarioPath, scenario, scenarioHash),
      setup: { disableAi: scenario.setup.disableAi },
      artifacts: [notesArtifact],
    },
    environmental: {
      mode: parsed.headless ? 'headless-smoke' : 'headed-human',
      requestedSeconds: parsed.seconds,
      observedDurationMilliseconds,
      endReason,
      vite: session ? { reused: session.server.reused, url: session.server.url } : null,
      browser: session?.browserDetails ?? null,
      preScenarioState: session?.preScenarioState ?? null,
      appliedScenarioState: session?.appliedScenarioState ?? null,
      postScenarioState,
      entityIds: session?.entityIds ?? null,
      consoleErrors: session?.consoleErrors ?? [],
      pageErrors: session?.pageErrors ?? [],
      error: runtimeError,
    },
  });
  const receiptPath = relative(cwd, finalized.receiptPath).replaceAll('\\', '/');
  const localNotesPath = relative(cwd, notesPath).replaceAll('\\', '/');
  process.stdout.write(`Playtest notes: ${localNotesPath}\nReceipt: ${receiptPath}\nReproduce: ${reproduce}\n`);
  if (runtimeError) process.stderr.write(`RWW play failed: ${runtimeError}\n`);
  return classification.exitCode;
}

async function captureBrowserState(page) {
  return page.evaluate(async () => {
    const driver = await import('/e2e/support/scenario-driver.ts');
    return driver.captureScenarioState();
  });
}

async function executeDoctor(parsed, cwd) {
  const started = Date.now();
  const system = probeSystem();
  const targetPath = parsed.target ? resolve(cwd, parsed.target) : null;
  const target = targetPath ? await loadTarget(targetPath) : null;
  const browser = parsed.browser ? await probeBrowser(cwd) : { status: 'not-requested' };
  const report = buildDoctorReport({ system, browser, target });
  const classification = report.status === 'fail' ? classifyExit('runtime') : classifyExit('success');
  const output = await finalize({
    cwd,
    parsed,
    started,
    classification,
    deterministic: {
      target: target === null ? null : {
        id: target.id,
        schema: target.schema,
        version: target.version,
        path: relative(cwd, targetPath).replaceAll('\\', '/'),
        sha256: await sha256File(targetPath),
      },
    },
    environmental: { doctor: report },
  });
  const result = sanitizeSecrets({
    ...report,
    receiptPath: relative(cwd, output.receiptPath).replaceAll('\\', '/'),
  });
  if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printDoctor(result);
  return classification.exitCode;
}

async function executeRun(parsed, cwd) {
  const started = Date.now();
  const manifestPath = resolve(cwd, parsed.manifest);
  const manifest = await loadManifest(manifestPath);
  const manifestHash = await sha256File(manifestPath);
  const runId = createRunId();
  const runDirectory = resolveRunDirectory(resolve(cwd, 'output/runs'), runId);
  const artifactsDirectory = resolve(runDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });

  const summaries = [];
  const artifacts = [];
  let failure = null;
  for (let index = 1; index <= parsed.repeat; index++) {
    const logPath = resolve(artifactsDirectory, `repeat-${index}.log`);
    try {
      const result = await runVitest(cwd, ['--config', 'vitest.core-match.config.ts'], {
        CORE_MATCH_MANIFEST: manifestPath,
        CORE_MATCH_WALL_CLOCK: '0',
      });
      await writeFile(logPath, `${result.stdout}${result.stderr}`);
      artifacts.push(await describeArtifact(runDirectory, logPath, 'environmental'));
      if (result.code !== 0) {
        const output = `${result.stdout}\n${result.stderr}`;
        failure = /CoreMatchManifestValidationError/.test(output)
          ? classifyExit('usage')
          : /Core-match gates failed|AssertionError/.test(output) ? classifyExit('gate') : classifyExit('runtime');
        break;
      }

      const generatedJson = resolve(cwd, 'output/core-match', `${manifest.id}.json`);
      const generatedMarkdown = resolve(cwd, 'output/core-match', `${manifest.id}.md`);
      const report = JSON.parse(await readFile(generatedJson, 'utf8'));
      const repeatDirectory = resolve(artifactsDirectory, `repeat-${index}`);
      await mkdir(repeatDirectory, { recursive: true });
      const jsonCopy = resolve(repeatDirectory, basename(generatedJson));
      const markdownCopy = resolve(repeatDirectory, basename(generatedMarkdown));
      await Promise.all([copyFile(generatedJson, jsonCopy), copyFile(generatedMarkdown, markdownCopy)]);
      artifacts.push(await describeArtifact(runDirectory, jsonCopy, 'deterministic'));
      artifacts.push(await describeArtifact(runDirectory, markdownCopy, 'deterministic'));
      summaries.push(stripEnvironmental({ summary: report.summary, gates: report.gates }));
    } catch (error) {
      await writeSanitizedErrorArtifact(logPath, error);
      artifacts.push(await describeArtifact(runDirectory, logPath, 'environmental'));
      failure = classifyExit('runtime');
      break;
    }
  }

  if (failure === null && summaries.some((summary) => sha256Json(summary) !== sha256Json(summaries[0]))) {
    failure = classifyExit('gate');
  }
  const classification = failure ?? classifyExit('success');
  const deterministicArtifacts = artifacts.filter((artifact) => artifact.classification === 'deterministic');
  const environmentalArtifacts = artifacts.filter((artifact) => artifact.classification === 'environmental');
  const finalized = await finalize({
    cwd,
    parsed,
    started,
    runId,
    classification,
    deterministic: {
      manifest: { path: relative(cwd, manifestPath).replaceAll('\\', '/'), sha256: manifestHash },
      summaries,
      repeatedSummariesMatch: summaries.length === parsed.repeat
        && summaries.every((summary) => sha256Json(summary) === sha256Json(summaries[0])),
      artifacts: deterministicArtifacts,
    },
    environmental: { artifacts: environmentalArtifacts },
  });
  process.stdout.write(`RWW run ${classification.exitCode === 0 ? 'passed' : 'failed'}: ${relative(cwd, finalized.receiptPath).replaceAll('\\', '/')}\n`);
  return classification.exitCode;
}

async function executePerf(parsed, cwd) {
  if (parsed.profile === 'browser-heavy') return executeBrowserPerf(parsed, cwd);
  const started = Date.now();
  const runId = createRunId();
  const runDirectory = resolveRunDirectory(resolve(cwd, 'output/runs'), runId);
  const artifactsDirectory = resolve(runDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });
  const logPath = resolve(artifactsDirectory, 'performance-profile.log');
  const reportPath = resolve(artifactsDirectory, 'headless-performance.json');
  const determinismLogPath = resolve(artifactsDirectory, 'headless-determinism.log');
  const determinismReportPath = resolve(artifactsDirectory, 'headless-determinism.json');
  let result;
  let infrastructureFailure = false;
  let gateFailure = false;
  let performanceReport = null;
  let determinismReport = null;
  let determinismExecuted = false;
  let sourceSnapshot = null;
  let finalSourceSnapshot = null;
  try {
    if (parsed.qualify) {
      const runnerFailures = referenceRunnerFailures(collectRuntime());
      if (runnerFailures.length > 0) {
        gateFailure = true;
        result = { code: 1 };
        await writeFile(logPath, `Headless qualification runner mismatch:\n${runnerFailures.join('\n')}\n`);
      }
    }
    if (parsed.requireClean) {
      sourceSnapshot = await collectGit(cwd);
      if (sourceSnapshot.dirty === null) {
        throw new Error(`Cannot verify clean source: ${sourceSnapshot.error ?? 'Git state unavailable'}`);
      }
      if (sourceSnapshot.dirty) {
        gateFailure = true;
        result = { code: 1 };
        await writeFile(logPath, 'Headless qualification requires a clean Git source tree.\n');
      }
    }
    if (!gateFailure) {
      if (parsed.qualify) {
        determinismExecuted = true;
        const determinismResult = await runVitest(
          cwd,
          ['tests/headless/performance-profile.test.ts', '--config', 'vitest.config.ts'],
          {
            RWW_PROFILE: 'phase',
            RWW_TERRAIN: parsed.terrain,
            RWW_PROFILE_TICKS: String(parsed.ticks),
            RWW_PROFILE_QUALIFY: '1',
          },
        );
        await writeFile(determinismLogPath, `${determinismResult.stdout}${determinismResult.stderr}`);
        determinismReport = parseHeadlessDeterminismReport(determinismResult.stdout);
        if (
          determinismResult.timedOut
          || determinismResult.outputLimitExceeded
          || determinismResult.signal !== null
          || determinismReport === null
        ) {
          infrastructureFailure = true;
        } else {
          await writeFile(
            determinismReportPath,
            `${JSON.stringify(sanitizeSecrets(determinismReport), null, 2)}\n`,
          );
          gateFailure = determinismResult.code !== 0
            || determinismReport.qualificationTimelinePassed !== true;
        }
      }
    }
    if (!gateFailure && !infrastructureFailure) {
      result = await runVitest(cwd, ['tests/headless/performance-profile.test.ts', '--config', 'vitest.config.ts'], {
        RWW_PROFILE: 'wall',
        RWW_TERRAIN: parsed.terrain,
        RWW_PROFILE_RUNS: String(parsed.runs),
        RWW_PROFILE_WARMUP_RUNS: String(parsed.warmupRuns),
        RWW_PROFILE_TICKS: String(parsed.ticks),
        RWW_PROFILE_QUALIFY: parsed.qualify ? '1' : '0',
        ...(parsed.maxMedianMs === null ? {} : { RWW_PROFILE_MAX_MEDIAN_MS: String(parsed.maxMedianMs) }),
      });
      await writeFile(logPath, `${result.stdout}${result.stderr}`);
      performanceReport = parseHeadlessPerformanceReport(result.stdout);
      if (performanceReport === null) {
        infrastructureFailure = true;
      } else {
        await writeFile(reportPath, `${JSON.stringify(sanitizeSecrets(performanceReport), null, 2)}\n`);
        const reportGateFailure = performanceReport.measuredResultsMatch !== true
          || performanceReport.medianBudgetPassed === false
          || performanceReport.qualificationResultPassed === false;
        if (
          result.timedOut
          || result.outputLimitExceeded
          || result.signal !== null
          || (result.code !== 0 && !reportGateFailure)
        ) {
          infrastructureFailure = true;
        } else {
          gateFailure = reportGateFailure;
        }
      }
    }
    if (parsed.requireClean && !infrastructureFailure && sourceSnapshot !== null) {
      finalSourceSnapshot = await collectGit(cwd);
      if (finalSourceSnapshot.dirty === null) {
        throw new Error(`Cannot verify final source: ${finalSourceSnapshot.error ?? 'Git state unavailable'}`);
      }
      if (sha256Json(finalSourceSnapshot) !== sha256Json(sourceSnapshot)) {
        gateFailure = true;
        const failurePath = result === undefined ? determinismLogPath : logPath;
        await writeFile(failurePath, 'Headless qualification source changed during execution.\n', { flag: 'a' });
      }
    }
  } catch (error) {
    infrastructureFailure = true;
    result = { code: 1 };
    await writeSanitizedErrorArtifact(logPath, error);
  }
  result ??= { code: 1, signal: null, timedOut: false, outputLimitExceeded: false };
  try {
    await stat(logPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(logPath, 'Measured headless performance phase was not executed.\n');
  }
  const artifacts = [await describeArtifact(runDirectory, logPath, 'environmental')];
  let structuredReportArtifact = null;
  let determinismReportArtifact = null;
  if (determinismExecuted) {
    artifacts.push(await describeArtifact(runDirectory, determinismLogPath, 'deterministic'));
    if (determinismReport !== null) {
      determinismReportArtifact = await describeArtifact(runDirectory, determinismReportPath, 'deterministic');
      artifacts.push(determinismReportArtifact);
    }
  }
  if (performanceReport !== null) {
    structuredReportArtifact = await describeArtifact(runDirectory, reportPath, 'environmental');
    artifacts.push(structuredReportArtifact);
  }
  const classification = infrastructureFailure
    ? classifyExit('runtime')
    : gateFailure || result.code !== 0 ? classifyExit('gate') : classifyExit('success');
  const finalized = await finalize({
    cwd,
    parsed,
    started,
    runId,
    classification,
    deterministic: {
      profile: parsed.profile,
      terrain: parsed.terrain,
      runs: parsed.runs,
      warmupRuns: parsed.warmupRuns,
      maxMedianMs: parsed.maxMedianMs,
      requireClean: parsed.requireClean,
      qualify: parsed.qualify,
      ticks: parsed.ticks,
      result: performanceReport === null ? null : {
        resultHashes: performanceReport.resultHashes,
        expectedQualificationResultHash: performanceReport.expectedQualificationResultHash,
        measuredResultsMatch: performanceReport.measuredResultsMatch,
        qualificationResultPassed: performanceReport.qualificationResultPassed,
        durationTicks: performanceReport.result?.durationTicks,
        winner: performanceReport.result?.winner,
        endReason: performanceReport.result?.endReason,
        structuredReportSha256: structuredReportArtifact?.sha256 ?? null,
      },
      timeline: determinismReport === null ? null : {
        timelineHash: determinismReport.timelineHash,
        expectedQualificationTimelineHash: determinismReport.expectedQualificationTimelineHash,
        qualificationTimelinePassed: determinismReport.qualificationTimelinePassed,
        eventTranscriptHash: determinismReport.eventTranscriptHash,
        periodicHashes: determinismReport.periodicHashes,
        structuredReportSha256: determinismReportArtifact?.sha256 ?? null,
      },
    },
    environmental: {
      timingClassification: 'environmental-only',
      report: performanceReport === null ? null : sanitizeSecrets(performanceReport),
      runnerAttestation: parsed.qualify ? {
        id: process.env.RWW_PINNED_RUNNER_ID ?? null,
        dedicated: process.env.RWW_RUNNER_DEDICATED === '1',
        acPower: process.env.RWW_RUNNER_AC_POWER === '1',
        powerPolicy: process.env.RWW_RUNNER_POWER_POLICY ?? null,
        immutableWorkspace: process.env.RWW_RUNNER_IMMUTABLE_WORKSPACE === '1',
        github: {
          repository: process.env.GITHUB_REPOSITORY ?? null,
          ref: process.env.GITHUB_REF ?? null,
          refProtected: process.env.GITHUB_REF_PROTECTED === 'true',
          eventName: process.env.GITHUB_EVENT_NAME ?? null,
          runId: process.env.GITHUB_RUN_ID ?? null,
          workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
          runUrl: process.env.GITHUB_RUN_ID === undefined
            ? null
            : `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        },
      } : null,
      sourceStability: parsed.requireClean ? {
        stable: sourceSnapshot !== null
          && finalSourceSnapshot !== null
          && sha256Json(sourceSnapshot) === sha256Json(finalSourceSnapshot),
        preflight: sourceSnapshot,
        final: finalSourceSnapshot,
      } : null,
      artifacts,
    },
    gitSnapshot: finalSourceSnapshot ?? sourceSnapshot,
  });
  process.stdout.write(`RWW perf ${classification.exitCode === 0 ? 'completed' : 'failed'}: ${relative(cwd, finalized.receiptPath).replaceAll('\\', '/')}\n`);
  return classification.exitCode;
}

async function executeVisual(parsed, cwd) {
  const started = Date.now();
  const runId = createRunId();
  const runDirectory = resolveRunDirectory(resolve(cwd, 'output/runs'), runId);
  const artifactsDirectory = resolve(runDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });
  const scenarioPath = safeScenarioPath(cwd, parsed.scenario);
  const scenario = await loadScenario(scenarioPath);
  const scenarioHash = await sha256File(scenarioPath);
  const screenshotPath = resolve(artifactsDirectory, `${scenario.id}.png`);
  const signaturePath = resolve(artifactsDirectory, `${scenario.id}.visual-signature.json`);
  const manifestPath = resolve(artifactsDirectory, `${scenario.id}.visual-manifest.json`);

  let captured;
  try {
    captured = await captureVisualScenario(cwd, scenario, screenshotPath);
  } catch (error) {
    const classification = classifyExit('runtime');
    const safeError = sanitizeSecrets(error instanceof Error ? error.message : String(error));
    const finalized = await finalize({
      cwd, parsed, started, runId, classification,
      deterministic: { scenario: scenarioIdentity(cwd, scenarioPath, scenario, scenarioHash) },
      environmental: { error: safeError },
    });
    process.stderr.write(`RWW visual failed: ${relative(cwd, finalized.receiptPath).replaceAll('\\', '/')}\n`);
    return classification.exitCode;
  }

  const signature = computeVisualSignature(
    Uint8Array.from(captured.frame.pixels), captured.frame.width, captured.frame.height,
    scenario.observationRegions,
  );
  await writeFile(signaturePath, `${JSON.stringify(signature, null, 2)}\n`);
  const screenshotHash = await sha256File(screenshotPath);
  const signatureHash = await sha256File(signaturePath);
  const comparison = scenario.expectedVisual === undefined
    ? { status: 'baseline-created', warning: 'Scenario has no embedded expected signature; no cross-GPU exact-pixel pass was inferred.' }
    : !parsed.compare
      ? { status: 'not-requested' }
      : compareVisualSignatures(signature, scenario.expectedVisual.signature, scenario.expectedVisual.tolerances);
  const invariantChecks = visualInvariantChecks(signature, captured.frame.state, scenario.invariants, 0);
  const browserErrors = [...captured.consoleErrors, ...captured.pageErrors];
  const classification = browserErrors.length > 0
    ? classifyExit('runtime')
    : invariantChecks.some((check) => check.status === 'fail') || comparison.status === 'fail'
      ? classifyExit('gate') : classifyExit('success');
  const manifest = {
    schema: 'rww.visual-manifest', version: 1,
    scenario: scenarioIdentity(cwd, scenarioPath, scenario, scenarioHash),
    screenshot: { path: basename(screenshotPath), sha256: screenshotHash },
    signature: { path: basename(signaturePath), sha256: signatureHash },
    renderer: captured.browser,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const artifacts = await Promise.all([
    describeArtifact(runDirectory, screenshotPath, 'environmental'),
    describeArtifact(runDirectory, signaturePath, 'environmental'),
    describeArtifact(runDirectory, manifestPath, 'environmental'),
  ]);
  const finalized = await finalize({
    cwd, parsed, started, runId, classification,
    deterministic: {
      scenario: manifest.scenario,
      manifestSha256: await sha256File(manifestPath),
      expectedComparison: comparison,
      invariants: invariantChecks,
    },
    environmental: {
      signature, rendererResources: captured.frame.resources, renderer: captured.browser,
      consoleErrors: captured.consoleErrors, pageErrors: captured.pageErrors, artifacts,
    },
  });
  const status = comparison.status === 'baseline-created' ? 'baseline-created (warning)' : classification.exitCode === 0 ? 'captured' : 'failed';
  process.stdout.write(`RWW visual ${status}: ${relative(cwd, screenshotPath).replaceAll('\\', '/')}\n`);
  process.stdout.write(`Signature: ${relative(cwd, signaturePath).replaceAll('\\', '/')}\nReceipt: ${relative(cwd, finalized.receiptPath).replaceAll('\\', '/')}\n`);
  return classification.exitCode;
}

async function executeBrowserPerf(parsed, cwd) {
  const started = Date.now();
  const runId = createRunId();
  const runDirectory = resolveRunDirectory(resolve(cwd, 'output/runs'), runId);
  const artifactsDirectory = resolve(runDirectory, 'artifacts');
  await mkdir(artifactsDirectory, { recursive: true });
  const scenarioPath = safeScenarioPath(cwd, parsed.scenario);
  const scenario = await loadScenario(scenarioPath);
  const targetPath = resolve(cwd, parsed.target);
  const target = await loadTarget(targetPath);
  const budget = selectBrowserBudget(target);
  const benchmarkScenario = {
    ...scenario,
    quality: 'low',
    viewport: { ...scenario.viewport, width: budget.resolution[0], height: budget.resolution[1] },
  };
  let measured;
  try {
    measured = await benchmarkBrowserScenario(
      cwd, benchmarkScenario, scenario.benchmark.warmupSeconds, parsed.seconds,
    );
  } catch (error) {
    const classification = classifyExit('runtime');
    const safeError = sanitizeSecrets(error instanceof Error ? error.message : String(error));
    const finalized = await finalize({
      cwd, parsed, started, runId, classification,
      deterministic: { scenario: scenarioIdentity(cwd, scenarioPath, scenario, await sha256File(scenarioPath)) },
      environmental: { error: safeError },
    });
    if (parsed.json) process.stdout.write(`${JSON.stringify({ status: 'error', error: safeError, receiptPath: relative(cwd, finalized.receiptPath).replaceAll('\\', '/') }, null, 2)}\n`);
    else process.stderr.write(`RWW perf browser-heavy failed: ${relative(cwd, finalized.receiptPath).replaceAll('\\', '/')}\n`);
    return classification.exitCode;
  }
  const metrics = summarizeFrameMetrics(
    measured.benchmark.intervals, parsed.seconds, measured.benchmark.render,
    measured.benchmark.simulation, measured.benchmark.fullFrame,
  );
  const verdict = evaluateBrowserBudget(metrics, budget);
  const frameSignature = computeVisualSignature(
    Uint8Array.from(measured.frame.pixels), measured.frame.width, measured.frame.height,
    scenario.observationRegions,
  );
  const invariantChecks = visualInvariantChecks(
    frameSignature, measured.frame.state, scenario.invariants, measured.benchmark.contextLosses,
  );
  const browserErrors = [...measured.consoleErrors, ...measured.pageErrors];
  const hardwareFailure = process.platform === 'win32' && measured.browser.softwareRenderer;
  const classification = browserErrors.length > 0 || hardwareFailure
    ? classifyExit('runtime')
    : verdict.status === 'fail' || invariantChecks.some((check) => check.status === 'fail')
      ? classifyExit('gate') : classifyExit('success');
  const report = {
    schema: 'rww.browser-performance', version: 1,
    status: classification.exitCode === 0 ? verdict.status : 'fail',
    scenario: scenarioIdentity(cwd, scenarioPath, scenario, await sha256File(scenarioPath)),
    target: { id: target.id, path: relative(cwd, targetPath).replaceAll('\\', '/'), sha256: await sha256File(targetPath), budget: budget.id },
    quality: 'low', viewport: benchmarkScenario.viewport,
    warmupSeconds: scenario.benchmark.warmupSeconds, sampleSeconds: parsed.seconds,
    metrics,
    resources: measured.benchmark.resources,
    gpuTimer: { supported: measured.benchmark.timerQuerySupported, milliseconds: measured.benchmark.gpuTimerMilliseconds },
    contextLosses: measured.benchmark.contextLosses,
    blackFrame: invariantChecks.some((check) => check.id === 'frame-luminance' && check.status === 'fail'),
    invariants: invariantChecks,
    verdict,
    renderer: measured.browser,
    consoleErrors: measured.consoleErrors,
    pageErrors: measured.pageErrors,
  };
  const safeReport = sanitizeSecrets(report);
  const reportPath = resolve(artifactsDirectory, 'browser-heavy.json');
  await writeFile(reportPath, `${JSON.stringify(safeReport, null, 2)}\n`);
  const artifact = await describeArtifact(runDirectory, reportPath, 'environmental');
  const finalized = await finalize({
    cwd, parsed, started, runId, classification,
    deterministic: {
      scenario: safeReport.scenario,
      target: safeReport.target,
      verdict,
      invariants: invariantChecks,
    },
    environmental: { report: safeReport, artifacts: [artifact] },
  });
  const output = sanitizeSecrets({
    ...safeReport,
    artifactSha256: artifact.sha256,
    receiptPath: relative(cwd, finalized.receiptPath).replaceAll('\\', '/'),
  });
  if (parsed.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else printBrowserPerf(output);
  return classification.exitCode;
}

async function finalize({
  cwd, parsed, started, classification, deterministic, environmental,
  runId = createRunId(), gitSnapshot = null,
}) {
  const normalizedArgs = normalizeCommand(parsed);
  const receipt = buildReceipt({
    runId,
    command: { name: parsed.command, normalizedArgs },
    deterministic,
    environmental: {
      ...environmental,
      git: gitSnapshot ?? await collectGit(cwd),
      runtime: collectRuntime(),
      startedAt: new Date(started).toISOString(),
      durationMilliseconds: Date.now() - started,
    },
    outcome: {
      status: classification.exitCode === 0 ? 'success' : 'failure',
      exitCode: classification.exitCode,
      failureCategory: classification.failureCategory,
    },
    reproduction: reproductionCommands(normalizedArgs),
  });
  const written = await writeReceipt({ runsRoot: resolve(cwd, 'output/runs'), receipt });
  return { receiptPath: written.path };
}

async function loadTarget(path) {
  try {
    return parseTarget(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new UsageError(`Target file not found: ${path}`);
    if (error instanceof SyntaxError) throw new UsageError(`Target is not valid JSON: ${path}`);
    throw error instanceof UsageError ? error : new UsageError(error instanceof Error ? error.message : String(error));
  }
}

async function loadManifest(path) {
  try {
    const details = await stat(path);
    if (!details.isFile()) throw new UsageError(`Manifest is not a file: ${path}`);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest === null || typeof manifest !== 'object' || typeof manifest.id !== 'string') {
      throw new UsageError('Manifest must be a JSON object with an id');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.id)) {
      throw new UsageError('Manifest id is unsafe for artifact paths');
    }
    return manifest;
  } catch (error) {
    if (error?.code === 'ENOENT') throw new UsageError(`Manifest file not found: ${path}`);
    if (error instanceof SyntaxError) throw new UsageError(`Manifest is not valid JSON: ${path}`);
    throw error;
  }
}

async function runVitest(cwd, args, extraEnvironment) {
  const vitest = resolve(cwd, 'node_modules/vitest/vitest.mjs');
  return runChild(process.execPath, [vitest, 'run', ...args], {
    cwd,
    env: minimalChildEnvironment(extraEnvironment),
    timeoutMs: 900_000,
  });
}

export function parseHeadlessPerformanceReport(stdout) {
  const marker = '{"schema":"rww.headless-performance-report"';
  const start = stdout.indexOf(marker);
  if (start < 0) return null;
  const newline = stdout.indexOf('\n', start);
  const serialized = stdout.slice(start, newline < 0 ? undefined : newline).trim();
  try {
    const report = JSON.parse(serialized);
    if (
      report?.schema !== 'rww.headless-performance-report'
      || report.version !== 1
      || report.mode !== 'wall'
      || !Array.isArray(report.simulationMilliseconds)
      || report.simulationMilliseconds.length < 1
      || !report.simulationMilliseconds.every(Number.isFinite)
      || !Array.isArray(report.resultHashes)
      || report.resultHashes.length !== report.simulationMilliseconds.length
      || !report.resultHashes.every((hash) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
      || typeof report.medianSimulationMilliseconds !== 'number'
      || typeof report.measuredResultsMatch !== 'boolean'
      || (report.medianBudgetPassed !== null && typeof report.medianBudgetPassed !== 'boolean')
      || (report.qualificationResultPassed !== null && typeof report.qualificationResultPassed !== 'boolean')
    ) return null;
    return report;
  } catch {
    return null;
  }
}

export function parseHeadlessDeterminismReport(stdout) {
  const marker = '{"schema":"rww.headless-determinism-report"';
  const start = stdout.indexOf(marker);
  if (start < 0) return null;
  const newline = stdout.indexOf('\n', start);
  try {
    const report = JSON.parse(stdout.slice(start, newline < 0 ? undefined : newline).trim());
    if (
      report?.schema !== 'rww.headless-determinism-report'
      || report.version !== 1
      || !Array.isArray(report.periodicHashes)
      || report.periodicHashes.length < 1
      || typeof report.eventTranscriptHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(report.eventTranscriptHash)
      || typeof report.timelineHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(report.timelineHash)
      || (report.qualificationTimelinePassed !== null
        && typeof report.qualificationTimelinePassed !== 'boolean')
    ) return null;
    return report;
  } catch {
    return null;
  }
}

export function referenceRunnerFailures(runtime, environment = process.env) {
  const failures = [];
  if (runtime.platform !== 'win32') failures.push(`platform ${runtime.platform} !== win32`);
  if (runtime.arch !== 'x64') failures.push(`architecture ${runtime.arch} !== x64`);
  if (!/^v26\./.test(runtime.node)) failures.push(`Node ${runtime.node} is not v26.x`);
  if (!runtime.release.startsWith('10.0.26220')) failures.push(`Windows release ${runtime.release} is not 10.0.26220.x`);
  if (!runtime.cpu.model.includes('i7-8650U')) failures.push(`CPU ${runtime.cpu.model} is not i7-8650U`);
  if (runtime.cpu.logicalCpus !== 8) failures.push(`logical CPU count ${runtime.cpu.logicalCpus} !== 8`);
  if (runtime.totalRamBytes < 24_000_000_000) failures.push(`RAM ${runtime.totalRamBytes} < 24000000000 bytes`);
  if (environment.RWW_PINNED_RUNNER_ID !== 't480s-headless-01') {
    failures.push('RWW_PINNED_RUNNER_ID is not the registered t480s-headless-01 runner');
  }
  if (environment.RWW_RUNNER_DEDICATED !== '1') failures.push('RWW_RUNNER_DEDICATED is not attested');
  if (environment.RWW_RUNNER_AC_POWER !== '1') failures.push('RWW_RUNNER_AC_POWER is not attested');
  if (environment.RWW_RUNNER_POWER_POLICY !== 'fixed-performance') {
    failures.push('RWW_RUNNER_POWER_POLICY is not fixed-performance');
  }
  if (environment.RWW_RUNNER_IMMUTABLE_WORKSPACE !== '1') {
    failures.push('RWW_RUNNER_IMMUTABLE_WORKSPACE is not attested');
  }
  if (environment.GITHUB_ACTIONS !== 'true') failures.push('qualification is not running in GitHub Actions');
  if (environment.RUNNER_ENVIRONMENT !== 'self-hosted') failures.push('GitHub runner is not self-hosted');
  if (environment.RUNNER_NAME !== 't480s-headless-01') {
    failures.push(`GitHub runner ${environment.RUNNER_NAME ?? 'unknown'} is not t480s-headless-01`);
  }
  if (environment.GITHUB_REPOSITORY !== 'Nether403/RingWorldWar') {
    failures.push(`GitHub repository ${environment.GITHUB_REPOSITORY ?? 'unknown'} is not Nether403/RingWorldWar`);
  }
  if (environment.GITHUB_REF !== 'refs/heads/master') failures.push('qualification ref is not master');
  if (environment.GITHUB_REF_PROTECTED !== 'true') failures.push('qualification ref is not protected');
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch') failures.push('qualification event is not workflow_dispatch');
  if (!/^\d+$/.test(environment.GITHUB_RUN_ID ?? '')) failures.push('GitHub run ID is unavailable');
  if (!(environment.GITHUB_WORKFLOW_REF ?? '').endsWith(
    '.github/workflows/headless-qualification.yml@refs/heads/master'
  )) failures.push('qualification workflow ref is not the protected master workflow');
  return failures;
}

function minimalChildEnvironment(extraEnvironment) {
  const environment = {};
  for (const key of [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CI',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return {
    ...environment,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    ...extraEnvironment,
  };
}

export async function writeSanitizedErrorArtifact(path, error) {
  const details = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(path, `${sanitizeSecrets(details)}\n`);
}

async function describeArtifact(baseDirectory, path, classification) {
  return {
    path: relative(baseDirectory, path).replaceAll('\\', '/'),
    sha256: await sha256File(path),
    classification,
  };
}

function stripEnvironmental(value) {
  if (Array.isArray(value)) return value.map(stripEnvironmental);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['wallClock', 'wallClockMilliseconds', 'environment', 'generatedAt', 'timing'].includes(key))
      .map(([key, child]) => [key, stripEnvironmental(child)]));
  }
  return value;
}

async function loadScenario(path) {
  try {
    return parseScenario(await readJsonFile(path, 'Scenario'));
  } catch (error) {
    throw error instanceof UsageError ? error : new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function safeScenarioPath(cwd, scenario) {
  try {
    return resolveScenarioPath(cwd, scenario);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function scenarioIdentity(cwd, path, scenario, sha256) {
  return {
    id: scenario.id,
    revision: scenario.revision,
    schema: scenario.schema,
    version: scenario.version,
    path: relative(cwd, path).replaceAll('\\', '/'),
    sha256,
  };
}

function visualInvariantChecks(signature, state, invariants, contextLosses) {
  return [
    thresholdInvariant('frame-luminance', signature.meanLuminance, invariants.minimumMeanLuminance),
    thresholdInvariant('frame-variance', signature.luminanceVariance, invariants.minimumLuminanceVariance),
    thresholdInvariant('live-units', state.units, invariants.minimumUnits),
    thresholdInvariant('live-structures', state.structures, invariants.minimumStructures),
    maximumInvariant('context-losses', contextLosses, invariants.maximumContextLosses ?? 0),
    {
      id: 'adaptive-quality-disabled', actual: state.adaptiveQuality, expected: false,
      status: state.adaptiveQuality === false ? 'pass' : 'fail',
    },
  ];
}

function thresholdInvariant(id, actual, minimum) {
  return { id, actual, minimum, status: actual >= minimum ? 'pass' : 'fail' };
}

function maximumInvariant(id, actual, maximum) {
  return { id, actual, maximum, status: actual <= maximum ? 'pass' : 'fail' };
}

function selectBrowserBudget(target) {
  const budget = target.frameBudgets?.find((item) => item.quality === 'low' && item.classification === 'candidate-hard')
    ?? target.frameBudgets?.find((item) => item.quality === 'low');
  if (!budget) throw new UsageError(`Target ${target.id} has no Low-quality browser frame budget`);
  if (!Array.isArray(budget.resolution) || budget.resolution.length !== 2) throw new UsageError(`Target budget ${budget.id} has no valid resolution`);
  return budget;
}

function printBrowserPerf(report) {
  process.stdout.write(`RWW perf browser-heavy: ${report.status}\n`);
  process.stdout.write(`Renderer: ${report.renderer.renderer}\n`);
  process.stdout.write(`Frames: median ${report.metrics.medianFrameMilliseconds}ms; p95 ${report.metrics.p95FrameMilliseconds}ms; p99 ${report.metrics.p99FrameMilliseconds}ms\n`);
  process.stdout.write(`>100ms: ${report.metrics.over100MillisecondsCount} (${report.metrics.over100MillisecondsPerMinute}/min); calls ${report.resources.drawCalls}; triangles ${report.resources.triangles}\n`);
  process.stdout.write(`Target ${report.verdict.id}: ${report.verdict.status}\nReceipt: ${report.receiptPath}\n`);
}

function printDoctor(report) {
  process.stdout.write(`RWW doctor: ${report.status}\n`);
  process.stdout.write(`Node ${report.system.node}; ${report.system.platform}/${report.system.arch}; ${report.system.logicalCpus} CPUs; ${(report.system.totalRamBytes / 2 ** 30).toFixed(1)} GiB RAM\n`);
  if (report.browser.status === 'available') {
    process.stdout.write(`Browser ${report.browser.name} ${report.browser.version}; WebGL2 ${report.browser.webgl2 ? 'yes' : 'no'}; ${report.browser.renderer}\n`);
  } else process.stdout.write(`Browser: ${report.browser.status}\n`);
  for (const item of report.checks) process.stdout.write(`[${item.status}] ${item.id}: ${item.message}\n`);
  process.stdout.write(`Receipt: ${report.receiptPath}\n`);
}
