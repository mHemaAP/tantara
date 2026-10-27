import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests',fullyParallel:true,workers:1,reporter:'list',use:{baseURL:'http://localhost:3011',...devices['Desktop Chrome']},webServer:{command:'pnpm exec next dev -H 127.0.0.1 -p 3011',url:'http://127.0.0.1:3011',reuseExistingServer:!process.env.CI,timeout:120000}});
