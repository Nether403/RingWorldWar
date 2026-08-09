import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const boundaries = [
  {
    directory: 'src/sim',
    rules: [
      [/Math\.random\s*\(/g, 'simulation randomness must use Rng'],
      [/\bDate\.now\s*\(/g, 'simulation cannot read wall-clock time'],
      [/\bperformance\.now\s*\(/g, 'simulation cannot read frame time'],
      [/from\s+['"]three['"]/g, 'simulation cannot import Three.js'],
      [/from\s+['"]@render\//g, 'simulation cannot import the render layer'],
    ],
  },
  {
    directory: 'src/headless',
    rules: [
      [
        /(?:from\s+|import\s*\(\s*)['"]@(?:render|ui)\//g,
        'headless code cannot import render or UI modules',
      ],
      [
        /(?:from\s+|import\s*\(\s*)['"](?:\.\.\/)+(?:render|ui)\//g,
        'headless code cannot import render or UI modules',
      ],
      [
        /(?:from\s+|import\s*\(\s*)['"](?:\.\.\/)+(?:game|main)(?:\.ts)?['"]/g,
        'headless code cannot import game or main',
      ],
      [
        /\b(?:window|document|navigator|location|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|fetch|Image|Audio|HTMLElement|HTMLCanvasElement|DOMParser|FileReader|WebSocket|AudioContext)\b/g,
        'headless code cannot use browser APIs',
      ],
    ],
  },
];

const worldAuthority = [
  ['drainEvents', ['src/game.ts', 'src/headless/runner.ts']],
  ['restorePersistenceState', ['src/game.ts', 'src/sim/serialize.ts']],
  ['setup', ['src/game.ts', 'src/headless/runner.ts']],
  ['step', ['src/game.ts', 'src/headless/runner.ts']],
  ['spawnUnit', ['src/scenario/worldFactory.ts']],
  ['spawnStructure', ['src/scenario/worldFactory.ts']],
  ['setSpinalPairs', ['src/scenario/worldFactory.ts']],
  ['recomputeCommandCaps', ['src/scenario/worldFactory.ts']],
  ['tryQueueUnit', ['src/ai/opponent.ts', 'src/ui/hud.ts']],
  ['tryPlaceStructure', ['src/ai/opponent.ts', 'src/game.ts']],
  ['fireBallisticCommand', ['src/game.ts']],
  ['fireBallisticAt', ['src/ai/opponent.ts']],
  ['activateAbility', ['src/ai/opponent.ts', 'src/ai/tactician.ts', 'src/game.ts']],
].map(([method, allowed]) => ({
  method,
  allowed: new Set(allowed),
  pattern: new RegExp(
    `\\b(?:this\\s*\\.\\s*|ctx\\s*\\.\\s*)?world\\s*(?:\\?\\.|\\.)\\s*${method}\\s*\\(`,
    'g',
  ),
}));

export function auditSource(file, source) {
  const normalized = file.replaceAll('\\', '/');
  const findings = [];

  if (normalized !== 'src/sim/world.ts') {
    for (const rule of worldAuthority) {
      if (rule.allowed.has(normalized)) continue;
      for (const match of source.matchAll(rule.pattern)) {
        findings.push({
          index: match.index,
          message: `World.${rule.method}() is restricted to reviewed authority owners`,
        });
      }
    }
  }

  if (normalized === 'src/ai/behaviorTree.ts' || normalized === 'src/ai/tactician.ts') {
    const pattern = /from\s+['"]\.\/opponent['"]/g;
    for (const match of source.matchAll(pattern)) {
      findings.push({
        index: match.index,
        message: 'lower-level AI modules must import shared contracts instead of opponent',
      });
    }
  }

  return findings;
}

function auditRepository() {
  const violations = [];

  for (const boundary of boundaries) {
    for (const file of walk(boundary.directory)) {
      const source = readFileSync(file, 'utf8');
      for (const [pattern, message] of boundary.rules) {
        for (const match of source.matchAll(pattern)) {
          violations.push(formatViolation(file, source, match.index, message));
        }
      }
    }
  }

  for (const file of walk('src')) {
    const source = readFileSync(file, 'utf8');
    for (const finding of auditSource(file, source)) {
      violations.push(formatViolation(file, source, finding.index, finding.message));
    }
  }

  return violations;
}

function formatViolation(file, source, index, message) {
  const line = source.slice(0, index).split('\n').length;
  return `${file}:${line} ${message}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const violations = auditRepository();
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('source boundaries: clean');
  }
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (extname(entry.name) === '.ts') yield path;
  }
}
