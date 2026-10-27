"""Hybrid retrieval: owner-scoped SQLite BM25 plus persistent FAISS, fused by RRF."""

import re

from sqlalchemy import select, text

from app.db import SessionLocal
from app.embeddings import embed_query
from app.models import Document, DocumentChunk
from app.services.vector_store import store


class RetrievalService:
    def search(
        self,
        question: str,
        owner_id: str,
        top_k: int = 5,
        case_id: str | None = None,
        jurisdiction: str | None = None,
        document_types: list[str] | None = None,
        case_ids: list[str] | None = None,
    ):
        results, _status = self.search_with_status(
            question, owner_id, top_k, case_id, jurisdiction, document_types, case_ids
        )
        return results

    def search_with_status(
        self,
        question: str,
        owner_id: str,
        top_k: int = 5,
        case_id: str | None = None,
        jurisdiction: str | None = None,
        document_types: list[str] | None = None,
        case_ids: list[str] | None = None,
    ):
        try:
            query_vector = embed_query(question)
            status = "ok"
        except Exception:
            query_vector = None
            status = "embedding_unavailable"
        clauses = [Document.owner_id == owner_id]
        if case_id:
            clauses.append(Document.case_id == case_id)
        elif case_ids:
            clauses.append(Document.case_id.in_(case_ids))
        if jurisdiction:
            clauses.append(Document.jurisdiction == jurisdiction)
        if document_types:
            clauses.append(Document.document_type.in_(document_types))
        with SessionLocal() as session:
            stmt = (
                select(
                    DocumentChunk.id,
                    DocumentChunk.document_id,
                    DocumentChunk.content,
                    DocumentChunk.page_number,
                    Document.title,
                    Document.document_type,
                    Document.jurisdiction,
                )
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(*clauses)
            )
            rows = session.execute(stmt).all()
            allowed = {r.id: r for r in rows}
            expected_vector_ids = set(
                session.scalars(
                    select(DocumentChunk.id).join(Document, Document.id == DocumentChunk.document_id)
                ).all()
            )
            where = "d.owner_id=:owner"
            tokens = re.findall(r"[\w-]{2,}", question)
            fts_query = " OR ".join('"' + t.replace('"', '""') + '"' for t in tokens) or '""'
            params = {"owner": owner_id, "query": fts_query}
            if case_id:
                where += " AND d.case_id=:case_id"
                params["case_id"] = case_id
            elif case_ids:
                marks = ",".join(f":case_{i}" for i in range(len(case_ids)))
                where += f" AND d.case_id IN ({marks})"
                params.update({f"case_{i}": v for i, v in enumerate(case_ids)})
            if jurisdiction:
                where += " AND d.jurisdiction=:jurisdiction"
                params["jurisdiction"] = jurisdiction
            if document_types:
                marks = ",".join(f":type_{i}" for i in range(len(document_types)))
                where += f" AND d.document_type IN ({marks})"
                params.update({f"type_{i}": v for i, v in enumerate(document_types)})
            try:
                lexical = (
                    session.execute(
                        text(
                            f"SELECT f.chunk_id FROM chunk_fts f JOIN documents d ON d.id=f.document_id WHERE {where} AND chunk_fts MATCH :query ORDER BY bm25(chunk_fts) LIMIT 100"
                        ),
                        params,
                    )
                    .scalars()
                    .all()
                )
            except Exception:
                lexical = []
        vector_store = store()
        indexed_ids = vector_store.id_set()
        if expected_vector_ids and expected_vector_ids != indexed_ids:
            status = "embedding_unavailable"
        semantic = vector_store.search(query_vector, vector_store.count()) if query_vector is not None else []
        semantic_ids = [cid for cid, _ in semantic if cid in allowed]
        return fuse_rankings(allowed, lexical, semantic_ids, top_k), status


def fuse_rankings(rows, lexical_ids, semantic_ids, top_k=5, k=60):
    """Return evidence-backed rows with RRF scores; never invent a score."""
    lrank = {cid: i for i, cid in enumerate(lexical_ids)}
    vrank = {cid: i for i, cid in enumerate(semantic_ids)}
    ranked = []
    for cid, row in rows.items():
        score = (1 / (k + lrank[cid] + 1) if cid in lrank else 0) + (
            1 / (k + vrank[cid] + 1) if cid in vrank else 0
        )
        if score:
            ranked.append((score, row))
    ranked.sort(key=lambda x: x[0], reverse=True)
    return [
        {
            "document_id": r.document_id,
            "document_title": r.title,
            "chunk_id": r.id,
            "page_number": r.page_number,
            "snippet": r.content[:900],
            "score": score,
            "retreival_score": score,
            "retrieval_score": score,
            "source_type": r.document_type,
            "jurisdiction": r.jurisdiction,
        }
        for score, r in ranked[:top_k]
    ]


retrieval_service = RetrievalService()
