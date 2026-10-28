import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
const apiUrl = process.env.TANTARA_API_URL ?? 'http://127.0.0.1:8116/api/v1';
const apiHost = apiUrl.replace(/\/api\/v1\/?$/, '');
const endpoint = (route: string) => `${apiHost}${route.startsWith('/api/v1') ? route : `/api/v1${route.startsWith('/') ? route : `/${route}`}`}`;
const screenshots = path.resolve(process.cwd(), '../docs/screenshots');
const credentials = {
  advocate: { email: 'advocate@tantara.local', password: 'tantara-local' },
  researcher: { email: 'researcher@tantara.local', password: 'tantara-local' },
  staff: { email: 'staff@tantara.local', password: 'tantara-local' },
};
let api: APIRequestContext;
let token = '';
let researcherToken = '';
let staffToken = '';
let seededBundleId = '';
let seededCaseId = '';
let seededDocId = '';
let noEvidenceCaseId = '';
let workflowBundleId = '';
let originalAiSettings: Record<string, unknown> = {};

async function login(email: string, password: string) {
  const response = await api.post(endpoint('/auth/login'), { data: { email, password } });
  expect(response.status(), `login for ${email}`).toBe(200);
  return (await response.json()).access_token as string;
}

async function apiGet<T>(route: string, bearer = token): Promise<T> {
  const response = await api.get(endpoint(route), { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  expect(response.ok(), `GET ${route}: ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function authenticatePage(page: Page, bearer = token) {
  await page.addInitScript((value) => {
    localStorage.setItem('tantara_token', value);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, bearer);
}

async function assertAuthenticatedAndSettled(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe('/');
  await expect(page.getByText('Welcome to TANTARA')).toHaveCount(0);
  await expect(page.getByText(/Opening your workspace|Opening bundle|Loading bundles|Loading…|Loading\.\.\./)).toHaveCount(0);
}

async function capture(page: Page, filename: string) {
  await assertAuthenticatedAndSettled(page);
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, filename), fullPage: true, animations: 'disabled' });
}

async function openBundleList(page: Page, bearer = token) {
  await authenticatePage(page, bearer);
  await page.goto('/bundles');
  await expect(page.getByRole('heading', { name: 'Filing Bundles' })).toBeVisible();
  await assertAuthenticatedAndSettled(page);
}

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: apiHost });
  token = await login(credentials.advocate.email, credentials.advocate.password);
  researcherToken = await login(credentials.researcher.email, credentials.researcher.password);
  staffToken = await login(credentials.staff.email, credentials.staff.password);
  const bundles = await apiGet<{ items: Array<{ id: string; case_id: string; downloadable: boolean }> }>('/bundles?page_size=100');
  const readyBundle = bundles.items.find((item) => item.downloadable);
  expect(readyBundle, 'seed should include a generated filing bundle').toBeTruthy();
  seededBundleId = readyBundle!.id;
  seededCaseId = readyBundle!.case_id;
  const docs = await apiGet<{ items: Array<{ id: string; title: string; page_count: number; case_id: string }> }>(`/documents?case_id=${seededCaseId}&page_size=100`);
  expect(docs.items.length).toBeGreaterThan(0);
  seededDocId = docs.items[0].id;
  const caseRows = await apiGet<{ items: Array<{ id: string; title: string }> }>('/cases?page_size=100');
  for (const row of caseRows.items) {
    const caseDocs = await apiGet<{ total: number }>(`/documents?case_id=${row.id}&page_size=1`);
    if (caseDocs.total === 0) { noEvidenceCaseId = row.id; break; }
  }
  expect(noEvidenceCaseId, 'seed should include a case without indexed documents').toBeTruthy();
});

test.afterAll(async () => {
  if (originalAiSettings.base_url) {
    await api.patch(endpoint('/settings/ai'), { headers: { Authorization: `Bearer ${token}` }, data: originalAiSettings }).catch(() => undefined);
  }
  await api?.dispose();
});

test('bundle API validates request shape, owner scope, and page-range boundaries', async () => {
  const missingName = await api.post(endpoint('/bundles'), { headers: { Authorization: `Bearer ${token}` }, data: { case_id: seededCaseId } });
  expect(missingName.status()).toBe(422);
  const extraField = await api.post(endpoint('/bundles'), { headers: { Authorization: `Bearer ${token}` }, data: { name: 'Invalid bundle', case_id: seededCaseId, description: 'forbidden' } });
  expect(extraField.status()).toBe(422);
  expect((await api.get(endpoint(`/bundles/${seededBundleId}`))).status()).toBe(401);
  expect((await api.get(endpoint(`/bundles/${seededBundleId}`), { headers: { Authorization: `Bearer ${researcherToken}` } })).status()).toBe(404);

  const create = await api.post(endpoint('/bundles'), { headers: { Authorization: `Bearer ${token}` }, data: { name: `Range edge cases ${Date.now()}`, case_id: seededCaseId, settings: {} } });
  expect(create.status()).toBe(200);
  const id = (await create.json()).id as string;
  const empty = await apiGet<{ total_pages: number; sections: unknown[] }>(`/bundles/${id}/preview`);
  expect(empty.total_pages).toBe(4);
  expect(empty.sections).toEqual([]);

  const docs = await apiGet<{ items: Array<{ id: string; page_count: number }> }>(`/documents?case_id=${seededCaseId}&page_size=100`);
  const doc = docs.items.find((item) => item.page_count >= 2)!;
  const fullRange = await api.put(endpoint(`/bundles/${id}/items`), { headers: { Authorization: `Bearer ${token}` }, data: { items: [{ document_id: doc.id, section: 'Whole Document', order: 0, page_start: 1, page_end: doc.page_count }] } });
  expect(fullRange.status()).toBe(200);
  let mapping = await apiGet<{ total_pages: number; sections: Array<{ items: Array<{ page_start: number; page_end: number; start_page: number; end_page: number }> }> }>(`/bundles/${id}/preview`);
  expect(mapping.sections[0].items[0]).toMatchObject({ page_start: 1, page_end: doc.page_count, start_page: 5, end_page: 4 + doc.page_count });

  const firstPage = await api.put(endpoint(`/bundles/${id}/items`), { headers: { Authorization: `Bearer ${token}` }, data: { items: [{ document_id: doc.id, section: 'Page One', order: 0, page_start: 1, page_end: 1 }] } });
  expect(firstPage.status()).toBe(200);
  mapping = await apiGet(`/bundles/${id}/preview`);
  expect(mapping.sections[0].items[0]).toMatchObject({ page_start: 1, page_end: 1, start_page: 5, end_page: 5 });
  const invalidRange = await api.put(endpoint(`/bundles/${id}/items`), { headers: { Authorization: `Bearer ${token}` }, data: { items: [{ document_id: doc.id, section: 'Page One', order: 0, page_start: 1, page_end: doc.page_count + 1 }] } });
  expect(invalidRange.status()).toBe(400);
  const rangeError = await invalidRange.json();
  expect(rangeError.error?.message ?? rangeError.detail).toContain('outside the source document');
});

test('staff sees the real empty bundle state and module navigation is available on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBundleList(page, staffToken);
  await expect(page.getByText('No filing bundles yet')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Bundles' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Strategy' })).toBeVisible();
  await capture(page, 'bundles-1440x900-empty-real.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(drawer.getByRole('link', { name: 'Bundles' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Strategy' })).toBeVisible();
  await drawer.getByRole('link', { name: 'Strategy' }).click();
  await expect(page).toHaveURL(/\/strategy/);
  await expect(page.getByRole('heading', { name: 'AI Strategy Advisor' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('seeded bundle opens from its real API id, maps ranges, previews, and downloads a PDF', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await apiGet<{ name: string; status: string; downloadable: boolean; download_url: string }>(`/bundles/${seededBundleId}`);
  expect(seeded.status).toBe('ready');
  expect(seeded.downloadable).toBeTruthy();
  await authenticatePage(page);
  await page.goto(`/bundles/${seededBundleId}`);
  await expect(page.getByRole('heading', { name: seeded.name })).toBeVisible();
  await expect(page.getByText(/Source pages 1–5/).first()).toBeVisible();
  await expect(page.getByText(/bundle pages/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' }).first()).toBeEnabled();
  await capture(page, 'bundle-1440x900-preview-real.png');
  await page.getByRole('button', { name: 'Preview PDF' }).click();
  await expect(page.getByTitle('Generated merged filing PDF')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).first().click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const buffers: Buffer[] = [];
  for await (const chunk of stream!) buffers.push(Buffer.from(chunk));
  expect(Buffer.concat(buffers).subarray(0, 5).toString()).toBe('%PDF-');
  const direct = await api.get(endpoint(seeded.download_url), { headers: { Authorization: `Bearer ${token}` } });
  expect(direct.status()).toBe(200);
  expect((await direct.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('builder saves a chosen range, maps source pages to bundle pages, and generates a ready bundle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBundleList(page);
  await page.getByRole('button', { name: 'New bundle' }).click();
  workflowBundleId = `bundle-workflow-${Date.now()}`;
  await page.getByLabel('Bundle name').fill(workflowBundleId);
  await page.getByLabel('Case').selectOption(seededCaseId);
  await page.getByRole('button', { name: 'Create bundle' }).click();
  await expect(page).toHaveURL(/\/bundles\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name: workflowBundleId })).toBeVisible();

  const scanned = await apiGet<{ items: Array<{ id: string; title: string }> }>(`/documents?case_id=${seededCaseId}&page_size=100`);
  const chosen = scanned.items.find((doc) => doc.title === 'Scanned Arbitration Agreement')!;
  await page.getByLabel('Add a case document').selectOption(chosen.id);
  await page.getByLabel('Source page from').fill('2');
  await page.getByLabel('Through page').fill('4');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByText('Source pages 2–4')).toBeVisible();
  await expect(page.getByText(/2–4/).first()).toBeVisible();
  await capture(page, 'bundle-1440x900-builder-range-real.png');

  await page.getByRole('button', { name: 'Generate Bundle' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /Bundle ready/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('ready', { exact: true }).first()).toBeVisible();
  const mapping = await apiGet<{ sections: Array<{ items: Array<{ document_id: string; page_start: number; page_end: number; start_page: number; end_page: number }> }> }>(`/bundles/${new URL(page.url()).pathname.split('/').pop()}/preview`);
  const item = mapping.sections.flatMap((section) => section.items).find((entry) => entry.document_id === chosen.id)!;
  expect(item).toMatchObject({ page_start: 2, page_end: 4, start_page: 5, end_page: 7 });
  await capture(page, 'bundle-1440x900-generated-real.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: workflowBundleId })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await capture(page, 'bundle-390x844-generated-real.png');
});

test('page-range 400 is shown and duplicate documents are unavailable for selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await authenticatePage(page);
  await page.goto(`/bundles/${workflowBundleId}`);
  await expect(page.getByText('Source pages 2–4')).toBeVisible();
  await expect(page.locator('#bundle-add-document option').filter({ hasText: 'Scanned Arbitration Agreement' })).toHaveCount(0);
  await expect(page.getByText(/can appear once per bundle/)).toBeVisible();
  await capture(page, 'bundle-1440x900-duplicate-guard-real.png');
  await page.getByLabel('Source page end for Scanned Arbitration Agreement').fill('99');
  await page.getByRole('button', { name: 'Save contents and refresh page ranges' }).click();
  await expect(page.getByRole('alert')).toContainText('Bundle item page range is outside the source document');
  await capture(page, 'bundle-1440x900-range-error-real.png');
});

test('strategy shows source excerpts honestly, saves edits, creates a task, and opens a prefilled research question', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = await apiGet<Record<string, unknown>>('/settings/ai');
  originalAiSettings = { base_url: settings.base_url, model: settings.model, top_k: settings.top_k, temperature: settings.temperature };
  const dead = await api.patch(endpoint('/settings/ai'), { headers: { Authorization: `Bearer ${token}` }, data: { ...originalAiSettings, base_url: 'http://127.0.0.1:59999/v1' } });
  expect(dead.status()).toBe(200);

  await authenticatePage(page);
  await page.goto(`/cases/${seededCaseId}/strategy`);
  await expect(page.getByRole('heading', { name: 'AI Strategy Advisor' })).toBeVisible();
  await expect(page.getByLabel('Select case for analysis')).toHaveValue(seededCaseId);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('Source excerpts assembled without a language model')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Model unavailable · source excerpts only')).toBeVisible();
  await expect(page.locator('.strategy-citation').first()).toContainText('p.');
  await capture(page, 'strategy-1440x900-model-unavailable-real.png');
  await capture(page, 'strategy-1440x900-template-source-excerpts-real.png');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ['Case Theory', 'Key Issues', 'Legal Arguments', 'Anticipated Counterarguments', 'Evidence Gaps', 'Strategy Plan']) {
    const tab = page.getByRole('button', { name: label, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, 'strategy-390x844-mobile-tabs-real.png');

  await page.getByRole('button', { name: 'Legal Arguments' }).click();
  const argument = page.getByLabel('Legal Arguments note 1');
  await argument.fill(`${await argument.inputValue()} Lawyer review note.`);
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByText(/Version saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AI Strategy Advisor' })).toBeVisible();
  await page.getByRole('button', { name: 'Legal Arguments' }).click();
  await expect(page.getByLabel('Legal Arguments note 1')).toContainText('Lawyer review note.');
  await capture(page, 'strategy-1440x900-notes-saved-real.png');

  await page.getByRole('button', { name: 'Create research task' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Task created:' })).toBeVisible();
  const tasks = await apiGet<{ items: Array<{ title: string; case_id: string }> }>(`/tasks?case_id=${seededCaseId}&page_size=100`);
  expect(tasks.items.some((task) => task.title === 'Review AI Strategy Advisor evidence gaps' && task.case_id === seededCaseId)).toBeTruthy();
  await capture(page, 'strategy-1440x900-task-created-real.png');

  await page.getByRole('link', { name: 'Create follow-up question' }).click();
  await expect(page).toHaveURL(/\/research\?/);
  await expect(page.getByLabel('Follow-up question')).toHaveValue(/Follow up on strategy evidence for/);
  await capture(page, 'research-followup-1440x900-prefilled-real.png');
});

test('case without indexed evidence shows an explicit empty strategy state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await authenticatePage(page);
  await page.goto(`/cases/${noEvidenceCaseId}/strategy`);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('No indexed evidence is available for this case.', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('No strategy was generated. Add and index case documents, then try again.')).toBeVisible();
  await capture(page, 'strategy-1440x900-no-evidence-real.png');
});

test('desktop navigation marks active bundles and strategy routes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBundleList(page);
  const bundlesLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Bundles' });
  await expect(bundlesLink).toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Strategy' }).click();
  await expect(page).toHaveURL(/\/strategy/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Strategy' })).toHaveAttribute('aria-current', 'page');
});
