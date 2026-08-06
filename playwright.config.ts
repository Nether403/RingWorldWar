import { defineConfig, devices } from 'playwright/test';

const qualificationMetadata = process.env.RWW_PLAYWRIGHT_METADATA
  ? JSON.parse(process.env.RWW_PLAYWRIGHT_METADATA) as Record<string, unknown>
  : {};
const qualificationReport = process.env.RWW_PLAYWRIGHT_JSON_OUTPUT;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  metadata: qualificationMetadata,
  reporter: qualificationReport
    ? [['line'], ['json', { outputFile: qualificationReport }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1100, height: 640 },
  },
  projects: [
    {
      name: 'chromium-regression',
      testIgnore: '**/title-screen-compat.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1100, height: 640 },
        deviceScaleFactor: 1,
        launchOptions: {
          args:
            process.platform === 'win32'
              ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
              : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'chrome-stable-compatibility',
      testMatch: ['**/matrix.spec.ts', '**/scenario.spec.ts', '**/title-screen-compat.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1100, height: 640 },
        deviceScaleFactor: 1,
        launchOptions: {
          args: process.platform === 'win32'
            ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
            : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
        },
      },
    },
    {
      name: 'firefox-compatibility',
      testMatch: ['**/matrix.spec.ts', '**/scenario.spec.ts', '**/title-screen-compat.spec.ts'],
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1100, height: 640 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'webkit-compatibility',
      testMatch: ['**/matrix.spec.ts', '**/scenario.spec.ts', '**/title-screen-compat.spec.ts'],
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1100, height: 640 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
