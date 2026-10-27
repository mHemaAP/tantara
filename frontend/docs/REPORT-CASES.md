# Cases / Clients / Tasks / Calendar — Round 3

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
