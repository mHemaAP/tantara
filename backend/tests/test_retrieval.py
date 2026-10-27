from types import SimpleNamespace

from app.services.retrieval import fuse_rankings


def test_reciprocal_rank_fusion_prefers_consensus_and_real_rows():
    rows = {
        cid: SimpleNamespace(
            id=cid,
            document_id="doc",
            content=cid,
            page_number=i,
            title="Evidence",
            document_type="Award",
            jurisdiction="India",
        )
        for i, cid in enumerate(("both", "fts", "faiss"), 1)
    }
    hits = fuse_rankings(rows, ["both", "fts"], ["both", "faiss"], top_k=3)
    assert [x["chunk_id"] for x in hits] == ["both", "fts", "faiss"]
    assert all(x["score"] > 0 for x in hits)
    assert hits[0]["page_number"] == 1


def test_fusion_does_not_fabricate_scores_for_unretrieved_rows():
    rows = {
        "unknown": SimpleNamespace(
            id="unknown",
            document_id="doc",
            content="x",
            page_number=1,
            title="T",
            document_type="Other",
            jurisdiction="India",
        )
    }
    assert fuse_rankings(rows, [], [], 5) == []
