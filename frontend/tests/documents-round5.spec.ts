import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiUrl = `${process.env.TANTARA_API_BASE_URL ?? 'http://127.0.0.1:8112'}/api/v1`;
const screenshots = '../docs/screenshots';

async function signIn(request: APIRequestContext) {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: { email: 'advocate@tantara.local', password: 'tantara-local' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

async function openWithToken(page: Page, token: string, href: string) {
  await page.addInitScript((value) => localStorage.setItem('tantara_token', value), token);
  await page.goto(href);
}

async function seededPageThreeDocument(request: APIRequestContext, token: string) {
  const response = await request.get(`${apiUrl}/documents?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const documents = (await response.json()).items as Array<{
    id: string;
    filename: string;
    content_hash: string;
    page_count: number;
    status: string;
    is_demo: boolean;
  }>;
  const document = documents.find((item) => item.filename === 'page-three-motion.pdf');
  expect(document).toBeTruthy();
  expect(document!.status).toBe('ready');
  expect(document!.is_demo).toBeTruthy();
  return document!;
}

async function captureViewport(page: Page, name: string, width: number, height: number) {
  const screenshotPath = `${screenshots}/${name}.png`;
  const image = await page.screenshot({ path: screenshotPath });
  writeFileSync(`/tmp/${name}.png`, image);
  const pixelData = execFileSync('python', [
    '-c',
    [
      'from PIL import Image',
      'import json, sys',
      'image = Image.open(sys.argv[1]).convert("RGB")',
      'width, height = image.size',
      'points = [(width - 1, 0), (width - 1, height - 1), (min(250, width - 1), 0), (min(250, width - 1), height - 1)]',
      'pixels = [image.getpixel(point) for point in points]',
      'print(json.dumps({"size": image.size, "pixels": pixels}))',
    ].join('; '),
    screenshotPath,
  ]).toString();
  const sampled = JSON.parse(pixelData) as { size: [number, number]; pixels: number[][] };
  expect(sampled.size).toEqual([width, height]);
  for (const pixel of sampled.pixels) {
    expect(pixel.some((channel) => channel > 32)).toBeTruthy();
  }
}

async function expectPageRatio(page: Page, pageNumber: number) {
  const pageCard = page.locator(`.pdf-page-card[data-page-card="${pageNumber}"]`);
  const ratioData = await pageCard.getAttribute('data-page-ratio');
  const canvas = pageCard.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const sourceRatio = Number(ratioData);
  const renderedRatio = bounds!.width / bounds!.height;
  expect(Math.abs(renderedRatio - sourceRatio) / sourceRatio).toBeLessThan(0.01);
}

test('real seeded document opens from library, renders proportionally, reads, and follows page citations', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let routeRegistrationCount = 0;
  const registerRoute = page.route.bind(page);
  page.route = (async (...arguments_: Parameters<typeof page.route>) => {
    routeRegistrationCount += 1;
    return registerRoute(...arguments_);
  }) as typeof page.route;

  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const settingsResponse = await request.get(`${apiUrl}/settings/ai`, { headers });
  expect(settingsResponse.ok()).toBeTruthy();
  let settings = await settingsResponse.json();
  if (!settings.runtime_status?.reachable) {
    await request.patch(`${apiUrl}/settings/ai`, {
      headers,
      data: { base_url: 'http://192.168.0.101:8080/v1', model: settings.model },
    });
    settings = await request.get(`${apiUrl}/settings/ai`, { headers }).then((response) => response.json());
  }
  const document = await seededPageThreeDocument(request, token);
  await openWithToken(page, token, '/documents');
  await expect(page.getByRole('link', { name: 'Page Three Motion' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('link', { name: 'Page Three Motion' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${document.id}$`));
  await expect(page.getByLabel('PDF page 1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Loading PDF pages…')).toHaveCount(0);
  await expect(page.getByLabel('Jump to page')).toHaveValue('1');
  await expectPageRatio(page, 1);
  await expect(page.getByRole('group', { name: /^Filename / })).toContainText('page-three-motion.pdf');
  await expect(page.getByRole('group', { name: /^Pages 5$/ })).toHaveText('Pages 5');
  await expect(page.getByRole('group', { name: /^Characters / })).toContainText('Characters ');
  await expect(page.locator('.document-metadata')).toContainText('Jurisdiction India');
  await expect(page.locator('.document-metadata')).toContainText('SHA-256');
  await captureViewport(page, 'documents-round5-viewer-desktop-1440-real', 1440, 900);

  await page.locator('.document-metadata').scrollIntoViewIfNeeded();
  await expect(page.getByRole('group', { name: /^Filename / })).toBeVisible();
  await captureViewport(page, 'documents-round5-metadata-desktop-1440-real', 1440, 900);

  if (!settings.runtime_status?.reachable) {
    await page.getByRole('button', { name: 'Run AI Read' }).click();
    await expect(page.locator('[data-error-category="model_unavailable"]')).toBeVisible();
    await expect(page.locator('.ai-read-field')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/https?:\/\/|:\d{2,5}/);
  } else {
    await expect(page.getByRole('button', { name: 'Run AI Read' })).toBeVisible();
    await page.getByRole('button', { name: 'Run AI Read' }).click();
    await expect(page.locator('.ai-read-field').first()).toBeVisible({ timeout: 150000 });
    await expect(page.locator('.ai-read-field[data-field-key="summary"]')).toContainText(
      'Routine procedural filing',
    );
    await expect(page.locator('.ai-read-panel')).toContainText('Local text extraction; candidate only');
    await expect(page.locator('.ai-read-panel')).not.toContainText(/\[\]|\{"found"|ai_suggested/);
    await expect(page.locator('.ai-read-panel')).not.toContainText('AI-generated');
    const arbitrationClause = page.locator('.ai-read-field[data-field-key="arbitration_clause"]');
    const extractedSummary = page.locator('.ai-read-field[data-field-key="summary"]');
    await expect(arbitrationClause).toBeVisible();
    await expect(extractedSummary).toBeVisible();
    await expect(arbitrationClause).toContainText('Not extracted');
    const summaryDisclosure = extractedSummary.locator('.ai-read-summary-disclosure');
    const collapsedSummaryHeight = await summaryDisclosure.boundingBox();
    expect(collapsedSummaryHeight).not.toBeNull();
    expect(collapsedSummaryHeight!.height).toBeLessThanOrEqual(160);
    await summaryDisclosure.locator('summary').click();
    await expect(summaryDisclosure).toContainText(/Unique page three clause/);
    await summaryDisclosure.locator('summary').click();
    await extractedSummary.scrollIntoViewIfNeeded();
    await page.locator('.ai-read-panel').scrollIntoViewIfNeeded();
    await captureViewport(page, 'documents-round5-airead-desktop-1440-populated-real', 1440, 900);
  }

  const pageThreeText = 'Unique page three clause: Sapphire Pavilion shall host the special procedural conference on the third calendar day.';
  await page.locator('.document-page-text-list summary').click();
  await page.locator('.document-page-text-list .document-page-citation').getByText('Page 3').click();
  await expect(page).toHaveURL(/page=3/);
  await expect(page.getByLabel('Jump to page')).toHaveValue('3', { timeout: 60000 });
  await expect(page.getByLabel('PDF page 3')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(pageThreeText)).toBeVisible();
  await expectPageRatio(page, 3);
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureViewport(page, 'documents-round5-citation-page3-desktop-1440-real', 1440, 900);

  expect(routeRegistrationCount).toBe(0);
  expect(document.content_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(document.page_count).toBe(5);
});
