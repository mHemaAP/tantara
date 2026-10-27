# Documents module report — Round 3

## Delivered

- `/documents` uses a dense table with a first-page PDF.js preview, a secondary grid view, filters/search, upload queue progress, server validation messages, duplicate handling, job polling, and confirmed deletes.
- `/documents/[id]` renders the actual PDF file with PDF.js, page navigation, zoom/rotation, selectable text, page deep links, per-page text chunks, relevance scores, and page highlighting. Page references use `/documents/{id}?page={page}`.
- Metadata uses a definition list with individually grouped label/value rows, localized timestamps, formatted character counts, and an accessible SHA-256 copy action with confirmation.
- AI Read renders API extraction fields with source page chips and supports edit/PATCH/reload. `model_unavailable` shows the configured endpoint, retry, and no candidate values. `no_evidence` also shows no candidate values.
- `/search` shows API titles, snippets, page links, and API relevance scores, including the legacy `retreival_score` fallback.

## Verification

Round 1 reported **4 passed / 5 failed**. Round 2 passed **16 / 16**. Round 3's final fresh-backend E2E run passed **20 / 20**. An earlier Round 3 run failed because its reused database already contained the upload fixture files (409 duplicate responses); a fresh database was then created and the full E2E suite passed.

The final successful gates were:

```text
pnpm format       passed
pnpm lint         passed; no warnings/errors (Next emitted its standard next lint deprecation notice)
pnpm typecheck    passed
pnpm build        passed; documents, viewer, and search routes included
pnpm test:e2e     20 passed, 0 failed
```

The fresh private backend was started from `backend-core` at `/home/kahitoz/projects/tantara-wt/be/backend` with `TANTARA_DATA_DIR=$(mktemp -d)`, `DATABASE_URL=sqlite:///$TANTARA_DATA_DIR/tantara.db`, and `CORS_ORIGINS=http://localhost:3012,http://127.0.0.1:3012`, followed by `.venv/bin/alembic upgrade head`, `.venv/bin/python ../scripts/seed.py --demo`, and `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8113`. The E2E command was `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8113 TANTARA_API_BASE_URL=http://127.0.0.1:8113 TANTARA_WEB_URL=http://127.0.0.1:3012 pnpm test:e2e`. The web server bound to `127.0.0.1:3012`. Both servers were stopped after verification.

The layout test asserts the sidebar's left coordinate is `0`, the canvas starts below the fixed header, and the unfocused skip link is outside the viewport. It also checks the main column and mobile sidebar/header geometry. Metadata tests assert accessible label/value groups, separate Pages and Characters rows, and the copied confirmation. The chunk test searches `SIAC Rules`, clicks the page-2 result, and verifies page 2 is open and highlighted.

The three-page text-layer PDF was uploaded and reached `ready`. The viewer captures show `arbitration-text-layer.pdf` at page 2 of 3, SHA-256 `7bc2e280bf09a77bf0988101be49bd3ba429b413ca3526a8357ccba733ec0b23`. The text-layer fixture contains the page-2 phrase “SIAC Rules”. The scanned fixture was uploaded and reached `ready`; OCR ran and extracted **“OCR MUST READ”**. No fallback was used for that fixture. Extraction-warning display was separately tested by returning a warning response to the viewer.

AI Read's successful path obtains extraction fields from `/documents/{id}/ai-read` and verifies that an edited field survives PATCH and reload. The test intercepts only the preceding `/ai/ask` readiness check because the seeded private model service is not configured. The model-unavailable path was forced with `/settings/ai` set to `http://127.0.0.1:9/v1`, then the original setting was restored. The no-evidence capture uses an intercepted empty text response and `no_evidence` readiness response. A fully blank PDF is rejected by this backend as an ingestion failure, so there is no truthful ready blank-PDF upload to capture; the test does not claim otherwise.

## Screenshots

All screenshots are under repository-root `docs/screenshots/`, are settled with no loading skeleton, and fixture-backed images are named with `-fixture`.

- Library: `documents-desktop.png`, `documents-mobile.png`, `documents-empty-desktop.png`, `documents-empty-mobile.png`, `documents-offline-desktop.png`, `documents-offline-mobile.png`.
- Viewer: `document-viewer-desktop-fixture.png` and `document-viewer-mobile-fixture.png` show `arbitration-text-layer.pdf`, page 2 of 3, SHA-256 `7bc2e280bf09a77bf0988101be49bd3ba429b413ca3526a8357ccba733ec0b23`.
- Metadata close-ups: `document-metadata-desktop-fixture.png`, `document-metadata-mobile-fixture.png` show the same three-page fixture and hash above.
- AI Read happy path: `document-airead-populated-desktop-fixture.png`, `document-airead-populated-mobile-fixture.png` show extracted fields and source-page chips for the same fixture. The edit/PATCH/reload is asserted in E2E.
- AI degradation: `airead-model-unavailable-desktop.png`, `airead-model-unavailable-mobile.png` show the seeded `scanned-agreement.pdf` (5 pages, SHA-256 `25056527b13befeb8fb9e34cb76ea0d7a6f1cd1efed335e372476ee51e1625b1`); `airead-no-evidence-desktop-fixture.png`, `airead-no-evidence-mobile-fixture.png` show the test's empty extracted-text and no-evidence response state.
- Search: `search-desktop.png`, `search-mobile.png` show seeded API results.

## Remaining gaps

- A blank PDF is rejected during ingestion; the no-evidence view is covered with a controlled empty-text/API response rather than an uploaded blank PDF.
- The AI Read test's extraction and PATCH use the real backend endpoints, but the readiness status is intercepted; a live external model was not available for a fully end-to-end model run.
- The backend has no upload configuration endpoint. The UI uses the server's 25 MB default and accepted MIME list. The upload error paths are wired to actual API responses.
- The viewer does not yet make a dedicated Range-header assertion, show OCR confidence over scanned page images, or render non-PDF binary formats. The viewer does render scanned PDFs and their extracted text/warnings.
- The library still lacks pagination, metadata editing, bulk selection/delete, and the full case/type/jurisdiction filter set. Search still lacks the full case/jurisdiction/source/date filter set.
- Documents and Search sidebar entries remain absent because the shared shell is owned by integration; `src/components/shell.tsx` was not changed.

## Changed-file commits

Round 2 commits remain one changed path per commit:

```text
654dca9 8eaa815 07d1592 93ab2d6 feceabb f035540 4b7e96a de5f528
15a8705 8cb0afa 55e403c 91bba4a e3b9435 03b9a8d df96e43 b74a27f
3b665dc d65de91 08aa7df 2f0c79d 455741d d4ce32c c90d719 1538327
6f1dc8b 01767fd 1f99d4a 0e5b37b 1e1dad6 094b04e 3e55c1e
```

Round 3 changes were also committed individually, one path per commit:

```text
be07933 c1ad3f8 b7a5676 d990217 cd7ccab 4cb61b7 388b6b0 8beb0eb
c755346 50823a4 9b0d8d5 87a93fb 304b7a7 bc114a3 0677002 6a30068
d4eb6b4 e05e0a9 976b681 a839661 5828fc5 6239605 f96b0a5 cd1d6b1
b5e0a6b 641e2f2 5d5c009
```
