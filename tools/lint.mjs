import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const violations = [];
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

for (const boundary of boundaries) {
  for (const file of walk(boundary.directory)) {
    const source = readFileSync(file, 'utf8');
    for (const [pattern, message] of boundary.rules) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${file}:${line} ${message}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('simulation and headless boundaries: clean');
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (extname(entry.name) === '.ts') yield path;
  }
}
