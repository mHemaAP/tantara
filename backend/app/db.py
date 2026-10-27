"""SQLAlchemy session factory and local database bootstrap."""
from contextlib import contextmanager
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, Session
from app.config import get_settings
from app.models import Base

_engine = None
_SessionLocal = None

def engine():
    global _engine, _SessionLocal
    if _engine is None:
        s=get_settings(); s.data_dir.mkdir(parents=True,exist_ok=True)
        url=s.database_url
        _engine=create_engine(url,connect_args={"check_same_thread":False,"timeout":30} if url.startswith("sqlite") else {},future=True)
        if url.startswith("sqlite"):
            @event.listens_for(_engine,"connect")
            def _sqlite_setup(conn, _record):
                cur=conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.execute("PRAGMA journal_mode=WAL"); cur.execute("PRAGMA busy_timeout=30000"); cur.close()
        _SessionLocal=sessionmaker(bind=_engine,expire_on_commit=False,autoflush=False)
    return _engine

def SessionLocal():
    engine()
    return _SessionLocal()

def get_session():
    session=SessionLocal()
    try: yield session
    finally: session.close()

@contextmanager
def session_scope():
    session=SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback(); raise
    finally: session.close()

def init_db():
    """Initialize a fresh typed schema and FTS5 triggers for local development."""
    e=engine()
    # Old prototype tables had `data` JSON columns. Preserve a recoverable copy
    # before replacing those non-normalized tables during this one-time cutover.
    with e.begin() as c:
        existing={r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").all()} if e.dialect.name=="sqlite" else set()
        if "cases" in existing:
            cols={r[1] for r in c.exec_driver_sql("PRAGMA table_info(cases)").all()}
            if "data" in cols:
                c.exec_driver_sql("ALTER TABLE cases RENAME TO cases_json_archive")
        for name in ("roles","sessions","clients","case_participants","case_events","hearings","tasks","document_pages","document_chunks","drafts","draft_versions","notes","research_sessions","research_messages","citations","filing_bundles","bundle_sections","bundle_items","community_posts","community_replies","community_tags","saved_items","app_preferences","ingestion_jobs","audit_events","extraction_fields","ai_conversations"):
            if name in existing:
                cols={r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({name})").all()}
                if "data" in cols:
                    c.exec_driver_sql(f"ALTER TABLE {name} RENAME TO {name}_json_archive")
        if "documents" in existing:
            cols={r[1] for r in c.exec_driver_sql("PRAGMA table_info(documents)").all()}
            # documents had real columns already; keep compatible fields where possible.
            if "owner_id" not in cols: c.exec_driver_sql("ALTER TABLE documents RENAME TO documents_json_archive")
    Base.metadata.create_all(e)
    with e.begin() as c:
        if e.dialect.name=="sqlite":
            c.exec_driver_sql("CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(chunk_id UNINDEXED, document_id UNINDEXED, content)")
            c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON document_chunks BEGIN INSERT INTO chunk_fts(chunk_id,document_id,content) SELECT new.id,new.document_id,new.content WHERE EXISTS(SELECT 1 FROM documents WHERE id=new.document_id); END")
            c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; END")
            c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; INSERT INTO chunk_fts(chunk_id,document_id,content) VALUES(new.id,new.document_id,new.content); END")
            c.exec_driver_sql("INSERT INTO chunk_fts(chunk_id,document_id,content) SELECT ch.id,ch.document_id,ch.content FROM document_chunks ch WHERE NOT EXISTS(SELECT 1 FROM chunk_fts f WHERE f.chunk_id=ch.id)")
    from sqlalchemy import select
    from app.models import User
    with SessionLocal() as session:
        if session.scalar(select(User.id).limit(1)) is None:
            import uuid
            from app.security import hash_password
            session.add(User(id=str(uuid.uuid4()),name="Aarav Mehta",email="advocate@tantara.local",password_hash=hash_password(get_settings().tantara_admin_password),role="advocate",avatar_initials="AM",title="Advocate"))
            session.commit()

# Transitional name retained for optional external adapters only. Domain services use ORM sessions.
def connect():
    return engine().begin()

def db():
    """Optional Supabase adapter; disabled for local mode."""
    from supabase import create_client
    s=get_settings()
    if not s.enable_cloud_providers or not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError("Supabase adapter disabled; configure ENABLE_CLOUD_PROVIDERS and credentials")
    return create_client(s.supabase_url,s.supabase_service_role_key)
