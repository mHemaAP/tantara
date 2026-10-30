#!/usr/bin/env node
/*
 * Prove, against a real deployment, the rule the operator stated:
 *   the reference corpus is available to everyone, a user's own uploads are visible only to them.
 *
 * It replays the exact questions that returned insufficient_evidence in production for a
 * freshly registered account, then checks the isolation half of the rule with two throwaway
 * accounts. Addresses use RFC 2606 .invalid, which cannot receive mail.
 *
 *   TANTARA_BASE=https://tantra.theessencetimes.com node scripts/probe-library-live.mjs
 */

const base = (process.env.TANTARA_BASE || 'https://tantra.theessencetimes.com').replace(/\/$/, '');
const api = `${base}/api/v1`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

// The questions a real user asked on 2026-10-30 and every one of them came back empty.
const REGRESSION_QUESTIONS = ['Relief options', 'Procedure under Arbitration Act', 'settlments'];

const stamp = Date.now();
const account = (name) => `${name}-${stamp}@example.invalid`;
const password = 'Tantra-Library-Probe-2026!';

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, { token, body, raw } = {}) {
  const response = await fetch(api + path, {
    method,
    headers: {
      'user-agent': UA,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: response.status, headers: response.headers };
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  return { status: response.status, json };
}

async function register(email) {
  const { status, json } = await call('POST', '/auth/register', {
    body: { name: 'Library Probe', email, password },
  });
  if (status !== 200) throw new Error(`register ${email} -> ${status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function main() {
  console.log(`target: ${base}`);

  const stranger = account('tantara-lib-stranger');
  const owner = account('tantara-lib-owner');
  const strangerToken = await register(stranger);
  const ownerToken = await register(owner);
  check('two fresh accounts registered', true, stranger);

  // 1. The stranger has nothing of their own — that is what produced the empty answers.
  const mine = await call('GET', '/documents?scope=mine&page_size=100', { token: strangerToken });
  check('fresh account owns zero documents', mine.status === 200 && mine.json.total === 0, `total=${mine.json.total}`);

  // 2. But the shared library is visible to them.
  const all = await call('GET', '/documents?page_size=100', { token: strangerToken });
  const items = all.json.items || [];
  const library = items.filter((item) => item.visibility === 'library');
  check(
    'library documents visible to a brand-new account',
    all.status === 200 && library.length > 0,
    `library=${library.length} of ${all.json.total}`,
  );
  check(
    'no document is listed without a visibility',
    items.length > 0 && items.every((item) => item.visibility === 'private' || item.visibility === 'library'),
    [...new Set(items.map((item) => item.visibility))].join(','),
  );
  check(
    'scope=library returns only library documents',
    library.length > 0 &&
      (await call('GET', '/documents?scope=library&page_size=100', { token: strangerToken })).json.items.every(
        (item) => item.visibility === 'library',
      ),
  );

  // 3. The exact production regressions: cited answers, not insufficient_evidence.
  for (const question of REGRESSION_QUESTIONS) {
    const ask = await call('POST', '/ai/ask', { token: strangerToken, body: { question, top_k: 8 } });
    const citations = ask.json.citations || [];
    check(
      `ask "${question}" answers from the library`,
      ask.status === 200 && ask.json.status !== 'insufficient_evidence' && citations.length > 0,
      `status=${ask.json.status} citations=${citations.length} basis=${ask.json.answer_basis}`,
    );
    const flagged = citations.filter((c) => c.visibility === 'library' || library.some((d) => d.id === c.document_id));
    check(`  citation for "${question}" is library-sourced`, flagged.length > 0, `${flagged.length} flagged`);
  }

  // 4. Read access to a statute: metadata, pages, and the original PDF.
  const statute = library.find((d) => /code of civil procedure/i.test(d.title)) || library[0];
  const detail = await call('GET', `/documents/${statute.id}`, { token: strangerToken });
  const pages = await call('GET', `/documents/${statute.id}/pages?page_size=5`, { token: strangerToken });
  const file = await call('GET', `/documents/${statute.id}/file`, { token: strangerToken, raw: true });
  check('library document detail readable', detail.status === 200 && detail.json.title === statute.title, statute.title);
  check('library pages readable', pages.status === 200 && (pages.json.items || []).length > 0);
  check(
    'library original file downloadable',
    file.status === 200 && /pdf|octet-stream/.test(file.headers.get('content-type') || ''),
    file.headers.get('content-type'),
  );

  // 5. Read-only for non-owners: every mutation must be refused, not silently applied.
  const patch = await call('PATCH', `/documents/${statute.id}`, {
    token: strangerToken,
    body: { title: 'Vandalised title' },
  });
  const del = await call('DELETE', `/documents/${statute.id}`, { token: strangerToken });
  const retry = await call('POST', `/documents/${statute.id}/retry`, { token: strangerToken });
  check('non-owner cannot rename a library document', patch.status === 403, `status=${patch.status}`);
  check('non-owner cannot delete a library document', del.status === 403, `status=${del.status}`);
  check('non-owner cannot re-index a library document', retry.status === 403, `status=${retry.status}`);
  const after = await call('GET', `/documents/${statute.id}`, { token: strangerToken });
  check('library document survived the attempts', after.status === 200 && after.json.title === statute.title);

  // 6. The other half of the rule: one user's upload is invisible to another.
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
    'utf8',
  );
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), `private-${stamp}.pdf`);
  form.append('title', `Private Note ${stamp}`);
  const uploaded = await fetch(`${api}/documents/upload`, {
    method: 'POST',
    headers: { 'user-agent': UA, authorization: `Bearer ${ownerToken}` },
    body: form,
  }).then((r) => r.json());
  const docId = uploaded.document_id || uploaded.id;
  check('owner can upload a private document', Boolean(docId), JSON.stringify(uploaded).slice(0, 90));

  if (docId) {
    const strangerSees = await call('GET', `/documents/${docId}`, { token: strangerToken });
    const strangerList = await call('GET', '/documents?page_size=100', { token: strangerToken });
    const ownerList = await call('GET', '/documents?scope=mine&page_size=100', { token: ownerToken });
    check('another account cannot open a private document', strangerSees.status === 404, `status=${strangerSees.status}`);
    check(
      'private document absent from another account list',
      !(strangerList.json.items || []).some((item) => item.id === docId),
    );
    check(
      'owner still sees their own upload',
      (ownerList.json.items || []).some((item) => item.id === docId),
    );
    check(
      'a user upload is not published to the library',
      (ownerList.json.items || []).every((item) => item.id !== docId || item.visibility === 'private'),
    );
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('probe failed:', error);
  process.exit(1);
});
