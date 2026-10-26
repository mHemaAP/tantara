import hashlib, io
from pathlib import Path

from pypdf import PdfReader

try:
    from app.config import get_settings
    from app.chunking import chunk_text
    from app.embeddings import embed_documents
    from app.db import insert_document, insert_chunks
except ImportError:  # pragma: no cover - fallback for direct script execution
    from config import get_settings
    from chunking import chunk_text
    from embeddings import embed_documents
    from db import insert_document, insert_chunks

def extract(filename, data):
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(f"[PAGE {i}]\n{p.extract_text() or ''}" for i, p in enumerate(reader.pages, 1))
    if ext in {".txt", ".md"}:
        return data.decode("utf-8", errors="replace")
    raise ValueError("Only PDF, TXT and MD files are supported.")

def ingest(filename, data, title, document_type="template", jurisdiction="India", source_label=None):
    s = get_settings()
    if Path(filename).suffix.lower() not in {".pdf", ".txt", ".md"}:
        raise ValueError("Only PDF, TXT and MD files are supported.")
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise ValueError(f"File exceeds {s.max_upload_mb} MB.")
    text = extract(filename, data)
    if not text.strip():
        raise ValueError("No text extracted; scanned PDFs require OCR.")
    doc = insert_document(title, document_type, jurisdiction, source_label, filename,
                          hashlib.sha256(data).hexdigest())
    chunks = chunk_text(text, s.chunk_size_chars, s.chunk_overlap_chars)
    vectors = embed_documents([c["content"] for c in chunks])
    rows = []
    for c, v in zip(chunks, vectors):
        rows.append({"document_id": doc["id"], "chunk_index": c["chunk_index"], "content": c["content"],
                     "embedding": v, "start_char": c["start_char"], "end_char": c["end_char"],
                     "page_number": None, "metadata": {"filename": filename, "source_label": source_label,
                     "jurisdiction": jurisdiction, "document_type": document_type}})
    insert_chunks(rows)
    return {"document_id": doc["id"], "title": title, "chunks_created": len(rows), "status": "ingested"}
