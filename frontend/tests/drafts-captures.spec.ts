import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

const apiOrigin = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8115').replace(/\/$/, '');
const apiV1 = `${apiOrigin}/api/v1`;
const shots = '../docs/screenshots';
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function login(api: APIRequestContext) {
  const response = await api.post(`${apiV1}/auth/login`, { data: { email: 'advocate@tantara.local', password: 'tantara-local' } });
  expect(response.status()).toBe(200);
  return (await response.json()).access_token as string;
}
async function settle(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.skeleton, [class*="skeleton"]')).toHaveCount(0);
}
async function capture(page: Page, name: string, viewport: typeof desktop | typeof mobile) {
  await page.setViewportSize(viewport);
  if (viewport.width === 390) {
    await page.waitForTimeout(250); // allow the sidebar's CSS close transition to finish before measuring it
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, 'mobile document must not overflow horizontally').toBeLessThanOrEqual(390);
    const sidebar = page.locator('.sidebar');
    const heading = page.locator('main h1').first();
    const targets = [heading, page.locator('.draft-editor').first(), page.locator('#case').first()];
    const side = await sidebar.boundingBox();
    if (side) for (const target of targets) {
      if (!await target.count() || !await target.isVisible()) continue;
      const box = await target.boundingBox();
      if (box) expect(side.x + side.width <= box.x || box.x + box.width <= side.x || side.y + side.height <= box.y || box.y + box.height <= side.y, `closed sidebar ${JSON.stringify(side)} must not intersect ${JSON.stringify(box)}`).toBeTruthy();
    }
  }
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}
async function docxText(bytes: Buffer) {
  const { inflateRawSync } = await import('node:zlib');
  for (let offset = 0; offset + 30 < bytes.length;) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
    const method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();
    const start=offset+30+nameLength+extraLength,end=start+size;
    if(name==='word/document.xml')return (method===8?inflateRawSync(bytes.subarray(start,end)):bytes.subarray(start,end)).toString('utf8');
    offset=end;
  }
  throw new Error('DOCX archive is missing word/document.xml');
}
function ascii85Decode(input: string) {
  const source=input.replace(/\s|~>/g,'');const out:number[]=[];
  for(let i=0;i<source.length;){
    if(source[i]==='z'){out.push(0,0,0,0);i++;continue;}
    const part=source.slice(i,i+5);i+=part.length;if(part.length<2)break;
    const count=part.length;let value=0;
    const padded=part.padEnd(5,'u');for(const ch of padded)value=value*85+(ch.charCodeAt(0)-33);
    const bytes=Buffer.alloc(4);bytes.writeUInt32BE(value>>>0);out.push(...bytes.subarray(0,count-1));
  }
  return Buffer.from(out);
}

 test('captures live seeded drafts and autofill states at desktop and mobile sizes', async ({ page }) => {
  test.setTimeout(420_000);
  const api = await request.newContext();
  const token = await login(api);
  const headers = { Authorization: `Bearer ${token}` };
  await page.addInitScript(value => localStorage.setItem('tantara_token', value), token);
  const casesResponse = await api.get(`${apiV1}/cases?page=1&page_size=100`, { headers });
  expect(casesResponse.status()).toBe(200);
  const cases = (await casesResponse.json()).items as Array<Record<string, any>>;
  const selectedCase = cases.find(c => c.title === 'ABC Pvt. Ltd. vs. XYZ Ltd.');
  if (!selectedCase) throw new Error('Seeded case ABC Pvt. Ltd. vs. XYZ Ltd. is required for real-backend captures.');
  const caseReference = String(selectedCase.reference_number);
  const templatesResponse = await api.get(`${apiV1}/draft-templates`, { headers });
  expect(templatesResponse.status()).toBe(200);
  const template = (await templatesResponse.json()).items[0];
  const initialDraftList = await api.get(`${apiV1}/drafts?page=1&page_size=100`, { headers });
  let existingDrafts = (await initialDraftList.json()).items as Array<Record<string, any>>;
  for (let i=existingDrafts.length; i<21; i++) {
    const create = await api.post(`${apiV1}/drafts`, { headers, data: { title: `Mobile list review ${i+1}`, document_type: 'Statement of Claim', case_id: selectedCase.id, content_markdown: '[REVIEW: Confirm the facts before filing.]' } });
    expect(create.status()).toBe(200);
  }
  const boundList = await api.get(`${apiV1}/drafts?page=1&page_size=100`, { headers });
  existingDrafts = (await boundList.json()).items;
  expect(existingDrafts.length).toBeGreaterThanOrEqual(21);
  const aiSettingsResponse = await api.get(`${apiV1}/settings/ai`, { headers });
  const originalAI = await aiSettingsResponse.json();

  await page.setViewportSize(desktop);
  await page.goto('/drafts');
  await expect(page.getByRole('heading', { name: 'AI Case Drafts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a draft' })).toBeVisible();
  await capture(page, 'drafts-list-desktop-1440', desktop);
  await capture(page, 'drafts-list-mobile-390', mobile);
  const startBox = await page.getByRole('link', { name: 'Start a draft' }).boundingBox();
  expect(startBox && startBox.y + startBox.height).toBeLessThanOrEqual(844);
  const firstRow = page.locator('.draft-recent-list .draft-version').first();
  await expect(page.locator('.draft-recent-list .draft-version')).toHaveCount(21);
  const rowText = firstRow.locator('span');
  await expect(rowText.locator('strong')).toBeVisible();
  await expect(rowText.locator('small')).toHaveCount(2);
  await page.setViewportSize(desktop);

  await page.locator('#case').selectOption(String(selectedCase.id));
  const source = page.locator('.draft-source input').first();
  if (await source.count()) await source.check();
  await expect(page.locator('#case')).toHaveValue(String(selectedCase.id));
  await page.getByRole('button', { name: 'Generate Draft' }).click();
  await expect(page.locator('.draft-editor')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('.draft-case-reference')).toContainText(caseReference);
  const draftUrl = new URL(page.url());
  const draftId = draftUrl.searchParams.get('id');
  expect(draftId).toBeTruthy();
  const persisted = await api.get(`${apiV1}/drafts/${draftId}`, { headers });
  expect(persisted.status()).toBe(200);
  const generated = await persisted.json();
  expect(generated.content_markdown).toContain(selectedCase.title);
  expect(generated.content_markdown).toContain(selectedCase.claimant);
  expect(generated.content_markdown).toContain(selectedCase.respondent);
  for (const line of generated.content_markdown.split('\n').filter((x: string) => /^Claimant:/i.test(x))) expect(line).toContain(selectedCase.claimant);
  for (const line of generated.content_markdown.split('\n').filter((x: string) => /^Respondent:/i.test(x))) expect(line).toContain(selectedCase.respondent);
  await expect(page.locator('.draft-review-summary')).toBeVisible();
  await expect(page.locator('.draft-review-item').first()).toContainText('[REVIEW:');
  expect(await page.locator('.draft-editor').innerText()).not.toMatch(UUID);
  await expect(page.locator('.draft-editor [data-chunk-id]').first()).toHaveAttribute('data-chunk-id', UUID);
  expect(await page.locator('.draft-editor').innerText()).not.toMatch(UUID);
  expect(await page.locator('.draft-editor h2').filter({ hasText: 'Case Details' }).count()).toBeLessThanOrEqual(1);
  await expect(page.locator('.draft-citation').first().locator('.draft-page-chips a').first()).toContainText('Page');
  await capture(page, 'draft-editor-desktop-1440', desktop);
  await capture(page, 'draft-editor-mobile-390', mobile);
  await capture(page, 'draft-review-needed-desktop-1440', desktop);
  await capture(page, 'draft-review-needed-mobile-390', mobile);

  const beforeEdit = await api.get(`${apiV1}/drafts/${draftId}/versions`, { headers });
  const initialVersions = (await beforeEdit.json()).items as Array<Record<string, any>>;
  const generatedVersionId = initialVersions[0]?.id;
  const uniquePhrase = 'COUNSEL REVIEW PHRASE LUNA 2026';
  const editor = page.locator('.draft-editor');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(uniquePhrase);
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByRole('status')).toContainText(/saved/i);
  await page.reload();
  await expect(page.locator('.draft-editor')).toContainText(uniquePhrase);
  const reloaded = await api.get(`${apiV1}/drafts/${draftId}`, { headers });
  expect((await reloaded.json()).content_markdown).toContain(uniquePhrase);
  const savedVersions = (await (await api.get(`${apiV1}/drafts/${draftId}/versions`, { headers })).json()).items as Array<Record<string, any>>;
  expect(savedVersions.length).toBeGreaterThan(initialVersions.length);
  expect(savedVersions.some(v => v.id === generatedVersionId)).toBeTruthy();
  await expect(page.locator('.draft-version-row').first()).toContainText('Current');
  await expect(page.locator('.draft-version-row').first().locator('time span')).toHaveCount(2);
  await expect(page.locator('.draft-version-row').first().locator('strong')).toContainText('Version');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restore' }).last().click();
  await expect(page.getByRole('status')).toContainText(/restored/i, { timeout: 20_000 });
  const restoredTitle = String(initialVersions[0]?.content_markdown ?? '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 20);
  await expect(page.locator('.draft-editor')).toContainText(restoredTitle);
  await capture(page, 'draft-version-history-desktop-1440', desktop);
  await capture(page, 'draft-version-history-mobile-390', mobile);

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(uniquePhrase);
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByRole('status')).toContainText(/saved/i);

  for (const format of ['docx', 'pdf'] as const) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format.toUpperCase()}` }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const bytes = await fs.readFile(path!);
    expect(bytes.byteLength).toBeGreaterThan(200);
    expect(format === 'docx' ? bytes.subarray(0, 4).toString() : bytes.subarray(0, 4).toString()).toBe(format === 'docx' ? 'PK\x03\x04' : '%PDF');
    if (format === 'docx') {
      const xml = await docxText(bytes);
      expect(xml).toContain('[REVIEW:');
      expect(xml).toContain(uniquePhrase);
    } else {
      const { inflateSync } = await import('node:zlib');
      const raw = bytes.toString('latin1');
      const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\n?endstream/g)].map(match => {
        try { return inflateSync(ascii85Decode(match[1])).toString('latin1'); } catch { return match[1]; }
      }).join('\n');
      expect(`${raw}\n${streams}`).toContain('[REVIEW:');
      expect(`${raw}\n${streams}`).toContain(uniquePhrase);
    }
  }

  await page.goto('/autofill');
  await page.locator('#autofill-case').selectOption(String(selectedCase.id));
  await expect(page.locator('.auto-field').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Preview fields' }).click();
  await expect(page.getByRole('status')).toContainText(/Preview loaded/i);
  await expect(page.locator('.auto-provenance').first()).toBeVisible();
  const sourcedField = page.locator('.auto-field').filter({ has: page.locator('.auto-source-link') }).first();
  const sourcedProvenance = await sourcedField.locator('.auto-provenance').innerText();
  const sourcedLabel = await sourcedField.locator('label').innerText();
  await sourcedField.getByRole('button', { name: 'Accept', exact: true }).click();
  await capture(page, 'autofill-preview-desktop-1440', desktop);
  await capture(page, 'autofill-preview-mobile-390', mobile);
  if (await page.locator('.auto-sources .auto-source').count()) await expect(page.locator('.auto-sources .auto-source').first()).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  const applyBox = await page.getByRole('button', { name: 'Apply to Draft' }).boundingBox();
  expect(applyBox && applyBox.y + applyBox.height).toBeLessThanOrEqual(844);
  await page.setViewportSize(desktop);
  await expect.poll(() => page.locator('#autofill-draft option').count(), { timeout: 15_000 }).toBeGreaterThan(1);
  await page.locator('#autofill-draft').selectOption(String(draftId));
  const accepted = await sourcedField.locator('input').inputValue();
  await page.getByRole('button', { name: 'Apply to Draft' }).click();
  await expect(page.getByRole('status')).toContainText(/Applied/i);
  const afterApply = (await (await api.get(`${apiV1}/drafts/${draftId}`, { headers })).json()).content_markdown as string;
  expect(afterApply).toContain(accepted);
  const expectedProvenance = sourcedProvenance.includes('Extracted') ? 'extracted_reviewed' : 'verified';
  expect(afterApply).toContain(`- ${sourcedLabel}: ${accepted} (provenance: ${expectedProvenance})`);
  expect(afterApply).toContain('source:');
  await capture(page, 'autofill-applied-desktop-1440', desktop);
  await capture(page, 'autofill-applied-mobile-390', mobile);
  await page.reload();
  await page.locator('#autofill-case').selectOption(String(selectedCase.id));
  await expect.poll(() => page.locator('#autofill-draft option').count(), { timeout: 15_000 }).toBeGreaterThan(1);
  await page.locator('#autofill-draft').selectOption(String(draftId));
  expect((await (await api.get(`${apiV1}/drafts/${draftId}`, { headers })).json()).content_markdown).toContain(accepted);

  await api.patch(`${apiV1}/settings/ai`, { headers, data: { base_url: 'http://127.0.0.1:8999/v1', model: originalAI.model, top_k: originalAI.top_k, temperature: originalAI.temperature } });
  await page.goto('/drafts');
  await page.locator('#case').selectOption(String(selectedCase.id));
  await page.getByRole('button', { name: 'Generate Draft' }).click();
  await expect(page.getByRole('status')).toContainText(/local model is unavailable/i, { timeout: 60_000 });
  const unavailableId = new URL(page.url()).searchParams.get('id');
  expect(unavailableId).toBeTruthy();
  const draftsBeforeRetry = (await (await api.get(`${apiV1}/drafts?page=1&page_size=100`, { headers })).json()).total;
  await capture(page, 'draft-model-unavailable-desktop-1440', desktop);
  await capture(page, 'draft-model-unavailable-mobile-390', mobile);
  await page.getByRole('button', { name: 'Retry generation' }).click();
  await expect(page.getByRole('status')).toContainText(/local model is unavailable/i, { timeout: 60_000 });
  expect(new URL(page.url()).searchParams.get('id')).not.toBe(unavailableId);
  const draftsAfterRetry = (await (await api.get(`${apiV1}/drafts?page=1&page_size=100`, { headers })).json()).total;
  expect(draftsAfterRetry).toBeGreaterThan(draftsBeforeRetry);
  await api.patch(`${apiV1}/settings/ai`, { headers, data: { base_url: originalAI.base_url, model: originalAI.model, top_k: originalAI.top_k, temperature: originalAI.temperature } });
  await api.dispose();
});
