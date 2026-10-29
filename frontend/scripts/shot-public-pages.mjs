// Capture the public front door on the deployed workspace and assert it behaves.
//
//   cd frontend
//   TANTARA_WEB_URL=https://tantra.theessencetimes.com node scripts/shot-public-pages.mjs
//
// For every route, at desktop and at phone width: one screenshot, one
// no-horizontal-overflow assertion, and a tally of console/page errors. The
// 3D hero is the thing most likely to throw, so errors are reported per route
// rather than in aggregate. Nothing here signs in — these pages must be public.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

const webUrl = (process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const shotDir = path.resolve(process.env.TANTARA_SHOT_DIR ?? '../reports/public');
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/signin', '/signup'];
const passes = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

await mkdir(shotDir, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const route of routes) {
  for (const { name, viewport } of passes) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
    const response = await page.goto(`${webUrl}${route}`, { waitUntil: 'load', timeout: 45_000 });
    // Let the 3D scene mount and any entrance animation settle before capturing.
    await page.waitForTimeout(2500);
    const slug = route === '/' ? 'home' : route.slice(1);
    const file = `${slug}-${name}.png`;
    await page.screenshot({ path: path.join(shotDir, file), fullPage: true });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      headings: [...document.querySelectorAll('h1,h2')].length,
      canvas: document.querySelectorAll('canvas').length,
      signUpLinks: [...document.querySelectorAll('a[href="/signup"]')].length,
      signInLinks: [...document.querySelectorAll('a[href="/signin"]')].length,
    }));
    // Prove the hero is a live render, not a picture: two captures of the scene
    // element 1.2s apart must differ when animation is allowed to run.
    let animates = null;
    if (metrics.canvas > 0) {
      const scene = page.locator('.landing-scene');
      if (await scene.count()) {
        const a = await scene.screenshot();
        await writeFile(path.join(shotDir, `scene-${name}.png`), a);
        await page.waitForTimeout(1200);
        const b = await scene.screenshot();
        animates = sha(a) !== sha(b);
      }
    }
    results.push({
      route,
      name,
      status: response?.status() ?? 0,
      overflow: metrics.scrollWidth > metrics.innerWidth + 1,
      scrollWidth: metrics.scrollWidth,
      innerWidth: metrics.innerWidth,
      canvas: metrics.canvas,
      animates,
      headings: metrics.headings,
      toSignup: metrics.signUpLinks,
      toSignin: metrics.signInLinks,
      file,
      errors,
    });
    await context.close();
  }
}

// prefers-reduced-motion: the scene must render one frame and then hold still.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
  await page.goto(`${webUrl}/`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(2500);
  const scene = page.locator('.landing-scene');
  let animates = null;
  if (await scene.count()) {
    const a = await scene.screenshot();
    await page.waitForTimeout(1200);
    const b = await scene.screenshot();
    animates = sha(a) !== sha(b);
  }
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    canvas: document.querySelectorAll('canvas').length,
    headings: [...document.querySelectorAll('h1,h2')].length,
    signUpLinks: [...document.querySelectorAll('a[href="/signup"]')].length,
    signInLinks: [...document.querySelectorAll('a[href="/signin"]')].length,
  }));
  await page.screenshot({ path: path.join(shotDir, 'home-reduced-motion.png'), fullPage: true });
  results.push({
    route: '/',
    name: 'reduced-motion',
    status: 200,
    overflow: metrics.scrollWidth > metrics.innerWidth + 1,
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
    canvas: metrics.canvas,
    animates,
    headings: metrics.headings,
    toSignup: metrics.signUpLinks,
    toSignin: metrics.signInLinks,
    file: 'home-reduced-motion.png',
    errors,
  });
  await context.close();
}

// A logged-out visitor must not be able to read workspace data.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${webUrl}/dashboard`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(2500);
  const finalUrl = page.url();
  const leaked = await page.evaluate(
    () => document.querySelectorAll('aside nav a, .workspace-shell').length,
  );
  await page.screenshot({ path: path.join(shotDir, 'dashboard-logged-out.png'), fullPage: true });
  results.push({
    route: '/dashboard',
    name: 'logged-out',
    status: 0,
    overflow: false,
    canvas: 0,
    headings: 0,
    toSignup: 0,
    toSignin: 0,
    file: 'dashboard-logged-out.png',
    finalUrl,
    leakedShell: leaked,
    errors: [],
  });
  await context.close();
}
await browser.close();

let failed = 0;
for (const r of results) {
  const problems = [...r.errors];
  if (r.overflow) problems.push(`horizontal overflow ${r.scrollWidth} > ${r.innerWidth}`);
  if (r.canvas > 0 && r.name !== 'reduced-motion' && r.animates === false) {
    problems.push('hero scene identical across 1.2s — not animating');
  }
  if (r.name === 'reduced-motion' && r.animates === true) {
    problems.push('hero scene changed despite prefers-reduced-motion');
  }
  if (r.leakedShell) problems.push(`workspace shell visible without a token (${r.leakedShell} nodes)`);
  if (r.finalUrl && new URL(r.finalUrl).pathname.startsWith('/dashboard')) {
    problems.push(`token-less visitor parked on ${new URL(r.finalUrl).pathname} — no redirect`);
  }
  if (problems.length) failed++;
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '} ${r.route.padEnd(11)} ${r.name.padEnd(10)} ` +
      `http=${String(r.status).padEnd(4)} canvas=${r.canvas} anim=${String(r.animates).padEnd(5)} h=${r.headings} ` +
      `→/signup=${r.toSignup} →/signin=${r.toSignin} ${r.file}`,
  );
  for (const p of problems) console.log(`       ${p}`);
}
console.log(`\n${results.length - failed}/${results.length} captures clean · shots in ${shotDir}`);
process.exit(failed ? 1 : 0);
