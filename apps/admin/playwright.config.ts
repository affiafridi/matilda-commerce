import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the admin app against a real API and the TEST database (never the
 * development one). The API runs on 4100 and the admin on 3101 so `pnpm dev` can stay up.
 * Browser: the Microsoft Edge that ships with Windows, so nothing has to be downloaded; set
 * PLAYWRIGHT_CHANNEL=chrome (or chromium after `playwright install`) elsewhere.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3101',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/launch-api.mjs',
      url: 'http://localhost:4100/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: 'pnpm exec next dev -p 3101',
      url: 'http://localhost:3101/sign-in',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_DIST_DIR: '.next-e2e', API_INTERNAL_URL: 'http://localhost:4100' },
    },
  ],
});
