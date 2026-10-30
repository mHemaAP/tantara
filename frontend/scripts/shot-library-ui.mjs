#!/usr/bin/env node
/*
 * Capture the law-library rule as a visitor sees it: an account that owns nothing still
 * reads the shared corpus, is told it is read-only, and gets cited answers from it.
 *
 *   TANTARA_BASE=https://tantra.theessencetimes.com node scripts/shot-library-ui.mjs
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = (process.env.TANTARA_BASE || 'https://tantra.theessencetimes.com').replace(/\/$/, '');
const outDir = process.env.OUT_DIR || '../reports/library';
const email = `tantara-ui-${Date.now()}@example.invalid`;
const password = 'Tantra-Library-Probe-2026!';
const out = await mkdir(outDir, { recursive: true }).then(() => outDir);

const browser = await chromium.launch();
const errors = [];

async function pageFor(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('console', (message) => message.type() === 'error' && errors.push(`console: ${message.text()}`));
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  return { context, page };
}

async function signUp(page) {
  await page.goto(`${base}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('#signup-name', 'Library Reader');
  await page.fill('#signup-email', email);
  await page.fill('#signup-password', password);
  await page.fill('#signup-confirm-password', password);
  await page.click('form button.primary');
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
}

const { page } = await pageFor(1440, 900);
await signUp(page);

await page.goto(`${base}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.document-library-badge:visible', { timeout: 30000 });
const badges = await page.locator('.document-library-badge').count();
await page.screenshot({ path: `${out}/documents-with-library.png`, fullPage: false });

const scope = page.getByLabel('Document scope');
await scope.selectOption('library');
await page.waitForTimeout(1200);
const libraryOnly = await page.locator('.document-row, .document-card').count();
await page.screenshot({ path: `${out}/library-scope.png` });

const overflowDesktop = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);

await page.goto(`${base}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.document-library-badge:visible', { timeout: 30000 });
// This account owns nothing, so every row here is a shared library document.
await page.locator('a[aria-label^="Open "]').first().click();
await page.waitForURL(/\/documents\/[0-9a-f-]+/, { timeout: 30000 });
await page.waitForSelector('.document-library-note', { timeout: 30000 });
await page.waitForLoadState('networkidle');
const readOnlyNote = await page.locator('.document-library-note').count();
const rowActions = await page.locator('button[aria-label^="Delete"]:visible').count();
await page.screenshot({ path: `${out}/document-read-only.png` });

await page.goto(`${base}/research`, { waitUntil: 'domcontentloaded' });
await page.fill('textarea, input[name="question"], .research-input', 'Relief options');
await page.keyboard.press('Enter');
await page.waitForSelector('.citation-library-badge', { timeout: 90000 });
await page.screenshot({ path: `${out}/research-from-library.png` });
const citations = await page.locator('.citation-library-badge').count();

// Same authenticated session, phone viewport: the rule must hold at every width.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/documents`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.document-library-badge:visible', { timeout: 30000 });
const mobileBadges = await page.locator('.document-library-badge:visible').count();
const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
await page.screenshot({ path: `${out}/documents-mobile.png` });

console.log(`account: ${email}`);
console.log(`library badges on first page: ${badges}; library-scope rows: ${libraryOnly}; mobile badges: ${mobileBadges}`);
console.log(`read-only note on document page: ${readOnlyNote}; delete controls visible: ${rowActions}`);
console.log(`library citation badges on research answer: ${citations}`);
console.log(`horizontal overflow: desktop=${overflowDesktop} mobile=${mobileOverflow}`);
console.log(`console/page errors: ${errors.length}`);
errors.slice(0, 5).forEach((error) => console.log(`  ${error}`));
await browser.close();
process.exit(errors.length || overflowDesktop || mobileOverflow || readOnlyNote < 1 ? 1 : 0);
