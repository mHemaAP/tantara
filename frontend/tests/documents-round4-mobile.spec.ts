import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiUrl = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8113'}/api/v1`;
const screenshotPath = '../docs/screenshots';
const liveModelBase = 'http://192.168.0.101:8080/v1';
const liveModelName = 'MiniCPM5-2B';

async function signIn(request: APIRequestContext) {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: 'advocate@tantara.local', password: 'tantara-local' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

async function firstReadyPdf(request: APIRequestContext, token: string) {
  const response = await request.get(`${apiUrl}/documents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const documents = (await response.json()).items as Array<{
    id: string;
    filename: string;
    status: string;
    is_demo?: boolean;
    page_count?: number;
  }>;
  return documents.find(
    (document) =>
      document.status === 'ready' &&
      document.is_demo &&
      (document.page_count ?? 0) > 1 &&
      document.filename.endsWith('.pdf'),
  )!;
}

async function openWithToken(page: Page, token: string, path: string) {
  await page.addInitScript((value) => localStorage.setItem('tantara_token', value), token);
  await page.goto(path);
}

async function waitForPdf(page: Page) {
  await expect(page.getByLabel('PDF page 1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Loading PDF pages…')).toHaveCount(0);
}

test('390px mobile library, viewer, AI Read states, empty and failure captures settle without overlap', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const document = await firstReadyPdf(request, token);
  const originalSettings = await request
    .get(`${apiUrl}/settings/ai`, { headers })
    .then((response) => response.json());
  await page.setViewportSize({ width: 390, height: 844 });

  await openWithToken(page, token, '/documents');
  await expect(page.locator('.documents-table tbody tr').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.document-preview-pane canvas')).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() => page.evaluate(() => window.document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  const header = page.locator('.topbar');
  const sidebar = page.locator('.sidebar');
  await expect
    .poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
    .toBe(0);
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expect
    .poll(async () => {
      const bounds = await page.locator('.documents-page').boundingBox();
      const headerBounds = await header.boundingBox();
      return Boolean(bounds && headerBounds && bounds.y >= headerBounds.height);
    })
    .toBeTruthy();
  await page.screenshot({ path: `${screenshotPath}/documents-library-mobile-390.png`, fullPage: true });

  await page.getByRole('textbox', { name: 'Search documents' }).fill('no-match-round4-77291');
  await expect(page.getByRole('heading', { name: 'No matching documents' })).toBeVisible();
  await expect(page.getByLabel('Filter by status')).toHaveValue('');
  await page.screenshot({ path: `${screenshotPath}/documents-library-empty-mobile-390.png`, fullPage: true });

  await openWithToken(page, token, `/documents/${document.id}?page=2`);
  await expect(page.getByLabel('Jump to page')).toHaveValue('2', { timeout: 60000 });
  await expect(page.getByLabel('PDF page 2')).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() => page.evaluate(() => window.document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await expect(page.locator('.pdf-toolbar')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeInViewport();
  await expect
    .poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().top)))
    .toBe(0);
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `${screenshotPath}/documents-viewer-page2-mobile-390-real.png`,
    fullPage: true,
  });

  await request.patch(`${apiUrl}/settings/ai`, {
    headers,
    data: { base_url: liveModelBase, model: liveModelName },
  });
  try {
    await openWithToken(page, token, `/documents/${document.id}`);
    await waitForPdf(page);
    await expect(page.locator('.ai-read-field').first()).toBeVisible({ timeout: 30000 });
    await page.screenshot({
      path: `${screenshotPath}/documents-ai-read-success-mobile-390-real.png`,
      fullPage: true,
    });

    await page.route('**/api/v1/ai/ask', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'model_unavailable', answer: '' }),
      }),
    );
    await page.getByRole('button', { name: /Run AI Read|Run again/ }).click();
    const unavailable = page.locator('[data-error-category="model_unavailable"]');
    await expect(unavailable).toBeVisible();
    await expect(unavailable).not.toContainText(/https?:\/\/|127\.0\.0\.1|192\.168\.|:\d{2,5}/);
    await expect(page.locator('.ai-read-field')).toHaveCount(0);
    await page.screenshot({
      path: `${screenshotPath}/documents-ai-read-unavailable-mobile-390-fixture.png`,
      fullPage: true,
    });
  } finally {
    await request.patch(`${apiUrl}/settings/ai`, {
      headers,
      data: { base_url: originalSettings.base_url, model: originalSettings.model },
    });
  }

  await page.route('**/api/v1/documents**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'offline', message: 'Offline' } }),
    }),
  );
  await openWithToken(page, token, '/documents');
  await expect(page.getByRole('heading', { name: 'Documents are unavailable' })).toBeVisible();
  await page.screenshot({
    path: `${screenshotPath}/documents-library-failure-mobile-390-fixture.png`,
    fullPage: true,
  });
});
