import { defineConfig, devices } from '@playwright/test';
const port = process.env.TANTARA_WEB_URL?.match(/:(\d+)/)?.[1] ?? '3015';
const baseURL = process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3015';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: {
    command: `pnpm exec next dev -H 127.0.0.1 -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
