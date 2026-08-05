import os from 'node:os';

export const TARGET_SCHEMA = 'rww.hardware-target';
export const TARGET_VERSION = 1;

export function probeSystem(source = os, nodeVersion = process.version) {
  const cpus = source.cpus();
  return {
    platform: source.platform(),
    arch: source.arch(),
    release: source.release(),
    node: nodeVersion,
    logicalCpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    totalRamBytes: source.totalmem(),
  };
}

export function parseTarget(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Target must be an object');
  if (input.schema !== TARGET_SCHEMA) throw new Error(`Unsupported target schema: ${input.schema}`);
  if (input.version !== TARGET_VERSION) throw new Error(`Unsupported target version: ${input.version}`);
  if (typeof input.id !== 'string' || input.id.length === 0) throw new Error('Target id is required');
  validateOptionalPositive(input.system?.minimumLogicalCpus, 'system.minimumLogicalCpus');
  validateOptionalPositive(input.system?.minimumRamGiB, 'system.minimumRamGiB');
  validateOptionalPositive(input.browser?.minimumDrawingBuffer?.width, 'browser.minimumDrawingBuffer.width');
  validateOptionalPositive(input.browser?.minimumDrawingBuffer?.height, 'browser.minimumDrawingBuffer.height');
  if (input.browser?.requireWebgl2 !== undefined && typeof input.browser.requireWebgl2 !== 'boolean') {
    throw new Error('browser.requireWebgl2 must be a boolean');
  }
  if (input.browser?.disallowSoftwareRenderer !== undefined && typeof input.browser.disallowSoftwareRenderer !== 'boolean') {
    throw new Error('browser.disallowSoftwareRenderer must be a boolean');
  }
  for (const [name, value] of Object.entries(input.browser?.minimumLimits ?? {})) {
    validateOptionalPositive(value, `browser.minimumLimits.${name}`);
  }
  validateOptionalPositive(input.privateGpu?.minimumDedicatedMemoryGiB, 'privateGpu.minimumDedicatedMemoryGiB');
  if (input.frameBudgets !== undefined && !Array.isArray(input.frameBudgets)) throw new Error('frameBudgets must be an array');
  const budgetIds = new Set();
  for (const [index, budget] of (input.frameBudgets ?? []).entries()) {
    if (budget === null || typeof budget !== 'object' || typeof budget.id !== 'string' || budget.id.length === 0) {
      throw new Error(`frameBudgets[${index}].id is required`);
    }
    if (budgetIds.has(budget.id)) throw new Error(`frameBudgets[${index}].id is duplicated`);
    budgetIds.add(budget.id);
    if (!['low', 'medium', 'high', 'ultra'].includes(budget.quality)) {
      throw new Error(`frameBudgets[${index}].quality is invalid`);
    }
    if (!['candidate-hard', 'advisory'].includes(budget.classification)) {
      throw new Error(`frameBudgets[${index}].classification is invalid`);
    }
    if (
      !Array.isArray(budget.resolution)
      || budget.resolution.length !== 2
      || !budget.resolution.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 8192)
    ) throw new Error(`frameBudgets[${index}].resolution is invalid`);
    validateBudgetNumber(budget.targetFps, `frameBudgets[${index}].targetFps`, 240);
    validateOptionalBudgetNumber(
      budget.maximumP95FrameMilliseconds,
      `frameBudgets[${index}].maximumP95FrameMilliseconds`,
    );
    validateOptionalBudgetNumber(
      budget.maximumP99FrameMilliseconds,
      `frameBudgets[${index}].maximumP99FrameMilliseconds`,
    );
  }
  return structuredClone(input);
}

function validateBudgetNumber(value, label, maximum = 10_000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive finite number at most ${maximum}`);
  }
}

function validateOptionalBudgetNumber(value, label) {
  if (value !== undefined) validateBudgetNumber(value, label);
}

export function buildDoctorReport({ system, browser = { status: 'not-requested' }, target = null }) {
  const checks = [];
  if (target !== null) evaluateTarget(checks, target, system, browser);
  if (browser.status === 'error') checks.push(check('browser-probe', 'fail', browser.error ?? 'Browser probe failed'));
  const status = checks.some((item) => item.status === 'fail')
    ? 'fail'
    : checks.some((item) => item.status === 'warn' || item.status === 'not-measured') ? 'warn' : 'pass';
  return {
    schema: 'rww.doctor-report',
    version: 1,
    status,
    system,
    browser,
    target: target === null ? null : { id: target.id, schema: target.schema, version: target.version },
    checks,
  };
}

function evaluateTarget(checks, target, system, browser) {
  const systemTarget = target.system ?? {};
  if (systemTarget.minimumLogicalCpus !== undefined) {
    checks.push(thresholdCheck('system-logical-cpus', system.logicalCpus, systemTarget.minimumLogicalCpus));
  }
  if (systemTarget.minimumRamGiB !== undefined) {
    checks.push(thresholdCheck('system-ram-gib', system.totalRamBytes / 2 ** 30, systemTarget.minimumRamGiB));
  }

  const browserTarget = target.browser ?? {};
  if (browser.status !== 'available') {
    if (Object.keys(browserTarget).length > 0) checks.push(check('browser-target', 'warn', 'Browser criteria not measured'));
  } else {
    if (browserTarget.requireWebgl2 === true) {
      checks.push(check('browser-webgl2', browser.webgl2 ? 'pass' : 'fail', browser.webgl2 ? 'WebGL2 available' : 'WebGL2 unavailable'));
    }
    if (browserTarget.disallowSoftwareRenderer === true) {
      checks.push(check(
        'browser-hardware-renderer', browser.softwareRenderer ? 'fail' : 'pass',
        browser.softwareRenderer ? 'Software renderer detected' : 'Hardware renderer reported',
      ));
    }
    const buffer = browserTarget.minimumDrawingBuffer;
    if (buffer !== undefined) {
      const passed = browser.drawingBuffer.width >= buffer.width && browser.drawingBuffer.height >= buffer.height;
      checks.push(check(
        'browser-drawing-buffer', passed ? 'pass' : 'fail',
        `${browser.drawingBuffer.width}x${browser.drawingBuffer.height}; requires ${buffer.width}x${buffer.height}`,
      ));
    }
    for (const [name, minimum] of Object.entries(browserTarget.minimumLimits ?? {})) {
      checks.push(thresholdCheck(`browser-limit:${name}`, browser.limits[name], minimum));
    }
  }

  if (target.privateGpu !== undefined) {
    checks.push(check('private-gpu-memory', 'warn', 'Dedicated GPU memory is not exposed reliably by browser or Node probes'));
  }
  for (const budget of target.frameBudgets ?? []) {
    checks.push(check(
      `frame-budget:${budget.id}`,
      'not-measured',
      'Requires a representative benchmark scenario; doctor does not certify frame budgets',
    ));
  }
}

function thresholdCheck(id, actual, minimum) {
  const passed = typeof actual === 'number' && actual >= minimum;
  return check(id, passed ? 'pass' : 'fail', `${actual ?? 'unavailable'}; requires at least ${minimum}`, { actual, minimum });
}

function check(id, status, message, values = {}) {
  return { id, status, message, ...values };
}

function validateOptionalPositive(value, path) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${path} must be a positive number`);
  }
}
