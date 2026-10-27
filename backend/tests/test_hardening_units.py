from types import SimpleNamespace

import pytest

from app.chunking import chunk_text
from app.services.retrieval import fuse_rankings


def test_page_aware_chunking_preserves_independent_page_numbers():
    pages = [(1, "A" * 2300), (2, "B" * 2300)]
    chunks = [{**chunk, "page_number": page} for page, body in pages for chunk in chunk_text(body, 500, 50)]
    assert {chunk["page_number"] for chunk in chunks} == {1, 2}
    assert all(chunk["content"].startswith("A") for chunk in chunks if chunk["page_number"] == 1)
    assert all(chunk["content"].startswith("B") for chunk in chunks if chunk["page_number"] == 2)


def test_rrf_fusion_orders_consensus_above_single_source_hits():
    rows = {
        key: SimpleNamespace(
            id=key,
            document_id="d",
            content=key,
            page_number=1,
            title="T",
            document_type="Other",
            jurisdiction="India",
        )
        for key in ("consensus", "lexical", "semantic")
    }
    hits = fuse_rankings(rows, ["consensus", "lexical"], ["consensus", "semantic"], 3)
    assert [hit["chunk_id"] for hit in hits] == ["consensus", "lexical", "semantic"]


def test_nonexistent_citation_chunk_is_rejected_by_database_foreign_key(tmp_path, monkeypatch):
    from app import config, db
    from app.db import session_scope
    from app.models import Citation

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/citation.db")
    config.get_settings.cache_clear()
    db._engine = None
    db.init_db()
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError), session_scope() as session:
        session.add(
            Citation(
                id="c",
                owner_id="missing",
                message_id="missing",
                document_id="missing",
                chunk_id="missing",
                page_number=1,
                excerpt="x",
                retrieval_score=0.1,
            )
        )
    db._engine = None
    config.get_settings.cache_clear()
