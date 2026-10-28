# L6b round 3 — AI Case Drafts and Smart Autofill

## What changed

- Replaced user-visible chunk UUIDs with document/page links in the editor body and the grouped citation rail. Chunk IDs remain only in `data-chunk-id`. The backend's live output may place IDs inline as `[chunk: [UUID p.1]]`; the UI resolves those through its source-excerpt lines.
- Rendered `[REVIEW:` and `[REVIEW]:` lines as amber **Needs your review** blocks, with a count of open items. The literal source wording stays present. Repeated `Case Details` headings are normalized so the second block is labelled for its evidence excerpts.
- Rebuilt version rows as separate version label, change note, timestamp and current marker. Dates and times use separate `Intl.DateTimeFormat` calls. Restore confirms, prefers L9i's version restore route, refreshes the draft after success, and reports 403 without retrying. A 404 falls back to the old snapshot endpoint while the backend lane is still pre-L9i.
- Grouped cited pages under one document card. Each page chip links to `/documents/{document_id}?page={page}`.
- Made the draft list load 21 records, show five rows by default, and expose a Show more control. Added a visible Start a draft action at the top of the page. Autofill source inventory is collapsed and Apply to Draft stays sticky above the field review.
- Autofill-applied draft lines now store value, provenance, and source together.
- Real capture tests authenticate to the private backend, discover the seeded case through `GET /api/v1/cases`, and assert that the editor's visible case reference equals the value returned by that request. There are no `page.route()` calls in `drafts-captures.spec.ts`.

## Per-defect verification

| Defect | File/change | Test and pinning assertion |
| --- | --- | --- |
| Chunk UUIDs shown to lawyers | `src/app/(workspace)/drafts/page.tsx`: resolve source excerpts into document/page links; keep IDs in `data-chunk-id` | `drafts-captures.spec.ts` / `captures live seeded drafts and autofill states at desktop and mobile sizes`: editor inner text does not match the UUID regex; a `data-chunk-id` attribute still carries the ID; page chips display page labels. |
| Concatenated version metadata | same page + `features/drafts/styles.css`: grid columns, separate date/time, Current marker | Same test checks separate `<time>` spans, Version label and Current marker after reload. |
| Duplicate Case Details heading | same page: normalize repeated headings | Same test asserts the Case Details heading count is at most one. Live generated copy sometimes has no such heading, so the assertion allows zero. |
| Review markers look like prose | same page + feature CSS: amber review block and count | Same test checks the review summary, Needs your review block and unchanged `[REVIEW:` wording. |
| Repeated cited-source rows | same page: group by document and show page chips | Same test checks a document card's page chips and their viewer links. |
| Export integrity and text | capture spec clicks both export controls; parses DOCX XML and decoded PDF text stream | Same test checks `PK\x03\x04`, `%PDF`, size >200 bytes, a newly saved unique phrase and a review marker. `drafts-api.spec.ts` also exports the empty-evidence draft and checks its markers. |
| Mobile sidebar obstruction | feature-local `features/drafts/styles.css` closes the sidebar off-canvas at mobile widths | Same test measures sidebar/page bounds at 390px after the close transition; it also checks horizontal scroll width <=390. |
| Autofill buried below document inventory | `src/app/(workspace)/autofill/page.tsx` uses collapsed `<details>` and a sticky Apply action; feature CSS positions the action above fields | Same test checks source rows remain collapsed and Apply to Draft is inside the first 844px viewport. |
| Long draft list | drafts page renders the 21-row API page, collapsed to five rows with Show more; Start a draft is in the header | Same test ensures the seeded setup has >=21 drafts, UI renders 21 rows, Start a draft is inside 844px, and row title/status/time use distinct elements. |
| Date hallucination | retained `autofill-date-guard.spec.ts` | `a statute year is never written into a date field` verifies `1996` remains blank/review-required and no apply/version write occurs. |

## Live API contract

Fetched `http://127.0.0.1:8115/openapi.json` from the actual backend worktree at `/home/kahitoz/projects/tantara-wt/be/backend`. Paths present and exercised:

```text
GET  /api/v1/draft-templates
GET  /api/v1/drafts
POST /api/v1/drafts
GET  /api/v1/drafts/{rid}
PATCH /api/v1/drafts/{rid}
POST /api/v1/drafts/generate
GET  /api/v1/drafts/{rid}/versions
POST /api/v1/drafts/{rid}/versions
POST /api/v1/drafts/{rid}/regenerate-section
GET  /api/v1/drafts/{rid}/export
GET  /api/v1/cases/{cid}/autofill
POST /api/v1/cases/{cid}/autofill/preview
POST /api/v1/cases/{cid}/autofill/apply
GET  /api/v1/settings/ai
PATCH /api/v1/settings/ai
```

The live API does **not** currently expose `POST /api/v1/cases/{cid}/autofill` or `POST /api/v1/drafts/{rid}/versions/{vid}/restore`. The UI reports 403 on the new restore route and has a legacy snapshot fallback for the observed 404. The OpenAPI also confirms no model-based Autofill suggestion route. These are backend gaps, not simulated successes.

## Endpoint-to-test map

| Endpoint | Exercising test and coverage |
| --- | --- |
| `GET /draft-templates`, `GET /drafts`, `POST /drafts`, `GET /drafts/{rid}` | `drafts-api.spec.ts`: template/list reads, create with no versions, reload and ownership checks; `drafts-captures.spec.ts`: real list and generated draft reload. |
| `POST /drafts/generate` | `drafts-api.spec.ts`: empty-corpus success, missing case validation envelope, unauthenticated 401; capture test: grounded output, seeded title/parties and real model request. |
| `GET /drafts/{rid}/versions`, `POST /drafts/{rid}/versions`, `PATCH /drafts/{rid}` | `drafts-api.spec.ts`: empty and saved history, malformed snapshot validation, anonymous/cross-user access; capture test: saved text/version survives reload and restore is confirmed. |
| `POST /drafts/{rid}/regenerate-section` | `drafts-api.spec.ts`: success preserves other sections, invalid body envelope, 401 and cross-user denial. |
| `GET /drafts/{rid}/export` | `drafts-api.spec.ts`: empty-evidence review markers survive DOCX/PDF, MIME type, byte size and magic; capture test clicks both controls and checks DOCX XML/PDF decoded text contain a newly saved phrase and review marker. |
| `GET /cases/{cid}/autofill`, `POST /cases/{cid}/autofill/preview`, `POST /cases/{cid}/autofill/apply` | `drafts-api.spec.ts`: success, invalid payload envelope, anonymous 401; capture test accepts a sourced field, applies it and verifies persisted value/provenance after reload. |
| `POST /cases/{cid}/autofill` | `drafts-api.spec.ts`: asserts absent from OpenAPI and actual request returns 405. This operation is not implemented by the observed backend. |
| `POST /drafts/{rid}/versions/{vid}/restore` | `drafts-api.spec.ts`: asserts absent from OpenAPI and actual request returns 404. The UI uses its legacy snapshot fallback on this backend; L9i success/403 remains untested here. |
| `PATCH /settings/ai` | Capture test sets a closed endpoint and restores the original setting; retry yields a second persisted draft. |

## Capture files

Every file below was captured from the running seeded backend with no `page.route()` shim. The capture test sets viewport sizes to exactly 1440×900 and 390×844, waits for skeletons to disappear, checks mobile overflow, and asserts the backend-discovered case reference is on screen.

| Files | Viewport | State proved | Data endpoint |
| --- | --- | --- | --- |
| `drafts-list-desktop-1440.png`, `drafts-list-mobile-390.png` | 1440×900, 390×844 | Live draft list; bounded 21-row setup and visible Start a draft | `GET /api/v1/drafts` |
| `draft-editor-desktop-1440.png`, `draft-editor-mobile-390.png` | 1440×900, 390×844 | Generated live grounded draft, visible seeded case reference, citations and no displayed UUIDs | `POST /api/v1/drafts/generate`, `GET /api/v1/drafts/{rid}` |
| `draft-review-needed-desktop-1440.png`, `draft-review-needed-mobile-390.png` | 1440×900, 390×844 | Actual missing-evidence review blocks, wording and marker count | `POST /api/v1/drafts/generate` |
| `draft-version-history-desktop-1440.png`, `draft-version-history-mobile-390.png` | 1440×900, 390×844 | Saved edit, restored prior version, separated metadata and current marker | `PATCH /api/v1/drafts/{rid}`, `GET /api/v1/drafts/{rid}/versions`, legacy `POST /api/v1/drafts/{rid}/versions` restore fallback |
| `autofill-preview-desktop-1440.png`, `autofill-preview-mobile-390.png` | 1440×900, 390×844 | Real per-field provenance and source review | `GET /api/v1/cases/{cid}/autofill`, `POST /api/v1/cases/{cid}/autofill/preview` |
| `autofill-applied-desktop-1440.png`, `autofill-applied-mobile-390.png` | 1440×900, 390×844 | Accepted sourced value and provenance persisted into the selected draft | `POST /api/v1/cases/{cid}/autofill/apply`, `POST /api/v1/drafts/{rid}/versions`, `GET /api/v1/drafts/{rid}` |
| `draft-model-unavailable-desktop-1440.png`, `draft-model-unavailable-mobile-390.png` | 1440×900, 390×844 | Dead-port unavailable state and retry issuing another real generation request | `PATCH /api/v1/settings/ai`, `POST /api/v1/drafts/generate` |

The measured local generation returned `status: "ok"`, `generation_kind: "model_generated"`, and the grounded seeded case parties. `MiniCPM5-2B` was reachable during the live capture; the unavailable state was produced by changing the authenticated AI preference to a closed `127.0.0.1:8999` port, and Retry created a second real draft.

No screenshot in this round is fixture-backed; there is no `-fixture` suffix on these live captures. Existing legacy `*-fixture.png` captures remain clearly labelled and are not evidence for this round.

## Test and build results

- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8115 TANTARA_WEB_URL=http://127.0.0.1:3014 pnpm exec playwright test tests/drafts-captures.spec.ts --reporter=line` — **1 passed (1.0m)** (`1 passed (1.0m)`). This run created all 14 non-fixture captures against the private seeded API.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8115 TANTARA_WEB_URL=http://127.0.0.1:3014 pnpm exec playwright test tests/drafts-api.spec.ts tests/autofill-date-guard.spec.ts --reporter=line` — **6 passed (4.5s)** (`6 passed (4.5s)`).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — `pnpm typecheck` passed (`tsc --noEmit`, exit 0); `pnpm lint` passed (`✔ No ESLint warnings or errors`); `pnpm build` passed (production routes generated).
- pytest: no pytest suite was run for this frontend lane.

## Honest gaps

- The backend currently lacks the L9i restore route, so the capture's actual restore uses the legacy snapshot endpoint. The new restore route's success and read-only 403 behavior cannot be proven against this backend revision.
- The API lacks `POST /cases/{cid}/autofill` and an AI suggestion route. The UI only presents returned case-record/extracted values and does not invent suggestion confidence.
- The PDF renderer's text layout is simplistic. The capture verifies the real downloaded stream contains the review marker and unique saved phrase, but does not establish visual page-break quality.
- No E2E path creates a brand-new case and uploads a new fixture file in this round; the genuine model-backed run uses the seeded case corpus. Fixture captures are not used as evidence.
- The frontend editor remains `contentEditable`, not Tiptap, and the backend's PATCH snapshot behavior is still pre-L9i. The explicit snapshot fallback is used when a PATCH does not create a version.
