# L6b — AI Case Drafts and Smart Autofill

## Delivered

- `/drafts` now loads live draft templates, cases, institutions, ready case documents, and recent drafts. It submits grounded generation requests, shows real generation state/progress, opens and edits generated content, lists citations and versions, saves versions, restores a selected version as a new version, regenerates a section, and downloads actual DOCX/PDF responses.
- `/autofill` loads case record and reviewed extraction values, shows provenance/source/page and available confidence, previews selected fields, requires an explicit per-field accept/edit, supports reviewed-only bulk acceptance, and protects lawyer-confirmed fields behind an explicit override. `Apply to Draft` adds accepted values to the selected draft and creates a version, then calls the case autofill apply API. The draft was reloaded from the API after application in the capture test.
- Date fields require a valid calendar date (or ISO timestamp with a valid calendar date). A bare year such as `1996` is cleared and marked for review. The regression test confirms that candidate causes neither a case apply request nor a draft version write.
- `frontend/next.config.ts` already had `devIndicators: false`; no change was needed there.

## OpenAPI paths verified and used

Fetched `http://127.0.0.1:8115/openapi.json` and asserted these live paths:

```text
GET  /api/v1/draft-templates
GET  /api/v1/drafts
POST /api/v1/drafts
GET  /api/v1/drafts/{rid}
POST /api/v1/drafts/generate
GET  /api/v1/drafts/{rid}/versions
POST /api/v1/drafts/{rid}/versions
POST /api/v1/drafts/{rid}/regenerate-section
GET  /api/v1/drafts/{rid}/export
GET  /api/v1/cases/{cid}/autofill
POST /api/v1/cases/{cid}/autofill/preview
POST /api/v1/cases/{cid}/autofill/apply
```

Autofill is case-scoped in the actual API; there is no literal `/api/v1/autofill` route. There is also no `suggest` or dedicated restore route. Restore is implemented by posting the selected historical content as a new version.

## Endpoint-to-test map

| Endpoint | Coverage |
| --- | --- |
| `GET /draft-templates` | `drafts-api.spec.ts`: live records, 401 anonymous |
| `GET /drafts` | `drafts-captures.spec.ts`: recent draft list and selection |
| `POST /drafts` | `drafts-api.spec.ts`: create a draft with no versions |
| `GET /drafts/{rid}` | `drafts-api.spec.ts`: reload and verify preserved body; 401 and cross-user 404 |
| `POST /drafts/generate` | `drafts-api.spec.ts`: empty-corpus review template, missing template, 422 envelope, 401; `drafts-captures.spec.ts`: load actual grounded model output |
| `GET /drafts/{rid}/versions` | `drafts-api.spec.ts`: empty/history states, invalid pagination 422, anonymous 401, cross-user 404 |
| `POST /drafts/{rid}/versions` | `drafts-api.spec.ts`: save and restore-as-new, missing content 422, anonymous 401, cross-user 404; capture test verifies reload after Autofill |
| `POST /drafts/{rid}/regenerate-section` | `drafts-api.spec.ts`: success preserves preceding content, invalid body 422, anonymous/cross-user rejection |
| `GET /drafts/{rid}/export` | `drafts-api.spec.ts`: DOCX and PDF with/without prior versions; MIME type, size over 200 bytes, `PK`/`%PDF` signatures, invalid format 422, anonymous/cross-user rejection |
| `GET /cases/{cid}/autofill` | `drafts-api.spec.ts`: real case fields and provenance, anonymous 401; date-guard regression uses one test fixture candidate |
| `POST /cases/{cid}/autofill/preview` | `drafts-api.spec.ts`: success, invalid `keys` 422, anonymous 401 |
| `POST /cases/{cid}/autofill/apply` | `drafts-api.spec.ts`: verified-value apply, invalid `fields` 422, anonymous 401; capture test verifies draft version reload |

The cross-user API test signs in as the separate seeded researcher account and confirms another user’s draft and versions/export/section operations return 404/403 without returning its data.

## Real backend and model evidence

- Backend source: `/home/kahitoz/projects/tantara-wt/be/backend`; isolated database: `/tmp/l6b-data/tantara.db`.
- Started only on `127.0.0.1:8115`, with both `TANTARA_DATA_DIR=/tmp/l6b-data` and `DATABASE_URL=sqlite:////tmp/l6b-data/tantara.db`, then ran Alembic and `../scripts/seed.py --demo`. Frontend and Playwright used port `3014`; no other lane ports were used.
- Authenticated as `advocate@tantara.local` / `tantara-local` for seeded screens.
- A live `POST /api/v1/drafts/generate` returned in **13.88 seconds** with `status: "ok"`, `generation_kind: "model_generated"`, provider `local`, and model `MiniCPM5-2B` while `http://192.168.0.101:8080/v1` was reachable.
- Grounding check: generated output included the real case title and parties (`ABC Pvt. Ltd.` / `XYZ Ltd.`), cited five chunk IDs, and a read-only check of the isolated database confirmed all five chunks belong to the selected “Unique Term Evidence” document on pages 1–5. Unsupported claim facts and requested relief remained marked with four `[REVIEW: ...]` markers; no additional party names appeared in the generated body.
- For unavailable-model capture, restarted the same backend with `TANTARA_LOCAL_LLM_BASE_URL=http://127.0.0.1:8999/v1` (no listener on 8999) and pointed the persisted AI preference at the same closed endpoint. Generation returned an editable review skeleton with an honest unavailable message and retry control. The preference was set on the temporary database only.

## Commands and results

- `pnpm typecheck` — passed (`tsc --noEmit`, exit 0).
- `pnpm lint` — passed: `✔ No ESLint warnings or errors`.
- `pnpm build` — passed; generated `/drafts` and `/autofill` routes.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8115 TANTARA_WEB_URL=http://127.0.0.1:3014 pnpm exec playwright test tests/drafts-api.spec.ts tests/autofill-date-guard.spec.ts` — **5 passed** (final summary: `5 passed (34.0s)`).
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8115 TANTARA_WEB_URL=http://127.0.0.1:3014 pnpm exec playwright test tests/drafts-captures.spec.ts` — **1 passed** (final summary: `1 passed (45.6s)`).
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8115 TANTARA_WEB_URL=http://127.0.0.1:3014 pnpm exec playwright test tests/drafts-unavailable-capture.spec.ts` — **1 passed** (final summary: `1 passed (22.1s)`).
- Final combined browser total: **7 passed** across the three successful commands. Screenshots assert no loading skeletons remain and scroll to the top before capture.

## Captures

All captures use the real seeded backend and include the required `-fixture.png` suffix.

- Draft list, desktop/mobile: `docs/screenshots/drafts-list-desktop-1440-seeded-fixture.png`, `docs/screenshots/drafts-list-mobile-390-seeded-fixture.png` — recent seeded drafts and the live draft-start form.
- Grounded generated editor, desktop/mobile: `docs/screenshots/draft-editor-desktop-1440-model-grounded-fixture.png`, `docs/screenshots/draft-editor-mobile-390-model-grounded-fixture.png` — the actual `MiniCPM5-2B` output, case parties, review markers, five page citations, and version panel.
- Version history after restore, desktop/mobile: `docs/screenshots/draft-version-history-desktop-1440-restored-fixture.png`, `docs/screenshots/draft-version-history-mobile-390-restored-fixture.png` — saved edit, restored original as a new version, and restore controls.
- Autofill preview, desktop/mobile: `docs/screenshots/autofill-preview-desktop-1440-record-based-fixture.png`, `docs/screenshots/autofill-preview-mobile-390-record-based-fixture.png` — record-based/reviewed provenance, source document/page links, and unavailable confidence shown as `—`.
- Autofill applied, desktop/mobile: `docs/screenshots/autofill-applied-desktop-1440-confirmed-fixture.png`, `docs/screenshots/autofill-applied-mobile-390-confirmed-fixture.png` — accepted fields written to the selected draft as a new version; message reports case-side skips.
- Model unavailable, desktop/mobile: `docs/screenshots/draft-model-unavailable-desktop-1440-dead-port-fixture.png`, `docs/screenshots/draft-model-unavailable-mobile-390-dead-port-fixture.png` — dead endpoint, explicit retry, editable review skeleton.

## Honest gaps

- The editor is a `contentEditable` surface with browser formatting commands, not Tiptap. It saves manually; there is no autosave/conflict-safe write flow.
- The backend exposes no model-based Autofill suggestion route or confidence score. The UI reports record-based values and shows `Confidence —` when absent; it does not invent AI suggestions.
- Some extraction values lack a document ID/page in the response; those values show their returned source title without a clickable page. The Autofill API also skips fields it does not permit updating, and the UI reports that count.
- Citation validation flags are not present in this API response. Citation display is built from the backend’s generated source excerpt list and links to matching document/page records when available.
- Section regeneration in the backend appends a marked review section; it does not call the model to regenerate prose. Diff summaries and autosave remain unavailable.
- The API contract suite covers real HTTP routes and seeded data, but it does not create a new case and upload a new fixture document end to end. Existing seeded PDFs are used for the grounded-generation capture.

## Commits

Commits are listed in the final response after the per-file commits are created.
