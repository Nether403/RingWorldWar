import { expect, test } from 'playwright/test';

test('all reviewed voice files decode in a real AudioContext', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const decoded = await page.evaluate(async () => {
    const modulePath = '/src/presentation/voiceMedia.ts';
    const { REVIEWED_VOICE_CLIPS } = await import(/* @vite-ignore */ modulePath);
    const context = new AudioContext();
    const failures: string[] = [];
    for (const clip of REVIEWED_VOICE_CLIPS) {
      try {
        const response = await fetch(clip.src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await context.decodeAudioData(await response.arrayBuffer());
      } catch (error) {
        failures.push(`${clip.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await context.close();
    return { count: REVIEWED_VOICE_CLIPS.length, failures };
  });

  expect(decoded).toEqual({ count: 68, failures: [] });
});

test('audio unlocks from a gesture and follows persisted master and voice volume', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { audio?: unknown } }).RWW?.audio));
  expect(await audioState(page)).toBe('idle');

  await page.keyboard.press('Escape');
  await expect.poll(() => audioState(page)).toBe('running');
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { RWW: any }).RWW.audio.loadedVoiceCount), { timeout: 15_000 }).toBe(34);
  const volume = page.getByRole('slider', { name: 'Master volume' });
  await volume.fill('35');
  const voiceVolume = page.getByRole('slider', { name: 'Voice volume' });
  await voiceVolume.fill('55');
  await expect.poll(() => page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return {
      setting: rww.settings.volume,
      live: rww.audio.masterVolume,
      voiceSetting: rww.settings.voiceVolume,
      voiceLive: rww.audio.voiceVolume,
    };
  })).toEqual({ setting: 0.35, live: 0.35, voiceSetting: 0.55, voiceLive: 0.55 });

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { audio?: unknown } }).RWW?.audio));
  expect(await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return {
      setting: rww.settings.volume,
      live: rww.audio.masterVolume,
      voiceSetting: rww.settings.voiceVolume,
      voiceLive: rww.audio.voiceVolume,
      state: rww.audio.state,
    };
  })).toEqual({ setting: 0.35, live: 0.35, voiceSetting: 0.55, voiceLive: 0.55, state: 'idle' });
});

test('voice requests only follow accepted player actions', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { game?: unknown } }).RWW?.game));

  const actions = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const recorded: unknown[] = [];
    rww.game.onPlayerVoiceAction = (action: unknown) => recorded.push(action);
    rww.game.world.spawnUnit(0, 'vanguard', 220, 40);
    rww.game.selectAt(220, 40, false);
    rww.game.issueOrder(300, 40, false);
    rww.game.selection.clear();
    rww.game.issueOrder(260, 40, false);
    return recorded;
  });

  expect(actions).toHaveLength(2);
  expect(actions[0]).toMatchObject({ kind: 'selection', faction: 0 });
  expect(actions[1]).toMatchObject({ kind: 'order', faction: 0, order: 'move' });
});

test('disposes an independent Web Audio backend without unhandled rejections', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const rejections = await page.evaluate(async () => {
    const modulePath = '/src/audio/webAudioBackend.ts';
    const { WebAudioBackend } = await import(/* @vite-ignore */ modulePath);
    const messages: string[] = [];
    const onRejection = (event: PromiseRejectionEvent) => {
      messages.push(String(event.reason));
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    const backend = new WebAudioBackend(9);
    backend.dispose();
    backend.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener('unhandledrejection', onRejection);
    return messages;
  });

  expect(rejections).toEqual([]);
});

async function audioState(page: import('playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { RWW: any }).RWW.audio.state);
}
