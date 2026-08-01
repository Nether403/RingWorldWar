import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const violations = [];
for (const file of walk('src/sim')) {
  const source = readFileSync(file, 'utf8');
  for (const [pattern, message] of [
    [/Math\.random\s*\(/g, 'simulation randomness must use Rng'],
    [/\bDate\.now\s*\(/g, 'simulation cannot read wall-clock time'],
    [/\bperformance\.now\s*\(/g, 'simulation cannot read frame time'],
    [/from\s+['"]three['"]/g, 'simulation cannot import Three.js'],
    [/from\s+['"]@render\//g, 'simulation cannot import the render layer'],
  ]) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${file}:${line} ${message}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('simulation boundaries: clean');
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (extname(entry.name) === '.ts') yield path;
  }
}
