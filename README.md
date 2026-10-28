# TANTARA

TANTARA is a local-first workspace for arbitration matters. It combines case and client management, document ingestion, cited legal research, drafting, filing bundles, calendar, tasks, and community tools in one authenticated application.

## Architecture

The browser uses the Next.js workspace. API requests go through its same-origin `/api/v1` rewrite to FastAPI. SQLAlchemy stores owner-scoped records in SQLite; uploaded files and generated paperbooks live under the configured workspace data directory.

```mermaid
flowchart TB
  User[Advocate or researcher] --> Browser[Browser workspace<br/>Next.js]
  Browser -->|same-origin /api/v1| Rewrite[Next.js API rewrite]
  Rewrite --> API[FastAPI routers]
  API --> Domain[SQLAlchemy domain services]
  Domain --> DB[(SQLite workspace database)]
  API --> Storage[(Workspace data directory<br/>uploads and generated bundles)]
```

## Document ingestion data flow

Uploads are stored under the workspace data directory. Ingestion extracts text and page metadata, using OCR where a document has no usable text layer. Page-aware chunks feed both lexical and semantic indexes.

```mermaid
flowchart LR
  Upload[PDF, DOCX, text] --> Store[(Workspace file storage)]
  Store --> Extract[Text extraction]
  Extract --> OCR[OCR when needed]
  Extract --> Pages[Page text and metadata]
  OCR --> Pages
  Pages --> Chunk[Page-aware chunking]
  Chunk --> FTS[(FTS5 full-text index)]
  Chunk --> Embed[Configured embeddings]
  Embed --> FAISS[(FAISS vector index)]
```

## Search and query lifecycle

Search and answer requests are scoped by the authenticated owner and any selected collections before hybrid ranking. Answers retain source citations. If the configured generation model is unavailable, the application reports that state rather than presenting a grounded answer.

```mermaid
sequenceDiagram
  actor User
  participant Web as Next.js workspace
  participant API as FastAPI
  participant Scope as Owner and collection filters
  participant FTS as FTS5
  participant FAISS as FAISS
  participant Fuse as Hybrid ranking and fusion
  participant Model as Configured answer model
  User->>Web: Search or ask a question
  Web->>API: GET search or POST ask
  API->>Scope: Authenticate and validate requested collections
  Scope->>FTS: Lexical retrieval
  Scope->>FAISS: Semantic retrieval
  FTS-->>Fuse: Ranked text matches
  FAISS-->>Fuse: Ranked vector matches
  Fuse-->>API: Cited passages and page numbers
  API->>Model: Generate answer from retrieved evidence
  Model-->>Web: Cited answer or unavailable state
  Web-->>User: Render answer and source links
```

## Repository layout

- `frontend/` — Next.js application, UI modules, and Playwright end-to-end tests.
- `backend/app/` — FastAPI application, domain models, API routers, and retrieval services.
- `backend/alembic/` — database migrations.
- `scripts/` — workspace seeding and development utilities.
- `docs/` — API notes, integration reports, design references, and current screenshots.

## Local development

Use Python 3.11 or newer, Node.js, and pnpm. From the repository root, install the backend and frontend dependencies:

```bash
python -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
cd frontend && pnpm install
```

In a backend terminal, set a new workspace directory, seed its demo data once, and start the API:

```bash
cd /path/to/tantara
export TANTARA_DATA_DIR="$PWD/.tantara-data"
export DATABASE_URL="sqlite:///$TANTARA_DATA_DIR/tantara.db"
backend/.venv/bin/python scripts/seed.py --demo
cd backend
../backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

The demo seeder refuses to append to an existing populated workspace. Keep the data directory if you want to keep its data; use a new directory for a separate demo workspace.

In another terminal, start the frontend. It uses the same-origin API rewrite, which defaults to the local API above:

```bash
cd /path/to/tantara/frontend
TANTARA_API_ORIGIN=http://127.0.0.1:8010 pnpm dev
```

Open `http://127.0.0.1:3010`. The workspace timezone defaults to `Asia/Kolkata`; configure it with `TANTARA_WORKSPACE_TIME_ZONE` when needed. AI provider and embedding settings are read from the backend environment. The application reports unavailable model services in the UI.

## Validation

```bash
cd frontend
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright test

cd ../backend
../backend/.venv/bin/python -m pytest -q --cov=app
```

Playwright starts an isolated migrated and demo-seeded backend and frontend using the configured test origins. Its test API origin is `TANTARA_API_ORIGIN`; the web origin is `TANTARA_WEB_URL`.

## Workspace screenshots

These desktop and mobile captures come from the authenticated, demo-seeded workspace. Dimensions and file sizes were checked against the referenced files when this table was added.

| Module | Desktop (1440×900) | Mobile (390×844) | Rendered | Captured (UTC) |
|---|---|---|---|---|
| Dashboard | ![Dashboard desktop](docs/screenshots/dashboard-1440x900.png) | ![Dashboard mobile](docs/screenshots/dashboard-390x844.png) | 1440×900 / 390×844 | 10-28 12:29 |
| Cases | ![Cases desktop](docs/screenshots/cases-1440x900.png) | ![Cases mobile](docs/screenshots/cases-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Clients | ![Clients desktop](docs/screenshots/clients-1440x900.png) | ![Clients mobile](docs/screenshots/clients-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Tasks | ![Tasks desktop](docs/screenshots/tasks-1440x900.png) | ![Tasks mobile](docs/screenshots/tasks-390x844.png) | 1440×900 / 390×844 | 10-28 12:29 |
| Calendar | ![Calendar desktop](docs/screenshots/calendar-1440x900.png) | ![Calendar mobile](docs/screenshots/calendar-390x844.png) | 1440×900 / 390×844 | 10-28 12:29 |
| Documents | ![Documents desktop](docs/screenshots/documents-1440x900.png) | ![Documents mobile](docs/screenshots/documents-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Search | ![Search desktop](docs/screenshots/search-1440x900.png) | ![Search mobile](docs/screenshots/search-390x844.png) | 1440×900 / 390×844 | 10-28 12:06 |
| Research | ![Research desktop](docs/screenshots/research-1440x900.png) | ![Research mobile](docs/screenshots/research-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Drafts | ![Drafts desktop](docs/screenshots/drafts-1440x900.png) | ![Drafts mobile](docs/screenshots/drafts-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Autofill | ![Autofill desktop](docs/screenshots/autofill-1440x900.png) | ![Autofill mobile](docs/screenshots/autofill-390x844.png) | 1440×900 / 390×844 | 10-28 12:06 |
| Bundles | ![Bundles desktop](docs/screenshots/bundles-1440x900.png) | ![Bundles mobile](docs/screenshots/bundles-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Strategy | ![Strategy desktop](docs/screenshots/strategy-1440x900.png) | ![Strategy mobile](docs/screenshots/strategy-390x844.png) | 1440×900 / 390×844 | 10-28 12:06 |
| Community | ![Community desktop](docs/screenshots/community-1440x900.png) | ![Community mobile](docs/screenshots/community-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
| Settings | ![Settings desktop](docs/screenshots/settings-profile-1440x900.png) | ![Settings mobile](docs/screenshots/settings-profile-390x844.png) | 1440×900 / 390×844 | 10-28 11:59 |
