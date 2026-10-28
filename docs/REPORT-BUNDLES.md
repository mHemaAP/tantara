# Filing Bundle and Strategy Advisor

## Delivered

- Added a case document picker and bundle composition UI with draggable order, keyboard move buttons, section assignment, optional cover/index/synopsis/list of dates, bundle status, generated-PDF preview and download.
- Added the nested case Strategy Advisor with six URL-synced tabs, supported/hypothesis labels, citation links, editable blocks, save notes, research task creation, follow-up link, and outcome disclaimer.
- Added feature-local API wrappers and styles. No app mock data was added.
- Updated Playwright's web server to use `TANTARA_WEB_URL` and the assigned 3015 port by default.

## Files

- `frontend/src/app/(workspace)/bundles/page.tsx`
- `frontend/src/features/bundles/api.ts`
- `frontend/src/features/bundles/bundles.css`
- `frontend/src/app/(workspace)/cases/[id]/strategy/page.tsx`
- `frontend/src/features/strategy/api.ts`
- `frontend/src/features/strategy/index.ts`
- `frontend/src/features/strategy/strategy-panel.tsx`
- `frontend/src/features/strategy/strategy.css`
- `frontend/playwright.config.ts`

## Verification

Commands run from `frontend/`:

- `pnpm exec tsc --noEmit` — passed.
- `pnpm lint` — passed, no ESLint warnings or errors.
- `pnpm build` — passed. Next.js reported `/bundles` and `/cases/[id]/strategy` in the route output.
- `pnpm typecheck` — dependency installation stopped with `ERR_PNPM_IGNORED_BUILDS` for `unrs-resolver`; direct `pnpm exec tsc --noEmit` completed successfully after dependencies were present.

## Runtime and proof limits

This checkout's `backend/` contains only the older RAG service (`/health`, `/ingest/file`, `/query`). It has no Alembic configuration, `scripts/seed.py`, `/api/v1` application, bundle handlers, or strategy handlers. No PDF fixtures or requested target crop images are present. Therefore there was no valid isolated backend to start on 127.0.0.1:8116, and the real-backend bundle/strategy workflows, model-unavailable checks, and screenshots could not be run. No request was sent to 127.0.0.1:8010. Port 3015 was not used, so there was no frontend server to stop.

The UI reads item page ranges and manual-review flags from `GET /bundles/{id}/items`; it checks `%PDF` before opening the downloaded blob. Page-range correctness against the merged PDF, merged page count, scanned/rotated PDF behavior, persistence against the real backend, and model availability remain unproven in this checkout. The requested screenshots (`bundles-desktop.png`, `bundle-preview.png`, `strategy-desktop.png`, `strategy-citations.png`, `bundles-mobile.png`) were not created. No commits were made.
