import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { documentHref } from '../src/features/documents/links';

const apiUrl = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8112'}/api/v1`;

async function signIn(request: APIRequestContext) {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: 'advocate@tantara.local', password: 'tantara-local' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

async function uploadFixture(request: APIRequestContext, fixtureName: string) {
  const token = await signIn(request);
  const response = await request.post(`${apiUrl}/documents/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: fixtureName,
        mimeType: 'application/pdf',
        buffer: readFileSync(`tests/fixtures/${fixtureName}`),
      },
      title: fixtureName,
    },
  });
  expect(response.status()).toBe(202);
  const uploaded = await response.json();
  await expect
    .poll(
      async () => {
        const job = await request.get(`${apiUrl}/documents/${uploaded.document_id}/job`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return (await job.json()).status;
      },
      { timeout: 60000 },
    )
    .toBe('ready');
  return { documentId: uploaded.document_id as string, token };
}

async function openWithToken(page: Page, token: string, href: string) {
  await page.addInitScript((value) => localStorage.setItem('tantara_token', value), token);
  await page.goto(href);
}

test('document URL builder encodes identifiers and preserves citation pages', () => {
  expect(documentHref('contract/one', 2)).toBe('/documents/contract%2Fone?page=2');
  expect(documentHref('contract-1')).toBe('/documents/contract-1');
});

test('captures seeded document and search states before fixture uploads', async ({ page, request }) => {
  const token = await signIn(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithToken(page, token, '/documents');
  await expect(page.locator('.documents-table tbody tr').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.document-preview-pane canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.document-preview-pane canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 60000,
  });
  await page.screenshot({
    path: '../docs/screenshots/documents-library-desktop-1440-real.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '../docs/screenshots/documents-library-mobile-390-real.png',
  });

  await page.getByRole('textbox', { name: 'Search documents' }).fill('no-document-with-this-title-9472');
  await expect(page.getByRole('heading', { name: 'No matching documents' })).toBeVisible();
  await expect(page.getByLabel('Filter by status')).toHaveValue('');
  await page.screenshot({
    path: '../docs/screenshots/documents-library-empty-mobile-390-real.png',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: '../docs/screenshots/documents-library-empty-desktop-1440-real.png',
  });

  await page.goto('/search');
  await page.getByRole('textbox', { name: 'Search documents' }).fill('agreement');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.search-hit').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.search-hit').first()).not.toContainText('Untitled document');
  await expect(page.getByText(/fusion rank score.*not a confidence value/i)).toBeVisible();
  await page.screenshot({
    path: '../docs/screenshots/documents-search-desktop-1440-real.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../docs/screenshots/documents-search-mobile-390-real.png' });
});

test('uploaded multi-page PDF deep-link scrolls to and highlights page 2', async ({ page, request }) => {
  test.setTimeout(60000);
  const { documentId, token } = await uploadFixture(request, 'arbitration-text-layer.pdf');
  await openWithToken(page, token, documentHref(documentId, 2));
  const targetPage = page.locator('.pdf-page-card[data-page-card="2"]');
  await expect(targetPage).toBeVisible({ timeout: 30000 });
  await expect(targetPage).toHaveClass(/pdf-page-deep-link/);
  const pageCanvas = targetPage.getByLabel('PDF page 2');
  await expect(pageCanvas).toBeVisible({ timeout: 45000 });
  await expect(pageCanvas).toHaveAttribute('data-rendered', 'true', { timeout: 45000 });
  await expect(pageCanvas).toHaveJSProperty('tagName', 'CANVAS');
  await expect
    .poll(() =>
      targetPage.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const viewport = node.closest('.pdf-pages-scroll')?.getBoundingClientRect();
        return Boolean(viewport && bounds.top < viewport.bottom && bounds.bottom > viewport.top);
      }),
    )
    .toBeTruthy();
  const sidebar = page.locator('.sidebar');
  const header = page.locator('.topbar');
  const canvas = pageCanvas;
  await expect.poll(() => sidebar.evaluate((node) => Math.round(node.getBoundingClientRect().left))).toBe(0);
  await expect
    .poll(async () => {
      const headerBottom = await header.evaluate((node) => node.getBoundingClientRect().bottom);
      const canvasTop = await canvas.evaluate((node) => node.getBoundingClientRect().top);
      return canvasTop > headerBottom;
    })
    .toBeTruthy();
  const skipLinkBounds = await page.locator('.skip-link').boundingBox();
  const mainBounds = await page.locator('#main').boundingBox();
  expect(skipLinkBounds).not.toBeNull();
  expect(mainBounds).not.toBeNull();
  expect(skipLinkBounds!.y + skipLinkBounds!.height).toBeLessThanOrEqual(0);
  expect(mainBounds!.x).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: '../docs/screenshots/documents-viewer-page2-desktop-1440-fixture.png',
  });
  const mobilePage = await page.context().newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await openWithToken(mobilePage, token, documentHref(documentId, 2));
  const mobilePageTwo = mobilePage.locator('.pdf-page-card[data-page-card="2"]');
  await expect(mobilePageTwo).toBeVisible({ timeout: 45000 });
  await expect(mobilePageTwo.getByLabel('PDF page 2')).toBeVisible({ timeout: 45000 });
  await expect(mobilePageTwo.getByLabel('PDF page 2')).toHaveAttribute('data-rendered', 'true', {
    timeout: 45000,
  });
  await expect
    .poll(() => mobilePage.locator('.sidebar').evaluate((node) => node.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expect
    .poll(() =>
      mobilePage.locator('.topbar').evaluate((node) => Math.round(node.getBoundingClientRect().top)),
    )
    .toBe(0);
  await mobilePage.screenshot({
    path: '../docs/screenshots/documents-viewer-page2-mobile-390-fixture.png',
  });
  await mobilePage.close();
});

test('viewer metadata uses separated definition rows and an accessible copy confirmation', async ({
  page,
  request,
  context,
}) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const document = documents.items.find(
    (item: { filename: string }) => item.filename === 'arbitration-text-layer.pdf',
  );
  expect(document).toBeTruthy();
  await openWithToken(page, token, `/documents/${document.id}`);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: process.env.TANTARA_WEB_URL ?? 'http://127.0.0.1:3013',
  });
  await expect(page.getByRole('group', { name: 'Filename arbitration-text-layer.pdf' })).toHaveText(
    /Filename\s+arbitration-text-layer\.pdf/,
  );
  await expect(page.getByRole('group', { name: 'Pages 3' })).toHaveText(/Pages\s+3/);
  await expect(page.getByRole('group', { name: /^Characters / })).toHaveText(/Characters\s+[\d,]+/);
  await expect(page.getByRole('group', { name: /^Created / })).toHaveText(/Created\s+.+/);
  await expect(page.getByRole('group', { name: /^Jurisdiction / })).toHaveText(/Jurisdiction\s+.+/);
  const copyButton = page.getByRole('button', { name: 'Copy SHA-256' });
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'SHA-256 copied' })).toBeVisible();
  await page
    .locator('.document-metadata')
    .screenshot({ path: '../docs/screenshots/documents-metadata-desktop-1440-fixture.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.document-metadata')
    .screenshot({ path: '../docs/screenshots/documents-metadata-mobile-390-fixture.png' });
});

test('page-aware chunks find SIAC Rules and open highlighted PDF page 2', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const document = documents.items.find(
    (item: { filename: string }) => item.filename === 'arbitration-text-layer.pdf',
  );
  expect(document).toBeTruthy();
  await openWithToken(page, token, `/documents/${document.id}`);
  await page.getByLabel('Search this document').fill('SIAC Rules');
  await page.getByRole('button', { name: 'Find chunks' }).click();
  const pageTwoHit = page.locator('.citation-chunk').filter({ hasText: 'Page 2' });
  await expect(pageTwoHit).toBeVisible({ timeout: 30000 });
  await expect(pageTwoHit.getByText(/Relevance\s+\d/)).toBeVisible();
  await pageTwoHit.getByRole('link', { name: 'Open page 2' }).click();
  await expect(page).toHaveURL(/page=2/);
  const pageTwo = page.locator('.pdf-page-card[data-page-card="2"]');
  await expect(pageTwo).toHaveClass(/pdf-page-deep-link/);
  await expect(pageTwo.locator('canvas')).toHaveAttribute('aria-label', 'PDF page 2');
});

test('AI Read renders real API fields and persists an edited field after reload', async ({
  page,
  request,
}) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const document = documents.items.find(
    (item: { filename: string; status: string }) =>
      item.filename === 'arbitration-text-layer.pdf' && item.status === 'ready',
  );
  expect(document).toBeTruthy();
  await page.route('**/api/v1/ai/ask', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', answer: 'Evidence passages are available.' }),
    }),
  );
  await openWithToken(page, token, `/documents/${document.id}`);
  await page.getByRole('button', { name: 'Run AI Read' }).click();
  await expect(page.locator('.ai-read-field').first()).toBeVisible();
  await expect(page.locator('.ai-read-field[data-field-key="arbitration_clause"]')).toContainText('Page 1');
  await page.getByRole('button', { name: 'Edit document_type' }).click();
  await page.getByRole('textbox', { name: 'Edit document_type' }).fill('Reviewed arbitration agreement');
  await page.getByRole('button', { name: 'Save document_type' }).click();
  await expect(page.locator('.ai-read-field[data-provenance-key="extracted_reviewed"]')).toContainText(
    'Reviewed extraction',
  );
  await page.reload();
  await expect(page.locator('.ai-read-field').filter({ hasText: 'document type' })).toContainText(
    'Reviewed arbitration agreement',
  );
  await expect(page.locator('.pdf-viewer canvas').first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Loading PDF pages…')).toHaveCount(0);
  await expect(page.locator('.ai-read-field').filter({ hasText: 'document type' })).toContainText(
    'Reviewed extraction',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: '../docs/screenshots/documents-ai-read-success-desktop-1440-fixture.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '../docs/screenshots/documents-ai-read-success-mobile-390-fixture.png',
  });
});

test('scanned fixture yields OCR text and reports the job warnings', async ({ request }) => {
  const { documentId, token } = await uploadFixture(request, 'arbitration-scanned.pdf');
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.get(`${apiUrl}/documents/${documentId}/pages`, { headers });
  const pages = (await response.json()).pages as Array<{ text: string; warnings: string[] }>;
  const extractedOcrQuote = pages[0].text.toUpperCase();
  expect(extractedOcrQuote).toContain('UNIQUE QUARTZ 7319');
  const job = await request
    .get(`${apiUrl}/documents/${documentId}/job`, { headers })
    .then((result) => result.json());
  expect(Array.isArray(job.warnings)).toBeTruthy();
  expect(pages[0].warnings).toEqual(expect.any(Array));
  expect(job.warnings).toEqual(expect.any(Array));
});

test('viewer surfaces extraction warnings returned when OCR is unavailable', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const scanned = documents.items.find(
    (item: { filename: string }) => item.filename === 'arbitration-scanned.pdf',
  );
  expect(scanned).toBeTruthy();
  await page.route(`**/api/v1/documents/${scanned.id}/pages`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.pages = body.pages.map((item: { warnings: string[] }) => ({
      ...item,
      warnings: ['OCR engine unavailable; scanned page text could not be read.'],
    }));
    await route.fulfill({ response, json: body });
  });
  await openWithToken(page, token, `/documents/${scanned.id}`);
  await expect(page.getByText('Extraction warnings')).toBeVisible();
  await expect(page.getByText('OCR engine unavailable; scanned page text could not be read.')).toBeVisible();
});

test('dead AI endpoint shows model_unavailable without fabricated extraction fields', async ({
  page,
  request,
}) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const original = await request
    .get(`${apiUrl}/settings/ai`, { headers })
    .then((response) => response.json());
  const docs = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const sourceDocument = docs.items.find(
    (item: { status: string; filename: string }) =>
      item.status === 'ready' && item.filename === 'scanned-agreement.pdf',
  );
  expect(sourceDocument).toBeTruthy();
  await request.patch(`${apiUrl}/settings/ai`, { headers, data: { base_url: 'http://127.0.0.1:9/v1' } });
  try {
    await openWithToken(page, token, `/documents/${sourceDocument.id}`);
    await page.getByRole('button', { name: /Run AI Read|Run again/ }).click();
    await expect(page.getByText('AI model unavailable')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.ai-read-degradation')).not.toContainText(/https?:\/\/|127\.0\.0\.1|:\d{2,5}/);
    await expect(page.getByText('document type', { exact: false })).toHaveCount(0);
    await expect(page.locator('.ai-read-field')).toHaveCount(0);
  } finally {
    await request.patch(`${apiUrl}/settings/ai`, { headers, data: { base_url: original.base_url } });
  }
});

test('no_evidence is shown without candidate extraction fields', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const docs = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const sourceDocument = docs.items.find((item: { status: string }) => item.status === 'ready');
  expect(sourceDocument).toBeTruthy();
  const documentId = sourceDocument.id as string;
  await page.route(`**/api/v1/documents/${documentId}/text`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: '', pages: [] }),
    }),
  );
  await page.route('**/api/v1/ai/ask', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'no_evidence', answer: 'No matching source passages were found.' }),
    }),
  );
  await openWithToken(page, token, `/documents/${documentId}`);
  await expect(page.getByLabel('PDF page 1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Loading PDF pages…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Document page chunks' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run AI Read' }).click();
  await expect(page.getByText('No evidence found')).toBeVisible();
  await expect(page.locator('.ai-read-degradation')).not.toContainText(/https?:\/\/|127\.0\.0\.1|:\d{2,5}/);
  await expect(page.locator('.ai-read-field')).toHaveCount(0);
  await page.screenshot({
    path: '../docs/screenshots/documents-ai-read-no-evidence-desktop-1440-fixture.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '../docs/screenshots/documents-ai-read-no-evidence-mobile-390-fixture.png',
  });

  const remainingDocuments = await request
    .get(`${apiUrl}/documents?page_size=100`, { headers })
    .then((response) => response.json());
  for (const document of remainingDocuments.items as Array<{ id: string; filename: string }>) {
    if (['arbitration-text-layer.pdf', 'arbitration-scanned.pdf'].includes(document.filename)) {
      await request.delete(`${apiUrl}/documents/${document.id}`, { headers });
    }
  }
});
