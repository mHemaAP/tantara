import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests',fullyParallel:true,workers:1,reporter:'list',use:{baseURL:'http://localhost:3010',...devices['Desktop Chrome']},webServer:{command:'pnpm dev',url:'http://127.0.0.1:3010',reuseExistingServer:!process.env.CI,timeout:120000}});
