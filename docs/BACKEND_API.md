# TANTARA API v1

Base URL: `http://127.0.0.1:8010/api/v1`. Send `Authorization: Bearer <access_token>`. Login is `POST /auth/login` with `{email,password}`; `/auth/me` returns the current user. Errors use `{error:{code,message}}`. List responses use `{items,total,page,page_size,pages}`.

## Workspace

- `GET /health`; `GET /meta/{institutions|case-statuses|dispute-categories|document-types|jurisdictions}`
- `GET /dashboard/summary`, `/dashboard/activity`, `/dashboard/upcoming?days=30`
- CRUD `/clients`, `/cases`, `/hearings`, `/tasks`, `/drafts`, `/bundles`, `/community/posts`; list filters include `q,status,case_id,page,page_size,sort` where applicable.
- `GET /clients/{id}/cases`; `GET /cases/{id}/overview`; case participants at `/cases/{id}/participants`; events at `/cases/{id}/events`; `/calendar?from&to`.
- Documents: `POST /documents/upload` (multipart); `GET /documents`; `GET|PATCH|DELETE /documents/{id}`; `/job`, `/retry`, `/ai-read`, `/extraction`, `/file`, `/pages`, `/text`; `GET /search/documents?query=...`.
- AI: `POST /ai/ask`; `GET|POST /ai/sessions`, `GET|PATCH|DELETE /ai/sessions/{id}`, `POST /ai/sessions/{id}/messages`; saved items `/ai/saved`; `GET /ai/status`.
- Drafts: `GET /draft-templates`; `/drafts/{id}/versions`; `POST /drafts/generate`; `/drafts/{id}/regenerate-section`; `/drafts/{id}/export?format=docx|pdf`.
- Case tools: `/cases/{id}/autofill`, `/autofill/preview`, `/autofill/apply`, `/strategy`, `/strategy/generate`.
- Bundles: `/bundles/{id}/items`, `/sections`, `/preview`, `/generate`, `/download` (bundle generation is not yet implemented).
- Settings: `/settings/profile`, `/workspace`, `/ai`, `/embeddings`, `/database`, `/database/stats`, `/database/backup`, `/data/import`, `/appearance`, `/security`, `/password`.

All record queries are scoped to the authenticated local owner. Uploads have extension/content checks, a configured byte limit, and content-hash filenames. AI answers require retrieved local evidence and citations are derived from indexed chunk identifiers. Generated content must be reviewed by a legal professional.
