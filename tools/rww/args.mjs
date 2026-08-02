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
      '--target', normalizePath(parsed.target), '--seconds', String(parsed.seconds),
      ...(parsed.json ? ['--json'] : []),
    ];
  }
  return [
    'perf', parsed.profile,
    '--terrain', parsed.terrain,
    '--runs', String(parsed.runs),
    '--ticks', String(parsed.ticks),
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
  const result = { command: 'perf', profile: 'headless-40m', terrain: 'flat', runs: 1, ticks: 72_000 };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    const value = optionValue(args, ++index, arg);
    if (arg === '--terrain') {
      if (value !== 'standard' && value !== 'flat') throw new UsageError('terrain must be standard or flat');
      result.terrain = value;
    } else if (arg === '--runs') result.runs = positiveInteger(value, 'runs');
    else if (arg === '--ticks') result.ticks = positiveInteger(value, 'ticks');
    else throw new UsageError(`Unknown perf option: ${arg}`);
  }
  return result;
}

function parseBrowserPerf(args) {
  const result = {
    command: 'perf', profile: 'browser-heavy', scenario: 'heavy-combat',
    target: 'validation/hardware/t480s-low.json', seconds: 30, json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') result.json = true;
    else {
      const value = optionValue(args, ++index, arg);
      if (arg === '--scenario') result.scenario = value;
      else if (arg === '--target') result.target = normalizePath(value);
      else if (arg === '--seconds') result.seconds = positiveInteger(value, 'seconds');
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

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function powerShellQuote(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}

function posixShellQuote(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}
