import { expect, request, test, type APIRequestContext } from '@playwright/test';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8115').replace(/\/$/, '') + '/api/v1/';
let owner: APIRequestContext;
let researcher: APIRequestContext;
let anonymous: APIRequestContext;
let caseId = '';
let draftId = '';
let initialContent = '';

async function login(email: string) {
  const context = await request.newContext({ baseURL: apiBase });
  const response = await context.post('auth/login', { data: { email, password: 'tantara-local' } });
  expect(response.status()).toBe(200);
  const token = (await response.json()).access_token;
  await context.dispose();
  return request.newContext({ baseURL: apiBase, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

async function expectValidation(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  expect(response.status()).toBe(422);
  const body = await response.json() as any;
  expect(body.error.code).toBe('validation_error');
  expect(body.error.message).toBeTruthy();
  expect(Array.isArray(body.error.details)).toBeTruthy();
}

test.describe('real drafts and autofill HTTP contract', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    owner = await login('advocate@tantara.local');
    researcher = await login('researcher@tantara.local');
    anonymous = await request.newContext({ baseURL: apiBase });
    const cases = await owner.get('cases?page=1&page_size=100');
    const rows = (await cases.json()).items as Array<{ id: string; title: string }>;
    caseId = rows.find(x => x.title === 'TechBuild vs. Metro Infra')!.id;
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await researcher?.dispose();
    await anonymous?.dispose();
  });

  test('generate succeeds on empty corpus and rejects invalid or unauthenticated input', async () => {
    const unauthorized = await anonymous.post('drafts/generate', { data: {} });
    expect(unauthorized.status()).toBe(401);
    expect((await anonymous.get('draft-templates')).status()).toBe(401);
    const invalid = await owner.post('drafts/generate', { data: { document_type: 'Statement of Claim' } });
    await expectValidation(invalid);
    const templates = await owner.get('draft-templates');
    expect(templates.status()).toBe(200);
    expect((await templates.json()).items).toHaveLength(12);
    const generated = await owner.post('drafts/generate', { data: { case_id: caseId, document_type: 'Statement of Claim', template_id: '1' } });
    expect(generated.status()).toBe(200);
    const body = await generated.json();
    expect(body.status).toBe('no_evidence');
    expect(body.generation_kind).toBe('review_template');
    expect(body.content_markdown).toContain('TechBuild vs. Metro Infra');
    expect(body.content_markdown).toContain('[REVIEW:');
    draftId = body.draft_id;
    initialContent = body.content_markdown;
    const noTemplate = await owner.post('drafts/generate', { data: { case_id: caseId, document_type: 'Statement of Claim' } });
    expect(noTemplate.status()).toBe(200);
    expect((await noTemplate.json()).generation_kind).toBe('review_template');
  });

  test('versions, restore-as-new-version, section regeneration, and both real exports work', async () => {
    const create = await owner.post('drafts', { data: { title: 'Export with no versions', document_type: 'Statement of Claim', case_id: caseId, content_markdown: '# Initial draft\n\nEvidence remains reviewable.' } });
    expect(create.status()).toBe(200);
    const freshId = (await create.json()).id as string;
    const noVersions = await owner.get(`drafts/${freshId}/versions`);
    expect(noVersions.status()).toBe(200);
    expect((await noVersions.json()).items).toHaveLength(0);
    const emptyDocx = await owner.get(`drafts/${freshId}/export?format=docx`);
    expect(emptyDocx.status()).toBe(200);
    expect(emptyDocx.headers()['content-type']).toContain('officedocument.wordprocessingml.document');
    expect((await emptyDocx.body()).byteLength).toBeGreaterThan(200);
    const emptyPdf = await owner.get(`drafts/${freshId}/export?format=pdf`);
    expect(emptyPdf.status()).toBe(200);
    expect((await emptyPdf.body()).byteLength).toBeGreaterThan(200);

    const badVersion = await owner.post(`drafts/${draftId}/versions`, { data: {} });
    await expectValidation(badVersion);
    const save1 = await owner.post(`drafts/${draftId}/versions`, { data: { content_markdown: initialContent, change_note: 'Original' } });
    expect(save1.status()).toBe(200);
    const save2 = await owner.post(`drafts/${draftId}/versions`, { data: { content_markdown: `${initialContent}\nCounsel note.`, change_note: 'Edited' } });
    expect(save2.status()).toBe(200);
    const history = await owner.get(`drafts/${draftId}/versions`);
    expect((await history.json()).items.length).toBeGreaterThanOrEqual(3);
    await expectValidation(await owner.get(`drafts/${draftId}/versions?page=0`));
    const restored = await owner.post(`drafts/${draftId}/versions`, { data: { content_markdown: initialContent, change_note: 'Restored previous version' } });
    expect(restored.status()).toBe(200);

    const badSection = await owner.post(`drafts/${draftId}/regenerate-section`, { data: {} });
    await expectValidation(badSection);
    const before = (await owner.get(`drafts/${draftId}`)).json();
    const regenerated = await owner.post(`drafts/${draftId}/regenerate-section`, { data: { section_heading: 'Evidence', instructions: 'Use verified material only.' } });
    expect(regenerated.status()).toBe(200);
    const regeneratedBody = await regenerated.json();
    expect(regeneratedBody.content_markdown).toContain('## Evidence');
    expect(regeneratedBody.content_markdown.startsWith(initialContent)).toBeTruthy();
    expect((await before).content_markdown).toBe(initialContent);

    for (const format of ['docx', 'pdf']) {
      const output = await owner.get(`drafts/${draftId}/export?format=${format}`);
      expect(output.status()).toBe(200);
      expect(output.headers()['content-type']).toContain(format === 'pdf' ? 'application/pdf' : 'officedocument.wordprocessingml.document');
      const bytes = await output.body();
      expect(bytes.byteLength).toBeGreaterThan(200);
      expect(format === 'pdf' ? bytes.subarray(0, 4).toString() : bytes.subarray(0, 2).toString()).toBe(format === 'pdf' ? '%PDF' : 'PK');
    }
    const badFormat = await owner.get(`drafts/${draftId}/export?format=txt`);
    await expectValidation(badFormat);
  });

  test('autofill get, preview, apply, validation, and anonymous rejection work', async () => {
    const get = await owner.get(`cases/${caseId}/autofill`);
    expect(get.status()).toBe(200);
    const fields = (await get.json()).fields as Array<{ key: string; value: string; provenance: string }>;
    expect(fields.some(x => x.key === 'claimant' && x.provenance === 'verified')).toBeTruthy();
    const previewBad = await owner.post(`cases/${caseId}/autofill/preview`, { data: { keys: 'claimant' } });
    await expectValidation(previewBad);
    const preview = await owner.post(`cases/${caseId}/autofill/preview`, { data: { keys: ['title', 'claimant'] } });
    expect(preview.status()).toBe(200);
    expect((await preview.json()).fields.map((x: any) => x.key)).toEqual(expect.arrayContaining(['title', 'claimant']));
    const applyBad = await owner.post(`cases/${caseId}/autofill/apply`, { data: { fields: 'not-an-array' } });
    await expectValidation(applyBad);
    const claimant = fields.find(x => x.key === 'claimant')!;
    const applied = await owner.post(`cases/${caseId}/autofill/apply`, { data: { fields: [{ key: claimant.key, value: claimant.value, provenance: 'verified' }] } });
    expect(applied.status()).toBe(200);
    expect((await applied.json()).applied).toContain('claimant');
    for (const method of ['get','preview','apply'] as const) {
      const response = method === 'get' ? await anonymous.get(`cases/${caseId}/autofill`) : await anonymous.post(`cases/${caseId}/autofill/${method}`, { data: method === 'preview' ? { keys: [] } : { fields: [] } });
      expect(response.status()).toBe(401);
    }
  });

  test('another user cannot read a draft and anonymous access is rejected', async () => {
    const crossUserDraft = await researcher.get(`drafts/${draftId}`);
    expect([403, 404]).toContain(crossUserDraft.status());
    if (crossUserDraft.status() === 200) throw new Error('Cross-user draft data must never be returned.');
    expect((await anonymous.get(`drafts/${draftId}`)).status()).toBe(401);
    const anonVersions = await anonymous.get(`drafts/${draftId}/versions`);
    expect(anonVersions.status()).toBe(401);
    expect((await anonymous.post(`drafts/${draftId}/versions`, { data: { content_markdown: 'x' } })).status()).toBe(401);
    const anonSection = await anonymous.post(`drafts/${draftId}/regenerate-section`, { data: { section_heading: 'Test' } });
    expect(anonSection.status()).toBe(401);
    const anonExport = await anonymous.get(`drafts/${draftId}/export?format=pdf`);
    expect(anonExport.status()).toBe(401);
    const crossExport = await researcher.get(`drafts/${draftId}/export?format=pdf`);
    expect([403, 404]).toContain(crossExport.status());
    const crossSection = await researcher.post(`drafts/${draftId}/regenerate-section`, { data: { section_heading: 'Test' } });
    expect([403, 404]).toContain(crossSection.status());
    const crossVersions = await researcher.get(`drafts/${draftId}/versions`);
    expect([403, 404]).toContain(crossVersions.status());
    const crossVersionWrite = await researcher.post(`drafts/${draftId}/versions`, { data: { content_markdown: 'private' } });
    expect([403, 404]).toContain(crossVersionWrite.status());
  });
});
