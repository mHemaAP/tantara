import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm exec next dev -H 127.0.0.1 -p 3012',
    url: 'http://127.0.0.1:3012',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
