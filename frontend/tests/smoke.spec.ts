import { test, expect } from '@playwright/test';

test.setTimeout(90000);
const routes = [
  '/',
  '/dashboard',
  '/settings/profile',
  '/settings/workspace',
  '/settings/local-ai',
  '/settings/embeddings',
  '/settings/database',
  '/settings/data-import',
  '/settings/appearance',
  '/settings/security',
];
let authToken = '';
test.beforeEach(async ({ page, request }) => {
  const apiBase = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8010'}/api/v1`;
  const response = await request.post(`${apiBase}/auth/login`, {
    data: { email: 'advocate@tantara.local', password: 'tantara-local' },
  });
  expect(response.ok()).toBeTruthy();
  const { access_token: token } = await response.json();
  authToken = token;
  await page.addInitScript((value) => localStorage.setItem('tantara_token', value), token);
});

test('existing routes render without console or hydration errors and overflow', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const apiBase = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8010'}/api/v1`;
  const headers = { Authorization: `Bearer ${authToken}` };
  const [caseResponse, documentResponse] = await Promise.all([
    request.get(`${apiBase}/cases`, { headers }),
    request.get(`${apiBase}/documents`, { headers }),
  ]);
  const caseItems = (await caseResponse.json()).items;
  const documentItems = (await documentResponse.json()).items;
  const liveRoutes = [
    ...routes,
    ...(caseItems[0] ? [`/cases/${caseItems[0].id}`] : []),
    ...(documentItems[0] ? [`/documents/${documentItems[0].id}`] : []),
  ];
  for (const route of liveRoutes) {
    await page.goto(route);
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${route} horizontal overflow`,
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test('login form validates and submits with Enter', async ({ page }) => {
  await page.goto('/');
  const email = page.locator('#email');
  await expect(email).toHaveValue('advocate@tantara.local');
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await email.fill('invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill('x');
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'email-error');
  await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#password')).toHaveAttribute('aria-describedby', 'password-error');
  await email.fill('advocate@tantara.local');
  await page.getByRole('textbox', { name: 'Password' }).fill('tantara-local');
  await page.getByRole('button', { name: 'Continue as Advocate' }).click();
  await expect(page).toHaveURL(/dashboard/);
});

test('settings validation exposes errors and navigation marks current route', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('tantara_preview');
    localStorage.setItem('tantara_token', 'e2e-fixture-token');
  });
  await page.reload();
  await page.goto('/settings/profile');
  await expect(
    page.getByRole('navigation', { name: 'Settings navigation' }).getByText('Profile'),
  ).toBeVisible();
  const name = page.getByLabel('Name');
  await expect(name).toBeVisible();
  await name.fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAttribute('aria-describedby', 'name-error');
  await expect(page.locator('#name-error')).toBeVisible();
});

test('local AI status and guest mutation controls are accessible', async ({ page }) => {
  await page.goto('/settings/local-ai');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  await expect(page.getByText('Technical details')).toBeVisible();
  await expect(page.getByLabel('Base URL')).toHaveAttribute('aria-describedby', /base_url-help/);
  await page.evaluate(() => localStorage.setItem('tantara_preview', 'true'));
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Submit question' })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open global search' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open global search' })).toBeVisible();
  await expect(page.locator('.searchbox')).toBeHidden();
});

test('dashboard shows unavailable metrics as em dashes without dead actions', async ({ page }) => {
  await page.route('**/api/v1/dashboard/summary', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'offline', message: 'Unavailable' } }) }),
  );
  await page.goto('/dashboard');
  await expect(page.getByText('Backend not reachable at 127.0.0.1:8010')).toBeVisible();
  await expect(page.locator('.metric strong')).toHaveCount(4);
  await expect(page.locator('.metric strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.getByRole('button', { name: /coming soon/i })).toHaveCount(0);
  await expect(page.getByText('Additional workspace tools are not available yet.')).toBeVisible();
  await expect(page.getByText('Research Desk will be available in a later phase.')).toHaveCount(0);
});

for (const width of [360, 768, 1024, 1440]) {
  test(`responsive workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
