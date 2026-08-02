import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'playwright/test';

const execFileAsync = promisify(execFile);

test('headless timed play resumes world ticks with general AI disabled', async () => {
  test.setTimeout(120_000);
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['tools/rww.mjs', 'play', 'directional-artillery', '--headless', '--seconds', '2'],
    { cwd: process.cwd(), timeout: 110_000 },
  );
  expect(stderr).toBe('');
  const receiptMatch = stdout.match(/^Receipt: (.+)$/m);
  expect(receiptMatch).not.toBeNull();
  const receipt = JSON.parse(await readFile(resolve(receiptMatch![1]!), 'utf8'));

  expect(receipt.outcome).toMatchObject({ status: 'success', exitCode: 0 });
  expect(receipt.environmental.appliedScenarioState).toMatchObject({
    tick: 24,
    aiEnabled: false,
  });
  expect(receipt.environmental.postScenarioState.tick).toBeGreaterThan(24);
  expect(receipt.environmental.postScenarioState.aiEnabled).toBe(false);
  expect(receipt.environmental.consoleErrors).toEqual([]);
  expect(receipt.environmental.pageErrors).toEqual([]);

  const notesMatch = stdout.match(/^Playtest notes: (.+)$/m);
  expect(notesMatch).not.toBeNull();
  expect(await readFile(resolve(notesMatch![1]!), 'utf8')).toContain('Which direction lets this launcher shoot farther?');
});
