export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseCliArgs(argv) {
  const [command, ...args] = argv;
  if (command === 'doctor') return parseDoctor(args);
  if (command === 'run') return parseRun(args);
  if (command === 'visual') return parseVisual(args);
  if (command === 'play') return parsePlay(args);
  if (command === 'perf') return parsePerf(args);
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { command: 'help' };
  }
  throw new UsageError(`Unknown command: ${command}`);
}

export function normalizeCommand(parsed) {
  if (parsed.command === 'help') return ['help'];
  if (parsed.command === 'doctor') {
    return [
      'doctor',
      ...(parsed.browser ? ['--browser'] : []),
      ...(parsed.target ? ['--target', normalizePath(parsed.target)] : []),
      ...(parsed.json ? ['--json'] : []),
    ];
  }
  if (parsed.command === 'run') {
    return ['run', normalizePath(parsed.manifest), '--repeat', String(parsed.repeat)];
  }
  if (parsed.command === 'visual') {
    return ['visual', parsed.scenario, ...(parsed.compare ? ['--compare'] : [])];
  }
  if (parsed.command === 'play') {
    return [
      'play', parsed.scenario,
      ...(parsed.seconds === null ? [] : ['--seconds', String(parsed.seconds)]),
      ...(parsed.headless ? ['--headless'] : []),
    ];
  }
  if (parsed.profile === 'browser-heavy') {
    return [
      'perf', 'browser-heavy', '--scenario', parsed.scenario,
      '--target', normalizePath(parsed.target), '--quality', parsed.quality,
      '--variant', parsed.variant, '--seconds', String(parsed.seconds),
      ...(parsed.json ? ['--json'] : []),
    ];
  }
  if (parsed.qualify) return ['perf', 'headless-40m', '--qualify'];
  return [
    'perf', parsed.profile,
    '--terrain', parsed.terrain,
    '--warmup-runs', String(parsed.warmupRuns),
    '--runs', String(parsed.runs),
    '--ticks', String(parsed.ticks),
    ...(parsed.maxMedianMs === null ? [] : ['--max-median-ms', String(parsed.maxMedianMs)]),
    ...(parsed.requireClean ? ['--require-clean'] : []),
  ];
}

export function reproductionCommands(normalizedArgs) {
  const argv = ['npm', 'run', 'rww', '--', ...normalizedArgs];
  return {
    argv,
    powershell: argv.map(powerShellQuote).join(' '),
    posix: argv.map(posixShellQuote).join(' '),
  };
}

export function reproductionCommand(normalizedArgs, platform = process.platform) {
  const commands = reproductionCommands(normalizedArgs);
  return platform === 'win32' ? commands.powershell : commands.posix;
}

function parseDoctor(args) {
  const result = { command: 'doctor', browser: false, json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--browser') result.browser = true;
    else if (arg === '--json') result.json = true;
    else if (arg === '--target') result.target = normalizePath(optionValue(args, ++index, arg));
    else throw new UsageError(`Unknown doctor option: ${arg}`);
  }
  return result;
}

function parseRun(args) {
  if (args.length === 0 || args[0].startsWith('--')) {
    throw new UsageError('run requires a core-match manifest path');
  }
  const result = { command: 'run', manifest: normalizePath(args[0]), repeat: 1 };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--repeat') result.repeat = positiveInteger(optionValue(args, ++index, arg), 'repeat');
    else throw new UsageError(`Unknown run option: ${arg}`);
  }
  return result;
}

function parseVisual(args) {
  if (args.length === 0 || args[0].startsWith('--')) throw new UsageError('visual requires a scenario name');
  const result = { command: 'visual', scenario: args[0], compare: false };
  for (let index = 1; index < args.length; index++) {
    if (args[index] === '--compare') result.compare = true;
    else throw new UsageError(`Unknown visual option: ${args[index]}`);
  }
  return result;
}

function parsePlay(args) {
  if (args.length === 0 || args[0].startsWith('--')) throw new UsageError('play requires a scenario name');
  const result = { command: 'play', scenario: args[0], seconds: null, headless: false };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--headless') result.headless = true;
    else if (arg === '--seconds') result.seconds = positiveInteger(optionValue(args, ++index, arg), 'seconds');
    else throw new UsageError(`Unknown play option: ${arg}`);
  }
  return result;
}

function parsePerf(args) {
  if (args[0] === 'browser-heavy') return parseBrowserPerf(args.slice(1));
  if (args[0] !== 'headless-40m') throw new UsageError('perf requires the headless-40m or browser-heavy profile');
  const result = {
    command: 'perf', profile: 'headless-40m', terrain: 'flat',
    runs: 1, warmupRuns: 0, maxMedianMs: null, requireClean: false, qualify: false, ticks: 72_000,
  };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--require-clean') {
      result.requireClean = true;
      continue;
    }
    if (arg === '--qualify') {
      result.qualify = true;
      continue;
    }
    const value = optionValue(args, ++index, arg);
    if (arg === '--terrain') {
      if (value !== 'standard' && value !== 'flat') throw new UsageError('terrain must be standard or flat');
      result.terrain = value;
    } else if (arg === '--runs') result.runs = boundedPositiveInteger(value, 'runs', 25);
    else if (arg === '--warmup-runs') result.warmupRuns = boundedNonNegativeInteger(value, 'warmup-runs', 5);
    else if (arg === '--max-median-ms') result.maxMedianMs = boundedPositiveInteger(value, 'max-median-ms', 600_000);
    else if (arg === '--ticks') result.ticks = boundedPositiveInteger(value, 'ticks', 1_000_000);
    else throw new UsageError(`Unknown perf option: ${arg}`);
  }
  if (result.qualify) {
    result.terrain = 'standard';
    result.runs = 5;
    result.warmupRuns = 1;
    result.maxMedianMs = 15_000;
    result.requireClean = true;
    result.ticks = 72_000;
  }
  return result;
}

function parseBrowserPerf(args) {
  const result = {
    command: 'perf', profile: 'browser-heavy', scenario: 'heavy-combat',
    target: 'validation/hardware/t480s-low.json', quality: 'low', variant: 'default', seconds: 30, json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') result.json = true;
    else {
      const value = optionValue(args, ++index, arg);
      if (arg === '--scenario') result.scenario = value;
      else if (arg === '--target') result.target = normalizePath(value);
      else if (arg === '--quality') {
        if (!['low', 'medium', 'high', 'ultra'].includes(value)) {
          throw new UsageError('quality must be low, medium, high, or ultra');
        }
        result.quality = value;
      }
      else if (arg === '--variant') {
        if (!['default', 'no-shadows', 'low-terrain', 'no-terrain-shadows'].includes(value)) {
          throw new UsageError('variant must be default, no-shadows, low-terrain, or no-terrain-shadows');
        }
        result.variant = value;
      }
      else if (arg === '--seconds') result.seconds = boundedPositiveInteger(value, 'seconds', 600);
      else throw new UsageError(`Unknown browser-heavy option: ${arg}`);
    }
  }
  return result;
}

function optionValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${option} requires a value`);
  return value;
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new UsageError(`${label} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value, label) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new UsageError(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function boundedPositiveInteger(value, label, maximum) {
  const parsed = positiveInteger(value, label);
  if (parsed > maximum) throw new UsageError(`${label} must be at most ${maximum}`);
  return parsed;
}

function boundedNonNegativeInteger(value, label, maximum) {
  const parsed = nonNegativeInteger(value, label);
  if (parsed > maximum) throw new UsageError(`${label} must be at most ${maximum}`);
  return parsed;
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function powerShellQuote(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}

function posixShellQuote(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}
