import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: process.env.TANTARA_WEB_URL
    ? undefined
    : {
        command: 'pnpm exec next dev -H 127.0.0.1 -p 3013',
        url: 'http://127.0.0.1:3013',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
