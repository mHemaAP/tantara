# Research Desk round 3 report

## Changes

- Citation references render as human links such as **Page 3 [1]**. Chunk IDs stay in `data-chunk-id`; answer prose is cleaned of raw UUID references. Citation links carry the document, page, and chunk query parameters.
- Source hits are grouped by document, page links are shown once per page, and identical excerpts appear once per document. The API document title is rendered after whitespace/escaped-newline cleanup. Relevance is shown to two decimals with rank and “relative to this query” framing. Human status labels are exposed alongside machine `data-status` values.
- The answer uses one answer-level source set rather than attaching every citation to every sentence. Case-record fields are labelled “from the case record”; conflicts can show the case value and the cited excerpt/page; `insufficient_evidence` suppresses answer citations and sources. These additive L9j paths are implemented conditionally but were not returned by the current backend (see gaps).
- Opening a history or saved answer restores the full session and hydrates document titles and citations. The active session ID persists through reload. Scope filtering associates sessions with jurisdictions through their linked live document records because this backend’s session records do not carry jurisdiction.
- The mobile shell exposes all nine destinations behind the off-canvas navigation button. Research content and the header controls remain inside the 390px viewport. Screenshot capture waits for the sidebar transition to finish before taking mobile evidence.
- Unavailable-model copy contains no endpoint, host, port, or exception. It offers Retry and shows lexical results as documents only. Retry resolves the failed turn in the visible conversation.

## Verification

The isolated backend was v1.1.0 on `127.0.0.1:8117`, started with both `TANTARA_DATA_DIR=/tmp/tantara-r3-data.FMTHoR` and `DATABASE_URL=sqlite:////tmp/tantara-r3-data.FMTHoR/tantara.db`; Alembic reached head and `scripts/seed.py --demo` reported “Demo workspace already seeded; researcher workspace reconciled.” The frontend used `127.0.0.1:3014`; our processes were stopped after verification.

The normal generation configuration was `MiniCPM5-2B` at `http://192.168.0.101:8080/v1`; `/settings/ai.runtime_status.reachable` reported `true` before the runs. The grounded-answer and genuine insufficiency tests completed with that model reachable. The unavailable test temporarily pointed settings at a dead local endpoint, asserted `model_unavailable`, no rendered answer, no model attribution, and evidence-only retrieval, then restored the prior model and verified Retry generated a grounded response. The `/ai/status` `ok` field was not treated as reachability proof.

Commands and outcomes:

- `pnpm format` — passed.
- `pnpm lint` — passed with no ESLint warnings or errors.
- `pnpm typecheck` — passed.
- `pnpm build` — passed; `/research` built at 9.29 kB.
- `TANTARA_WEB_URL=http://127.0.0.1:3014 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8117 pnpm test:e2e` — 13 passed, 4 failed (17 total). All 8 Research tests passed, covering formatter/grouping/status units, mobile shell bounds and navigation, scoped history, history/saved restoration, citations, no-evidence, genuine insufficiency, model-unavailable, and retry. The 4 failures are in the unrelated existing `smoke.spec.ts`: route traversal is interrupted by navigation at `/cases/case-1`; the settings smoke expects a Profile nav entry and a “Test connection” control not present in this tree; the dashboard smoke hardcodes port 8010. These tests were left unchanged.
- `TANTARA_WEB_URL=http://127.0.0.1:3014 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8117 pnpm exec playwright test tests/research.spec.ts --grep 'new research' --workers=1` — 1 passed after the scoped-history fix.

After the last valid full run, a final assertion was added for the mobile menu button’s viewport bounds. A focused rerun could not be completed: port 3014 had been taken by the `fe5` worktree and `/research` returned 404. That foreign process was not stopped or used. The earlier mobile run covered the navigation button and nine destinations; the new explicit button-bounds assertion is the only unverified test edit.

## Captures

Authenticated captures use real seeded API data, have no loading skeletons or Next.js dev badge, and are under `frontend/docs/screenshots/`.

- Desktop (1440px wide): `research-desktop-answer-citations.png`, `research-desktop-insufficient-evidence.png`, `research-desktop-model-unavailable.png`, `research-desktop-no-evidence.png`, `research-desktop-scope-selected.png`, `research-desktop-history-refreshed.png`, and `research-desktop-empty.png`.
- Mobile (390×844): `research-mobile-answer-citations.png`, `research-mobile-insufficient-evidence.png`, `research-mobile-model-unavailable.png`, `research-mobile-no-evidence.png`, and `research-mobile-empty.png` (composer visible in the initial view).
- Additional interaction captures cover the citation destination, refreshed/restored history, saved answer, scope, library, suggestion, Ask, and Retry states.

The citation click reaches `/documents/{id}?page=N&chunk=...` and the viewer title matches the cited document. **The page-scroll/highlight handoff remains blocked by the Documents viewer:** this v1.1.0 `/api/v1/documents/{id}/pages` response is `{ "pages": [...] }`, while the current viewer only consumes a bare array or `{ "items": [...] }`. It consequently renders no `#page-N` element and has no “Page number” input. The Research lane did not change the Documents feature, and no claim is made that the cited page or chunk highlight was visible in the viewer capture.

The current v1.1.0 `/api/v1/ai/ask` response includes status, answer, citations with page/excerpt/title and score aliases, model, and disclaimer, but does not return the additive `supports`, `answer_basis`, `context_fields`, `conflicts`, or `insufficient_evidence` fields. The conditional UI behavior for those fields therefore needs a backend-enabled integration run.

## Changed files and commits

Each changed file is committed separately.

- Implementation and tests: `ca726a2` Research page; `4989fb7` Research CSS; `975b76c` shell navigation; `529136a` API types; `99fa2b6` presentation helpers; `168bfd5` Research tests; `cb93b94` Playwright assigned-URL configuration.
- Captures: `4f6f666` desktop answer; `064e07f` desktop empty; `5ebb44c` desktop insufficiency; `df22c50` desktop model unavailable; `f5cb4c8` desktop no evidence; `afa3f6b` mobile answer; `d1245d1` mobile empty; `db47805` mobile insufficiency; `c061a40` mobile model unavailable; `4b79258` mobile no evidence; `32318ad` Ask; `73e84d2` citation viewer; `e0ebf12` history entry; `2e64625` history refresh; `2b5127c` library; `f89d14a` new after history; `754fb84` new state; `12b9afe` retry recovered; `64190e6` saved answer opened; `e40fe00` saved answer; `d56e39d` scope; `c4a2e4d` suggested question; `685c298` restored session.
- This report is committed separately after the implementation and capture commits.
