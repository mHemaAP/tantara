import time

from app import main
from app.services import retrieval as retrieval_module


def _uploaded_evidence(client):
    login = client.post(
        "/api/v1/auth/login", json={"email": "advocate@tantara.local", "password": "tantara-local"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    body = b"Unique evidence marker ZXQ-771 says the arbitration seat is Mumbai."
    upload = client.post(
        "/api/v1/documents/upload",
        headers=headers,
        files={"file": ("evidence.txt", body, "text/plain")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["document_id"]
    for _ in range(100):
        job = client.get(f"/api/v1/documents/{document_id}/job", headers=headers).json()
        if job["status"] in {"ready", "failed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "ready"
    return headers, document_id


def test_dead_user_configured_model_returns_explicit_unavailable_result(client):
    headers, _document_id = _uploaded_evidence(client)
    configured = client.patch(
        "/api/v1/settings/ai",
        headers=headers,
        json={"base_url": "http://127.0.0.1:9/v1", "model": "dead-local-model"},
    )
    assert configured.status_code == 200
    response = client.post(
        "/api/v1/ai/ask",
        headers=headers,
        json={"question": "Which city appears in marker ZXQ-771?"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "model_unavailable"
    assert (
        result["answer"] == "Relevant documents were found, but the configured language model is unavailable."
    )
    assert result["citations"] == []


def test_embedding_failure_keeps_fts_results_and_reports_degradation(client, monkeypatch):
    headers, _document_id = _uploaded_evidence(client)

    def unavailable(_question):
        raise RuntimeError("test embedding backend outage")

    monkeypatch.setattr(retrieval_module, "embed_query", unavailable)
    response = client.get(
        "/api/v1/search/documents",
        headers=headers,
        params={"query": "ZXQ-771 arbitration Mumbai"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "embedding_unavailable"
    assert result["total"] >= 1
    assert "ZXQ-771" in result["items"][0]["snippet"]


def test_ai_citation_payload_keeps_both_score_spellings(client, monkeypatch):
    headers, document_id = _uploaded_evidence(client)
    monkeypatch.setattr(main, "llm_answer", lambda question, hits, **kwargs: "The seat is Mumbai.")
    response = client.post(
        "/api/v1/ai/ask",
        headers=headers,
        json={"question": "What city is named near ZXQ-771?"},
    )
    assert response.status_code == 200
    citation = response.json()["citations"][0]
    assert citation["document_id"] == document_id
    assert citation["retrieval_score"] == citation["retreival_score"]
