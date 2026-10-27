import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { documentHref } from '../src/features/documents/links';

const apiUrl = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8010'}/api/v1`;

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
    },
  });
  expect(response.status()).toBe(202);
  const uploaded = await response.json();
  await expect.poll(async () => {
    const job = await request.get(`${apiUrl}/documents/${uploaded.document_id}/job`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (await job.json()).status;
  }, { timeout: 60000 }).toBe('ready');
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

test('uploaded multi-page PDF deep-link scrolls to and highlights page 2', async ({ page, request }) => {
  const { documentId, token } = await uploadFixture(request, 'arbitration-text-layer.pdf');
  await openWithToken(page, token, documentHref(documentId, 2));
  const targetPage = page.locator('.pdf-page-card[data-page-card="2"]');
  await expect(targetPage).toBeVisible({ timeout: 30000 });
  await expect(targetPage).toHaveClass(/pdf-page-deep-link/);
  await expect(targetPage.locator('canvas')).toHaveAttribute('aria-label', 'PDF page 2');
  await expect.poll(() => targetPage.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const viewport = node.closest('.pdf-pages-scroll')?.getBoundingClientRect();
    return Boolean(viewport && bounds.top < viewport.bottom && bounds.bottom > viewport.top);
  })).toBeTruthy();
});

test('scanned fixture yields OCR text and reports the job warnings', async ({ request }) => {
  const { documentId, token } = await uploadFixture(request, 'arbitration-scanned.pdf');
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.get(`${apiUrl}/documents/${documentId}/pages`, { headers });
  const pages = (await response.json()).pages as Array<{ text: string; warnings: string[] }>;
  const extractedOcrQuote = pages[0].text.toUpperCase();
  expect(extractedOcrQuote).toContain('OCR MUST READ');
  const job = await request.get(`${apiUrl}/documents/${documentId}/job`, { headers }).then((result) => result.json());
  expect(Array.isArray(job.warnings)).toBeTruthy();
  expect(pages[0].warnings).toEqual(expect.any(Array));
  expect(job.warnings).toEqual(expect.any(Array));
});

test('viewer surfaces extraction warnings returned when OCR is unavailable', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const scanned = documents.items.find((item: { filename: string }) => item.filename === 'arbitration-scanned.pdf');
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

test('dead AI endpoint shows model_unavailable without fabricated extraction fields', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const original = await request.get(`${apiUrl}/settings/ai`, { headers }).then((response) => response.json());
  const docs = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const sourceDocument = docs.items.find((item: { status: string; filename: string }) => item.status === 'ready' && item.filename.endsWith('.pdf'));
  expect(sourceDocument).toBeTruthy();
  await request.patch(`${apiUrl}/settings/ai`, { headers, data: { base_url: 'http://127.0.0.1:9/v1' } });
  try {
    await openWithToken(page, token, `/documents/${sourceDocument.id}`);
    await page.getByRole('button', { name: /Run AI Read|Run again/ }).click();
    await expect(page.getByText('AI model unavailable')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('http://127.0.0.1:9/v1')).toBeVisible();
    await expect(page.getByText('document type', { exact: false })).toHaveCount(0);
    await expect(page.locator('.ai-read-field')).toHaveCount(0);
  } finally {
    await request.patch(`${apiUrl}/settings/ai`, { headers, data: { base_url: original.base_url } });
  }
});

test('no_evidence is shown without candidate extraction fields', async ({ page, request }) => {
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const documents = await request.get(`${apiUrl}/documents`, { headers }).then((response) => response.json());
  const sourceDocument = documents.items.find((item: { filename: string; status: string }) =>
    item.filename === 'arbitration-text-layer.pdf' && item.status === 'ready');
  expect(sourceDocument).toBeTruthy();
  await page.route('**/api/v1/ai/ask', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'no_evidence', answer: 'No matching source passages were found.' }),
  }));
  await openWithToken(page, token, `/documents/${sourceDocument.id}`);
  await page.getByRole('button', { name: 'Run AI Read' }).click();
  await expect(page.getByText('No evidence found')).toBeVisible();
  await expect(page.locator('.ai-read-field')).toHaveCount(0);
});
