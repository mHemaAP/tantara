// Prove the self-service account flow works on the deployed workspace, end to end.
//
//   cd frontend
//   TANTARA_WEB_URL=https://tantra.theessencetimes.com node scripts/probe-signup-live.mjs
//
// It registers a throwaway address on a non-deliverable domain (RFC 2606 .invalid),
// so no probe account can ever receive mail. Three things must be true:
//   1. POST /auth/register returns a token that authenticates at /auth/me
//   2. a duplicate registration is refused with 409 / code "duplicate"
//   3. the /signup form in a real browser creates the account and lands in the workspace
// Exit code 0 only when all three hold.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const shotDir = path.resolve('../reports/public');
await mkdir(shotDir, { recursive: true });

const webUrl = (process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const apiBase = process.env.TANTARA_API_ORIGIN ?? webUrl;
const email = `tantara-probe-${Date.now()}@example.invalid`;
const password = 'Probe-Check-2026!';

const problems = [];
const note = (line) => console.log(line);

// 1 + 2: the API contract, against the deployed backend.
const created = await fetch(`${apiBase}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '  Probe   Account  ', email, password }),
});
const payload = await created.json().catch(() => ({}));
note(`POST /auth/register → ${created.status} role=${payload?.user?.role} initials=${payload?.user?.avatar_initials} name="${payload?.user?.name}"`);
if (created.status !== 200 || !payload?.access_token) problems.push('registration did not return a token');
if (payload?.user?.role !== 'advocate') problems.push(`new account role is ${payload?.user?.role}, expected advocate`);
if (payload?.user?.name !== 'Probe Account') problems.push(`name not normalized: "${payload?.user?.name}"`);
if (payload?.user?.initials === undefined && payload?.user?.avatar_initials !== 'PA')
  problems.push(`unexpected initials: ${payload?.user?.avatar_initials}`);

const me = await fetch(`${apiBase}/api/v1/auth/me`, {
  headers: { Authorization: `Bearer ${payload?.access_token ?? ''}` },
});
note(`GET /auth/me with that token → ${me.status}`);
if (me.status !== 200) problems.push('the registration token does not authenticate at /auth/me');
const identity = await me.json().catch(() => ({}));
if (identity?.email !== email.toLowerCase()) problems.push(`token belongs to ${identity?.email}`);

const escalation = await fetch(`${apiBase}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Wannabe Admin', email: `probe-role-${Date.now()}@example.invalid`, password, role: 'admin' }),
});
const escalated = await escalation.json().catch(() => ({}));
note(`POST /auth/register with "role": "admin" → ${escalation.status} role=${escalated?.user?.role}`);
if (escalated?.user?.role === 'admin') problems.push('privilege escalation succeeded');

const duplicate = await fetch(`${apiBase}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Duplicate Probe', email: email.toUpperCase(), password }),
});
const dup = await duplicate.json().catch(() => ({}));
note(`POST /auth/register duplicate (different case) → ${duplicate.status} code=${dup?.error?.code}`);
if (duplicate.status !== 409 || dup?.error?.code !== 'duplicate')
  problems.push(`duplicate email not refused properly: ${duplicate.status} ${JSON.stringify(dup)}`);

// 3: the browser form on the deployed frontend.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 160)}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
const browserEmail = `tantara-form-${Date.now()}@example.invalid`;
await page.goto(`${webUrl}/signup`, { waitUntil: 'load', timeout: 45_000 });
await page.fill('#signup-name', 'Form Probe');
await page.fill('#signup-email', browserEmail);
await page.fill('#signup-password', password);
await page.fill('#signup-confirm-password', 'mismatch-on-purpose');
await page.getByRole('button', { name: /Create account/ }).click();
const mismatch = await page.locator('#signup-confirm-password-error').textContent().catch(() => null);
note(`mismatched passwords → "${String(mismatch).trim()}"`);
if (!mismatch || !/do not match/i.test(mismatch)) problems.push('password confirmation not enforced in the form');

await page.fill('#signup-confirm-password', password);
await page.getByRole('button', { name: /Create account/ }).click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => {});
note(`form submit → ${page.url().replace(/^https?:\/\/[^/]+/, '')}`);
if (!/\/dashboard/.test(page.url())) problems.push('the signup form did not sign the new account in');
const shellText = await page.locator('.workspace, aside nav').first().textContent().catch(() => '');
if (!shellText) problems.push('workspace shell did not render after signup');
await page.screenshot({ path: path.join(shotDir, 'signup-after-form.png') });
await context.close();
await browser.close();
if (errors.length) problems.push(...errors);

note('');
for (const p of problems) note(`FAIL ${p}`);
note(problems.length ? `${problems.length} problem(s) — probe account ${email}` : `signup flow verified on ${webUrl} (probe ${email})`);
process.exit(problems.length ? 1 : 0);
