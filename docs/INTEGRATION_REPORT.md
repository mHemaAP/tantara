# Integration report

Branch: `feat/tantara-workspace`  
Implementation HEAD at report preparation: `4e71023` (`Track autofill, version-history and model-unavailable captures`).  
The report, semantic navigation fixes, and final captures are committed as separate per-file changes after this evidence was collected.

## Lane merge record

All eight lane branches were reported at `ahead=0`; their origin SHAs were:

| Lane | `origin/<branch>` |
|---|---|
| be | `3a4dacb` |
| fe | `983f8b4` |
| fe2 | `203d28f` |
| fe3 | `2121281` |
| fe4 | `eb85b22` |
| fe5 | `20d4693` |
| fe6 | `ec30a01` |
| fe7 | `1042b26` |

Merge commits: `324f718` backend-core, `5c5a7c4` frontend-core, `b5549eb` frontend-cases, `3d32f80` frontend-documents, `b058b3f` frontend-research, `b771771` frontend-drafts, `ced42d7` frontend-bundles/strategy, `0b07a31` frontend-community.

## Validation evidence

The complete Playwright run used the unified isolated seeded backend/frontend topology. Verbatim summary:

```text
1 skipped
101 passed (9.3m)
```

The skip is the cross-user client/task/calendar permission scenario, which requires a second seeded identity. No test was reported as failed or did not run. The follow-up focused `ui-parity.spec.ts` run after the page-current semantics fix and tab-role changes was:

```text
Running 5 tests using 1 worker
✓ workspace navigation exposes all module routes and each route resolves (33.3s)
✓ settings section navigation keeps one visible page-level current link (1.9s)
✓ shared shell matches measured desktop target geometry and artwork (2.6s)
✓ dashboard renders four metrics before Ask TANTARA and keeps both secondary totals compact (2.1s)
✓ strategy evidence follow-up arrives prefilled in Research Desk (2.2s)
5 passed (1.5m)
```

Backend coverage command `backend/.venv/bin/python -m pytest -q --cov=app`:

```text
TOTAL                                3109    212    93%
104 passed in 198.24s (0:03:18)
```

Frontend checks after the final semantic navigation changes:

```text
pnpm exec tsc --noEmit
# no output; exit 0

pnpm lint
# exit 0
./src/features/calendar/index.tsx
137:5 Warning: React Hook useMemo has missing dependencies: 'cursorParts.month' and 'cursorParts.year'.
Checking formatting...
All matched files use Prettier code style!
```

Production build `pnpm build` completed with exit 0 and emitted all workspace routes. It reported the same existing calendar `useMemo` dependency warning.

Fresh test-free seeded visual evidence was captured from the main repository frontend. The required `ui_compare.mjs` invocation covered 11 routes; each logged `authed=true`, desktop `scrollW=1440`, mobile `mobileScrollW=390`, and heading font `Playfair Display`. Additional authenticated `/autofill`, `/search`, and `/strategy` desktop/mobile captures were collected to cover the full 14-route module set. `docs/screenshots/` contains 14 desktop 1440×900 and 14 mobile 390×844 screenshots; no fixture-named screenshots remain. All module routes are covered by route-resolution and rail-click assertions. The shell rail alone owns `aria-current="page"`; nested settings uses `location`, module links use `true`, and tabs use `aria-selected`.

The exact target probe output was:

```text
docs/design/frontend.png: 1536x1024 sidebar_w=222 sidebar_bg=#031023 header_h=70 workspace_bg=#FDFDFD primary=#EDF7F6 gold_px=2588 nav_rows~25
```

## Backend integration probes

The exact supplied `verify_integration.sh` ran through backend tests, bundle/draft/query probes, copied-data relocation, frontend lint, typecheck, and production build. Its output included:

```text
104 passed in 289.27s (0:04:49)
ALL BUNDLE DETAIL/PREVIEW/DOWNLOAD EXPECTATIONS PASSED
ALL DRAFT VERSIONING/RESTORE/EXPORT EXPECTATIONS PASSED
ALL QUERY/ANSWER-GROUNDING EXPECTATIONS PASSED
seeded bundle download after relocation         200 71557B magic=%PDF
pnpm lint                                      0
tsc --noEmit                                   0
pnpm build                                     0
host:port literals in src?                     0
tantara_preview refs (src/tests, must be 0/0)? 0/0
```

The exact script then stopped on its own shell helper defect:

```text
/home/kahitoz/projects/tantara-run/review-tools/verify_integration.sh: line 19: $2: unbound variable
```

A temporary, uncommitted corrected copy was used to diagnose the remaining harness behavior. Its style-contract helper was unauthenticated and therefore did not establish route styling; see `OPEN_ISSUES.md`. A subsequent Playwright subprocess in that copy hit an already-used health port. These are harness failures, so the corrected-copy run is not claimed as a green complete integration gate. Direct isolated bundle, query, and relocation proofs passed as shown above.

The report files and screenshots are repository evidence; the exact integration helper remains external and was not modified.
