import { expect, test } from 'playwright/test';

test('shows a lightweight Last Rotation menu before starting a new campaign', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await expect(title).toBeVisible();
  await expect(title.getByRole('heading', { name: 'Ring World War' })).toBeVisible();
  await expect(title.getByText('The Last Rotation', { exact: true })).toBeVisible();
  await expect(title.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(await page.locator('#app canvas').count()).toBe(0);
  expect(await page.evaluate(() => 'RWW' in window)).toBe(false);

  await title.getByRole('button', { name: 'Settings' }).click();
  await expect(title.getByRole('dialog', { name: 'Presentation settings' })).toBeVisible();
  expect(await title.locator('.rww-title-chrome').evaluate((element) => ({
    inert: (element as HTMLElement).inert,
    ariaHidden: element.getAttribute('aria-hidden'),
  }))).toEqual({ inert: true, ariaHidden: 'true' });
  await title.getByLabel('Graphics quality').focus();
  await page.keyboard.press('Tab');
  await expect(title.getByLabel('Master volume')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(title.getByLabel('Voice volume')).toBeFocused();
  await title.getByLabel('Master volume').fill('35');
  await title.getByLabel('Voice volume').fill('50');
  await title.getByLabel('Graphics quality').selectOption('medium');
  await title.getByRole('button', { name: 'Close settings' }).click();

  await title.getByRole('button', { name: 'New Campaign' }).click();
  await title.getByRole('dialog', { name: 'The Last Rotation introduction' })
    .getByRole('button', { name: 'Skip intro' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
  await expect(page.locator('#app canvas')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return { quality: rww.renderer.quality, voiceVolume: rww.settings.voiceVolume };
  })).toEqual({ quality: 'medium', voiceVolume: 0.5 });
  expect(errors).toEqual([]);
});

test('enables Continue only for a valid existing save and restores it atomically', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  const saved = await page.evaluate(() => {
    const session = (window as unknown as {
      RWW: {
        game: {
          world: { tick: number; players: Record<number, { salvage: number }> };
          saveGame(): { ok: boolean };
        };
      };
    }).RWW;
    session.game.world.players[0]!.salvage = 12_345;
    const result = session.game.saveGame();
    return { ok: result.ok, tick: session.game.world.tick };
  });
  expect(saved.ok).toBe(true);

  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await expect(title.getByRole('button', { name: 'Continue' })).toBeEnabled();
  expect(await page.evaluate(() => 'RWW' in window)).toBe(false);
  await title.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  const restored = await page.evaluate(() => {
    const world = (window as unknown as {
      RWW: { game: { world: { tick: number; players: Record<number, { salvage: number }> } } };
    }).RWW.game.world;
    return { tick: world.tick, salvage: world.players[0]!.salvage };
  });
  expect(restored.tick).toBeGreaterThanOrEqual(saved.tick);
  expect(restored.salvage).toBe(12_345);
});

test('disables Continue for a structurally corrupt save slot', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  await page.evaluate(() => localStorage.setItem('ring-world-war/save-slot', '{corrupt'));
  await page.reload();
  const title = page.locator('[data-rww-title-screen]');
  await expect(title.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(await page.evaluate(() => 'RWW' in window)).toBe(false);
  await expect(page.locator('#app canvas')).toHaveCount(0);
});

test('returns an incompatible save to the menu without a console failure', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  expect(await page.evaluate(() => {
    const game = (window as unknown as { RWW: { game: { saveGame(): { ok: boolean } } } }).RWW.game;
    return game.saveGame().ok;
  })).toBe(true);

  await page.goto('/?menu=1&seed=20260732&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Continue' }).click();
  await expect(title.getByRole('status')).toContainText('ARCHIVE REJECTED');
  await expect(title.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(await page.evaluate(() => 'RWW' in window)).toBe(false);
  await expect(page.locator('#app canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('falls through to gameplay when optional intro media fails', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?menu=1&quality=low&mediaTest=missing-intro');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
  await expect(page.locator('#app canvas')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('renders an optional poster when no menu loop is configured', async ({ page }) => {
  await page.goto('/?menu=1&quality=high');
  await page.evaluate(async () => {
    document.querySelector('[data-rww-title-screen]')?.remove();
    const titlePath = '/src/ui/titleScreen.ts';
    const settingsPath = '/src/render/settings.ts';
    const [{ TitleScreen }, { Settings }] = await Promise.all([
      import(/* @vite-ignore */ titlePath),
      import(/* @vite-ignore */ settingsPath),
    ]);
    const title = new TitleScreen({
      settings: new Settings({ storage: null, search: 'quality=high' }),
      hasSave: false,
      media: {
        menuPoster: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/%3E',
      },
    });
    void title.show();
  });

  const poster = page.locator('[data-rww-title-screen] .rww-title-media img');
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute('alt', '');
  await expect(poster).toHaveAttribute('loading', 'lazy');
  await expect(poster).toHaveAttribute('decoding', 'async');
  await expect(page.locator('[data-rww-title-screen] .rww-title-media video')).toHaveCount(0);
});

test('removes a failed optional menu poster and preserves the CSS fallback', async ({ page }) => {
  await page.route('**/missing-menu-poster.webp', (route) => route.abort());
  await page.goto('/?menu=1&quality=high');
  await page.evaluate(async () => {
    document.querySelector('[data-rww-title-screen]')?.remove();
    const titlePath = '/src/ui/titleScreen.ts';
    const settingsPath = '/src/render/settings.ts';
    const [{ TitleScreen }, { Settings }] = await Promise.all([
      import(/* @vite-ignore */ titlePath),
      import(/* @vite-ignore */ settingsPath),
    ]);
    const title = new TitleScreen({
      settings: new Settings({ storage: null, search: 'quality=high' }),
      hasSave: false,
      media: { menuPoster: '/missing-menu-poster.webp' },
    });
    void title.show();
  });

  const title = page.locator('[data-rww-title-screen]');
  await expect(title.locator('.rww-title-media')).toHaveCount(0);
  await expect(title.locator('.rww-title-fallback')).toBeVisible();
  await expect(title.getByRole('button', { name: 'New Campaign' })).toBeVisible();
});

test('plays the reviewed intro with captions and skips into gameplay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();
  const intro = title.getByRole('dialog', { name: 'The Last Rotation introduction' });
  await expect(intro).toBeVisible();
  const video = intro.locator('video');
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).textTracks.length), { timeout: 60_000 }).toBe(1);
  await expect.poll(() => video.evaluate((element) =>
    (element as HTMLVideoElement).readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const media = await video.evaluate((element) => {
    const value = element as HTMLVideoElement;
    return { duration: value.duration, readyState: value.readyState };
  });
  expect(media.readyState).toBeGreaterThanOrEqual(2);
  expect(media.duration).toBeGreaterThan(64);
  expect(media.duration).toBeLessThan(66);

  await video.evaluate((element) => {
    const value = element as HTMLVideoElement;
    value.currentTime = 3;
    value.dispatchEvent(new Event('timeupdate'));
  });
  await expect(intro.getByLabel('Intro elapsed time')).toHaveText('0:03');
  await intro.getByRole('button', { name: 'Mute' }).click();
  await expect(intro.getByRole('button', { name: 'Sound on' })).toBeVisible();
  await intro.getByRole('button', { name: 'Captions on' }).click();
  await expect(intro.getByRole('button', { name: 'Captions off' })).toBeVisible();
  await intro.getByRole('button', { name: 'Skip intro' }).click();

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('skips cinematic media when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=high');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'The Last Rotation introduction' })).toHaveCount(0);
});

test('stops an active cinematic when reduced motion becomes enabled', async ({ page }) => {
  await page.goto('/?menu=1&quality=high');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();
  await expect(title.getByRole('dialog', { name: 'The Last Rotation introduction' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
});

test('supports keyboard-only campaign start and Escape-to-skip', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await expect(title.getByRole('button', { name: 'New Campaign' })).toBeFocused();
  await page.keyboard.press('Enter');
  const intro = title.getByRole('dialog', { name: 'The Last Rotation introduction' });
  await expect(intro).toBeVisible();
  await expect(intro.getByRole('button', { name: 'Skip intro' })).toBeFocused();
  await page.keyboard.press('Escape');

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(title).toHaveCount(0);
});

test('skips the disabled mute control in the zero-volume focus loop', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Settings' }).click();
  await title.getByLabel('Master volume').fill('0');
  await title.getByRole('button', { name: 'Close settings' }).click();
  await title.getByRole('button', { name: 'New Campaign' }).click();
  const intro = title.getByRole('dialog', { name: 'The Last Rotation introduction' });
  await expect(intro.getByRole('button', { name: 'Volume 0%' })).toBeDisabled();
  await expect(intro.getByRole('button', { name: 'Skip intro' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(intro.getByRole('button', { name: 'Captions on' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(intro.getByRole('button', { name: 'Skip intro' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
});

test('keeps Fight again on the immediate restart path', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'New Campaign' }).click();
  await title.getByRole('dialog', { name: 'The Last Rotation introduction' })
    .getByRole('button', { name: 'Skip intro' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await page.evaluate(() => {
    (window as unknown as { RWW: { game: { hud: { restartRequested: boolean } } } })
      .RWW.game.hud.restartRequested = true;
  });

  await page.waitForURL((url) => url.searchParams.get('menu') === '0');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(page.locator('[data-rww-title-screen]')).toHaveCount(0);
});

test('keeps the command deck contained on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await expect(title).toBeVisible();
  await expect(title.getByRole('button', { name: 'New Campaign' })).toBeVisible();
  await expect(title.getByRole('button', { name: 'Settings' })).toBeVisible();

  const bounds = await title.evaluate((element) => {
    const root = element as HTMLElement;
    const deck = root.querySelector<HTMLElement>('.rww-title-deck')!;
    const rect = deck.getBoundingClientRect();
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
});
