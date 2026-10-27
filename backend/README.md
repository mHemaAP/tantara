# TANTARA local backend

FastAPI workspace API with SQLite transactions, local file storage, local MiniLM embeddings, FTS5 search and a local OpenAI compatible LLM. Cloud adapters are optional and disabled by default. The database and upload data remain under `backend/data/`.

## Setup

Use Python 3.12 (the ONNX runtime wheels are not available for the machine's Python 3.14):

```sh
uv venv --python 3.12 backend/.venv
uv pip install -p backend/.venv/bin/python -r backend/requirements.txt -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
```

The default local account is `advocate@tantara.local` / `tantara-local`. Set `TANTARA_ADMIN_PASSWORD` before first startup or run `scripts/seed.py --empty`. At first startup the server creates SQLite WAL storage and a random 48-byte JWT key in `backend/data/.secret` with mode 0600.

Run only on loopback:

```sh
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

OpenAPI is served at `/openapi.json`; the checked-in `backend/openapi.json` is the frontend generation snapshot. The API prefix is `/api/v1`; legacy `/health`, `/ingest/file` and `/query` are retained.

## Environment

See `.env.example`. Local defaults use the OpenAI-compatible endpoint `http://192.168.0.101:8080/v1`, model `MiniCPM5-2B`, FastEmbed `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions), SQLite/FTS5, and local file storage. The LLM endpoint can be changed with `LOCAL_LLM_BASE_URL` and `LOCAL_LLM_MODEL`. `AI_PROVIDER=anthropic`, `EMBEDDING_PROVIDER=voyage`, or Supabase require `ENABLE_CLOUD_PROVIDERS=true` and relevant credentials. No credentials are required to start.

## Data and operations

`python scripts/seed.py --demo` inserts a clearly flagged workspace sample. `--empty` retains only the bootstrap user. `python scripts/import_corpus.py` attempts one public India Code Act PDF and records retrieval outcome, hash, source, and reuse note in `backend/data/corpus/manifest.json`; it is optional.

Alembic commands from `backend/`: `.venv/bin/alembic upgrade head`. SQLite FTS triggers mirror chunk inserts, updates and deletes; document deletion removes chunks (and FTS rows via trigger), the stored original, and ingestion jobs. Embeddings are stored alongside chunks in SQLite for this first local backend. SQLite is transactional; DuckDB is not used for transactional data.

## Tests

Run `.venv/bin/pytest -q` from `backend/`. Live workflow smoke script: start the loopback server, then `backend/.venv/bin/python backend/tests/e2e_flows.py`. It currently exercises client→case→participant→hearing/task→reopen persistence. The upload workflow requires an explicit source document and is not auto-run with fabricated legal material.

## Known limitations

This foundation provides the principal local API paths and owner scoping, but some workflow endpoints currently persist compact JSON domain records rather than normalized, field-by-field SQLAlchemy mappings. OCR executes on scanned PDFs when OCR runtime models can be loaded; confidence currently appears as null in the page-map response. Hybrid ranking combines FTS5 ranks and local cosine scores without a separately persisted FAISS index. Bundle assembly, robust multipart range streaming, true generated case strategy, corpus-to-index automation, rate limiting, multi-user role authorization policies, and complete per-endpoint contract tests remain unfinished. Generated drafts use conspicuous review placeholders; they are not model-generated legal advice.
