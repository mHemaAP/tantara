import { expect, test, type Page } from '@playwright/test';
import { documentPageUrl } from '../src/features/research/document-url';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8114';
const apiRoot = `${apiBase}/api/v1`;
const credentials = { email: 'advocate@tantara.local', password: 'tantara-local' };
test.describe.configure({ timeout: 180_000 });

async function signIn(page: Page) {
  const response = await page.request.post(`${apiRoot}/auth/login`, { data: credentials });
  expect(response.ok(), `Login failed: ${await response.text()}`).toBeTruthy();
  const token = (await response.json()).access_token as string;
  await page.addInitScript((value) => {
    localStorage.setItem('tantara_token', value);
    document.cookie = `tantara_token=${value}; Path=/; SameSite=Lax`;
  }, token);
}

async function authHeader(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('tantara_token'));
  return { Authorization: `Bearer ${token}` };
}

async function waitSettled(page: Page) {
  await expect(page.getByRole('heading', { name: 'Research Desk' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-busy="true"], .skeleton, [data-loading="true"]')).toHaveCount(0);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toBeEmpty();
  await expect(page.locator('[aria-busy="true"], .skeleton, [data-loading="true"]')).toHaveCount(0);
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true });
}

async function answerQuestion(page: Page, question: string, via: 'button' | 'suggestion' = 'button') {
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/ai/ask') && response.request().method() === 'POST',
  );
  if (via === 'suggestion') {
    await page.getByRole('button', { name: question, exact: true }).click();
  } else {
    await page.getByRole('textbox', { name: 'Research question' }).fill(question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
  }
  const response = await responsePromise;
  expect(response.ok(), `Ask failed: ${await response.text()}`).toBeTruthy();
  const payload = await response.json();
  return payload as {
    status: string;
    answer?: string;
    citations?: Array<{
      citation_ref?: string;
      document_id: string;
      document_title: string;
      chunk_id: string;
      page_number: number;
      excerpt: string;
      retrieval_score?: number;
      retreival_score?: number;
    }>;
    sources?: Array<{
      citation_ref?: string;
      document_id: string;
      document_title: string;
      chunk_id: string;
      page_number: number;
      excerpt: string;
      retrieval_score?: number;
      retreival_score?: number;
    }>;
    research_session_id?: string;
    message_id?: string;
  };
}

test('documentPageUrl preserves document, page, and chunk contract', () => {
  expect(documentPageUrl('doc/1', 7, 'chunk 2')).toBe('/documents/doc%2F1?page=7&chunk=chunk+2');
});

test.describe('Research Desk live API controls', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/research');
    await waitSettled(page);
  });

  test.afterEach(async ({ page }) => {
    const headers = await authHeader(page).catch(() => ({}));
    const saved = await page.request.get(`${apiRoot}/ai/saved?page_size=100`, { headers }).catch(() => null);
    if (saved?.ok()) {
      const items = (await saved.json()).items ?? [];
      for (const item of items)
        await page.request.delete(`${apiRoot}/ai/saved/${item.id}`, { headers }).catch(() => null);
    }
    const history = await page.request
      .get(`${apiRoot}/ai/sessions?page_size=100`, { headers })
      .catch(() => null);
    if (history?.ok()) {
      const items = (await history.json()).items ?? [];
      for (const item of items)
        await page.request.delete(`${apiRoot}/ai/sessions/${item.id}`, { headers }).catch(() => null);
    }
  });

  test('shell stays pinned through scroll and navigation; mobile puts the composer first', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/research');
    await waitSettled(page);
    const header = page.locator('.topbar');
    const sidebar = page.locator('.sidebar');
    const content = page.locator('.research-page');
    const initialHeader = await header.boundingBox();
    const initialSidebar = await sidebar.boundingBox();
    const initialContent = await content.boundingBox();
    expect(initialHeader?.y).toBe(0);
    expect(initialSidebar?.y).toBe(0);
    expect(initialSidebar?.height).toBeGreaterThanOrEqual(900);
    expect(initialContent?.y).toBeGreaterThanOrEqual((initialHeader?.height ?? 0) + 10);
    await capture(page, 'research-desktop-empty');
    await page.evaluate(() => window.scrollTo(0, 500));
    expect((await header.boundingBox())?.y).toBe(0);
    expect((await sidebar.boundingBox())?.y).toBe(0);
    await page.goto('/research/documents');
    await expect(page.getByRole('heading', { name: 'Research library' })).toBeVisible();
    expect((await page.locator('.topbar').boundingBox())?.y).toBe(0);
    expect((await page.locator('.sidebar').boundingBox())?.y).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/research');
    await waitSettled(page);
    const composer = page.getByRole('textbox', { name: 'Research question' });
    const composerBox = await composer.boundingBox();
    const historyButton = page.getByRole('button', { name: 'Refresh history' });
    const historyBox = await historyButton.boundingBox();
    expect(composerBox?.y).toBeLessThan(844);
    expect(composerBox?.y).toBeLessThan(historyBox?.y ?? Number.MAX_SAFE_INTEGER);
    await expect(page.getByRole('option', { name: 'Collections unavailable' })).toBeAttached();
    const collectionSelect = page.getByLabel('Collection');
    const collectionWidth = await collectionSelect.evaluate(
      (node) => (node as HTMLSelectElement).clientWidth,
    );
    expect(collectionWidth).toBeGreaterThan(200);
    const mobileHeader = page.locator('.topbar');
    const mobileSidebar = page.locator('.sidebar');
    expect((await mobileHeader.boundingBox())?.y).toBe(0);
    expect((await mobileSidebar.boundingBox())?.y).toBe(0);
    expect((await mobileSidebar.boundingBox())?.height).toBeGreaterThanOrEqual(844);
    await capture(page, 'research-mobile-empty');
  });

  test('new research, live scope selectors, refresh, suggestions, Ask, history, saved items, and library work', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'New research' }).click();
    await expect(page.getByRole('textbox', { name: 'Research question' })).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'What are you researching?' })).toBeVisible();
    await capture(page, 'research-new-state');

    const headers = await authHeader(page);
    const documentsResponse = await page.request.get(`${apiRoot}/documents?page_size=100`, { headers });
    expect(documentsResponse.ok()).toBeTruthy();
    const documents = (await documentsResponse.json()).items as Array<{
      id: string;
      case_id?: string;
      jurisdiction?: string;
    }>;
    const scopedDocument = documents.find((document) => document.case_id);
    expect(scopedDocument).toBeTruthy();
    await page.getByLabel('Case').selectOption(scopedDocument!.case_id!);
    await page.getByLabel('Jurisdiction').selectOption(scopedDocument!.jurisdiction ?? 'India');
    await expect(page.getByLabel('Case')).toHaveValue(scopedDocument!.case_id!);
    await capture(page, 'research-scope-selected');
    const refreshResponse = page.waitForResponse(
      (response) => response.url().includes('/api/v1/ai/sessions') && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Refresh history' }).click();
    expect((await refreshResponse).ok()).toBeTruthy();
    await capture(page, 'research-history-refreshed');

    const suggestedQuestion = 'Find documents about seat of arbitration';
    const suggested = await answerQuestion(page, suggestedQuestion, 'suggestion');
    expect(['ok', 'answered']).toContain(suggested.status);
    expect(suggested.answer?.trim().length).toBeGreaterThan(0);
    expect(suggested.citations?.length ?? suggested.sources?.length ?? 0).toBeGreaterThan(0);
    const suggestedSources = suggested.citations ?? suggested.sources ?? [];
    const suggestedDocumentCount = new Set(suggestedSources.map((source) => source.document_id)).size;
    await expect(page.locator('.source-count')).toHaveText(String(suggestedDocumentCount));
    await expect(page.locator('.source-bottom b').first()).toHaveText(/^\d+\.\d{2}$/);
    await capture(page, 'research-suggested-question');

    await page.getByLabel('Case').selectOption('');
    await page.getByLabel('Collection').selectOption('');
    await page.getByLabel('Jurisdiction').selectOption('');
    await page.getByRole('button', { name: 'Refresh history' }).click();
    const historyEntry = page.locator('.history-item').first();
    await expect(historyEntry).toBeVisible();
    await historyEntry.click();
    await expect(page.getByText(/\d{2} [A-Z][a-z]{2} \d{4}/).first()).toBeVisible();
    await capture(page, 'research-history-entry');

    const saveResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/ai/saved') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).last().click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Saved answer' })).toBeVisible();
    await capture(page, 'research-saved-search');
    await page.getByRole('button', { name: 'Saved answer' }).click();
    await expect(page.locator('.turn.assistant').last()).toBeVisible();
    await capture(page, 'research-saved-answer-opened');

    await page.locator('a[href="/research/documents"]').click();
    await expect(page).toHaveURL(/\/research\/documents$/);
    await expect(page.getByRole('heading', { name: 'Research library' })).toBeVisible();
    await capture(page, 'research-library');
    await page.getByRole('link', { name: 'Back to Research Desk' }).click();
    await waitSettled(page);

    await page.getByRole('button', { name: 'New research' }).click();
    await capture(page, 'research-new-after-history');
    const asked = await answerQuestion(page, 'What is the seat of arbitration?', 'button');
    expect(['ok', 'answered']).toContain(asked.status);
    expect(asked.answer?.trim().length).toBeGreaterThan(0);
    await capture(page, 'research-ask-button');
    await page.reload();
    await waitSettled(page);
    await expect(page.getByText(asked.answer!, { exact: false }).first()).toBeVisible();
    await capture(page, 'research-session-restored');
  });

  test('citations show API markers and open the highest cited page', async ({ page }) => {
    const asked = await answerQuestion(page, 'What does the arbitration agreement say about the seat?');
    expect(['ok', 'answered']).toContain(asked.status);
    const citations = asked.citations ?? asked.sources ?? [];
    expect(citations.length).toBeGreaterThan(0);
    const distinctDocumentIds = new Set(citations.map((citation) => citation.document_id));
    await expect(page.locator('.sources-card header p')).toContainText(
      `${distinctDocumentIds.size} ${distinctDocumentIds.size === 1 ? 'document' : 'documents'}`,
    );
    for (const citation of citations) {
      expect(citation.document_id).toBeTruthy();
      expect(citation.chunk_id).toBeTruthy();
      expect(citation.citation_ref).toBeTruthy();
      const docResponse = await page.request.get(`${apiRoot}/documents/${citation.document_id}`, {
        headers: await authHeader(page),
      });
      expect(docResponse.ok()).toBeTruthy();
      const document = await docResponse.json();
      expect(citation.page_number).toBeGreaterThan(0);
      expect(citation.page_number).toBeLessThanOrEqual(document.page_count);
      await expect(
        page
          .getByRole('link', {
            name: `Open ${citation.document_title} at page ${citation.page_number}`,
          })
          .first(),
      ).toHaveAttribute(
        'href',
        documentPageUrl(citation.document_id, citation.page_number, citation.chunk_id),
      );
    }
    await expect(page.locator('.answer-citation').first()).toBeVisible();
    const largestPageCitation = citations.reduce((largest, current) =>
      current.page_number > largest.page_number ? current : largest,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'docs/screenshots/research-desktop-answer-citations.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'research-mobile-answer-citations');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('link', {
        name: `Open ${largestPageCitation.document_title} at page ${largestPageCitation.page_number}`,
      })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/documents/${encodeURIComponent(largestPageCitation.document_id)}\\?page=${largestPageCitation.page_number}`,
      ),
    );
    await expect(page.getByRole('heading', { name: largestPageCitation.document_title })).toBeVisible();
    await expect(page.getByLabel('Page number')).toHaveValue(String(largestPageCitation.page_number));
    await expect(
      page.locator('.page-heading').filter({ hasText: `Page ${largestPageCitation.page_number}` }),
    ).toBeVisible();
    await expect(page.locator(`#page-${largestPageCitation.page_number}`)).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/research-citation-viewer.png', fullPage: true });
  });

  test('an empty case scope returns true no-evidence state', async ({ page }) => {
    const headers = await authHeader(page);
    const [casesResponse, documentsResponse] = await Promise.all([
      page.request.get(`${apiRoot}/cases?page_size=100`, { headers }),
      page.request.get(`${apiRoot}/documents?page_size=100`, { headers }),
    ]);
    expect(casesResponse.ok()).toBeTruthy();
    expect(documentsResponse.ok()).toBeTruthy();
    const cases = (await casesResponse.json()).items as Array<{ id: string; title: string }>;
    const documents = (await documentsResponse.json()).items as Array<{ case_id?: string }>;
    const emptyCase = cases.find(
      (candidate) => !documents.some((document) => document.case_id === candidate.id),
    );
    expect(emptyCase).toBeTruthy();
    await page.getByLabel('Case').selectOption(emptyCase!.id);
    const response = await answerQuestion(page, 'What does the case file say about its hearing schedule?');
    expect(response.status).toBe('no_evidence');
    await expect(page.getByText('Insufficient evidence in your library')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload a document' })).toBeVisible();
    await expect(page.locator('.answer-text')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'research-desktop-no-evidence');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'research-mobile-no-evidence');
  });

  test('the reachable model can report insufficient evidence without synthesizing a conclusion', async ({
    page,
  }) => {
    const response = await answerQuestion(
      page,
      'What is the governing law of the arbitration agreement itself?',
    );
    expect(['ok', 'answered']).toContain(response.status);
    expect(response.answer).toMatch(/evidence is insufficient/i);
    expect((response.citations ?? response.sources ?? []).length).toBeGreaterThan(0);
    await expect(page.getByText('Evidence is insufficient', { exact: true })).toBeVisible();
    await expect(page.getByText(/no conclusion was generated from this evidence/i)).toBeVisible();
    await expect(page.locator('.source-item').first()).toBeVisible();
    await expect(page.locator('.answer-citation')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'research-desktop-insufficient-evidence');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, 'research-mobile-insufficient-evidence');
  });

  test('unreachable model hides answer text; retry recovers when the configured endpoint is restored', async ({
    page,
  }) => {
    const headers = await authHeader(page);
    const settingsResponse = await page.request.get(`${apiRoot}/settings/ai`, { headers });
    const previous = await settingsResponse.json();
    try {
      await page.request.patch(`${apiRoot}/settings/ai`, {
        headers,
        data: { base_url: 'http://127.0.0.1:1/v1' },
      });
      const failed = await answerQuestion(page, 'What is the seat of arbitration in the agreement?');
      expect(failed.status).toBe('model_unavailable');
      await expect(page.getByText('Model unavailable', { exact: true })).toBeVisible();
      await expect(page.locator('.answer-text')).toHaveCount(0);
      await expect(page.getByText('Lexical results · documents only')).toBeVisible();
      const callout = page.locator('.state-callout.unavailable').filter({ hasText: 'Model unavailable' });
      const calloutText = await callout.innerText();
      expect(calloutText).not.toMatch(/https?:\/\//i);
      expect(calloutText).not.toContain('127.0.0.1');
      expect(calloutText).not.toMatch(/\b\d{2,5}\b/);
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, 'research-desktop-model-unavailable');
      await page.setViewportSize({ width: 390, height: 844 });
      await capture(page, 'research-mobile-model-unavailable');

      await page.request.patch(`${apiRoot}/settings/ai`, {
        headers,
        data: { base_url: previous.base_url, model: previous.model },
      });
      const retryPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/ai/ask') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Retry' }).first().click();
      const retryResponse = await retryPromise;
      const recovered = await retryResponse.json();
      expect(['ok', 'answered']).toContain(recovered.status);
      expect(String(recovered.answer ?? '').trim().length).toBeGreaterThan(0);
      await expect(page.locator('.answer-citation').first()).toBeVisible();
      await capture(page, 'research-retry-recovered');
    } finally {
      await page.request.patch(`${apiRoot}/settings/ai`, {
        headers,
        data: { base_url: previous.base_url, model: previous.model },
      });
    }
  });
});
