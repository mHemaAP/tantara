import {defineConfig,devices} from '@playwright/test';
const webUrl = process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010';
export default defineConfig({testDir:'./tests',fullyParallel:true,workers:1,reporter:'list',use:{baseURL:webUrl,...devices['Desktop Chrome']},webServer:{command:process.env.TANTARA_WEB_URL ? 'pnpm exec next dev -H 127.0.0.1 -p 3014' : 'pnpm dev',url:webUrl,reuseExistingServer:!process.env.CI,timeout:120000}});
