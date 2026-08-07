import { expect, test } from 'playwright/test';

test('renders the live launch plan from the fixed progress endpoint', async ({ page, request }) => {
  const response = await request.get('/__rww/progress');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toContain('no-store');
  const data = await response.json() as {
    generatedAt: string;
    planModifiedAt: string;
    plan: {
      activeSlice: string;
      slices: Array<{
        id: string;
        title: string;
        state: string;
        qualification: string;
        disposition: string;
      }>;
      gates: Array<{ state: string; evidenceRefs?: string[] }>;
      references: unknown[];
    };
    receipts: unknown[];
  };
  expect(Date.parse(data.generatedAt)).not.toBeNaN();
  expect(Date.parse(data.planModifiedAt)).not.toBeNaN();
  expect(data.planModifiedAt).not.toBe(data.generatedAt);
  const active = data.plan.slices.find((slice) => slice.id === data.plan.activeSlice);
  expect(active).toBeDefined();
  expect(data.plan.slices).toHaveLength(37);
  expect(data.plan.gates).toHaveLength(8);
  expect(data.plan.references).toHaveLength(3);
  expect(data.receipts.length).toBeLessThanOrEqual(8);

  await page.goto('/progress.html');
  await expect(page.getByRole('heading', { name: 'Launch Scope Control' })).toBeVisible();
  await expect(page.getByTestId('active-slice')).toContainText(active!.title);
  await expect(page.locator('[data-slice]')).toHaveCount(37);
  await expect(page.locator(`[data-slice="${active!.id}"]`)).toContainText(active!.qualification.replace(/-/g, ' '));
  await expect(page.locator(`[data-slice="${active!.id}"]`)).toContainText(active!.disposition.replace(/-/g, ' '));
  await expect(page.getByText('Dependency Ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Claim Receipts Verified', { exact: true })).toBeVisible();
  const verifiedClaims = data.plan.slices.filter((slice) => slice.state === 'complete').length
    + data.plan.gates.filter((gate) => gate.state === 'passed' && gate.evidenceRefs?.length === 1).length;
  await expect(page.locator('#metric-receipts')).toHaveText(String(verifiedClaims).padStart(2, '0'));
  await expect(page.getByRole('heading', { name: 'Local Run Telemetry' })).toBeVisible();
  await expect(page.getByText(/SC2 \/ milestone-only advisory/i)).toBeVisible();
  await expect(page.locator('[data-gate]')).toHaveCount(8);
  await expect(page.getByRole('link', { name: /campaign full-game/i })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=h5ik9BSzUGA',
  );
  await expect(page.getByTestId('sync-state')).toContainText('CONNECTED');
  await expect(page.getByTestId('plan-freshness')).toContainText(/PLAN (CURRENT|STALE)/);
  await expect(page.getByTestId('plan-freshness')).toContainText('UPDATED');
});

test('preserves last-known-good plan while separating stale source and degraded connection state', async ({ page, request }) => {
  const payload = await (await request.get('/__rww/progress')).json() as Record<string, any>;
  const active = payload.plan.slices.find((slice: { id: string }) => slice.id === payload.plan.activeSlice);
  active.qualification = 'automation-policy-passed';
  payload.generatedAt = new Date().toISOString();
  payload.planModifiedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let calls = 0;
  await page.route('**/__rww/progress', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      return;
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' });
  });

  await page.goto('/progress.html');
  await expect(page.getByTestId('active-slice')).toContainText(active.title);
  await expect(page.locator(`[data-slice="${active.id}"]`)).toContainText('automation policy passed');
  await expect(page.getByTestId('plan-freshness')).toContainText('PLAN STALE');
  await expect(page.getByTestId('sync-state')).toContainText('LINK DEGRADED', { timeout: 5_000 });
  await expect(page.getByTestId('sync-state')).toContainText('LAST RESPONSE');
  await expect(page.getByTestId('active-slice')).toContainText(active.title);
  await expect(page.getByTestId('plan-freshness')).toContainText('PLAN STALE');
  await expect(page.getByTestId('plan-freshness')).toContainText('EVIDENCE FAILURE / LAST VERIFIED');
});

test('keeps the progress console usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/progress.html');
  await expect(page.getByTestId('active-slice')).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const references = page.getByRole('heading', { name: 'Reference Manifest' });
  await references.scrollIntoViewIfNeeded();
  await expect(references).toBeVisible();
  await expect(page.getByRole('link', { name: /mission-separated/i })).toBeVisible();
});
