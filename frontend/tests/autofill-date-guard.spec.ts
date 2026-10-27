import { expect, request, test } from '@playwright/test';

test('a statute year is never written into a date field', async ({ page }) => {
  let applied: { fields: Array<{ key: string; value: string }> } | undefined;
  let draftWrite: { content_markdown: string } | undefined;
  const api = await request.newContext();
  const login = await api.post(`${(process.env.NEXT_PUBLIC_API_BASE_URL??'http://127.0.0.1:8115').replace(/\/$/,'')}/api/v1/auth/login`, { data: { email: 'advocate@tantara.local', password: 'tantara-local' } });
  const token = (await login.json()).access_token as string;
  await page.addInitScript(value => localStorage.setItem('tantara_token', value), token);
  await api.dispose();
  await page.route('**/api/v1/cases?page=1&page_size=100', route => route.fulfill({ json: { items: [{ id: 'case-1', title: 'Fixture Case' }] } }));
  await page.route('**/api/v1/drafts?page=1&page_size=100', route => route.fulfill({ json: { items: [{ id: 'draft-1', case_id: 'case-1', title: 'Fixture Draft' }] } }));
  await page.route('**/api/v1/drafts/draft-1', route => route.fulfill({ json: { id: 'draft-1', case_id: 'case-1', content_markdown: '# Existing draft' } }));
  await page.route('**/api/v1/drafts/draft-1/versions', async route => {
    draftWrite = route.request().postDataJSON();
    await route.fulfill({ json: { id: 'version-2', version_number: 2 } });
  });
  await page.route('**/api/v1/cases/case-1/autofill', route => route.fulfill({ json: { fields: [{ key: 'contract_date', value: '1996', provenance: 'unverified AI suggestion', confidence: 0.31 }] } }));
  await page.route('**/api/v1/cases/case-1/autofill/preview', route => route.fulfill({ json: { fields: [{ key: 'contract_date', value: '1996', provenance: 'ai_suggested', confidence: 0.31 }] } }));
  await page.route('**/api/v1/cases/case-1/autofill/apply', async route => {
    applied = route.request().postDataJSON();
    await route.fulfill({ json: { status: 'ok' } });
  });
  await page.goto('/autofill');
  const selector = page.locator('#autofill-case');
  await expect(selector).toBeVisible();
  await selector.selectOption('case-1');
  const date = page.locator('#field-contract_date');
  await expect(date).toBeVisible();
  await expect(date).toHaveValue('');
  await expect(page.getByText(/year alone or invalid calendar date/i)).toBeVisible();
  await page.getByRole('button', { name: 'Preview fields' }).click();
  await expect(page.getByText(/Preview loaded/i)).toBeVisible();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to Draft' }).click();
  await expect(page.locator('.auto-error')).toContainText('Accept at least one field');
  expect(applied).toBeUndefined();
  expect(draftWrite).toBeUndefined();
});
