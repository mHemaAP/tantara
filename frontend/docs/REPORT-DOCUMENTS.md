# Documents module report — Round 2

## Delivered

- `/documents` now defaults to a compact, selectable table with title, filename, case, page count, uploaded date, and shared ingestion status pills. Grid is a secondary view. The right preview pane renders the selected PDF's first page with PDF.js.
- Upload supports multiple queued files, XHR per-file progress, server-configured accepted MIME types and the 25 MB configured limit, inline API validation errors, duplicate links, polling, retry, and confirmed deletion. The backend exposes no upload-config endpoint; the limit shown is the backend's `max_upload_mb` default of 25.
- `/documents/[id]` renders PDF files from `GET /documents/{id}/file` using PDF.js, including page navigation, zoom, selectable text layer, and `?page=N` deep-link scrolling/highlight. Metadata includes file identity, hash copy, size, pages/characters, timestamps, jurisdiction, source and demo state. Non-PDF documents retain extracted-text display.
- AI Read calls the real API and renders returned extraction fields with source/provenance/review-required details and per-field PATCH edits. `model_unavailable` displays the configured base URL and retry with no candidate fields; `no_evidence` likewise shows no invented fields. One shared `DocumentStatus` component is used in the library and viewer.
- `/search` renders API hits, highlights snippets, labels real `retrieval_score` (and legacy `retreival_score`) values as relevance, and links to citation pages using `/documents/{id}?page={page}`.
- Added a URL-builder unit test plus real upload, ingestion, PDF deep-link, OCR, warning, and AI-degradation E2E coverage. Added two ReportLab fixtures in `tests/fixtures/`.

## Verification

The previous Round 1 E2E result was **4 passed / 5 failed**. Round 2's final full gate passed:

```text
pnpm format        passed
pnpm lint          passed (no warnings/errors; Next reports its standard next lint deprecation notice)
pnpm typecheck     passed
pnpm build         passed; /documents, /documents/[id], and /search are in the route output
pnpm test:e2e      16 passed, 0 failed
```

The Playwright run used `TANTARA_WEB_URL=http://127.0.0.1:3012`, `TANTARA_API_BASE_URL=http://127.0.0.1:8113`, and `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8113`. Its private backend used `TANTARA_DATA_DIR=$(mktemp -d)`, `DATABASE_URL=sqlite:///$TANTARA_DATA_DIR/tantara.db`, `CORS_ORIGINS=http://localhost:3012,http://127.0.0.1:3012`, `.venv/bin/alembic upgrade head`, and `.venv/bin/python ../scripts/seed.py --demo`. The first retry incorrectly inherited the backend's default database path and got duplicate 409s; setting `DATABASE_URL` inside the temporary directory fixed the isolation. The final run used a newly seeded database and all tests passed. Frontend and private backend processes were stopped after verification; no other worktree listener was stopped.

The test force-patched `/settings/ai` to `http://127.0.0.1:9/v1`, observed `model_unavailable`, verified that URL and asserted zero candidate fields. A separate intercepted `no_evidence` response likewise yielded no candidate fields. The OCR fixture's extracted text included **“OCR MUST READ”**; OCR ran on the private backend, with no fallback used for that fixture. The warning display was verified by returning an explicit OCR-unavailable warning in the viewer test.

## Fixtures and viewer evidence

- `tests/fixtures/arbitration-text-layer.pdf`: three pages, SHA-256 `f90da7f88c27d961566790126b8de85184aa9c0a8cdd2d7dd1b5e78d60d9905e`.
- `tests/fixtures/arbitration-scanned.pdf`: one rendered-image page, SHA-256 `6247ea5eb8a3af8b9eac86ab334fb28fccc2d168d250af9708522759810cbb2c`.
- The desktop and mobile viewer captures show `arbitration-text-layer.pdf`, opened at `?page=2`; it has 3 pages and SHA-256 `f90da7f88c27d961566790126b8de85184aa9c0a8cdd2d7dd1b5e78d60d9905e`.

## Screenshots

All captures are in repository-root `docs/screenshots/`. They are settled states with no loading skeletons. The document/viewer screenshots are real API data uploaded to the private backend during the run; no screenshot uses a Playwright route fixture.

- `documents-desktop.png`, `documents-mobile.png`
- `documents-empty-desktop.png`, `documents-empty-mobile.png`
- `documents-offline-desktop.png` (backend stopped after the authenticated page loaded)
- `document-viewer-desktop.png`, `document-viewer-mobile.png` (multi-page PDF at page 2; identity above)
- `document-airead-desktop.png`, `document-airead-mobile.png`
- `airead-model-unavailable-desktop.png`
- `search-desktop.png`, `search-mobile.png`

## Remaining gaps

- The backend does not expose a runtime upload-limit/MIME config endpoint, so the upload helper reads the configured 25 MB backend default and accepted MIME list rather than fetching runtime config.
- The private backend's configured local model was unavailable. The honest failure state is covered, but a successful live-model extraction and successful PATCH review round-trip could not be demonstrated against a working LLM endpoint.
- The PDF viewer does not yet provide in-document text search/highlight, a citations/chunk panel, OCR-confidence overlay on rendered scanned pages, or a non-PDF source-file viewer. PDF.js uses the file endpoint and allows its HTTP Range requests, but a dedicated Range-header assertion is not in E2E.
- The library does not yet include every requested case/type/jurisdiction filter, pagination, metadata-edit dialog, or multi-select bulk-delete flow. Search does not yet expose all requested case/jurisdiction/source/date filters. The UI does support title/status filtering, individual confirmed deletion, and duplicate conflict navigation.
- The shared workspace shell still lacks Documents and Search sidebar links; integration owns `src/components/shell.tsx`, which was intentionally left untouched.
- The reports' `documents-empty-*` captures show the genuine empty failed-document state produced by the API filter; they are not a globally empty library.

## Changed-file commits

Round 2 changes were committed individually, one changed file per commit. Hashes are listed in the final response.
