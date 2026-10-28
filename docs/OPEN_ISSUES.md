# Open issues and verification notes

This ledger includes only findings that remain open or explicitly deferred. Earlier R22–R25 implementation findings are fixed in the current tree: document warnings accept string and `{page, warning}` forms; draft evidence anchors navigate from the editor; client detail uses the matter layout and renders available fields; and case form submissions omit blank optional fields and display server validation details inline.

## Current findings

| Finding | Current evidence | Follow-up |
|---|---|---|
| A duplicate frontend screenshot corpus still contains five 1440×1000 captures. | After removing the five root historical desktop captures and nine obsolete failure images, `frontend/docs/screenshots/` retains 96 files. Five are still 1440×1000: `calendar-empty.png`, `cases-desktop.png`, `cases-empty.png`, `clients-desktop.png`, and `clients-empty.png`. Of the remaining corpus, 67 filenames have no same-basename counterpart in `docs/screenshots/`. Root `README.md` has 28 image links and all resolve. | R32: defer broader cleanup until README/spec references can be preserved safely under root `docs/screenshots/`; no wholesale deletion or regeneration in this pass. |

## Deferred

| Finding | Evidence | Reason deferred |
|---|---|---|
| Case list cannot distinguish “no hearings” from “past hearings only.” | `frontend/src/features/cases/components/case-list.tsx:213-218` renders an em dash when `next_hearing_at` is absent. The case API supplies the next upcoming hearing only; it exposes no past-hearing/history indicator. | R6: defer a differentiated label until the API provides enough history to make the distinction accurately. The existing upcoming-only semantics remain unchanged. |

## Closed observations

- **R45 inline navigation:** the Documents page renders `WorkspaceModuleNav` inside its `documents-heading` (`frontend/src/app/(workspace)/documents/page.tsx:131-145`). It is a separately named `Documents navigation` region (`frontend/src/features/documents/WorkspaceModuleNav.tsx:31`), presented in the page header as inline navigation; it is not a second global sidebar. The prior duplicate-global-rail finding is closed.
- **R22–R25:** the stale ledger findings were removed after verifying their implementations in the current source. See the source and regression tests rather than the obsolete line references from the prior ledger.

## Tooling and validation notes

- **Style-contract helper authentication:** the external helper run at `http://127.0.0.1:3034/` reported `auth_present: false` and no login request. Its no-heading/font-none output is not authenticated evidence. Authenticated Playwright and comparison captures are separate evidence; the helper itself still needs authenticated setup to support route conclusions.
- **Verifier strategy-write probe:** an earlier verifier request returned HTTP 405 because it did not exercise the route/method that writes strategy data. That result does not prove or disprove strategy authorization. Treat it as a tooling limitation; use the API domain contract test for authorization evidence.
- **Former authorization skip (resolved):** the prior cross-user skip was replaced by the real cross-user authorization test in `frontend/tests/api-domain-contracts.spec.ts`. A temporary owner-filter removal caused that test to fail (`Expected: 404`, `Received: 200`); the filter was restored.
- **Calendar hook warning (resolved):** the missing `cursorParts.month/year` dependency was corrected in `frontend/src/features/calendar/index.tsx`; current `pnpm lint` reports no ESLint warnings or errors.
