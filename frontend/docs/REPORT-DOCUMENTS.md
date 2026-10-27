# Documents module report — Round 4

## Sol findings and proof

| Finding | Change | Proof |
|---|---|---|
| Workspace shell shifted or overlapped content; mobile drawer left a strip over the page | Removed shell-affecting styles from the document route, constrained the viewer layout to its own grid, and contained the mobile library table's horizontal overflow in the documents feature stylesheet. No shared shell files were changed. | Direct-entry Playwright checks assert header top `0`, sidebar left `0` on desktop, closed drawer right `<= 0` on mobile, page content and toolbar below the header, and mobile document width `<= 390px`. |
| Skip link appeared over content | Kept the shared focus-only skip link behavior; removed the route-local override that made it visible when unfocused. | Playwright verifies it is outside the viewport before focus, appears after Tab, and the unfocused settled capture omits it. |
| Metadata labels and values ran together and direct viewer entry missed styling | Kept route CSS imported directly by `/documents/[id]`; metadata is a definition list with label/value columns, separate Pages and Characters rows, grouped accessible names, thousands separators, localized date-only values, and a `Copy SHA-256` button with copied confirmation. | The deep-link test checks each accessible metadata group and the copy confirmation without first visiting `/documents`; metadata captures are included below. |
| PDF content clipped or ran behind the header; viewer controls were obscured | Bounded the canvas to the viewer scroller, calculate a fit-width scale, and keep the toolbar in normal flow above the canvas. The requested page remains selected through render and scroll settling. | Playwright opens the direct `?page=2` link, waits for its canvas, checks page input `2`, toolbar visibility, page bounds within the scroll container, and page 2's deep-link highlight. The citation test searches `SIAC Rules`, opens the hit, and verifies page 2. |
| No successful desktop AI Read evidence | Ran AI Read with the reachable local model at `http://192.168.0.101:8080/v1` and captured the completed result with the seeded document visible. | E2E probes the model endpoint, checks the result fields/source page chip, parsed clause quote, human provenance, absence of raw JSON/empty arrays, and the rendered PDF canvas before capture. It also exercises edit → PATCH → reload. |
| AI extraction output showed JSON and enum keys | Unwraps page/value objects, renders clause quotes as prose, displays empty values as “Not found in this document”, and maps provenance keys to human labels while retaining the key in `data-provenance-key`. | Real-model capture and E2E assertions check quote prose and page link, no `[]`/raw JSON, “AI suggestion”, and the machine key only as a data attribute. |
| AI Read errors all looked like model connection failures; dead endpoint leaked its URL | Classifies authentication, embedding, extraction, response-loading, model-unavailable, and no-evidence outcomes separately. Model failure surfaces a retry action without host, URL, or port. | Five category-specific tests exercise the error paths; the dead endpoint test PATCHes AI settings to `http://127.0.0.1:9/v1` and asserts no endpoint detail or candidate fields render. |
| Search titles and relevance semantics were unclear | Uses the API's `document_title`, explains that the displayed relevance value is a fusion rank score rather than confidence, and keeps OCR confidence distinct. | Search E2E checks the hit is titled and the fusion-score explanation is visible. Desktop and mobile search captures show seeded API results. |
| Empty library started with a misleading Failed filter; Ready and processed/reviewed status were conflated | Resets the status filter when the filtered total is zero; names document processing and AI review independently. | Playwright checks the zero-result filter resets to All, and metadata accessibility groups expose separate document-processing and AI-review states. |
| Mobile library capture expanded to 766px because the wide table escaped its scroller | Added paint containment to the table scroller and mobile overflow containment inside the documents feature. | Mobile E2E asserts `document.documentElement.scrollWidth <= 390`; the refreshed library PNG is 390px wide. |

## Verification

Round 1 was reported as **4 passed / 5 failed**. The first Round 4 run had **11 passed / 18 failed** because the E2E helpers still defaulted to port 8010 while the required private backend was on 8113. The next run reached the private API and had **27 passed / 2 failed**: one stale assertion expected the visible `extracted_reviewed` enum, and the OCR fixture collided with a seeded file. The visible-provenance assertion now checks the human label plus the DOM data key, and the scanned fixture was regenerated with unique image-rendered text. The final full run passed **29 / 29**.

Final gates:

```text
pnpm format       passed
pnpm lint         passed; no ESLint warnings or errors (Next's next lint deprecation notice only)
pnpm typecheck    passed
pnpm build        passed; /documents, /documents/[id], and /search routes included
pnpm test:e2e     29 passed, 0 failed
```

The backend was started from the read-only backend worktree at `/home/kahitoz/projects/tantara-wt/be/backend` using a fresh `TANTARA_DATA_DIR=$(mktemp -d)`, `DATABASE_URL=sqlite:///$TANTARA_DATA_DIR/tantara.db`, and `CORS_ORIGINS=http://localhost:3012,http://127.0.0.1:3012`, then `.venv/bin/alembic upgrade head`, `.venv/bin/python ../scripts/seed.py --demo`, and `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8113`. Playwright used `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8113 TANTARA_API_BASE_URL=http://127.0.0.1:8113 TANTARA_WEB_URL=http://127.0.0.1:3012 pnpm test:e2e`; Next binds only to `127.0.0.1:3012`. The configured screenshots use a 1440×900 desktop viewport and a 390×844 mobile viewport. `devIndicators: false` was already present in `frontend/next.config.ts` and was left unchanged.

The real seeded document in the direct viewer and real AI Read captures is **scanned-agreement.pdf**, 5 pages, SHA-256 `892e8d0fcea506b1898c8f0b9251145b0e28673944b26c49a0a8b32439ebe54b`. It is a demo corpus document. The three-page text-layer upload fixture has SHA-256 `7bc2e280bf09a77bf0988101be49bd3ba429b413ca3526a8357ccba733ec0b23`; the scanned fixture has SHA-256 `46f641e6b33d7a3f70df3657a8663be7042701a9e58d2bcad080e8e02e0b34a9`.

OCR was exercised, not assumed: the text-layer PDF uploaded and reached `ready`; the scanned PDF is a page image of text, uploaded and reached `ready`, and its OCR-derived page text includes **“UNIQUE QUARTZ 7319”**. The fixture E2E asserts that quoted text. The separate extraction-warning test simulates an unavailable OCR engine response and checks the warning is rendered; it does not claim OCR ran in that scenario.

## Screenshots

All paths are repository-root `docs/screenshots/`. PNG widths are 1440px for desktop and 390px for mobile; full-page captures have taller heights than the configured 900px/844px viewports. `-fixture` identifies captures whose state is controlled or whose document is a test fixture. Real-corpus viewer captures show `scanned-agreement.pdf` at page 2 of 5 with the SHA-256 above; AI Read captures use the same seeded document and wait for its PDF canvas and extraction to finish.

- Library loaded: `documents-library-desktop-1440.png`, `documents-library-mobile-390.png`; additional real captures: `documents-library-desktop-1440-real.png`, `documents-library-mobile-390-real.png`.
- Library empty results: `documents-library-empty-desktop-1440.png`, `documents-library-empty-mobile-390.png`; additional real captures: `documents-library-empty-desktop-1440-real.png`, `documents-library-empty-mobile-390-real.png`.
- Library API failure fixture: `documents-library-failure-desktop-1440-fixture.png`, `documents-library-failure-mobile-390-fixture.png`.
- Backend-stopped documents API state: `documents-offline-desktop-1440-fixture.png`, `documents-offline-mobile-390-fixture.png` (the auth identity endpoint is supplied locally to keep the shell open).
- Viewer page 2, real seeded corpus: `documents-viewer-page2-desktop-1440-real.png`, `documents-viewer-page2-mobile-390-real.png`.
- Viewer page 2, uploaded PDF fixture: `documents-viewer-page2-desktop-1440-fixture.png`, `documents-viewer-page2-mobile-390-fixture.png`.
- Metadata close-up: `documents-metadata-desktop-1440-real.png`; uploaded fixture comparison: `documents-metadata-desktop-1440-fixture.png`, `documents-metadata-mobile-390-fixture.png`.
- AI Read success, reachable model and real seeded document: `documents-ai-read-success-desktop-1440-real.png`, `documents-ai-read-success-mobile-390-real.png`.
- AI Read unavailable, dead endpoint: `documents-ai-read-unavailable-desktop-1440.png`; controlled mobile response: `documents-ai-read-unavailable-mobile-390-fixture.png`.
- AI Read no evidence: `documents-ai-read-no-evidence-desktop-1440-fixture.png`, `documents-ai-read-no-evidence-mobile-390-fixture.png`.
- AI Read API extraction fixture fallback: `documents-ai-read-success-desktop-1440-fixture.png`, `documents-ai-read-success-mobile-390-fixture.png`.
- Search results: `documents-search-desktop-1440-real.png`, `documents-search-mobile-390-real.png`.

## Remaining gaps

- The repository has no shared `BackendOffline` component. With the backend fully stopped, the shared shell redirects to sign-in when its own `/auth/me` request fails; the offline captures keep the documents API genuinely stopped while locally supplying only that shell identity response. The regular 503 failure captures label their intercepted documents response as a fixture.
- The mobile unavailable-model screenshot uses a controlled API response and is labeled `-fixture`; the desktop unavailable screenshot exercises the actual dead configured endpoint.
- The viewer currently handles PDF files and extracted page text. It does not render non-PDF binaries or a scanned page image with a separate OCR-confidence meter.
- The library remains short of the full round-1 scope: pagination, metadata editing, bulk selection/delete, and complete case/type/jurisdiction filters are not implemented. Search's full filter set is also not implemented.
- Documents and Search sidebar links remain an integration-owned shell change and are not present in the shared sidebar.

## Changed-file commits

Every changed path below has its own local commit; the final report commit itself is listed in the final message.

| Commit | Path |
|---|---|
| `c7152e2` | `docs/screenshots/airead-model-unavailable-desktop.png` |
| `cfc74f0` | `docs/screenshots/airead-model-unavailable-mobile.png` |
| `af4a183` | `docs/screenshots/airead-no-evidence-desktop-fixture.png` |
| `d718b02` | `docs/screenshots/airead-no-evidence-mobile-fixture.png` |
| `9b63e0a` | `docs/screenshots/document-airead-populated-desktop-fixture.png` |
| `8e4b9cf` | `docs/screenshots/document-airead-populated-mobile-fixture.png` |
| `886f64d` | `docs/screenshots/document-metadata-desktop-fixture.png` |
| `5aa5829` | `docs/screenshots/document-metadata-mobile-fixture.png` |
| `a6d80bd` | `docs/screenshots/document-viewer-desktop-fixture.png` |
| `44174ef` | `docs/screenshots/document-viewer-mobile-fixture.png` |
| `1d4cccf` | `docs/screenshots/documents-desktop.png` |
| `d851db2` | `docs/screenshots/documents-empty-desktop.png` |
| `ccca820` | `docs/screenshots/documents-empty-mobile.png` |
| `9d998bb` | `docs/screenshots/documents-mobile.png` |
| `cfe60c8` | `docs/screenshots/documents-offline-desktop.png` |
| `ee91125` | `docs/screenshots/documents-offline-mobile.png` |
| `abc6de1` | `docs/screenshots/search-desktop.png` |
| `ee4a78f` | `docs/screenshots/search-mobile.png` |
| `7973ddd` | `frontend/playwright.config.ts` |
| `0668cc9` | `frontend/src/app/(workspace)/documents/[id]/document-detail.css` |
| `8bb3876` | `frontend/src/app/(workspace)/documents/[id]/page.tsx` |
| `e29b865` | `frontend/src/app/(workspace)/documents/page.tsx` |
| `a36468c` | `frontend/src/app/(workspace)/search/page.tsx` |
| `e26e81b` | `frontend/src/features/documents/DocumentStatus.tsx` |
| `84f363d` | `frontend/src/features/documents/documents.css` |
| `b5383ce` | `frontend/src/features/search/search.css` |
| `15e6387` | `frontend/src/features/viewer/PdfDocumentViewer.tsx` |
| `8507f92` | `frontend/src/features/viewer/viewer.css` |
| `93fedbc` | `frontend/tests/documents-round2.spec.ts` |
| `4f4374a` | `frontend/tests/fixtures/arbitration-scanned.pdf` |
| `2ca9a0c` | `docs/screenshots/documents-ai-read-no-evidence-desktop-1440-fixture.png` |
| `83b1fc6` | `docs/screenshots/documents-ai-read-no-evidence-mobile-390-fixture.png` |
| `897f9b7` | `docs/screenshots/documents-ai-read-success-desktop-1440-fixture.png` |
| `a1ade86` | `docs/screenshots/documents-ai-read-success-desktop-1440-real.png` |
| `27964ca` | `docs/screenshots/documents-ai-read-success-mobile-390-fixture.png` |
| `e8acdaa` | `docs/screenshots/documents-ai-read-success-mobile-390-real.png` |
| `1fd63b0` | `docs/screenshots/documents-ai-read-unavailable-desktop-1440.png` |
| `c551681` | `docs/screenshots/documents-ai-read-unavailable-mobile-390-fixture.png` |
| `3ea04a4` | `docs/screenshots/documents-library-desktop-1440-real.png` |
| `2a9805e` | `docs/screenshots/documents-library-desktop-1440.png` |
| `ea12ae5` | `docs/screenshots/documents-library-empty-desktop-1440-real.png` |
| `67009de` | `docs/screenshots/documents-library-empty-desktop-1440.png` |
| `23195a2` | `docs/screenshots/documents-library-empty-mobile-390-real.png` |
| `7d1610d` | `docs/screenshots/documents-library-empty-mobile-390.png` |
| `ca5f94a` | `docs/screenshots/documents-library-failure-desktop-1440-fixture.png` |
| `75bb8c9` | `docs/screenshots/documents-library-failure-mobile-390-fixture.png` |
| `f9db06b` | `docs/screenshots/documents-library-mobile-390-real.png` |
| `23cdd98` | `docs/screenshots/documents-library-mobile-390.png` |
| `fb8559d` | `docs/screenshots/documents-metadata-desktop-1440-fixture.png` |
| `203bc2a` | `docs/screenshots/documents-metadata-desktop-1440-real.png` |
| `96c4700` | `docs/screenshots/documents-metadata-mobile-390-fixture.png` |
| `d4ef602` | `docs/screenshots/documents-offline-desktop-1440-fixture.png` |
| `467f664` | `docs/screenshots/documents-offline-mobile-390-fixture.png` |
| `ff6a5c6` | `docs/screenshots/documents-search-desktop-1440-real.png` |
| `6c77f77` | `docs/screenshots/documents-search-mobile-390-real.png` |
| `8d10107` | `docs/screenshots/documents-viewer-page2-desktop-1440-fixture.png` |
| `d88b05a` | `docs/screenshots/documents-viewer-page2-desktop-1440-real.png` |
| `aeedd51` | `docs/screenshots/documents-viewer-page2-mobile-390-fixture.png` |
| `6d48dbc` | `docs/screenshots/documents-viewer-page2-mobile-390-real.png` |
| `c8e7675` | `frontend/tests/documents-round4-mobile.spec.ts` |
| `2066df2` | `frontend/tests/documents-round4.spec.ts` |
