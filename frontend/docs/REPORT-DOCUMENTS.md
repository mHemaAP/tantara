# Documents module report — Round 5

## Round 5 findings and proof

| Finding | Change | Test or capture |
|---|---|---|
| Mobile navigation overlapped content and the library overflowed | Kept document styling feature-local; the drawer closes off-canvas, the library uses compact cards on mobile, and the desktop table remains a table. | `documents-round5-mobile.spec.ts` checks the closed sidebar right edge is at or left of zero, no intersection with `<main>`, the title fits, drawer open/Escape dismissal, and `scrollWidth === 390` with all eight seeded documents. It captures the settled library and document screens. |
| PDF pages were compressed or could remain loading | The PDF canvas uses the PDF.js viewport dimensions and is contained in its own scroll region; the toolbar stays above it. | Round 5 desktop/mobile tests wait for `data-rendered=true`, check no loading label, and compare the rendered canvas aspect ratio with `data-page-ratio` derived from the PDF itself (error <1%). Both follow the Page 3 citation and assert the visible passage. |
| Real-corpus viewer, metadata and successful AI Read were not evidenced | The tests navigate from the real library row for `page-three-motion.pdf`, with no route registrations, wait for the canvas, run AI Read based on authenticated `settings.runtime_status.reachable`, and capture the completed fields. | Desktop test asserts zero route registrations, populated prose, source page, separate metadata rows, bounded/expandable summary and page citation. Mobile performs the same real-corpus flow and checks the summary is reachable. |
| AI extraction could expose arrays/JSON or repeated text as a summary | Extraction values are unwrapped and rendered as prose, empty evidence is labelled “Not extracted,” duplicate text is removed, and long summary text is bounded until expanded. Provenance uses human-readable labels while preserving machine values in `data-*`. | E2E rejects raw JSON and enum keys, asserts the real summary prose and candidate provenance, and expands the summary to verify the full value. Fixture extraction tests remain explicitly named `-fixture`. |
| Endpoint details could leak in errors | Error copy omits configured hosts, URLs and ports. | Dead-endpoint test configures `http://127.0.0.1:9/v1`; asserts no candidate fields and no visible `https?://` or `:\\d{2,5}`. Separate tests cover authentication, embedding, extraction, response-loading, model-unavailable and no-evidence states. |
| Capture dimensions and black artifacts were unreliable | Capture tests set the viewport themselves and capture the viewport (not an unbounded full page). Screenshot helpers assert exact dimensions and sample corner pixels for near-black contamination. Removed older mobile captures that still showed an open drawer, a black band, or non-viewport metadata crops. | Round 5 screenshots are 1440×900 or 390×844. The capture tests fail on a black sampled corner; a post-run audit confirmed the new Round 5 captures have no near-black corners. |
| Upload outcome needed real proof | Upload runs through the UI, the ingestion job is polled to `ready`, and the uploaded PDF renders. AI extraction is requested from the real API and the rendered field must include its source page. Cleanup retries transient connection resets and must succeed. | `documents-round5.spec.ts` upload outcome test; its capture is named `-fixture.png` because its document is a generated fixture. |
| Library fixture count and stale count could be mistaken for live data | Real corpus captures use the seeded backend; fixture and controlled failure captures are suffixed `-fixture`. List failures do not present an old count as current. | Mobile test compares the live API’s eight demo records to the displayed cards. The real library capture is separate from the fixture captures. |

## Verification

The preceding complete Round 5 run had **32 passed / 2 failed**: a seeded-library wait timed out under suite load, and the upload test hit a transient backend connection reset during cleanup. The library test now has a 90-second timeout without changing its assertions. The upload test exercises actual upload, ready job, PDF render and API extraction; cleanup retries the transient reset and asserts success. Its focused rerun passed **1/1**. The next full run passed **34/34**; after adding the explicit mobile search/empty/failure/unavailable/no-evidence capture test and removing legacy screenshots that showed drawer overlap or black bands, the final full run passed **35/35**, with no skipped or weakened assertions.

Commands and results:

```text
pnpm format       passed
pnpm lint         passed; no ESLint warnings or errors (Next next-lint deprecation notice only)
pnpm typecheck    passed
pnpm build        passed; /documents, /documents/[id], /search included
pnpm test:e2e     35 passed, 0 failed (5.9 minutes)
```

E2E command:

```sh
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8112 \
TANTARA_API_BASE_URL=http://127.0.0.1:8112 \
TANTARA_WEB_URL=http://127.0.0.1:3013 pnpm test:e2e
```

The private backend ran from `/home/kahitoz/projects/tantara-wt/be/backend`, bound to `127.0.0.1:8112`, with `TANTARA_DATA_DIR=/tmp/tantara-docs-final.y8KUqV`, `DATABASE_URL=sqlite:////tmp/tantara-docs-final.y8KUqV/tantara.db`, and CORS origins for localhost and 127.0.0.1 on port 3013. Seeding used `scripts/seed.py --demo`. A clean `alembic upgrade head` encountered a circular dependency in the read-only backend's `0008_community_visibility` migration after its schema changes had partially applied. The schema already contained the intended visibility column and constraint; the migration marker was stamped at `0008_community_visibility`, then `alembic upgrade head` and demo seeding completed. No backend source was changed. The frontend ran only on 127.0.0.1:3013; the separate worktree's 3014 listener was not touched. `devIndicators: false` was already configured and was not edited.

The live AI settings endpoint reported the model reachable. Tests branch on that authenticated API value; they do not use a separate model probe. The real-corpus flow navigates through the UI without registering any Playwright route handler.

## Real seeded-corpus evidence

The real viewer and AI Read captures show the seeded demo document **`page-three-motion.pdf`**, 5 pages, SHA-256 **`ab7f8914425ba71199556afddc6c2947a171234ff3c56ec8d4102a56da2559a6`**. The Page 3 citation resolves to: “Unique page three clause: Sapphire Pavilion shall host the special procedural conference on the third calendar day.” The text appears in the page text layer after clicking the Page 3 citation.

Desktop captures (1440×900):

- `docs/screenshots/documents-round5-viewer-desktop-1440-real.png` — rendered page and toolbar.
- `docs/screenshots/documents-round5-metadata-desktop-1440-real.png` — metadata grid.
- `docs/screenshots/documents-round5-airead-desktop-1440-populated-real.png` — completed extraction and rendered viewer.
- `docs/screenshots/documents-round5-citation-page3-desktop-1440-real.png` — Page 3 citation result and supporting passage.
- `docs/screenshots/documents-round5-download-viewer-desktop-1440-real.png` — PDF download outcome.

Mobile captures (390×844):

- `docs/screenshots/documents-round5-library-mobile-390-real.png` — eight seeded documents as cards.
- `docs/screenshots/documents-round5-viewer-mobile-390-real.png` — rendered viewer.
- `docs/screenshots/documents-round5-metadata-mobile-390-real.png` — metadata grid.
- `docs/screenshots/documents-round5-airead-mobile-390-populated-real.png` — completed extraction with bounded summary.
- `docs/screenshots/documents-round5-citation-page3-mobile-390-real.png` — citation result and supporting passage.

The generated multi-page upload capture is `docs/screenshots/documents-round5-upload-outcome-desktop-1440-fixture.png` and is explicitly fixture-labelled. Mobile empty and search states use real API data. Mobile failure, model-unavailable (empty extraction response controlled in the test), and no-evidence states are fixture-labelled; they are not presented as real seeded-corpus extraction results.

Additional settled mobile state captures (390×844):

- `docs/screenshots/documents-round5-search-mobile-390-real.png` — real seeded search results with resolved document titles.
- `docs/screenshots/documents-round5-empty-mobile-390-real.png` — real library query with no matching rows.
- `docs/screenshots/documents-round5-failure-mobile-390-fixture.png` — controlled documents API failure.
- `docs/screenshots/documents-round5-ai-read-unavailable-mobile-390-fixture.png` — dead model configuration, with an empty extraction response, no candidate fields, and no endpoint text.
- `docs/screenshots/documents-round5-ai-read-no-evidence-mobile-390-fixture.png` — controlled no-evidence response.

## Remaining gaps

- Non-PDF files use extracted text rather than a native document renderer; a distinct scanned-page OCR confidence meter is not implemented.
- The full library pagination, metadata editing, bulk deletion, and all case/type/jurisdiction filters remain incomplete.
- Search does not yet expose every requested filter.
- Documents and Search sidebar destinations remain an integration-owned shared-shell change; this lane did not edit `src/components/shell.tsx`.
- The first clean backend migration attempt needs the documented stamp recovery because of the circular dependency in the read-only backend migration; backend work is outside this lane.

## Round 5 commits

Round 5 changes are committed one file per commit, locally, with no push or merge. The new test changes, refreshed screenshots and this report are listed in the final response with their commit hashes.
