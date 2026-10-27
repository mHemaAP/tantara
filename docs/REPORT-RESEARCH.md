# Research Desk implementation report

## Built

- Added `/research` as a three-panel research workspace with case/jurisdiction scope, history, saved answers, a grounded question composer, response states, source excerpts, and relevance scores.
- Added `/research/documents` as a live workspace document list and handoff route.
- Added a feature-local `documentPageUrl(documentId, page, chunkId)` helper and a contract assertion for the encoded path, page, and chunk.
- Research requests use the v1.1.0 API. There is no streaming endpoint, so the UI shows a cancellable, timed search/thinking state while the request is pending. It does not synthesize answer text.
- Model-unavailable history and no-evidence history render their explicit state rather than backend fallback text. Model-unavailable requests display the configured endpoint and lexical documents only.
- Saved message IDs are opened by resolving the owning session through the session API.
- Changed the citation link to a native anchor so it performs a full navigation to the Documents route.

## Backend verification and model configuration

Started only the backend lane's v1.1.0 backend on `127.0.0.1:8114`, with both `TANTARA_DATA_DIR` and `DATABASE_URL=sqlite:///$TANTARA_DATA_DIR/tantara.db`, after migrations and `scripts/seed.py --demo`. `/health` returned `{"status":"ok","service":"TANTARA Local Workspace API","version":"1.1.0"}`. OpenAPI included `/ai/ask`, `/ai/status`, `/ai/sessions`, `/ai/saved`, `/search/documents`, `/cases`, and `/meta/{name}`.

During grounded-answer runs, `/ai/status` reported local model `MiniCPM5-2B`, endpoint `http://192.168.0.101:8080/v1`, `reachable: true`. The model-unavailable E2E test temporarily set the per-user `/settings/ai` base URL to `http://127.0.0.1:1/v1`; that request returned `model_unavailable`, rendered no `.answer-text`, and showed lexical documents only. The test restored the previous base URL and model. The model was reachable again at the end.

## Checks run

- `pnpm lint` — passed, no ESLint warnings or errors.
- `pnpm typecheck` — passed.
- `pnpm build` — passed after a clean rerun. An earlier build overlapped a dev server and failed while `.next` was being changed; the final isolated build succeeded.
- Responsive Research route E2E at 1440, 1024, 768, and 390 px — passed; no horizontal overflow. It captured desktop and mobile screenshots.
- Model-unavailable Research E2E — passed with the dead endpoint override described above.
- `documentPageUrl` contract assertion — passed.
- Grounded answer E2E received non-empty answer text, `ok` status, and source IDs/page values that matched document records. The deep-link test reached `/documents/{id}?page=N`, but failed to find the cited page element.
- Out-of-scope E2E did **not** produce the required `no_evidence` API status. The API returned `ok` with retrieved documents and an answer saying evidence was insufficient. The test fails on the API status assertion, so no no-evidence screenshot was made.
- The first unfiltered Playwright invocation ran all 14 tests because the filename argument was forwarded incorrectly. It reported 6 passed and 8 failed, including unrelated smoke tests with assumptions tied to `127.0.0.1:8010`. Focused Research runs then confirmed the model-unavailable and responsive cases pass, while the citation-viewer and no-evidence assertions remain blocked by the gaps below.

## Integration gaps

1. **Citation viewer contract:** Research generates the required `/documents/{id}?page=N&chunk=...` link and navigation reaches that route. The Documents viewer currently reads `/documents/{id}/pages` as an array or `{items: [...]}`, but v1.1.0 returns `{pages: [...]}`. It therefore renders no `#page-N` element. The viewer also does not read `chunk` or highlight the cited excerpt. Fix these in the Documents lane; this Research branch intentionally does not edit that feature.
2. **No-evidence classification:** The seeded out-of-scope question retrieved unrelated indexed material and the backend returned `status: ok`, not `no_evidence`. The Research UI renders API statuses faithfully and does not infer a different status from generated wording. The backend needs a relevance threshold/classification that returns `no_evidence` when the corpus does not support the question.
3. **Collections:** `/meta/collections` is absent from the v1.1.0 API (it returns 404); the selector explicitly reports that metadata is unavailable. Jurisdictions are live from `/meta/jurisdictions`.
4. **Upload fixture handoff E2E:** The current citation E2E uses the private backend's seeded indexed corpus, not a newly uploaded fixture PDF. Full upload → ready → ask → click → page/highlight proof remains blocked by the viewer response-shape/highlight gap. No fixture upload test is claimed as passing.
5. **Navigation:** The current shell exposes no documented extendable navigation constant, and shell edits are outside this lane. The Research route works directly; the integrator should add its sidebar entry.
6. **Captures:** Committed captures include settled real-data desktop, answer-with-citations, model-unavailable, and mobile states. `research-no-evidence.png` is absent because the backend did not return that state for the seeded corpus; creating a screenshot with a fabricated state would misrepresent runtime behavior.

## Files and captures

- Research route: `frontend/src/app/(workspace)/research/page.tsx`
- Research library handoff: `frontend/src/app/(workspace)/research/documents/page.tsx`
- Feature styles: `frontend/src/app/(workspace)/research/research.css`
- API wrappers: `frontend/src/features/research/api.ts`
- URL contract: `frontend/src/features/research/document-url.ts`
- E2E: `frontend/tests/research.spec.ts`
- Playwright port configuration: `frontend/playwright.config.ts`
- Captures: `frontend/docs/screenshots/research-desktop.png`, `research-answer-citations.png`, `research-model-unavailable.png`, `research-mobile.png`

`frontend/next.config.ts` already had `devIndicators: false` in the starting state, so no edit was needed there. The shell/nav was left to integration.
