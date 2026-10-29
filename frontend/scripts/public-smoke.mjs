// Live smoke check of a deployed workspace through its public URL.
//
//   TANTARA_E2E_PASSWORD=... pnpm exec node scripts/public-smoke.mjs
//
// Optional: TANTARA_WEB_URL (default https://tantra.theessencetimes.com),
// TANTARA_E2E_EMAIL (default advocate@tantara.local), TANTARA_SMOKE_OUT.
// It only reads: it logs in, opens each page, and writes screenshots.

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const webUrl = (process.env.TANTARA_WEB_URL ?? 'https://tantra.theessencetimes.com').replace(/\/$/, '');
const email = process.env.TANTARA_E2E_EMAIL ?? 'advocate@tantara.local';
const password = process.env.TANTARA_E2E_PASSWORD;
const outDir = path.resolve(process.cwd(), process.env.TANTARA_SMOKE_OUT ?? '../reports/public-smoke');
if (!password?.trim()) throw new Error('TANTARA_E2E_PASSWORD is required for an authenticated smoke check');

const pages = [
  ['dashboard', '/dashboard'],
  ['cases', '/cases'],
  ['clients', '/clients'],
  ['tasks', '/tasks'],
  ['calendar', '/calendar'],
  ['documents', '/documents'],
  ['search', '/search?q=arbitration'],
  ['research', '/research'],
  ['drafts', '/drafts'],
  ['bundles', '/bundles'],
  ['community', '/community'],
  ['settings', '/settings/profile'],
];
const viewports = [
  { width: 1440, height: 900, suffix: '1440x900' },
  { width: 390, height: 844, suffix: '390x844' },
];

const browser = await chromium.launch({ headless: true });
const failures = [];
const pageErrors = [];
try {
  await mkdir(outDir, { recursive: true });
  const context = await browser.newContext({ viewport: viewports[0], timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error).split('\n')[0]));

  const ready = await page.request.get(`${webUrl}/readyz`);
  if (!ready.ok()) throw new Error(`${webUrl}/readyz returned ${ready.status()}`);
  const readiness = await ready.json();
  if (readiness.database !== 'ok' || readiness.objects !== 'ok') {
    throw new Error(`workspace dependencies are not ready: ${JSON.stringify(readiness)}`);
  }
  console.log(`edge: ${webUrl} ready (database=${readiness.database}, objects=${readiness.objects})`);

  const login = await page.request.post(`${webUrl}/api/v1/auth/login`, { data: { email, password } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  const token = (await login.json()).access_token;
  await page.addInitScript((value) => {
    localStorage.setItem('tantara_token', value);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, token);

  for (const [label, route] of pages) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(new URL(route, webUrl).toString(), { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status >= 400) {
        failures.push(`${route} ${viewport.suffix}: HTTP ${status}`);
        continue;
      }
      try {
        // The shell renders instantly; wait for the data queries to settle so a
        // screenshot proves the workspace really loaded, not just the layout.
        await page.waitForLoadState('networkidle', { timeout: 20_000 });
        await page.locator('.sidebar .nav a[href]').first().waitFor({ state: 'attached', timeout: 15_000 });
        await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 15_000 });
        await page.locator('main [class*="skeleton"]').first().waitFor({ state: 'detached', timeout: 20_000 });
      } catch {
        failures.push(`${route} ${viewport.suffix}: page frame did not settle`);
        continue;
      }
      const body = await page.locator('body').innerText();
      if (/Not Found|This page could not be found/i.test(body)) failures.push(`${route} ${viewport.suffix}: 404 page`);
      if (/Loading|could not load|Failed to load/i.test(body)) failures.push(`${route} ${viewport.suffix}: data still loading`);
      const file = path.join(outDir, `${label}-${viewport.suffix}.png`);
      await writeFile(file, await page.screenshot({ fullPage: false }));
      console.log(`ok   ${route.padEnd(24)} ${viewport.suffix}  ${path.relative(process.cwd(), file)}`);
    }
  }
} finally {
  await browser.close();
}

if (pageErrors.length) console.log(`page errors: ${[...new Set(pageErrors)].join(' | ')}`);
if (failures.length) {
  for (const failure of failures) console.log(`FAIL ${failure}`);
  throw new Error(`${failures.length} public smoke failures`);
}
console.log(`public smoke passed: ${pages.length * viewports.length} views, ${outDir}`);
