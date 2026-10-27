import { installApiFixtures } from '../tests/api-fixtures.mjs';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const base = 'http://127.0.0.1:3010';
const args = process.argv.slice(2);
const val = (key, fallback) => args.find((x) => x.startsWith(`${key}=`))?.split('=')[1] ?? fallback;
const routes = val('--routes', '/,/dashboard,/settings/local-ai').split(',');
const [width, height] = val('--viewport', '1440x900').split('x').map(Number);
let child;
try {
  await fetch(base, { signal: AbortSignal.timeout(800) });
} catch {
  child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-H', '127.0.0.1', '-p', '3010'],
    { stdio: 'inherit' },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base, { signal: AbortSignal.timeout(400) });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error('Next dev server failed to start on 127.0.0.1:3010');
}

await mkdir('../docs/screenshots', { recursive: true });
let realToken = null;
try {
  const auth = await fetch('http://127.0.0.1:8010/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'advocate@tantara.local', password: 'tantara-local' }),
    signal: AbortSignal.timeout(1500),
  });
  if (auth.ok) realToken = (await auth.json()).access_token;
  if (realToken) {
    const cors = await fetch('http://127.0.0.1:8010/api/v1/auth/me', {
      method: 'OPTIONS',
      headers: {
        Origin: base,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
      signal: AbortSignal.timeout(1500),
    });
    if (!cors.headers.get('access-control-allow-origin')) realToken = null;
  }
} catch {
  /* contract fixtures below keep screenshot review deterministic offline */
}

const browser = await chromium.launch({
  headless: true,
  args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
});
const errors = [];
try {
  for (const route of routes) {
    for (const mode of ['desktop', 'mobile']) {
      const mobile = mode === 'mobile';
      const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width, height },
        deviceScaleFactor: mobile ? 1 : 2,
        isMobile: mobile,
      });
      const page = await context.newPage();
      if (!realToken) await installApiFixtures(page);
      await page.addInitScript((token) => {
        localStorage.setItem('tantara_token', token);
        document.cookie = `tantara_token=${token}; Path=/; SameSite=Lax`;
        localStorage.removeItem('tantara_preview');
      }, realToken ?? 'e2e-fixture-token');
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`${route}/${mode}: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`${route}/${mode}: ${error.message}`));
      const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
      if (!response?.ok()) throw new Error(`Login page: HTTP ${response?.status()}`);
      if (route === '/dashboard') {
        try {
          await page.locator('.metric strong').first().getByText('12').waitFor({ state: 'visible' });
        } catch (error) {
          throw new Error(
            `Dashboard did not load in ${mode}: ${page.url()} ${(await page.locator('body').innerText()).slice(0, 800)}; console errors: ${errors.join(' | ')}; ${error}`,
          );
        }
      }
      if (route === '/settings/local-ai')
        await page.getByRole('button', { name: 'Test connection' }).waitFor({ state: 'visible' });
      const slug = route === '/' ? 'home' : route.replace(/^\//, '').replaceAll('/', '-');
      await page.screenshot({ path: `../docs/screenshots/${slug}-${mode}.png`, fullPage: true });
      await context.close();
    }
  }

  const stateContext = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const statePage = await stateContext.newPage();
  await installApiFixtures(statePage);
  await statePage.addInitScript(() => {
    localStorage.setItem('tantara_token', 'e2e-fixture-token');
    document.cookie = 'tantara_token=e2e-fixture-token; Path=/; SameSite=Lax';
    localStorage.removeItem('tantara_preview');
  });
  statePage.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) {
      errors.push(`state capture: ${message.text()}`);
    }
  });
  statePage.on('pageerror', (error) => errors.push(`state capture: ${error.message}`));

  await statePage.goto(`${base}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
  await statePage.locator('.metric strong').first().getByText('12').waitFor({ state: 'visible' });
  let focusedSearch = false;
  for (let i = 0; i < 30; i++) {
    await statePage.keyboard.press('Tab');
    focusedSearch = await statePage.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Open global search',
    );
    if (focusedSearch) break;
  }
  if (!focusedSearch) throw new Error('Could not keyboard-tab to the global search button');
  await statePage.screenshot({ path: '../docs/screenshots/states-focus-desktop.png', fullPage: true });

  let focusedAsk = false;
  for (let i = 0; i < 35; i++) {
    await statePage.keyboard.press('Tab');
    focusedAsk = await statePage.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Ask an arbitration law question',
    );
    if (focusedAsk) break;
  }
  if (!focusedAsk) throw new Error('Could not keyboard-tab to the Ask TANTARA input');
  await statePage.screenshot({ path: '../docs/screenshots/states-ai-input-focus-desktop.png', fullPage: true });

  await statePage.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await statePage.locator('#email').fill('invalid-email');
  await statePage.locator('#password').fill('x');
  await statePage.getByRole('button', { name: 'Continue as Advocate' }).click();
  await statePage.getByText('Enter a valid email address').waitFor({ state: 'visible' });
  await statePage.getByText('Password must be at least 8 characters').waitFor({ state: 'visible' });
  await statePage.screenshot({ path: '../docs/screenshots/states-validation-desktop.png', fullPage: true });

  let unavailable = true;
  await statePage.route('**/api/v1/dashboard/summary', async (route) => {
    if (unavailable) await route.abort();
    else await route.fallback();
  });
  await statePage.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await statePage.getByText('Backend not reachable at 127.0.0.1:8010').waitFor({ state: 'visible' });
  await statePage.locator('.offline details').first().click();
  await statePage.screenshot({ path: '../docs/screenshots/states-offline-desktop.png', fullPage: true });
  unavailable = false;
  await statePage.getByRole('button', { name: 'Retry' }).click();
  await statePage.locator('.metric strong').first().getByText('12').waitFor({ state: 'visible' });
  await statePage.screenshot({ path: '../docs/screenshots/states-offline-recovered-desktop.png', fullPage: true });
  await stateContext.close();

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log(
    `Captured ${routes.length * 2 + 5} screenshots (${routes.length} routes, desktop and mobile, plus five UI states including recovery). API mode: ${realToken ? 'backend' : 'test fixtures'}.`,
  );
} finally {
  await browser.close();
  child?.kill('SIGTERM');
}
