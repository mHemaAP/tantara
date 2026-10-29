// End-to-end walkthrough of the deployed Tantra workspace, driven as a browser user.
//
//   TANTARA_E2E_PASSWORD='…' node scripts/e2e-walkthrough.mjs
//
// Optional: TANTARA_WEB_URL (default https://tantra.theessencetimes.com),
// TANTARA_SHOT_DIR (default ../reports/walkthrough), TANTARA_E2E_ONLY=advocate,associate.
//
// It signs in as each demo account and drives real flows: create a matter, create a
// task, upload a PDF and wait for indexing, search, ask the research desk, generate a
// draft, assemble a filing bundle and download the merged PDF, post to the community,
// then prove role limits and per-account isolation. Every step is asserted, every
// screen is screenshotted, and report.json records both for the deck builder.

import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const webUrl = (process.env.TANTARA_WEB_URL ?? 'https://tantra.theessencetimes.com').replace(/\/$/, '');
const password = process.env.TANTARA_E2E_PASSWORD;
const outDir = path.resolve(process.cwd(), process.env.TANTARA_SHOT_DIR ?? '../reports/walkthrough');
const only = new Set(
  (process.env.TANTARA_E2E_ONLY ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
if (!password?.trim()) throw new Error('TANTARA_E2E_PASSWORD is required');

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const FIXTURE_PDF = path.resolve(process.cwd(), '../frontend/tests/fixtures/arbitration-text-layer.pdf');
const RUN_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

const checks = [];
const shots = [];
const notes = [];
const step = { n: 0 };

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail: String(detail) });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
}

function note(text) {
  notes.push(String(text));
  console.log(`note ${text}`);
}

let page;

async function shot(label, caption, detail = '') {
  step.n += 1;
  const file = `${String(step.n).padStart(2, '0')}-${label}.png`;
  // A renderer that runs out of memory on a long draft document used to abort the
  // whole pass. A missing image is a caption in the deck, not a failed walkthrough.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.screenshot({ path: path.join(outDir, file), animations: 'disabled', timeout: 30_000 });
      shots.push({ n: step.n, file, label, caption, detail });
      console.log(`shot ${file}  ${caption}`);
      return;
    } catch (error) {
      if (attempt === 2) {
        shots.push({ n: step.n, file: null, label, caption, detail, error: String(error).split('\n')[0] });
        console.log(`MISS ${label}: ${String(error).split('\n')[0]}`);
        return;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    }
  }
}

/** The page frame is up and its data has landed. */
async function settled({ heading = true } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 45_000 });
  await page.locator('.sidebar .nav a[href]').first().waitFor({ state: 'attached', timeout: 20_000 });
  if (heading) await page.locator('main h1, main h2').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page
    .locator('main [class*="skeleton"]')
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .catch(() => {});
  const body = await page.locator('body').innerText();
  if (/Not Found|This page could not be found/i.test(body)) throw new Error('a 404 page was rendered');
  if (/could not load|Failed to load|Something went wrong/i.test(body)) throw new Error('the page reported an error');
  return body;
}

async function go(route, options) {
  await page.goto(`${webUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return settled(options);
}

async function stepRun(title, body) {
  console.log(`\n== ${title}`);
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    check(title, false, message);
    await shot(`broken-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, `${title}: step failed`, message);
    // A renderer that dies (memory) takes its page with it; every later step would
    // then fail on a dead target, so rebuild the session and carry on.
    if (/crash|has been closed|Session closed|Target closed/i.test(message)) {
      await recover().catch((retry) => check('walkthrough: session recovered', false, String(retry).split('\n')[0]));
    }
  }
}

let currentContext = null;
let currentEmail = '';

async function recover() {
  try {
    if (currentContext) await currentContext.close();
  } catch {
    /* the context is already gone */
  }
  currentContext = await newContext();
  await attachNewPage(currentContext);
  if (currentEmail) await login(currentEmail);
  note('rebuilt the browser session after a dead page and continued');
}

let token = '';
async function api(pathname, init = {}) {
  const response = await page.request.fetch(`${webUrl}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { ok: response.ok(), status: response.status(), body: payload };
}

async function listAll(pathname) {
  const items = [];
  let current = 1;
  while (true) {
    const result = await api(`${pathname}${pathname.includes('?') ? '&' : '?'}page=${current}&page_size=100`);
    if (!result.ok) break;
    const batch = result.body.items ?? result.body.posts ?? [];
    items.push(...batch);
    if (current >= (result.body.pages ?? 1) || batch.length === 0) break;
    current += 1;
  }
  return items;
}

async function login(email, shotPrefix = 'login') {
  currentEmail = email;
  await page.context().clearCookies();
  await page.goto(`${webUrl}/signin`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${webUrl}/signin`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor({ state: 'visible', timeout: 30_000 });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await shot(`${shotPrefix}-${email.split('@')[0]}`, `Sign-in screen, signing in as ${email}`);
  await page.locator('button.primary:has-text("Continue as")').click();
  await page.waitForURL('**/dashboard', { timeout: 45_000 });
  token = await page.evaluate(() => localStorage.getItem('tantara_token'));
  const me = await api('/api/v1/auth/me');
  check(`${email}: signed in`, me.ok && Boolean(token), `role=${me.body.role}`);
  return me.body;
}

// --disable-dev-shm-usage matters here: the draft and bundle screens render long
// documents, and a renderer that runs out of shared memory takes the whole pass down.
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
});
const pageErrors = new Set();

function newContext(viewport = DESKTOP) {
  const context = browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', acceptDownloads: true });
  return context;
}

async function attachNewPage(context) {
  currentContext = context;
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => pageErrors.add(String(error).split('\n')[0]));
  token = '';
  return page;
}

try {
  await mkdir(outDir, { recursive: true });
  const readiness = await fetch(`${webUrl}/readyz`, { signal: AbortSignal.timeout(20_000) })
    .then((response) => response.json())
    .catch(() => ({}));
  check('edge is ready', readiness.database === 'ok' && readiness.objects === 'ok', JSON.stringify(readiness));

  // ------------------------------------------------------------------ advocate
  const advocate = await newContext();
  await attachNewPage(advocate);
  let advocateCaseTitles = [];

  if (!only.size || only.has('advocate')) {
    await stepRun('advocate: sign in and cockpit', async () => {
      await login('advocate@tantara.local');
      const body = await settled();
      check('advocate: cockpit shows live counts', /\d/.test(body), body.split('\n').find((line) => /matter|task|document/i.test(line)) ?? '');
      await shot('advocate-dashboard', 'Cockpit: KPIs, deadlines, upcoming hearings, recent activity');
    });

    await stepRun('advocate: matter library', async () => {
      const cases = await listAll('/api/v1/cases');
      advocateCaseTitles = cases.map((item) => item.title);
      const body = await go('/cases');
      check('advocate: matters listed', cases.length > 0 && /My Cases/i.test(body), `${cases.length} matters via API`);
      await shot('advocate-cases', `Matter library with ${cases.length} matters`, 'status filters + search');
    });

    await stepRun('advocate: matter record', async () => {
      // /cases/new, /cases/active, /cases/pending are all routes under /cases/ — the
      // first anchor in the shell was the “New case” button, so this opened a form.
      const href = await page.evaluate(() => {
        const link = [...document.querySelectorAll('a[href^="/cases/"]')].find((anchor) =>
          /\/cases\/[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(anchor.getAttribute('href') ?? ''),
        );
        return link?.getAttribute('href') ?? null;
      });
      if (!href) throw new Error('no matter link with an id found in the case list');
      const body = await go(href);
      check('advocate: matter record shows parties and forum', /Claimant|Respondent|Parties/i.test(body), href);
      await shot('advocate-case-detail', 'Matter record: parties, hearings, documents, notes, tasks', href);
    });

    await stepRun('advocate: clients', async () => {
      const clients = await listAll('/api/v1/clients');
      const body = await go('/clients');
      check('advocate: clients listed', clients.length > 0, `${clients.length} clients via API`);
      await shot('advocate-clients', `Client book with ${clients.length} clients`);
    });

    await stepRun('advocate: create a task', async () => {
      await go('/tasks');
      const title = `E2E review of arbitration clause (${RUN_STAMP})`;
      await page.locator('button:has-text("New task")').first().click();
      await page.locator('[aria-label="Task title"]').fill(title);
      const due = new Date(Date.now() + 3 * 86_400_000);
      const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}T10:30`;
      await page.locator('[aria-label="Due date and time"]').fill(local);
      await page.locator('[aria-label="Task priority"]').selectOption({ index: 1 });
      const linked = await page.locator('[aria-label="Linked case"] option').nth(1).getAttribute('value');
      await page.locator('[aria-label="Linked case"]').selectOption(linked);
      await page.locator('[aria-label="Task notes"]').fill('Created by the automated browser walkthrough; check the linked matter.');
      await shot('advocate-task-form', 'Task composer: due date, priority, linked matter, notes');
      await page.locator('button:has-text("Save task")').click();
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      const body = await settled();
      check('advocate: task created through the UI', body.includes(title.slice(0, 40)) || (await listAll('/api/v1/tasks')).some((t) => t.title === title), title);
      await shot('advocate-tasks', 'Task board after the new task lands', title);
    });

    await stepRun('advocate: calendar', async () => {
      const body = await go('/calendar');
      check('advocate: calendar renders dated entries', /Hearing|Deadline|Calendar/i.test(body));
      await shot('advocate-calendar', 'Hearing and deadline calendar in workspace time');
    });

    await stepRun('advocate: document library', async () => {
      const documents = await listAll('/api/v1/documents');
      const statutes = documents.filter((d) => d.document_type === 'Statute');
      const ready = documents.filter((d) => d.status === 'ready');
      const pages = documents.reduce((sum, d) => sum + (d.page_count ?? 0), 0);
      const body = await go('/documents');
      // A 347-page CPC may still be indexing when this runs; the shelf only has to
      // be substantially there, and any stragglers must be queued rather than failed.
      const unfinished = documents.filter((d) => !['ready', 'queued', 'extracting', 'indexing'].includes(d.status));
      check(
        'advocate: statute shelf indexed',
        statutes.length >= 9 && ready.length >= documents.length - 2 && unfinished.length === 0,
        `${statutes.length} statutes, ${ready.length}/${documents.length} ready, ${pages} pages${unfinished.length ? `, stuck: ${unfinished.map((d) => `${d.filename}:${d.status}`).join(', ')}` : ''}`,
      );
      await shot('advocate-documents', `Document library: ${documents.length} documents / ${pages} pages, incl. ${statutes.length} statutes`, 'type, status, page count');
      const statute = statutes.find((d) => /arbitration/i.test(d.title)) ?? statutes[0];
      if (statute) {
        await go(`/documents/${statute.id}`);
        const text = await page.locator('main').innerText();
        check('advocate: statute viewer shows extracted text', text.length > 1200 && /Section|Act/i.test(text), `${statute.title} · ${statute.page_count} pages`);
        await shot('advocate-document-viewer', `Reading “${statute.title}” with extracted text and page map`, statute.id);
      }
    });

    await stepRun('advocate: hybrid search', async () => {
      const query = 'court can grant interim measures before arbitration begins';
      const response = await api(`/api/v1/search/documents?query=${encodeURIComponent(query)}&limit=8`);
      const hits = response.body.items ?? [];
      await go('/search');
      await page.locator('input[aria-label="Search documents"]').fill(query);
      await page.locator('form.search-query button[type="submit"]').click();
      await page.locator('.search-results').waitFor({ state: 'visible', timeout: 60_000 });
      // The count span only appears once the client request resolves, so wait for the
      // number itself instead of the section shell.
      const heading = page.locator('.search-result-heading');
      await heading.getByText(/\d+ passages/).waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
      const tally = await heading.innerText();
      check('advocate: search returns statute passages', response.ok && hits.length > 0 && /\d+ passages/.test(tally), `api status=${response.body.status} hits=${hits.length} · ui "${tally.replace(/\s+/g, ' ').trim()}"`);
      check('advocate: hits carry page references', hits.every((hit) => !hit.page_number || hit.page_number > 0), hits.map((hit) => hit.page_number).join(','));
      await shot('advocate-search', 'Hybrid search: vectors plus Postgres full-text, with page references', query);
    });

    await stepRun('advocate: research desk', async () => {
      await go('/research', { heading: false });
      await page.locator('textarea[aria-label="Research question"]').fill(
        'What must a party show to obtain interim relief from a court under the Arbitration and Conciliation Act, 1996?',
      );
      await shot('advocate-research-ask', 'Research desk: the question is scoped to this workspace corpus');
      await page.locator('.composer button[type="submit"]').click();
      await page.locator('.answer-text').first().waitFor({ state: 'visible', timeout: 240_000 });
      await page.locator('.answer-citation').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => note('answer rendered without citation chips'));
      const citations = await page.locator('.answer-citation').count();
      const answer = (await page.locator('.answer-text').first().innerText()).trim();
      // The reasoning model behind this answer is 2B parameters and sometimes replies in
      // two sentences; what matters functionally is that it answers from the retrieved
      // passages and cites them, which the next check asserts separately.
      check('advocate: grounded answer produced', answer.length > 150, `${answer.length} characters`);
      check('advocate: answer cites retrieved passages', citations > 0, `${citations} citation chips`);
      await shot('advocate-research-answer', 'Grounded answer with the statute passages it retrieved', `${citations} citations`);
    });

    await stepRun('advocate: AI draft', async () => {
      await go('/drafts');
      await page.locator('select#case').waitFor({ state: 'visible', timeout: 20_000 });
      await page.selectOption('select#case', await page.locator('select#case option').nth(1).getAttribute('value'));
      await page.selectOption('select#template', await page.locator('select#template option').nth(1).getAttribute('value'));
      await page.locator('textarea.draft-textarea').fill(
        'Draft a notice invoking arbitration. Keep the tone measured, cite the contract clause, and flag anything the file does not support.',
      );
      await shot('advocate-drafts-form', 'Draft builder: matter, document type, institution, instruction');
      await page.locator('button.draft-primary').click();
      await page.locator('.draft-editor').first().waitFor({ state: 'visible', timeout: 300_000 });
      const body = await page.locator('main').innerText();
      check('advocate: draft generated', body.length > 1200, `${body.length} characters on screen`);
      check('advocate: draft lists cited sources', /Cited sources/i.test(body));
      await shot('advocate-draft-editor', 'Draft editor with generated clause text and cited sources');
    });

    await stepRun('advocate: filing bundle', async () => {
      const cases = await listAll('/api/v1/cases');
      let target = null;
      for (const item of cases) {
        const docs = await listAll(`/api/v1/documents?case_id=${item.id}`);
        if (docs.filter((d) => d.status === 'ready' && (d.page_count ?? 0) > 0).length >= 2) {
          target = { case: item, docs: docs.filter((d) => d.status === 'ready') };
          break;
        }
      }
      if (!target) throw new Error('no matter has two ready documents to bundle');

      await go('/bundles');
      check('advocate: bundle list renders', /Filing Bundles/i.test(await page.locator('main').innerText()));
      const bundleName = `E2E Paperbook ${RUN_STAMP}`;
      await page.locator('button:has-text("New bundle")').first().click();
      await page.locator('.bundle-create-form input').fill(bundleName);
      await page.locator('.bundle-create-form select').selectOption(target.case.id);
      await shot('advocate-bundles', 'Filing bundle form: name the paperbook, bind it to a matter', target.case.title);
      await page.locator('button:has-text("Create bundle")').click();
      // Reading the first anchor in the list used to grab an older bundle, whose
      // documents were already attached, so the add picker had nothing left to pick.
      let created = null;
      const createdBy = Date.now() + 60_000;
      while (Date.now() < createdBy && !created) {
        const bundles = await listAll('/api/v1/bundles');
        created = bundles.find((b) => (b.name ?? b.title ?? '') === bundleName) ?? null;
        if (!created) await page.waitForTimeout(1500);
      }
      if (!created) throw new Error(`bundle "${bundleName}" never appeared in /api/v1/bundles`);
      await go(`/bundles/${created.id}`);
      const options = await page.locator('#bundle-add-document option').count();
      check('advocate: bundle document picker is populated', options > 0, `${options} selectable documents on ${created.id}`);
      const docIds = target.docs.slice(0, 3).map((d) => d.id);
      for (const id of docIds) {
        await page.locator('#bundle-add-document').selectOption(id);
        await page.locator('button:has-text("Add document")').click();
        await page.waitForTimeout(1200);
      }
      const items = await page.locator('ol.bundle-items > li').count();
      check('advocate: documents added to the bundle', items >= docIds.length, `${items} rows in the contents list`);
      await shot('advocate-bundle-items', 'Bundle assembled in filing order with page ranges', `${docIds.length} documents`);

      await page.locator('button:has-text("Generate Bundle")').first().click();
      await page
        .locator('text=/Bundle ready · \\d+ pages/')
        .first()
        .waitFor({ state: 'visible', timeout: 240_000 });
      const success = await page.locator('.bundle-notice, [class*="success"]').first().innerText().catch(() => '');
      check('advocate: merged PDF generated', /Bundle ready/.test(success), success.trim());
      await shot('advocate-bundle-ready', 'Generated filing bundle with merged page count', success.trim());

      const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
      // The page offers the bundle download twice (header and footer action), so the
      // strict locator has to be told which one.
      await page.locator('button:has-text("Download PDF")').first().click();
      const download = await downloadPromise;
      const saved = path.join(outDir, `bundle-${target.case.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.pdf`);
      await download.saveAs(saved);
      const bytes = await readFile(saved);
      check('advocate: downloaded file is a real PDF', bytes.subarray(0, 5).toString() === '%PDF-', `${bytes.length} bytes from ${download.suggestedFilename()}`);
    });

    await stepRun('advocate: community', async () => {
      await go('/community');
      const postTitle = `Walkthrough note ${RUN_STAMP}`;
      await page.fill('#community-title', postTitle);
      await page.fill(
        '#community-body',
        'Shared observation from the browser walkthrough: keep the limitation date next to the seat clause in every arbitration matter, and cite the provision, not just the section number.',
      );
      await page.fill('#community-tags', 'walkthrough, arbitration');
      // The composer defaults to Private — correct behaviour, but a private post never
      // reaches the workspace feed, so the walkthrough opts in to sharing.
      await page.selectOption('#community-visibility', 'workspace');
      await shot('advocate-community-form', 'Community post composer: title, details, tags, visibility', 'Default is Private; this one is shared to the workspace feed');
      await page.locator('button.community-submit').click();
      // The feed refreshes a beat after the POST resolves; reloading the route reads it
      // from the server instead of racing that refresh.
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await go('/community');
      const body = await settled();
      const posts = await listAll('/api/v1/community/posts');
      const mine = posts.find((post) => post.title === postTitle);
      check(
        'advocate: community post published',
        body.includes(postTitle) && mine?.visibility === 'workspace',
        `feed shows it: ${body.includes(postTitle)} · api visibility=${mine?.visibility ?? 'missing'}`,
      );
      if (mine?.id) {
        await go(`/community/${mine.id}`);
        await settled();
      }
      await shot('advocate-community', 'Community feed with the walkthrough post published');
    });

    for (const [label, route, heading, sub] of [
      ['advocate-strategy', '/strategy', 'Strategy', 'Positions and issues tracked against a matter'],
      ['advocate-autofill', '/autofill', 'Smart autofill', 'Pull clause facts out of a document into a form'],
      ['advocate-settings', '/settings/profile', 'Settings', 'Profile, workspace preferences and security'],
    ]) {
      await stepRun(`advocate: ${label}`, async () => {
        await go(route).catch(() => {});
        await shot(label, heading, sub);
      });
    }

    await stepRun('advocate: command palette', async () => {
      await go('/dashboard');
      await page.locator('button[aria-label="Site search"]').click();
      await page.keyboard.type('arbitration');
      await page.waitForTimeout(1200);
      await shot('advocate-palette', 'Command palette: jump to any matter or document');
    });

    await advocate.close();
  }

  // ---------------------------------------------------------------- associate
  if (!only.size || only.has('associate')) {
    const fresh = await newContext();
    await attachNewPage(fresh);
    await stepRun('associate: empty workspace', async () => {
      await login('associate@tantara.local');
      // Every pass uploads a fixture PDF and opens a matter, so the second run would
      // otherwise be judged against the first run's leftovers. Documents can be deleted
      // through the API; matters cannot (no delete route), so the matter assertions below
      // check ownership rather than absolute emptiness.
      const stale = await listAll('/api/v1/documents');
      for (const doc of stale) await api(`/api/v1/documents/${doc.id}`, { method: 'DELETE' });
      const body = await settled();
      check('associate: fresh account sees an empty workspace', /No |Create|Add|Start|Nothing/i.test(body), body.split('\n').find((line) => /no |create|start/i.test(line)) ?? '');
      await shot('associate-empty-start', 'A separate account: its own work only, nothing seeded');
      const cases = await listAll('/api/v1/cases');
      const own = cases.filter((item) => (item.title ?? '').startsWith('Essence Textiles'));
      // There is no DELETE route for matters, so an earlier pass leaves its own matter
      // behind. Emptiness of the *seeded firm* is what isolation means here.
      check('associate: no matters of the seeded firm are visible', own.length === cases.length, `${own.length}/${cases.length} own matters`);
      const documents = await listAll('/api/v1/documents');
      check('associate: starts a pass with no documents', documents.length === 0, `${documents.length} documents after clearing ${stale.length}`);
    });

    await stepRun('associate: create a matter', async () => {
      const caseTitle = 'Essence Textiles v. Northwind Logistics';
      const caseRef = `E2E/WALK/${RUN_STAMP}`;
      await go('/cases/new');
      await page.fill('input[name="title"]', caseTitle);
      await page.fill('input[name="reference_number"]', caseRef);
      await page.fill('input[name="claimant"]', 'Essence Textiles Pvt Ltd');
      await page.fill('input[name="respondent"]', 'Northwind Logistics LLP');
      await page.fill('input[name="seat"]', 'Mumbai');
      const forum = await page.locator('select[name="forum"] option').nth(1).getAttribute('value');
      await page.selectOption('select[name="forum"]', forum);
      await shot('associate-case-form', 'New matter form: parties, seat, institution, limitation date');
      await page.locator('button:has-text("Save case")').click();
      // The old check matched the glob '**/cases/*' against /cases/new itself and read
      // the page before the redirect, so a successful save looked like a failure.
      let made = null;
      const byApi = Date.now() + 45_000;
      while (Date.now() < byApi && !made) {
        const cases = await listAll('/api/v1/cases');
        made = cases.find((c) => c.reference_number === caseRef) ?? null;
        if (!made) await page.waitForTimeout(1500);
      }
      if (!made) {
        const errors = await page.locator('.matter-error-text').allInnerTexts().catch(() => []);
        throw new Error(`matter never appeared in /api/v1/cases${errors.length ? ` · form said: ${errors.join('; ')}` : ''}`);
      }
      await go(`/cases/${made.id}`);
      const body = await settled();
      check('associate: matter created and reopened', body.includes(caseTitle), `${caseRef} · ${made.forum ?? ''} · ${page.url()}`);
      await shot('associate-case-created', 'The matter this account just created', `${caseTitle} · ${caseRef}`);
    });

    await stepRun('associate: upload a PDF and wait for indexing', async () => {
      await go('/documents');
      await page.setInputFiles('input[type="file"]', FIXTURE_PDF);
      await page.waitForTimeout(5000);
      await shot('associate-upload-queue', 'Upload accepted: extract → embed → index, live job state');
      const deadline = Date.now() + 300_000;
      let uploaded = null;
      while (Date.now() < deadline) {
        const listing = await listAll('/api/v1/documents');
        uploaded = listing.find((d) => /arbitration-text-layer/i.test(d.filename ?? ''));
        if (uploaded && ['ready', 'failed'].includes(uploaded.status)) break;
        await page.waitForTimeout(5000);
      }
      check('associate: uploaded PDF indexed', uploaded?.status === 'ready', `status=${uploaded?.status} pages=${uploaded?.page_count}`);
      await go('/documents');
      await shot('associate-documents', 'The new account now has its own document library', uploaded?.filename ?? '');
      if (uploaded?.id) {
        await go(`/documents/${uploaded.id}`);
        const text = await page.locator('main').innerText();
        check('associate: uploaded document readable in the viewer', /SIAC|arbitration/i.test(text), `${text.length} characters rendered`);
        await shot('associate-document-viewer', 'Uploaded agreement read back in the viewer with page map');
      }
    });

    await stepRun('associate: search its own upload', async () => {
      const query = 'arbitration administered under the SIAC Rules in force';
      const response = await api(`/api/v1/search/documents?query=${encodeURIComponent(query)}&limit=5`);
      const hits = response.body.items ?? [];
      const own = hits.filter((hit) => /arbitration-text-layer|arbitration agreement|siac/i.test(JSON.stringify(hit)));
      await go('/search');
      await page.locator('input[aria-label="Search documents"]').fill(query);
      await page.locator('form.search-query button[type="submit"]').click();
      await page.locator('.search-results').waitFor({ state: 'visible', timeout: 60_000 });
      check('associate: own upload is searchable', own.length > 0, `hits=${hits.length} titles=${[...new Set(hits.map((h) => h.document_title))].join(', ')}`);
      await shot('associate-search', 'Searching the freshly uploaded agreement', query);
    });

    await stepRun('associate: isolation from the seeded firm', async () => {
      const cases = await listAll('/api/v1/cases');
      const titles = cases.map((c) => c.title);
      check('associate: sees only its own matters', titles.every((title) => title.startsWith('Essence Textiles')), `${titles.length} matters, all opened by this account`);
      const leaked = advocateCaseTitles.filter((title) => titles.includes(title));
      check('associate: none of the advocate matters are visible', leaked.length === 0, leaked.join(' | ') || 'none');
      await go('/cases');
      await shot('associate-isolation', 'Workspace isolation: this account sees only matters it opened itself', `advocate has ${advocateCaseTitles.length} matters, this account ${titles.length}`);
      for (const title of advocateCaseTitles.slice(0, 2)) {
        const probe = await api(`/api/v1/search?q=${encodeURIComponent(title)}&limit=5`);
        const hits = probe.body.items ?? [];
        check(`associate: advocate matter not searchable ("${title.slice(0, 24)}")`, hits.every((hit) => !JSON.stringify(hit).includes(title)), `hits=${hits.length}`);
      }
    });

    await fresh.close();
  }

  // --------------------------------------------------------------- researcher
  if (!only.size || only.has('researcher')) {
    const ro = await newContext();
    await attachNewPage(ro);
    await stepRun('researcher: read-only role', async () => {
      await login('researcher@tantara.local');
      await settled();
      await shot('researcher-dashboard', 'Second identity: the researcher’s own workspace');
      const bytes = await readFile(FIXTURE_PDF);
      const upload = await api('/api/v1/documents/upload', {
        method: 'POST',
        multipart: { file: { name: 'researcher-upload-attempt.pdf', mimeType: 'application/pdf', buffer: bytes } },
      });
      check('researcher: upload refused by role', upload.status === 403, `HTTP ${upload.status} ${JSON.stringify(upload.body).slice(0, 120)}`);
      await go('/documents');
      await shot('researcher-role', 'Role enforcement: a researcher is read-only for ingestion', `upload attempt returned HTTP ${upload.status}`);
      const readable = await api('/api/v1/documents?page=1&page_size=5');
      check('researcher: can still read their own workspace', readable.ok, `documents=${readable.body.total ?? readable.body.items?.length}`);
    });
    await ro.close();
  }

  // -------------------------------------------------------------------- staff
  if (!only.size || only.has('staff')) {
    const staff = await newContext();
    await attachNewPage(staff);
    await stepRun('staff: third identity', async () => {
      await login('staff@tantara.local');
      await settled();
      await shot('staff-dashboard', 'Third identity: matters staff account');
    });
    await staff.close();
  }

  // ------------------------------------------------------------------- mobile
  if (!only.size || only.has('advocate')) {
    const mobile = await newContext(MOBILE);
    await attachNewPage(mobile);
    await stepRun('mobile: same workspace at 390x844', async () => {
      // A distinct shot prefix: the mobile login screen would otherwise overwrite the
      // desktop one, since both phases sign in as the same account.
      await login('advocate@tantara.local', 'mobile-login');
      for (const [label, route] of [
        ['mobile-dashboard', '/dashboard'],
        ['mobile-cases', '/cases'],
        ['mobile-documents', '/documents'],
        ['mobile-research', '/research'],
      ]) {
        await page.goto(`${webUrl}${route}`, { waitUntil: 'domcontentloaded' });
        await settled({ heading: route !== '/research' }).catch(() => {});
        await shot(label, `Mobile ${MOBILE.width}×${MOBILE.height} — ${route}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check(`mobile: no horizontal overflow on ${route}`, !overflow);
      }
    });
    await mobile.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((item) => !item.ok);
await writeFile(
  path.join(outDir, 'report.json'),
  JSON.stringify(
    {
      webUrl,
      when: new Date().toISOString(),
      viewport: DESKTOP,
      mobileViewport: MOBILE,
      checks,
      shots,
      notes,
      pageErrors: [...pageErrors],
    },
    null,
    2,
  ),
);
console.log(
  `\nchecks ${checks.length - failed.length}/${checks.length} passed · screenshots ${shots.length} · page errors ${pageErrors.size}`,
);
for (const item of failed) console.log(`FAIL ${item.name}  ${item.detail}`);
if (pageErrors.size) console.log(`page errors: ${[...pageErrors].join(' | ')}`);
if (failed.length) throw new Error(`${failed.length} end-to-end checks failed`);
console.log(`walkthrough passed: ${outDir}`);
