import { expect, test, type Page } from '@playwright/test';
import { documentPageUrl } from '../src/features/research/document-url';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8114';
const apiRoot = `${apiBase}/api/v1`;
const credentials = { email: 'advocate@tantara.local', password: 'tantara-local' };

async function signIn(page: Page) {
  const response = await page.request.post(`${apiRoot}/auth/login`, { data: credentials });
  expect(response.ok(), `Login failed: ${await response.text()}`).toBeTruthy();
  const token = (await response.json()).access_token as string;
  await page.addInitScript((value) => {
    localStorage.setItem('tantara_token', value);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, token);
}

test('documentPageUrl builds the viewer contract with a page and chunk', () => {
  expect(documentPageUrl('doc/1', 7, 'chunk 2')).toBe('/documents/doc%2F1?page=7&chunk=chunk+2');
});

test.describe('Research Desk against the private v1.1.0 API', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Research Desk' })).toBeVisible();
  });

  test('answers from indexed corpus, citations resolve, and history survives reload', async ({ page }) => {
    const askResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/ai/ask') && r.request().method() === 'POST',
    );
    await page
      .getByRole('textbox', { name: 'Research question' })
      .fill('What is the seat of arbitration in the agreement and what law governs it?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const response = await (await askResponse).json();
    await expect(page.locator('.turn.assistant p').first()).not.toBeEmpty({ timeout: 45000 });
    expect(['ok', 'answered']).toContain(response.status);
    const citations = response.citations ?? response.sources ?? [];
    expect(citations.length).toBeGreaterThan(0);
    await page.screenshot({ path: 'docs/screenshots/research-answer-citations.png', fullPage: true });
    for (const citation of citations) {
      expect(citation.document_id).toBeTruthy();
      expect(citation.chunk_id).toBeTruthy();
      const docResponse = await page.request.get(`${apiRoot}/documents/${citation.document_id}`, {
        headers: await authHeader(page),
      });
      expect(docResponse.ok()).toBeTruthy();
      const doc = await docResponse.json();
      expect(citation.page_number).toBeGreaterThan(0);
      expect(citation.page_number).toBeLessThanOrEqual(doc.page_count);
      await expect(
        page.getByRole('link', { name: `Open ${citation.document_title} at page ${citation.page_number}` }),
      ).toHaveAttribute(
        'href',
        documentPageUrl(citation.document_id, citation.page_number, citation.chunk_id),
      );
    }
    const firstCitation = citations[0];
    await page
      .getByRole('link', {
        name: `Open ${firstCitation.document_title} at page ${firstCitation.page_number}`,
      })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/documents/${encodeURIComponent(firstCitation.document_id)}\\?page=${firstCitation.page_number}`,
      ),
    );
    await expect(page.locator(`#page-${firstCitation.page_number}`)).toBeVisible();
    await expect(page.locator(`#page-${firstCitation.page_number}`)).toContainText(
      firstCitation.excerpt.slice(0, 24),
    );
    await page.goto('/research');
    await expect(page.getByRole('heading', { name: 'Research Desk' })).toBeVisible();
    const answer = await page.locator('.turn.assistant p').first().innerText();
    await page.reload();
    await expect(
      page.getByText('What is the seat of arbitration in the agreement and what law governs it?').first(),
    ).toBeVisible();
    expect(answer.length).toBeGreaterThan(0);
  });

  test('out of scope question renders explicit no evidence state', async ({ page }) => {
    const askResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/ai/ask') && r.request().method() === 'POST',
    );
    await page
      .getByRole('textbox', { name: 'Research question' })
      .fill('How does a Martian gemstone auction determine dragon migration visas?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const result = await (await askResponse).json();
    expect(result.status).toBe('no_evidence');
    await expect(page.getByText('Insufficient evidence in your library')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload a document' })).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/research-no-evidence.png', fullPage: true });
  });

  test('unreachable local model displays retrieved documents only', async ({ page }) => {
    const login = await page.request.post(`${apiRoot}/auth/login`, { data: credentials });
    const token = (await login.json()).access_token as string;
    const headers = { Authorization: `Bearer ${token}` };
    const settingsResponse = await page.request.get(`${apiRoot}/settings/ai`, { headers });
    const previous = await settingsResponse.json();
    try {
      await page.request.patch(`${apiRoot}/settings/ai`, {
        headers,
        data: { base_url: 'http://127.0.0.1:1/v1' },
      });
      const askResponse = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/ai/ask') && r.request().method() === 'POST',
      );
      await page
        .getByRole('textbox', { name: 'Research question' })
        .fill('What is the seat of arbitration in the agreement?');
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      const result = await (await askResponse).json();
      expect(result.status).toBe('model_unavailable');
      await expect(page.getByText('Model unavailable', { exact: true })).toBeVisible();
      await expect(
        page.getByText('No answer text is shown because the configured model could not respond.'),
      ).toBeVisible();
      await expect(page.locator('.answer-text')).toHaveCount(0);
      await expect(page.getByText('Lexical results · documents only')).toBeVisible();
      await page.screenshot({ path: 'docs/screenshots/research-model-unavailable.png', fullPage: true });
    } finally {
      await page.request.patch(`${apiRoot}/settings/ai`, {
        headers,
        data: { base_url: previous.base_url, model: previous.model },
      });
    }
  });

  test('layout stacks cleanly on mobile and filters fit tablet width', async ({ page }) => {
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Research Desk' })).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
      await expect(page.locator('[role="status"]').filter({ hasText: 'Loading' })).toHaveCount(0);
      if (width === 390)
        await page.screenshot({ path: 'docs/screenshots/research-mobile.png', fullPage: true });
      if (width === 1440)
        await page.screenshot({ path: 'docs/screenshots/research-desktop.png', fullPage: true });
    }
  });
});

async function authHeader(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('tantara_token'));
  return { Authorization: `Bearer ${token}` };
}
