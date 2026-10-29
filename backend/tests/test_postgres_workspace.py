"""Live PostgreSQL + MinIO workspace checks.

The default offline suite stays on SQLite/FAISS/filesystem and needs no network.
These checks run only when the services are advertised through the environment,
which is how the deployed workspace is verified:

    TANTARA_PG_TEST_URL=postgresql+psycopg://user:pass@host:5432/db \
    TANTARA_S3_TEST_ENDPOINT=http://host:9000 TANTARA_S3_TEST_BUCKET=bucket \
    MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... pytest tests/test_postgres_workspace.py

Every test works inside a throwaway PostgreSQL schema, so the workspace
database itself is never written to.
"""

import hashlib
import os
import time
import uuid

import pytest
from sqlalchemy import delete, make_url, select, text

PG_URL = os.getenv("TANTARA_PG_TEST_URL", "")
S3_ENDPOINT = os.getenv("TANTARA_S3_TEST_ENDPOINT", "")
S3_BUCKET = os.getenv("TANTARA_S3_TEST_BUCKET", "")
ADMIN_PASSWORD = "test-admin-password-long"

pytestmark = pytest.mark.skipif(not PG_URL, reason="TANTARA_PG_TEST_URL is not configured")


def _reset_singletons():
    from app import config, db
    from app.services import vector_store

    config.get_settings.cache_clear()
    if db._engine is not None:
        db._engine.dispose()
    db._engine = None
    db._SessionLocal = None
    if hasattr(vector_store, "_store"):
        del vector_store._store


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """A disposable PostgreSQL schema (plus MinIO bucket) wired through app settings."""
    import psycopg

    from app.routers import documents as documents_module

    url = make_url(PG_URL)
    admin = psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        dbname=url.database,
        user=url.username,
        password=url.password,
        autocommit=True,
    )
    schema = f"tantara_test_{uuid.uuid4().hex[:10]}"
    admin.execute(f'CREATE SCHEMA "{schema}"')

    documents_module.pool.shutdown(wait=True)
    documents_module.pool = documents_module.ThreadPoolExecutor(
        max_workers=2, thread_name_prefix="tantara-ingest-test"
    )

    monkeypatch.setenv("TANTARA_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATA_DIR", raising=False)
    separator = "&" if "?" in PG_URL else "?"
    monkeypatch.setenv("DATABASE_URL", f"{PG_URL}{separator}options=-csearch_path%3D{schema}")
    monkeypatch.setenv("TANTARA_ADMIN_PASSWORD", ADMIN_PASSWORD)
    if S3_ENDPOINT:
        monkeypatch.setenv("OBJECT_STORAGE", "s3")
        monkeypatch.setenv("S3_ENDPOINT", S3_ENDPOINT)
        monkeypatch.setenv("S3_BUCKET", S3_BUCKET)
    _reset_singletons()

    from app.db import init_db

    init_db()
    try:
        yield schema
    finally:
        documents_module.pool.shutdown(wait=True)
        documents_module.pool = documents_module.ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="tantara-ingest"
        )
        _reset_singletons()
        admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
        admin.close()


def _owner_id() -> str:
    """The advocate account bootstrapped by init_db (foreign keys are enforced on PostgreSQL)."""
    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as session:
        owner = session.scalars(select(User).limit(1)).one()
        return owner.id


def _add_document(session, owner_id, *, title, content):
    from app.models import Document

    document = Document(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        title=title,
        filename=f"{title[:20]}.md",
        stored_path=f"uploads/{uuid.uuid4().hex}.bin",
        content_hash=hashlib.sha256(content.encode()).hexdigest(),
        document_type="Note",
        jurisdiction="India",
        status="ready",
        text_content=content,
    )
    session.add(document)
    return document


def _add_chunk(session, document_id, index, content):
    from app.models import DocumentChunk

    chunk = DocumentChunk(
        id=str(uuid.uuid4()),
        document_id=document_id,
        chunk_index=index,
        content=content,
        page_number=1,
        is_demo=False,
    )
    session.add(chunk)
    return chunk


def test_migrations_create_postgres_search_objects(workspace):
    from app.db import SessionLocal
    from app.services.vector_store import store

    with SessionLocal() as session:
        vector_table = session.execute(text("SELECT to_regclass('chunk_vectors')")).scalar()
        lexical_index = session.execute(text("SELECT to_regclass('ix_document_chunks_search_tsv')")).scalar()
        assert vector_table and lexical_index, "PostgreSQL search objects are missing"
        columns = {
            row[0]
            for row in session.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name='document_chunks'")
            )
        }
        assert "search_tsv" in columns
        assert (
            session.execute(
                text("SELECT tantara_dot(ARRAY[1.0,2.0]::real[], ARRAY[3.0,4.0]::real[])")
            ).scalar()
            == 11.0
        )
        # float4 products of tiny embedding components must not raise an underflow error.
        tiny = session.execute(
            text("SELECT tantara_dot(ARRAY[1e-20,1e-20]::real[], ARRAY[1e-20,1e-20]::real[])")
        ).scalar()
        assert 0.0 <= tiny < 1e-30  # scored without raising a float4 underflow error
    assert store().backend == "postgres"
    assert store().count() == 0


def test_vector_store_roundtrip_and_ranking(workspace):
    import numpy as np

    from app.db import SessionLocal, session_scope
    from app.models import Document
    from app.services.vector_store import store

    owner = _owner_id()
    with session_scope() as session:
        document = _add_document(session, owner, title="Vector probe", content="probe")
        chunk_ids = [
            _add_chunk(session, document.id, index, f"vector probe chunk {index}").id for index in range(3)
        ]

    def unit(axis):
        vector = np.zeros(4, dtype="float32")
        vector[axis] = 1.0
        return vector

    store().rebuild(list(zip(chunk_ids, [unit(0), unit(1), unit(2)], strict=True)))
    assert store().count() == 3
    assert store().id_set() == set(chunk_ids)

    hits = store().search(unit(1), 3)
    assert hits[0][0] == chunk_ids[1]
    assert hits[0][1] == pytest.approx(1.0, abs=1e-5)
    # An unnormalized query vector is normalized by the store, so scores stay in range.
    assert 0.0 <= store().search(np.array([0, 5, 0, 0], dtype="float32"), 2)[0][1] <= 1.0 + 1e-6

    store().remove([chunk_ids[0]])
    assert store().count() == 2
    store().add([(chunk_ids[0], unit(0) * 2)])  # re-insert upserts instead of duplicating
    assert store().count() == 3

    with SessionLocal() as session:
        session.execute(delete(Document).where(Document.id == document.id))
        session.commit()
        # ON DELETE CASCADE keeps the vector table aligned with its chunks.
        remaining = session.execute(text("SELECT count(*) FROM chunk_vectors")).scalar()
    assert remaining == 0


def test_lexical_search_uses_generated_tsvector(workspace):
    from app.db import SessionLocal
    from app.services.retrieval import _lexical_ids

    owner = _owner_id()
    with SessionLocal() as session:
        document = _add_document(
            session, owner, title="Arbitration agreement", content="seat of arbitration Mumbai"
        )
        seat = _add_chunk(session, document.id, 0, "The seat of arbitration is Mumbai, India.").id
        other = _add_chunk(session, document.id, 1, "The tribunal ordered costs against the petitioner.").id
        session.commit()

        hits = _lexical_ids(session, "d.owner_id=:owner", {"owner": owner}, ["arbitration", "Mumbai"])
        assert seat in hits
        assert other not in hits
        assert _lexical_ids(session, "d.owner_id=:owner", {"owner": "someone-else"}, ["arbitration"]) == []
        assert _lexical_ids(session, "d.owner_id=:owner", {"owner": owner}, []) == []


@pytest.mark.skipif(not S3_ENDPOINT, reason="TANTARA_S3_TEST_ENDPOINT is not configured")
def test_object_store_uses_minio(workspace):
    from app.object_store import MissingObject, ensure_bucket, object_store

    assert ensure_bucket() == S3_BUCKET
    store = object_store()
    assert store.backend == "s3"

    key = store.put("uploads/pg-probe.bin", b"minio payload")
    assert key == "uploads/pg-probe.bin"
    assert store.exists(key)
    assert store.size(key) == len(b"minio payload")
    assert store.get(key) == b"minio payload"
    local = store.local_path(key)
    assert local is not None and local.read_bytes() == b"minio payload"

    listed = store.list_keys("uploads")
    assert key in listed
    assert all(name.startswith("uploads/") for name in listed)
    with pytest.raises(ValueError):
        store.list_keys("secrets")

    store.delete(key)
    assert not store.exists(key)
    assert store.size(key) is None
    assert store.local_path(key) is None
    assert key not in store.list_keys("uploads")
    with pytest.raises(MissingObject):
        store.get(key)


@pytest.mark.skipif(not S3_ENDPOINT, reason="TANTARA_S3_TEST_ENDPOINT is not configured")
def test_upload_search_and_download_on_postgres_and_minio(workspace):
    from fastapi.testclient import TestClient

    from app.main import app

    marker = f"TANTARA-PG-MARKER-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": "advocate@tantara.local", "password": ADMIN_PASSWORD}
        )
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        assert client.get("/readyz").json()["database"] == "ok"

        case = client.post(
            "/api/v1/cases", json={"title": "PG workspace case", "status": "active"}, headers=headers
        )
        assert case.status_code in {200, 201}, case.text
        case_id = case.json()["id"]

        body = (f"Minutes of hearing.\nReference phrase: {marker}.\nThe seat of arbitration is Mumbai.\n") * 3

        upload = client.post(
            "/api/v1/documents/upload",
            files={"file": ("minutes.md", body.encode("utf-8"), "text/markdown")},
            data={
                "title": "PG minutes",
                "document_type": "Hearing Note",
                "jurisdiction": "India",
                "case_id": case_id,
            },
            headers=headers,
        )
        assert upload.status_code == 202, upload.text
        document_id = upload.json()["document_id"]

        from app.db import SessionLocal
        from app.models import Document

        with SessionLocal() as session:
            stored = session.get(Document, document_id).stored_path
        assert stored.startswith("uploads/")

        from app.object_store import object_store

        assert object_store().exists(stored), "upload was not written to MinIO"

        job = {}
        for _ in range(120):
            job = client.get(f"/api/v1/documents/{document_id}/job", headers=headers).json()
            if job.get("status") in {"ready", "failed"}:
                break
            time.sleep(0.5)
        assert job.get("status") == "ready", job

        from app.services.vector_store import store as vector_store

        with SessionLocal() as session:
            indexed = session.execute(text("SELECT count(*) FROM chunk_vectors")).scalar()
        assert indexed > 0 and indexed == vector_store().count()

        asked = client.post(
            "/api/v1/ai/ask",
            json={
                "question": f"What city is the seat of arbitration? {marker}",
                "case_id": case_id,
                "top_k": 5,
            },
            headers=headers,
        )
        assert asked.status_code == 200, asked.text
        payload = asked.json()
        assert payload["citations"], f"PostgreSQL retrieval returned no citations: {payload}"
        assert any(citation["document_id"] == document_id for citation in payload["citations"])

        download = client.get(f"/api/v1/documents/{document_id}/file", headers=headers)
        assert download.status_code == 200 and marker.encode() in download.content

        backup = client.post("/api/v1/settings/database/backup", headers=headers)
        assert backup.status_code == 200, backup.text
        assert backup.json()["kind"] == "sql" and backup.json()["bytes"] > 0
        assert object_store().exists(backup.json()["path"])

        deleted = client.delete(f"/api/v1/documents/{document_id}", headers=headers)
        assert deleted.status_code == 200
        assert not object_store().exists(stored), "object left behind after document delete"
        with SessionLocal() as session:
            assert session.execute(text("SELECT count(*) FROM chunk_vectors")).scalar() == 0
