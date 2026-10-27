# Cases / Clients / Tasks / Calendar — Round 3

## Round 4 acceptance follow-up

This section supersedes Round 3's statement that the seeded Cases collection did not expose a hearing projection. The private API's `GET /cases` response does include `next_hearing_at`, derived as the earliest hearing whose `at` value is at or after the API clock. The Round 3 UI overlaid a hearings collection map, which admitted past dates and made the list disagree with case detail. Round 4 removes that map and uses the case API projection in both views.

### Sol-ranked findings

| Finding | Round 4 change | Test/evidence |
|---|---|---|
| Next.js “N” dev badge contaminated screenshots. | Added `devIndicators: false`; capture checks the indicator element and visible issues badge in the Next shadow portal before every screenshot. | `pnpm screenshots` passed with no visible indicator in the 16 recaptured states. |
| Cases mobile hid hearing/status columns and clipped status tabs. | Added responsive case cards with title, forum, next hearing and status; kept status tabs horizontally accessible and removed the table's hidden mobile columns. | E2E verifies a card and its status/hearing values fit within the 390px viewport; 360/390/768/1024/1440 route smoke passed without horizontal overflow. |
| Calendar mobile month view was unreadable. | Calendar switches to Agenda below 650px; agenda rows retain normal wrapping and full event text. The Month view remains available on desktop. | E2E verifies Agenda is selected at 390px, event labels do not use word-breaking styles, and the document has no horizontal overflow. Capture shows dated agenda groups. |
| Next hearing values were stale/inconsistent. | Removed client-side hearing map; list and detail format the same API-derived `next_hearing_at`. Rows with no future hearing retain `—`. | API-level regression compares projection to the minimum future linked hearing, asserts no returned projection is earlier than the test clock, then verifies the same date in list and detail. |
| Client zero-case count was shown as unavailable. | Kept the API's computed `case_count` value intact, including numeric zero. Missing/null remains `—`. | API + UI test finds the seeded zero-case client and asserts its Cases cell reads `0`. |
| Task Retry had no recovery proof. | Added a visible Retry button with focus-ring styling. Empty task groups are omitted; task rows now use title, due, priority and linked-case columns. | E2E forces the first two browser task fetch attempts to fail, clicks Retry, then verifies real API task groups replace the error state. |
| Task list showed empty groups and had low information density. | Only populated groups render; task rows use a compact column grid and stronger priority styling. | E2E smoke and loaded task capture. |
| Cases list had excess row height and filtered searches said “No matters yet.” | Removed duplicated demo labels from each row (the global honest sample-data badge remains); reduced cell padding and added “No matching cases.” | Loaded and empty case captures; route smoke. |
| Active route state needed proof for Calendar and case detail. | Existing shell route-prefix matching now has explicit coverage for Cases, case detail, Clients, Tasks and Calendar. | E2E asserts exactly one `aria-current="page"` link on each route. No shell behavior was changed this round. |

### Current capture inventory

- `docs/screenshots/cases-desktop.png` — clean seeded 12-case list, real counts and future hearing projections.
- `docs/screenshots/cases-mobile.png` — 390px responsive case cards with status and hearing visible.
- `docs/screenshots/case-detail-desktop.png` — seeded case detail with API-derived next hearing.
- `docs/screenshots/clients-desktop.png` — seeded clients, including the genuine zero-case client.
- `docs/screenshots/tasks-desktop.png` — populated task groups with due dates, priorities and case links.
- `docs/screenshots/calendar-desktop.png` — seeded October month view.
- `docs/screenshots/calendar-mobile.png` — 390px agenda with dated event groups.
- `docs/screenshots/dashboard-desktop.png` — dashboard with the existing Matters card and metrics.
- `docs/screenshots/cases-empty.png`, `clients-empty.png`, `calendar-empty.png` — genuine empty search/period states.
- `docs/screenshots/cases-failure.png`, `clients-failure.png`, `tasks-failure.png`, `calendar-failure.png`, `case-detail-failure.png` — API failure states with retry treatment.

### Gates

- Previous E2E baseline: 20 tests. Round 4: `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8112 pnpm test:e2e` — **25 passed**.
- `pnpm format` — passed.
- `pnpm lint` — passed; no ESLint warnings or errors (Next reports `next lint` is deprecated).
- `pnpm typecheck` — passed.
- `pnpm build` — passed; 17 app routes generated.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8112 pnpm screenshots` — passed; 8 loaded real-data captures, 3 genuine empty states and 5 failure states. Captures used a fresh temporary SQLite database seeded with `scripts/seed.py --demo` and the required `DATABASE_URL`.

### Remaining gaps

- The sidebar art still uses the existing illustrated SVG rather than the target's photographic scales-and-books image. The repository has no photographic sidebar asset; the N badge was removed from captures via configuration, but the photo fidelity itself remains open.
- Team assignment, case Research and case Activity log remain unavailable for the backend reasons documented above. Client edit/delete/status CRUD and dedicated keyboard tests for every dialog remain open.
- No behavior in `src/components/shell.tsx` changed in Round 4; integration still needs to retain the previously documented Round 3 shell behavior when reconciling with `frontend-core`.

### Round 4 commits

Each implementation, test, screenshot and report path was committed separately; no push or merge was performed.

- Config: `af7bfbc`.
- Case detail: `c909156`; Calendar mobile: `1352261`; case list: `adf5d29`.
- Feature styles: `6648315`; Tasks: `2bc53a7`.
- Capture guard: `8999f57`; acceptance tests: `9fced7d`, `e407cd8`.
- Screenshots each have an individual `Refresh <filename> evidence` commit; see the filenames above and `git log` for their current commit IDs.
- This report is committed separately after its contents are finalized.

## Sol-3 defect follow-up

| Finding | Fix | Files | Evidence |
|---|---|---|---|
| Unconditional unread dot claimed notifications without evidence. | Removed the fixed dot. The bell is labelled “Recent activity”; a dot appears only when `GET /dashboard/activity` returns rows. Empty activity renders no dot. | `src/components/shell.tsx`, `src/features/shell/styles.css`, `tests/cases-regressions.spec.ts` | `shell has no activity signal when the real activity feed is empty` intercepts the feed with an empty response and asserts `.activity-dot` is absent. |
| Header initially fabricated Aarav Mehta. | Identity begins empty; loading uses “Signing in…” and a neutral initials box; auth failure displays “Signed out” / “Authentication unavailable” and the app shows a sign-in treatment. Preview has a neutral “Preview workspace” label. | `src/components/shell.tsx`, `tests/cases-regressions.spec.ts` | `shell never displays a fabricated identity while auth is loading`. |
| Next Hearing was blank despite seven seeded hearings. | `/cases` has no computed hearing projection; the case model's `next_hearing_at` is nullable and all seeded cases return null. The table now makes one bounded `GET /hearings?page=1&page_size=100&sort=at` request and maps the nearest hearing by `case_id`. | `src/features/cases/api.ts`, `src/features/cases/components/case-list.tsx`, `tests/cases-regressions.spec.ts` | Direct API read on the isolated seed: `/cases` returned 12 records and `next_hearing_at: null` for each; `/hearings` returned 7, including a hearing linked to `ABC Pvt. Ltd. vs. XYZ Ltd.` at `2026-10-28T10:00:00`. Regression asserts both API facts and the rendered date for a linked case. This is one collection call, not N+1. |
| Shell was one-line, inline-styled, and omitted lane navigation. | Reformatted shell, moved its shell-specific styling to a feature stylesheet, and added active navigation links in target order for Dashboard, My Cases, Research Desk, Drafts & Documents, Calendar, Tasks, Clients, Community, and Settings. | `src/components/shell.tsx`, `src/features/shell/styles.css`, `package.json` | `pnpm format`, route smoke, and rendered shell regressions pass. |

## Continued feature work

- Tasks now support create and edit with title, case link, due date/time, priority, status, and notes; completion remains optimistic with rollback on API failure. Uses `POST /tasks` and `PATCH /tasks/{id}`.
- Case detail now has create/edit/delete flows for timeline events, hearings, participants (including counsel role), and notes, using the corresponding supported endpoints. Notes, documents, and drafts use their real filtered listing endpoints.
- Case detail retains explicit unavailable states for case-specific Research and the Activity log because this backend exposes neither a case research listing nor an audit/activity listing endpoint. It does not refetch the case record for those tabs.
- The API has no assigned-team/team-member field or assignment endpoint on Case. Counsel participants can be recorded as case participants, but this is not a substitute for an assigned-team feature. Case form team assignment remains open.
- Shell changes are intentionally explicit for integration to port onto `frontend-core`'s authoritative shell. In `src/components/shell.tsx`, the nav array/order is at line 30; empty identity/auth error state starts at lines 52–54 and auth resolution at 76–98; real activity fetch is at 159–166 and the conditional signal at 285–294; neutral avatar and loading/signed-out labels are at 317–361. `src/features/shell/styles.css` owns the former inline shell layout styles. The file is much larger in this branch because Prettier expanded its original one-line statements; the behavioral port is the nav, activity signal, and identity/auth handling described above. Integration must reconcile these behaviors with `frontend-core`'s shell.

## Screenshots

All captures below use a clean, isolated demo seed on `127.0.0.1:8112`; loaded records are real API responses and demo records are marked in the UI.

- `docs/screenshots/cases-desktop.png` — seeded cases table, live counts, hearing dates, pagination.
- `docs/screenshots/cases-mobile.png` — seeded cases table at 390px.
- `docs/screenshots/case-detail-desktop.png` — seeded case overview and real case facts.
- `docs/screenshots/clients-desktop.png` — seeded client directory.
- `docs/screenshots/tasks-desktop.png` — seeded task groups.
- `docs/screenshots/calendar-desktop.png` — seeded calendar month.
- `docs/screenshots/calendar-mobile.png` — calendar at 390px.
- `docs/screenshots/dashboard-desktop.png` — dashboard with Matters card below the existing metrics.
- `docs/screenshots/cases-empty.png` — real search with no matching cases.
- `docs/screenshots/clients-empty.png` — real search with no matching clients.
- `docs/screenshots/calendar-empty.png` — real event-free agenda period.
- `docs/screenshots/case-detail-failure.png` — case API failure with retry treatment.
- `docs/screenshots/cases-failure.png` — case API failure with Retry.
- `docs/screenshots/clients-failure.png` — client API failure with Retry.
- `docs/screenshots/tasks-failure.png` — task API failure with Retry.
- `docs/screenshots/calendar-failure.png` — calendar API failure with Retry.

## Quality gates

- Before this round: 17 Playwright tests passed.
- After this round: `pnpm test:e2e` — 20 passed. The three added tests cover empty recent activity/no dot, neutral auth-loading identity, and the API/UI next-hearing projection.
- `pnpm format` — passed.
- `pnpm lint` — passed, no ESLint warnings or errors.
- `pnpm typecheck` — passed.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8112 pnpm build` — passed for all app routes.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8112 pnpm screenshots` — passed, saving 8 loaded real-data captures, 3 genuine empty states, and 5 API-failure states. The earlier clean-seed capture also passed before final case editor CRUD wiring; these screenshot surfaces do not include those editor dialogs.

## Remaining work

- Case team assignment needs a real backend field and endpoint; current case participant CRUD can record counsel roles but cannot assign workspace team members.
- Case Research and Activity log remain unavailable because their listing endpoints are absent.
- Client directory remains short of full edit/delete/status CRUD.
- Dedicated keyboard assertions for the dialogs and E2E CRUD coverage for the new event/hearing/note edit/delete controls are still missing.

## Commits

One file per commit; no push or merge was performed.

- Shell formatting script: `e4c7ba9`
- Shell behavior: `64d452c`
- Shell feature styles: `7a836e6`
- Case API wrappers: `7b63111`
- Next-hearing projection: `ea66f75`
- Case/task styles: `ab8aa9c`
- Task editing: `a032f9b`
- Case detail resources/editors: `c11d4d3`
- Defect regressions: `898fc59`
- Screenshots, in the order listed above: `2be79f6`, `5ad025e`, `1d80ff6`, `c55c380`, `d86c74e`, `ac29790`, `7d41534`, `8f09820`, `7b230a3`, `8c6a50e`, `bb5602d`, `1760599`, `00a5a06`, `aae675b`, `93b91f4`, `653797f`.
- This report is committed separately after the listed implementation and capture commits.
