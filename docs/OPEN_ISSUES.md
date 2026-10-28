# Open issues

- The external `review-tools/verify_integration.sh` cannot complete as supplied. It exits under `set -u` because its helper is called without the second argument:
  `/home/kahitoz/projects/tantara-run/review-tools/verify_integration.sh: line 19: $2: unbound variable`.
  The preceding backend, bundle/draft/query, data-relocation, lint, typecheck, and build gates passed. A temporary corrected copy then encountered two harness problems: the style-contract check did not authenticate, and the Playwright subprocess found its health port already occupied. No external verifier code was changed.
- The style-contract helper's unauthenticated route diagnostics are not valid UI findings. Its exact captured diagnostic was:
  `form_without_method: null`
  `auth_present: false | login_call: no-login-request-seen | url: http://127.0.0.1:3030/`
  Consequently it labeled `/clients`, `/community`, and `/settings/profile` as `no-heading, heading-family-not-loaded(none)`. The authenticated `ui_compare.mjs` run on the main-repository app observed a heading with `Playfair Display` on all 11 requested routes, and the full route set had no mobile overflow.
- Playwright has one intentional skip: cross-user client/task/calendar authorization needs a second seeded identity. Full result: `1 skipped, 101 passed (9.3m)`; no failures or did-not-run tests.
- `pnpm lint` and `pnpm build` report an existing `react-hooks/exhaustive-deps` warning at `frontend/src/features/calendar/index.tsx:137` for `cursorParts.month` and `cursorParts.year`. It does not fail either gate.
