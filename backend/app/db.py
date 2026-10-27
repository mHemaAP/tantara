"""Local SQLAlchemy persistence with explicit domain tables and SQLite FTS."""
import json, os, sqlite3
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.config import get_settings

TABLES = "roles sessions clients cases case_participants case_events hearings tasks document_pages drafts draft_versions notes research_sessions research_messages citations filing_bundles bundle_sections bundle_items community_posts community_replies community_tags saved_items app_preferences ingestion_jobs audit_events extraction_fields ai_conversations".split()
_engine = None

def engine():
    global _engine
    if _engine is None:
        s = get_settings(); s.data_dir.mkdir(parents=True, exist_ok=True)
        url = s.database_url
        _engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {}, future=True)
        if url.startswith("sqlite"):
            with _engine.begin() as c:
                c.exec_driver_sql("PRAGMA journal_mode=WAL")
                c.exec_driver_sql("PRAGMA foreign_keys=ON")
    return _engine

def init_db():
    with engine().begin() as c:
        c.exec_driver_sql("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('advocate','researcher','staff','admin')), avatar_initials TEXT, title TEXT, owner_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        c.exec_driver_sql("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), case_id TEXT, title TEXT NOT NULL, document_type TEXT, jurisdiction TEXT, source_label TEXT, filename TEXT, stored_path TEXT, content_hash TEXT NOT NULL, status TEXT DEFAULT 'queued', text_content TEXT DEFAULT '', warnings TEXT DEFAULT '[]', page_count INTEGER DEFAULT 0, is_demo INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(owner_id,content_hash))")
        for t in TABLES:
            c.exec_driver_sql(f"CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, owner_id TEXT, case_id TEXT, data TEXT NOT NULL DEFAULT '{{}}', is_demo INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        # Repair databases initialized by the early JSON-domain prototype, which
        # accidentally created document_chunks with the generic columns.
        chunk_cols={r[1] for r in c.exec_driver_sql("PRAGMA table_info(document_chunks)").all()}
        if chunk_cols and "document_id" not in chunk_cols:
            c.exec_driver_sql("DROP TABLE document_chunks")
        c.exec_driver_sql("CREATE INDEX IF NOT EXISTS documents_owner_case_idx ON documents(owner_id,case_id)")
        c.exec_driver_sql("CREATE TABLE IF NOT EXISTS document_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, embedding TEXT, page_number INTEGER, start_char INTEGER, end_char INTEGER)")
        c.exec_driver_sql("CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(chunk_id UNINDEXED, document_id UNINDEXED, content)")
        c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON document_chunks BEGIN INSERT INTO chunk_fts(chunk_id,document_id,content) VALUES(new.id,new.document_id,new.content); END")
        c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; END")
        c.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; INSERT INTO chunk_fts(chunk_id,document_id,content) VALUES(new.id,new.document_id,new.content); END")
        if c.exec_driver_sql("SELECT count(*) FROM users").scalar() == 0:
            from app.security import hash_password
            import uuid
            c.execute(text("INSERT INTO users(id,name,email,password_hash,role,avatar_initials,title) VALUES(:id,:name,:email,:pw,'advocate','AM','Advocate')"), {"id":str(uuid.uuid4()),"name":"Aarav Mehta","email":"advocate@tantara.local","pw":hash_password(get_settings().tantara_admin_password)})

def connect():
    # All repository scopes commit successful writes and roll back exceptions.
    return engine().begin()

def db():
    """Legacy optional Supabase adapter; only constructed when explicitly configured."""
    from supabase import create_client
    s=get_settings()
    if not s.enable_cloud_providers or not s.supabase_url or not s.supabase_service_role_key:
        raise RuntimeError("Supabase adapter disabled; configure ENABLE_CLOUD_PROVIDERS and credentials")
    return create_client(s.supabase_url,s.supabase_service_role_key)

def insert_document(*args, **kwargs):
    raise RuntimeError("Use the local DocumentRepository")
def insert_chunks(*args, **kwargs):
    raise RuntimeError("Use the local DocumentRepository")
def search(*args, **kwargs):
    raise RuntimeError("Use the local RetrievalService")
