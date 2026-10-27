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

async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.skeleton, [class*="skeleton"]')).toHaveCount(0);
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true });
}

test('capture real drafts and autofill review states at desktop and mobile sizes', async ({ page }) => {
  test.setTimeout(180_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { name: 'Recent drafts' })).toBeVisible();
  await settled(page);
  await capture(page, `${shots}/drafts-list-desktop-1440-seeded-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/drafts-list-mobile-390-seeded-fixture.png`);

  const api = await request.newContext();
  const login = await api.post(`${apiOrigin}/api/v1/auth/login`, { data: { email: 'advocate@tantara.local', password: 'tantara-local' } });
  const token = (await login.json()).access_token as string;
  const list = await api.get(`${apiOrigin}/api/v1/drafts?page=1&page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
  const drafts = (await list.json()).items as Array<Record<string, any>>;
  const generated = drafts.find(d => d.id === 'b9db7237-3aa9-4d11-83e7-b5302357fb19');
  expect(generated?.content_markdown).toContain('ZXQORBITKEY');
  expect(generated?.content_markdown).toContain('[REVIEW:');
  const historyResponse = await api.get(`${apiOrigin}/api/v1/drafts/${generated?.id}/versions`, { headers: { Authorization: `Bearer ${token}` } });
  const initialVersion = ((await historyResponse.json()).items as Array<Record<string, any>>).find(v => v.version_number === 1);
  expect(initialVersion?.content_markdown).toContain('ZXQORBITKEY');
  await api.post(`${apiOrigin}/api/v1/drafts/${generated?.id}/versions`, { headers: { Authorization: `Bearer ${token}` }, data: { content_markdown: initialVersion?.content_markdown, change_note: 'Restore grounded model output for visual review' } });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/drafts?id=${generated?.id}`);
  await expect(page.locator('.draft-editor')).toContainText('ZXQORBITKEY');
  await expect(page.locator('.draft-editor')).toContainText('ABC Pvt. Ltd.');
  await expect(page.locator('.draft-citation a').first()).toContainText('Unique Term Evidence');
  await settled(page);
  await capture(page, `${shots}/draft-editor-desktop-1440-model-grounded-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/draft-editor-mobile-390-model-grounded-fixture.png`);

  await page.setViewportSize({ width: 1440, height: 1100 });
  const editor = page.locator('.draft-editor');
  const startingVersions = await page.getByRole('button', { name: 'Restore' }).count();
  await editor.evaluate(el=>{const node=el as HTMLElement;node.textContent=`${node.innerText}\n\nCounsel review note: confirm the evidence and relief.`;node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Counsel review note'}));});
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText(/Version \d+ saved\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(startingVersions+1);
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByText(/restored as a new version/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(startingVersions+2);
  await settled(page);
  await capture(page, `${shots}/draft-version-history-desktop-1440-restored-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/draft-version-history-mobile-390-restored-fixture.png`);

  const cases = await api.get(`${apiOrigin}/api/v1/cases?page=1&page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
  const caseRow = ((await cases.json()).items as Array<Record<string, any>>).find(c => c.title === 'ABC Pvt. Ltd. vs. XYZ Ltd.');
  expect(caseRow).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/autofill');
  await page.locator('#autofill-case').selectOption(caseRow!.id);
  await expect(page.getByRole('status')).toContainText('no model suggestion route');
  await page.getByRole('button', { name: 'Preview fields' }).click();
  await expect(page.getByRole('status')).toContainText('Preview loaded');
  await expect(page.locator('.auto-provenance').first()).toBeVisible();
  await expect(page.getByText('Confidence —').first()).toBeVisible();
  await settled(page);
  await capture(page, `${shots}/autofill-preview-desktop-1440-record-based-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/autofill-preview-mobile-390-record-based-fixture.png`);

  await page.setViewportSize({ width: 1440, height: 1100 });
  const selectedDraftId = await page.locator('#autofill-draft').inputValue();
  expect(selectedDraftId).toBeTruthy();
  for (const button of await page.getByRole('button', { name: 'Accept', exact: true }).all()) await button.click();
  await page.getByRole('button', { name: 'Apply to Draft' }).click();
  await expect(page.getByRole('status')).toContainText('Applied');
  const appliedDraft = await api.get(`${apiOrigin}/api/v1/drafts/${selectedDraftId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await appliedDraft.json()).content_markdown).toContain('## Accepted case details (autofill)');
  await settled(page);
  await capture(page, `${shots}/autofill-applied-desktop-1440-confirmed-fixture.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, `${shots}/autofill-applied-mobile-390-confirmed-fixture.png`);
  await api.dispose();
});
