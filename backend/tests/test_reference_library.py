import time

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Document


def _login(client, email="advocate@tantara.local", password="tantara-local"):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _register(client, email):
    response = client.post(
        "/api/v1/auth/register",
        json={"name": "Library Reader", "email": email, "password": "secure-pass-8"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _upload(client, headers, title, content):
    response = client.post(
        "/api/v1/documents/upload",
        headers=headers,
        files={"file": (f"{title}.txt", content, "text/plain")},
        data={"title": title},
    )
    assert response.status_code == 202
    document_id = response.json()["document_id"]
    for _ in range(120):
        job = client.get(f"/api/v1/documents/{document_id}/job", headers=headers).json()
        if job["status"] in {"ready", "failed"}:
            break
        time.sleep(0.05)
    assert job["status"] == "ready", job
    return document_id


def _set_visibility(document_id, visibility):
    with SessionLocal() as session:
        document = session.scalar(select(Document).where(Document.id == document_id))
        document.visibility = visibility
        session.commit()


def test_library_documents_are_shared_for_reading_retrieval_and_asking(client):
    owner = _login(client)
    reader = _register(client, "reader@example.com")
    content = (
        b"LIBRARYCLAUSEPHRASE Specific performance under the Specific Relief Act is available "
        b"when compensation in money is not an adequate remedy."
    )
    document_id = _upload(client, owner, "Specific Relief Act, 1963", content)
    _set_visibility(document_id, "library")

    listed = client.get("/api/v1/documents?scope=all", headers=reader)
    assert listed.status_code == 200
    library_item = next(item for item in listed.json()["items"] if item["id"] == document_id)
    assert library_item["visibility"] == "library"
    assert client.get("/api/v1/documents?scope=mine", headers=reader).json()["total"] == 0
    assert any(item["id"] == document_id for item in client.get("/api/v1/documents?scope=library", headers=reader).json()["items"])

    detail = client.get(f"/api/v1/documents/{document_id}", headers=reader)
    assert detail.status_code == 200 and detail.json()["visibility"] == "library"
    assert "Specific Relief Act" in client.get(f"/api/v1/documents/{document_id}/text", headers=reader).json()["text"]
    assert client.get(f"/api/v1/documents/{document_id}/pages", headers=reader).json()["pages"]
    assert client.get(f"/api/v1/documents/{document_id}/file", headers=reader).content == content
    assert client.head(f"/api/v1/documents/{document_id}/file", headers=reader).status_code == 200

    search = client.get(
        "/api/v1/search/documents", headers=reader, params={"query": "LIBRARYCLAUSEPHRASE"}
    )
    assert search.status_code == 200
    hit = next(item for item in search.json()["items"] if item["document_id"] == document_id)
    assert hit["visibility"] == "library"
    answer = client.post(
        "/api/v1/ai/ask", headers=reader, json={"question": "What does LIBRARYCLAUSEPHRASE say?"}
    )
    assert answer.status_code == 200
    assert any(
        citation["document_id"] == document_id and citation["visibility"] == "library"
        for citation in answer.json()["citations"]
    )


def test_private_documents_remain_invisible_to_other_accounts(client):
    owner = _login(client)
    reader = _register(client, "private-reader@example.com")
    document_id = _upload(client, owner, "Private account evidence", b"private account evidence")
    listed = client.get("/api/v1/documents?scope=all", headers=reader)
    assert listed.status_code == 200
    assert all(item["id"] != document_id for item in listed.json()["items"])
    for endpoint in (
        f"/api/v1/documents/{document_id}",
        f"/api/v1/documents/{document_id}/text",
        f"/api/v1/documents/{document_id}/pages",
        f"/api/v1/documents/{document_id}/file",
    ):
        assert client.get(endpoint, headers=reader).status_code == 404


def test_library_documents_are_read_only_and_duplicate_uploads_are_blocked(client):
    owner = _login(client)
    reader = _register(client, "library-writer@example.com")
    content = b"Unique bytes for reference library duplicate protection."
    document_id = _upload(client, owner, "Reference material", content)
    _set_visibility(document_id, "library")

    mutations = (
        ("patch", f"/api/v1/documents/{document_id}", {"title": "Changed"}),
        ("delete", f"/api/v1/documents/{document_id}", None),
        ("post", f"/api/v1/documents/{document_id}/retry", None),
        ("patch", f"/api/v1/documents/{document_id}/extraction", {"fields": {"summary": "Edited"}}),
        ("post", f"/api/v1/documents/{document_id}/ai-read", None),
    )
    for method, url, body in mutations:
        response = getattr(client, method)(url, headers=reader, json=body) if body is not None else getattr(client, method)(url, headers=reader)
        assert response.status_code == 403
        assert "Reference library documents are read-only" in response.text

    duplicate = client.post(
        "/api/v1/documents/upload",
        headers=reader,
        files={"file": ("same.txt", content, "text/plain")},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["message"] == "Already in the law library"
    assert duplicate.json()["error"]["details"]["existing_document"]["id"] == document_id


def test_filing_bundles_accept_library_documents_but_not_foreign_private_documents(client):
    owner = _login(client)
    reader = _register(client, "bundle-reader@example.com")
    library_id = _upload(client, owner, "Library statute", b"A statute for a filing bundle.")
    private_id = _upload(client, owner, "Private exhibit", b"A private document.")
    _set_visibility(library_id, "library")

    case = client.post("/api/v1/cases", headers=reader, json={"title": "Library filing"}).json()
    bundle = client.post(
        "/api/v1/bundles", headers=reader, json={"case_id": case["id"], "name": "Statutes"}
    ).json()
    accepted = client.put(
        f"/api/v1/bundles/{bundle['id']}/items",
        headers=reader,
        json={"items": [{"document_id": library_id, "section": "Authorities"}]},
    )
    assert accepted.status_code == 200
    details = client.get(f"/api/v1/bundles/{bundle['id']}", headers=reader)
    assert details.status_code == 200
    assert any(item["document_id"] == library_id for item in details.json()["items"])

    rejected = client.put(
        f"/api/v1/bundles/{bundle['id']}/items",
        headers=reader,
        json={"items": [{"document_id": private_id}]},
    )
    assert rejected.status_code == 404
