import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3016', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8117 pnpm exec next dev -H 127.0.0.1 -p 3016',
    url: 'http://127.0.0.1:3016',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
