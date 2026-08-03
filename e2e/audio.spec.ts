import { expect, test } from 'playwright/test';

test('procedural audio unlocks from a gesture and follows persisted master volume', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { audio?: unknown } }).RWW?.audio));
  expect(await audioState(page)).toBe('idle');

  await page.keyboard.press('Escape');
  await expect.poll(() => audioState(page)).toBe('running');
  const volume = page.getByRole('slider', { name: 'Master volume' });
  await volume.fill('35');
  await expect.poll(() => page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return { setting: rww.settings.volume, live: rww.audio.masterVolume };
  })).toEqual({ setting: 0.35, live: 0.35 });

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { audio?: unknown } }).RWW?.audio));
  expect(await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return { setting: rww.settings.volume, live: rww.audio.masterVolume, state: rww.audio.state };
  })).toEqual({ setting: 0.35, live: 0.35, state: 'idle' });
});

async function audioState(page: import('playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { RWW: any }).RWW.audio.state);
}
