import { execFileSync } from 'node:child_process';
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

async function captureMobile(page: Page, name: string) {
  const screenshotPath = `${screenshots}/${name}.png`;
  await page.screenshot({ path: screenshotPath });
  const pixelData = execFileSync('python', [
    '-c',
    [
      'from PIL import Image',
      'import json, sys',
      'image = Image.open(sys.argv[1]).convert("RGB")',
      'width, height = image.size',
      'points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]',
      'pixels = [image.getpixel(point) for point in points]',
      'print(json.dumps({"size": image.size, "pixels": pixels}))',
    ].join('; '),
    screenshotPath,
  ]).toString();
  const sampled = JSON.parse(pixelData) as { size: [number, number]; pixels: number[][] };
  expect(sampled.size).toEqual([390, 844]);
  for (const pixel of sampled.pixels) expect(pixel.some((channel) => channel > 32)).toBeTruthy();
}

async function expectPageRatio(page: Page, pageNumber: number) {
  const card = page.locator(`.pdf-page-card[data-page-card="${pageNumber}"]`);
  const ratio = Number(await card.getAttribute('data-page-ratio'));
  const bounds = await card.locator('canvas').boundingBox();
  expect(bounds).not.toBeNull();
  const renderedRatio = bounds!.width / bounds!.height;
  expect(Math.abs(renderedRatio - ratio) / ratio).toBeLessThan(0.01);
}

test('mobile library drawer, cards, viewer geometry, metadata, AI Read and page citation are usable', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 390, height: 844 });
  const token = await signIn(request);
  const headers = { Authorization: `Bearer ${token}` };
  const docsResponse = await request.get(`${apiUrl}/documents?page_size=100`, { headers });
  const docs = (await docsResponse.json()).items as Array<{
    id: string;
    filename: string;
    is_demo?: boolean;
  }>;
  expect(docs.filter((item) => item.is_demo).length).toBe(8);
  const seededDocument = docs.find((item) => item.filename === 'page-three-motion.pdf');
  expect(seededDocument).toBeTruthy();
  const settings = await request
    .get(`${apiUrl}/settings/ai`, { headers })
    .then((response) => response.json());

  await openWithToken(page, token, '/documents');
  const sidebar = page.locator('.sidebar');
  const main = page.locator('#main');
  const heading = page.getByRole('heading', { name: 'Documents', exact: true });
  await expect(heading).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.documents-mobile-cards .document-card')).toHaveCount(docs.length);
  await expect.poll(() => page.evaluate(() => window.document.documentElement.scrollWidth)).toBe(390);
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  const headingBounds = await heading.boundingBox();
  expect(headingBounds).not.toBeNull();
  expect(headingBounds!.x).toBeGreaterThanOrEqual(0);
  expect(headingBounds!.x + headingBounds!.width).toBeLessThanOrEqual(390);
  const sidebarBounds = await sidebar.boundingBox();
  const mainBounds = await main.boundingBox();
  expect(sidebarBounds).not.toBeNull();
  expect(mainBounds).not.toBeNull();
  expect(
    sidebarBounds!.x < mainBounds!.x + mainBounds!.width &&
      sidebarBounds!.x + sidebarBounds!.width > mainBounds!.x,
  ).toBeFalsy();
  await captureMobile(page, 'documents-round5-library-mobile-390-real');

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await expect(heading).toBeVisible();
  const documentLink = page
    .locator('.documents-mobile-cards')
    .getByRole('link', { name: 'Page Three Motion' });
  await documentLink.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${seededDocument!.id}$`));
  await expect(page.getByLabel('PDF page 1')).toBeVisible({ timeout: 60000 });
  await expect(page.getByLabel('PDF page 1')).toHaveAttribute('data-rendered', 'true', {
    timeout: 60000,
  });
  await expect(page.getByText('Loading PDF pages…')).toHaveCount(0);
  await expect(page.getByLabel('Jump to page')).toHaveValue('1');
  await expectPageRatio(page, 1);
  await expect.poll(() => page.evaluate(() => window.document.documentElement.scrollWidth)).toBe(390);
  await captureMobile(page, 'documents-round5-viewer-mobile-390-real');

  await page.locator('.document-metadata').scrollIntoViewIfNeeded();
  await expect(page.getByRole('group', { name: /^Filename / })).toBeVisible();
  await expect(page.locator('.document-metadata')).toContainText('Jurisdiction India');
  await captureMobile(page, 'documents-round5-metadata-mobile-390-real');

  if (settings.runtime_status?.reachable) {
    await page.getByRole('button', { name: 'Run AI Read' }).click();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 150000 });
    await expect(page.locator('.ai-read-field').first()).toBeVisible({ timeout: 150000 });
    const arbitrationClause = page.locator('.ai-read-field[data-field-key="arbitration_clause"]');
    const summary = page.locator('.ai-read-field[data-field-key="summary"]');
    await expect(arbitrationClause).toBeVisible();
    await expect(summary).toContainText('Routine procedural filing');
    await expect(summary).toContainText('Local text extraction; candidate only');
    const summaryDisclosure = summary.locator('.ai-read-summary-disclosure');
    const collapsedHeight = await summaryDisclosure.boundingBox();
    expect(collapsedHeight).not.toBeNull();
    expect(collapsedHeight!.height).toBeLessThanOrEqual(160);
    await summaryDisclosure.locator('summary').click();
    await expect(summaryDisclosure).toContainText(/Unique page three clause/);
    await summaryDisclosure.locator('summary').click();
    await arbitrationClause.scrollIntoViewIfNeeded();
    await expect(summary).toBeVisible();
    await captureMobile(page, 'documents-round5-airead-mobile-390-populated-real');
  } else {
    await page.getByRole('button', { name: 'Run AI Read' }).click();
    await expect(page.locator('[data-error-category="model_unavailable"]')).toBeVisible();
    await expect(page.locator('.ai-read-field')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/https?:\/\/|:\d{2,5}/);
    await captureMobile(page, 'documents-round5-airead-mobile-390-unavailable-real');
  }

  await page.locator('.document-page-text-list summary').click();
  await page.locator('.document-page-text-list .document-page-citation').getByText('Page 3').click();
  await expect(page).toHaveURL(/page=3/);
  await expect(page.getByLabel('Jump to page')).toHaveValue('3', { timeout: 60000 });
  await expect(page.getByLabel('PDF page 3')).toBeVisible({ timeout: 60000 });
  await expect(page.getByLabel('PDF page 3')).toHaveAttribute('data-rendered', 'true', {
    timeout: 60000,
  });
  await expect(page.locator('#page-3')).toContainText(
    /Unique page three clause: Sapphire Pavilion shall host the special procedural conference/,
  );
  await expect(page.locator('.pdf-page-card[data-page-card="3"] .pdf-text-layer')).toContainText(
    /Unique page three clause/,
  );
  await expectPageRatio(page, 3);
  await captureMobile(page, 'documents-round5-citation-page3-mobile-390-real');
});
