import sqlite3
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine,inspect,text
from app import config,db
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def _upgrade(path,tmp_path,monkeypatch):
    monkeypatch.setenv("DATABASE_URL",f"sqlite:///{path}")
    monkeypatch.setenv("DATA_DIR",str(tmp_path))
    config.get_settings.cache_clear();db._engine=None
    cfg=Config(str(ROOT/"alembic.ini"));cfg.set_main_option("script_location",str(ROOT/"alembic"))
    command.upgrade(cfg,"head");command.upgrade(cfg,"head")
    return create_engine(f"sqlite:///{path}")

def test_fresh_upgrade_is_idempotent(tmp_path,monkeypatch):
    engine=_upgrade(tmp_path/"fresh.db",tmp_path,monkeypatch)
    names=set(inspect(engine).get_table_names())
    assert {"users","clients","cases","documents","document_chunks","filing_bundles","extraction_fields"}<=names
    assert "data" not in {c["name"] for c in inspect(engine).get_columns("cases")}
    assert "embedding" not in {c["name"] for c in inspect(engine).get_columns("document_chunks")}

def test_prototype_json_tables_are_archived_and_user_kept(tmp_path,monkeypatch):
    path=tmp_path/"prototype.db"
    con=sqlite3.connect(path)
    con.executescript("""
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,avatar_initials TEXT,title TEXT,owner_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id,name,email,password_hash,role) VALUES('u1','Local User','u@example.local','scrypt','advocate');
    CREATE TABLE cases(id TEXT PRIMARY KEY,owner_id TEXT,case_id TEXT,data TEXT NOT NULL,is_demo INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
    INSERT INTO cases(id,owner_id,data) VALUES('c1','u1','{"title":"legacy"}');
    CREATE TABLE documents(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,case_id TEXT,title TEXT NOT NULL,document_type TEXT,jurisdiction TEXT,source_label TEXT,filename TEXT,stored_path TEXT,content_hash TEXT,status TEXT,text_content TEXT,warnings TEXT,page_count INTEGER,is_demo INTEGER,created_at TEXT);
    CREATE TABLE document_chunks(id TEXT PRIMARY KEY,owner_id TEXT,case_id TEXT,data TEXT NOT NULL);
    """);con.commit();con.close()
    engine=_upgrade(path,tmp_path,monkeypatch)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email FROM users WHERE id='u1'")).scalar()=="u@example.local"
        assert conn.execute(text("SELECT data FROM cases_legacy_0002 WHERE id='c1'")).scalar()=="{\"title\":\"legacy\"}"
        assert conn.execute(text("SELECT count(*) FROM cases")).scalar()==0
