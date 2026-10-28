import { expect, request, test, type Page } from '@playwright/test';

const apiOrigin = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8115').replace(/\/$/, '');
const shots = '../docs/screenshots';

async function authenticate(page: Page) {
  const api = await request.newContext();
  const response = await api.post(`${apiOrigin}/api/v1/auth/login`, { data: { email: 'advocate@tantara.local', password: 'tantara-local' } });
  expect(response.status()).toBe(200);
  const token = (await response.json()).access_token as string;
  await page.addInitScript(value => localStorage.setItem('tantara_token', value), token);
  await api.dispose();
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true });
}

test('capture honest model-unavailable state with editable review skeleton', async ({ page }) => {
  test.setTimeout(120_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/drafts');
  const caseSelect = page.locator('#case');
  await expect(caseSelect).toBeVisible();
  await caseSelect.selectOption({ label: 'ABC Pvt. Ltd. vs. XYZ Ltd.' });
  await expect(page.locator('.draft-source input').first()).toBeVisible();
  await page.locator('.draft-source input').first().check();
  await page.getByRole('button', { name: 'Generate Draft' }).click();
  await expect(page.getByRole('status')).toContainText('local model is unavailable', { timeout: 30_000 });
  await expect(page.locator('.draft-editor')).toContainText('[REVIEW:');
  await expect(page.locator('.draft-editor')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Retry generation' })).toBeVisible();
  await expect(page.locator('[aria-busy="true"], .skeleton, [class*="skeleton"]')).toHaveCount(0);
  await capture(page, `${shots}/draft-model-unavailable-desktop-1440-dead-port-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/draft-model-unavailable-mobile-390-dead-port-fixture.png`);
});
