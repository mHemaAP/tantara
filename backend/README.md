# TANTARA — Legal Knowledge RAG Backend

TANTARA is a Retrieval-Augmented Generation (RAG) backend designed to answer questions using a curated legal knowledge base.

## Technology stack

- FastAPI — API backend
- Supabase — PostgreSQL database and vector search
- Voyage AI — text embeddings
- Anthropic Claude — language model

## API endpoints

- `GET /health` — service health check
- `POST /ingest/file` — ingest a supported document
- `POST /query` — ask a question using retrieved knowledge

## Deployment

Deploy this repository as a Python web service on Render.

Configure API credentials and application settings through Render environment variables. Never commit actual API keys or secrets to GitHub.

## Important

This project is an initial implementation. Test database compatibility, document ingestion, retrieval quality, security, and API behavior before using it with confidential legal documents or in production.
