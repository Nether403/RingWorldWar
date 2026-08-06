import { expect, test } from 'playwright/test';

test('shows the command deck and starts without media under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await expect(title.getByRole('heading', { name: 'Ring World War' })).toBeVisible();
  await expect(title.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await title.getByRole('button', { name: 'New Campaign' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
});

test('decodes the reviewed cinematic and skips into gameplay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();
  const intro = title.getByRole('dialog', { name: 'The Last Rotation introduction' });
  const video = intro.locator('video');
  await expect(intro).toBeVisible();
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).textTracks.length), { timeout: 60_000 }).toBe(1);
  expect(await video.evaluate((element) => (element as HTMLVideoElement).duration)).toBeGreaterThan(64);
  await intro.getByRole('button', { name: 'Skip intro' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  expect(errors).toEqual([]);
});
