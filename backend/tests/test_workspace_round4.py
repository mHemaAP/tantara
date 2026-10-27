import runpy
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, func, select, text

from app import config
from app.db import SessionLocal, session_scope
from app.models import (
    Base,
    Case,
    CaseEvent,
    Client,
    CommunityPost,
    CommunityReply,
    Document,
    DocumentChunk,
    DocumentPage,
    ExtractionField,
    Hearing,
    Task,
    User,
)
from app.services.vector_store import store


def test_debug_ingest_artifact_is_never_written_into_the_checkout():
    checkout_artifact = Path(__file__).resolve().parents[1] / "tmp_ingest_test.txt"
    assert not checkout_artifact.exists()


def test_data_dirs_derive_separate_database_files_with_independent_rows(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    roots = [tmp_path / "one", tmp_path / "two"]
    engines = []
    try:
        for root in roots:
            monkeypatch.setenv("TANTARA_DATA_DIR", str(root))
            settings = config.Settings(_env_file=None)
            settings.data_dir.mkdir(parents=True, exist_ok=True)
            assert settings.data_dir == root.resolve()
            assert settings.database_url == f"sqlite:///{root.resolve() / 'tantara.db'}"
            engine = create_engine(settings.database_url)
            engines.append(engine)
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE marker (value TEXT)"))
                connection.execute(text("INSERT INTO marker VALUES (:value)"), {"value": root.name})
        assert engines[0].url.database != engines[1].url.database
        assert engines[0].connect().execute(text("SELECT value FROM marker")).scalar() == "one"
        assert engines[1].connect().execute(text("SELECT value FROM marker")).scalar() == "two"
        assert (
            config.Settings(
                _env_file=None,
                data_dir=roots[0],
                database_url="sqlite:///explicit.db",
            ).database_url
            == "sqlite:///explicit.db"
        )
    finally:
        for engine in engines:
            engine.dispose()
    monkeypatch.setenv("TANTARA_LOCAL_LLM_BASE_URL", "http://127.0.0.1:9/v1")
    assert config.Settings(_env_file=None).local_llm_base_url == "http://127.0.0.1:9/v1"


def test_database_and_faiss_store_share_resolved_data_root(client):
    settings = config.get_settings()
    assert Path(settings.database_url.removeprefix("sqlite:///")).resolve().parent == settings.data_dir
    assert store().root.resolve() == settings.data_dir / "index"


def test_demo_seed_has_multpage_content_calendar_extractions_and_feed(client, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["seed.py", "--demo"])
    runpy.run_path(str(Path(__file__).resolve().parents[2] / "scripts" / "seed.py"), run_name="seed_test")[
        "main"
    ]()
    today = datetime.now(UTC).date()
    with SessionLocal() as session:
        documents = session.scalars(select(Document).where(Document.is_demo.is_(True))).all()
        assert len(documents) >= 8
        assert all(document.page_count >= 5 for document in documents)
        assert sum(document.page_count for document in documents) >= 40
        assert any("scanned" in document.filename for document in documents)
        assert any("contract" in document.filename for document in documents)
        assert any("page-three-motion" in document.filename for document in documents)
        assert sum("near-duplicate" in document.filename for document in documents) >= 2
        pages = session.scalars(select(DocumentPage).where(DocumentPage.is_demo.is_(True))).all()
        assert any(page.warnings and "manual review" in str(page.warnings).lower() for page in pages)
        scanned = next(document for document in documents if "scanned" in document.filename)
        scanned_pages = [page for page in pages if page.document_id == scanned.id]
        assert len(scanned_pages) >= 5
        assert any("seat shall be mumbai" in page.text.lower() for page in scanned_pages)
        assert session.scalar(select(func.count(ExtractionField.id))) > 0
        chunks = session.scalars(select(DocumentChunk)).all()
        assert chunks and all(chunk.is_demo for chunk in chunks)
        events = session.scalars(select(CaseEvent).where(CaseEvent.is_demo.is_(True))).all()
        assert events and any(
            event.occurred_at.date().year == today.year and event.occurred_at.date().month == today.month
            for event in events
        )
        assert session.scalar(select(func.count(CommunityPost.id))) >= 5
        assert session.scalar(select(func.count(CommunityReply.id))) >= 5
        tasks = session.scalars(select(Task).where(Task.is_demo.is_(True), Task.status != "done")).all()
        assert any(task.due_at is None for task in tasks)
        assert any(task.due_at and task.due_at.date() < today for task in tasks)
        assert any(task.due_at and task.due_at.date() == today for task in tasks)
        assert all(row.is_demo for row in documents + pages + events)
        demo_clients = session.scalars(select(Client).where(Client.is_demo.is_(True))).all()
        assert any(
            session.scalar(select(func.count(Case.id)).where(Case.client_id == row.id)) == 0
            for row in demo_clients
        )
        demo_cases = session.scalars(select(Case).where(Case.is_demo.is_(True))).all()
        assert any(row.status == "closed" for row in demo_cases)
        past_only = next(row for row in demo_cases if row.title.startswith("ABC Pvt."))
        future_pair = next(row for row in demo_cases if row.title.startswith("TechBuild"))
        past_hearings = session.scalars(select(Hearing).where(Hearing.case_id == past_only.id)).all()
        future_hearings = session.scalars(select(Hearing).where(Hearing.case_id == future_pair.id)).all()
        assert past_hearings and all(hearing.at.date() < today for hearing in past_hearings)
        assert len([hearing for hearing in future_hearings if hearing.at.date() > today]) >= 2
        future_expected = min(hearing.at for hearing in future_hearings if hearing.at.date() > today)
        owner_id = session.scalar(select(User.id).where(User.email == "advocate@tantara.local"))

    from app.security import create_token

    headers = {"Authorization": f"Bearer {create_token(owner_id)}"}
    client_list = client.get("/api/v1/clients", headers=headers).json()["items"]
    empty_client = next(row for row in client_list if row["name"] == "No Active Matters Ltd.")
    assert empty_client["case_count"] == 0
    case_list = client.get("/api/v1/cases", headers=headers).json()["items"]
    past_case = next(row for row in case_list if row["title"].startswith("ABC Pvt."))
    assert past_case["next_hearing_at"] is None
    future_case = next(row for row in case_list if row["title"].startswith("TechBuild"))
    expected_iso = future_expected.isoformat()
    assert future_case["next_hearing_at"].startswith(expected_iso[:19])
    assert any(row["status"] == "closed" for row in case_list)
    phrase = client.get(
        "/api/v1/search/documents",
        headers=headers,
        params={"query": '"Sapphire Pavilion on the third calendar day"'},
    ).json()
    assert phrase["items"][0]["document_title"] == "Page Three Motion"
    assert phrase["items"][0]["page_number"] == 3
    semantic = client.get(
        "/api/v1/search/documents",
        headers=headers,
        params={"query": "where will the tribunal sit"},
    ).json()
    assert semantic["items"]
    assert any("seat shall be mumbai" in hit["snippet"].lower() for hit in semantic["items"])
    unique = client.get("/api/v1/search/documents", headers=headers, params={"query": "ZXQORBITKEY"}).json()
    assert unique["items"][0]["document_title"] == "Unique Term Evidence"
    unrelated = client.get(
        "/api/v1/search/documents", headers=headers, params={"query": "violet saxophone excavation quantum"}
    ).json()
    assert unrelated["items"] == []


def test_empty_seed_retains_only_the_local_advocate_and_no_rows(client, monkeypatch):
    from app.config import get_settings

    with SessionLocal() as session:
        owner = session.scalar(select(User))
    storage = get_settings().data_dir / "uploads"
    storage.mkdir(parents=True, exist_ok=True)
    stored_path = storage / "seeded-test.pdf"
    stored_path.write_bytes(b"fixture")
    document_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Document(
                id=document_id,
                owner_id=owner.id,
                title="Seed cleanup check",
                filename="seeded-test.pdf",
                stored_path=str(stored_path),
                content_hash="a" * 64,
                status="ready",
            )
        )
        session.flush()
        session.add(
            DocumentPage(
                id=str(uuid.uuid4()),
                owner_id=owner.id,
                document_id=document_id,
                page_number=1,
                text="Fixture page",
            )
        )
        session.add(
            DocumentChunk(
                id=str(uuid.uuid4()),
                document_id=document_id,
                chunk_index=0,
                content="Fixture searchable chunk",
                page_number=1,
            )
        )
    monkeypatch.setattr(sys, "argv", ["seed.py", "--empty"])
    runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts" / "seed.py"), run_name="empty_seed_test"
    )["main"]()
    with SessionLocal() as session:
        assert session.scalar(select(func.count(User.id))) == 1
        for table in Base.metadata.sorted_tables:
            if table.name != "users":
                assert session.execute(select(func.count()).select_from(table)).scalar() == 0, table.name
        assert session.execute(text("SELECT count(*) FROM rate_buckets")).scalar() == 0
    assert store().count() == 0
    assert not stored_path.exists()


def test_case_hearing_derivation_is_live_and_owner_scoped(client):
    login = client.post(
        "/api/v1/auth/login", json={"email": "advocate@tantara.local", "password": "tantara-local"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    case = client.post("/api/v1/cases", headers=headers, json={"title": "Hearing-derived case"}).json()
    cid = case["id"]
    overview = client.get(f"/api/v1/cases/{cid}/overview", headers=headers).json()
    assert overview["documents_count"] == 0 and overview["drafts_count"] == 0
    past = (datetime.now(UTC) - timedelta(days=2)).replace(tzinfo=None).isoformat()
    first = (datetime.now(UTC) + timedelta(days=4)).replace(tzinfo=None).isoformat()
    second = (datetime.now(UTC) + timedelta(days=9)).replace(tzinfo=None).isoformat()
    past_row = client.post(
        "/api/v1/hearings", headers=headers, json={"title": "Past", "at": past, "case_id": cid}
    ).json()
    from app.models import User
    from app.security import hash_password

    foreign_owner = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            User(
                id=foreign_owner,
                name="Foreign hearing owner",
                email=f"foreign-{foreign_owner}@local",
                password_hash=hash_password("password"),
                role="advocate",
            )
        )
        session.flush()
        session.add(
            Hearing(
                id=str(uuid.uuid4()),
                owner_id=foreign_owner,
                case_id=cid,
                title="Another user's hearing",
                at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
            )
        )
    assert client.get(f"/api/v1/cases/{cid}", headers=headers).json()["next_hearing_at"] is None
    hearing1 = client.post(
        "/api/v1/hearings", headers=headers, json={"title": "Sooner", "at": first, "case_id": cid}
    ).json()
    later_hearing = client.post(
        "/api/v1/hearings", headers=headers, json={"title": "Later", "at": second, "case_id": cid}
    ).json()
    expected = client.get(f"/api/v1/cases/{cid}", headers=headers).json()["next_hearing_at"]
    assert expected.startswith(first[:16])
    assert client.get("/api/v1/cases", headers=headers).json()["items"][0]["next_hearing_at"] == expected
    assert client.delete(f"/api/v1/hearings/{hearing1['id']}", headers=headers).status_code == 200
    after_delete = client.get(f"/api/v1/cases/{cid}", headers=headers).json()["next_hearing_at"]
    assert after_delete.startswith(second[:16])
    assert client.delete(f"/api/v1/hearings/{later_hearing['id']}", headers=headers).status_code == 200
    assert client.get(f"/api/v1/cases/{cid}", headers=headers).json()["next_hearing_at"] is None
    assert client.delete(f"/api/v1/hearings/{past_row['id']}", headers=headers).status_code == 200


def test_client_case_count_is_owner_scoped_and_requires_auth(client):
    login = client.post(
        "/api/v1/auth/login", json={"email": "advocate@tantara.local", "password": "tantara-local"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    client_row = client.post("/api/v1/clients", headers=headers, json={"name": "Counted client"}).json()
    client.post("/api/v1/cases", headers=headers, json={"title": "Owned case", "client_id": client_row["id"]})
    from app.models import User
    from app.security import hash_password

    uid = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            User(
                id=uid,
                name="Other",
                email=f"other-{uid}@local",
                password_hash=hash_password("x"),
                role="advocate",
            )
        )
        session.flush()
        session.add(
            Case(
                id=str(uuid.uuid4()),
                owner_id=uid,
                title="Other's case",
                client_id=client_row["id"],
                status="active",
            )
        )
    listing = client.get("/api/v1/clients", headers=headers).json()
    assert next(item for item in listing["items"] if item["id"] == client_row["id"])["case_count"] == 1
    assert client.get(f"/api/v1/clients/{client_row['id']}", headers=headers).json()["case_count"] == 1
    assert client.get("/api/v1/clients").status_code == 401


def test_missing_faiss_index_is_explicit_on_search_and_ask(client):
    login = client.post(
        "/api/v1/auth/login", json={"email": "advocate@tantara.local", "password": "tantara-local"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    uploaded = client.post(
        "/api/v1/documents/upload",
        headers=headers,
        files={"file": ("evidence.txt", b"The arbitration seat is Mumbai. " * 20, "text/plain")},
    )
    did = uploaded.json()["document_id"]
    for _ in range(100):
        job = client.get(f"/api/v1/documents/{did}/job", headers=headers).json()
        if job["status"] in {"ready", "failed"}:
            break
        import time

        time.sleep(0.05)
    assert job["status"] == "ready"
    store().rebuild([])
    search = client.get(
        "/api/v1/search/documents", headers=headers, params={"query": "arbitration seat Mumbai"}
    )
    assert search.status_code == 200 and search.json()["status"] == "embedding_unavailable"
    ask = client.post("/api/v1/ai/ask", headers=headers, json={"question": "What is the seat?"})
    assert ask.status_code == 200
    assert ask.json()["meta"]["retrieval_status"] == "embedding_unavailable"
