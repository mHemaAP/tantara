# TANTARA backend API

Base URL: `http://127.0.0.1:8010/api/v1`. Authenticated routes use `Authorization: Bearer <access_token>`. Root `/health`, `/ingest/file`, and `/query` are retained as legacy adapters. See the committed [OpenAPI snapshot](../backend/openapi.json) for operation schemas.

The bundled `tantara_admin_password` default is `tantara-local` for local development and tests only. **Change this** by setting `TANTARA_ADMIN_PASSWORD` before using the service outside an isolated local workspace. No production credential or real secret is stored in this repository.

`TANTARA_DATA_DIR` (or `DATA_DIR`) is resolved to an absolute path and holds both `tantara.db` and the FAISS index. `DATABASE_URL` explicitly overrides the derived database URL. Alembic can be run from the repository root (`alembic upgrade head`) or from `backend/` (`alembic upgrade head`).

## Contract conventions

- List responses are `{items,total,page,page_size,pages}`; supported domain filters include `q`, `status`, `case_id`, `page`, `page_size`, and `sort`. Documents also accept `type`; hearings accept `from` and `to`; community posts accept `tag`, `kind`, and `saved`.
- Errors use `{error:{code,message,details?}}`. Common statuses: 400 invalid domain input, 401 missing/invalid token, 403 role denial, 404 missing or not-owned record, 409 duplicate/unique conflict, 413 upload limit, 422 request validation, 429 SQLite-backed per-minute rate limit shared across workers, 503 optional model failure.
- Records are owner-scoped. Case deletion archives the case; document deletion removes its file and all index rows.

## Authentication and metadata

- `POST /auth/login`, `GET /auth/me`
- `GET /meta/institutions`, `/meta/case-statuses`, `/meta/dispute-categories`, `/meta/document-types`, `/meta/jurisdictions`

## Workspace

- CRUD `/clients`; `GET /clients/{id}/cases`
- CRUD `/cases`; `GET /cases/{id}/overview`
- `POST /cases/{id}/participants`; `PATCH|DELETE /cases/{id}/participants/{participant_id}`
- CRUD `/cases/{id}/events`
- CRUD `/hearings` and `/tasks`
- `GET /calendar?from=&to=`
- `GET /dashboard/summary`, `/dashboard/activity`, `/dashboard/upcoming?days=`

## Documents and search

- `POST /documents/upload` (multipart: `file`, optional title/type/jurisdiction/case_id), `GET /documents`, `GET|PATCH|DELETE /documents/{id}`
- `GET /documents/{id}/job`, `POST /documents/{id}/retry`
- `GET /documents/{id}/file` (Range), `/pages`, `/text`
- `POST|GET /documents/{id}/ai-read`, `PATCH /documents/{id}/extraction`
- `GET /search/documents?query=&case_ids=&document_types=&page=&page_size=`

## AI, drafting, bundles, and strategy

- `POST /ai/ask`; `GET /ai/status`; `GET|POST /ai/sessions`; `GET|PATCH|DELETE /ai/sessions/{id}`; `POST /ai/sessions/{id}/messages`; `GET|POST /ai/saved`; `DELETE /ai/saved/{id}`
- `GET /draft-templates`; CRUD `/drafts`; `POST /drafts/generate`; `GET|POST /drafts/{id}/versions`; `POST /drafts/{id}/regenerate-section`; `GET /drafts/{id}/export?format=docx|pdf`
- CRUD `/bundles`; `PUT /bundles/{id}/items` accepts optional inclusive `page_start` and `page_end` per source document (omitting both includes all pages); `PUT /bundles/{id}/sections`; `GET /bundles/{id}/preview`; `POST /bundles/{id}/generate`; `GET /bundles/{id}/download`
- `GET /cases/{id}/autofill`; `POST /cases/{id}/autofill/preview`; `POST /cases/{id}/autofill/apply`
- `GET|PUT /cases/{id}/strategy`; `POST /cases/{id}/strategy/generate`

## Community and settings

- CRUD `/community/posts`; `GET|POST /community/posts/{id}/replies`; `DELETE /community/posts/{id}/replies/{reply_id}`; `POST /community/posts/{id}/save`
- `GET|PATCH /settings/profile`, `/settings/workspace`, `/settings/appearance`, `/settings/ai`
- `GET /settings/embeddings`, `/settings/database`, `/settings/database/stats`, `POST /settings/database/backup`, `GET /settings/security`, `POST /settings/password`
- `GET|POST /settings/data/import` (optional corpus runner)

AI answers return `ok|no_evidence|model_unavailable|embedding_unavailable`. Search returns `{status,items,total,page,page_size,pages}` with `status: "embedding_unavailable"` if chunks have stored embeddings but the configured embedding backend fails or the FAISS index is missing/stale; lexical hits may still be returned and carry that warning. AI ask uses the same status and only cites returned database chunks. Empty retrieval returns an explicit insufficient-evidence answer and no citations. Citations include actual page numbers and both `retreival_score` (legacy misspelling) and `retrieval_score`, with equal numeric values; new clients should use `retrieval_score`.
