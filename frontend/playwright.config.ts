import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'desktop',
      testIgnore: /documents-round(4|5)-mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: /documents-round(4|5)-mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec next dev -H 127.0.0.1 -p 3010',
    url: 'http://127.0.0.1:3010',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
