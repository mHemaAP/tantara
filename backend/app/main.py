import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

try:
    from app.ingestion import ingest
    from app.rag import answer
except ImportError:  # pragma: no cover - fallback for direct script execution
    from ingestion import ingest
    from rag import answer

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="TANTARA RAG API", version="0.1.0")


class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=8000)
    top_k: int = Field(default=5, ge=1, le=12)
    jurisdiction: str | None = "India"
    document_types: list[str] | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "TANTARA RAG API",
        "version": "0.1.0",
    }


@app.post("/ingest/file")
async def ingest_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    document_type: str = Form("template"),
    jurisdiction: str = Form("India"),
    source_label: str | None = Form(None),
):
    try:
        return ingest(
            file.filename or "upload.bin",
            await file.read(),
            title,
            document_type,
            jurisdiction,
            source_label,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logging.exception("Document ingestion failed")
        raise HTTPException(
            status_code=500,
            detail="Ingestion failed; check server logs/configuration.",
        ) from exc


@app.post("/query")
def query(req: QueryRequest):
    try:
        return answer(
            req.question,
            req.top_k,
            req.jurisdiction,
            req.document_types,
        )
    except Exception as exc:
        logging.exception("Query failed")
        raise HTTPException(
            status_code=500,
            detail="Query failed; check server logs/configuration.",
        ) from exc
