#!/usr/bin/env node
import { parseCliArgs, UsageError } from './rww/args.mjs';
import { executeCommand } from './rww/commands.mjs';
import { sanitizeSecrets } from './rww/receipt.mjs';

const USAGE = `Ring World War CLI

Usage:
  npm run rww -- doctor [--browser] [--target <target.json>] [--json]
  npm run rww -- run <core-match-manifest> [--repeat N]
  npm run rww -- visual <scenario> [--compare]
  npm run rww -- play <scenario> [--seconds N] [--headless]
  npm run rww -- perf headless-40m [--terrain standard|flat] [--warmup-runs N] [--runs N] [--ticks N] [--max-median-ms N] [--require-clean] [--qualify]
  npm run rww -- perf browser-heavy [--scenario <name>] [--target <target.json>] [--seconds N] [--json]

Exit codes: 0 success, 2 usage/config, 3 deterministic/gate failure, 4 infrastructure/runtime failure.
`;

try {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    process.stdout.write(USAGE);
    process.exitCode = 0;
  } else {
    process.exitCode = await executeCommand(parsed, process.cwd());
  }
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${sanitizeSecrets(error.message)}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`RWW infrastructure/runtime failure: ${sanitizeSecrets(details)}\n`);
    process.exitCode = 4;
  }
}
