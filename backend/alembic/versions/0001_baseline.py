"""Create the normalized identity/document baseline and FTS5 index."""

from alembic import op
from app.models import Base

revision = "0001_baseline"
down_revision = "0001_local_workspace"
branch_labels = None
depends_on = None


def _dependency_closure(names):
    """Table names needed before `names` can be created (foreign keys are eager on PostgreSQL)."""
    seen, stack = set(), list(names)
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        for key in Base.metadata.tables[name].foreign_keys:
            stack.append(key.column.table.name)
    return seen


def upgrade():
    bind = op.get_bind()
    names = ("users", "documents", "document_chunks")
    if bind.dialect.name == "sqlite":
        tables = [Base.metadata.tables[name] for name in names]
    else:
        # SQLite tolerates foreign keys to tables created by later revisions;
        # PostgreSQL resolves them at DDL time, so the referenced tables (cases,
        # clients, …) are created first, in dependency order.
        tables = [table for table in Base.metadata.sorted_tables if table.name in _dependency_closure(names)]
    Base.metadata.create_all(bind, tables=tables, checkfirst=True)
    if bind.dialect.name == "sqlite":
        op.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(chunk_id UNINDEXED, document_id UNINDEXED, content)"
        )
        op.execute(
            "CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON document_chunks BEGIN INSERT INTO chunk_fts(chunk_id,document_id,content) VALUES(new.id,new.document_id,new.content); END"
        )
        op.execute(
            "CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; END"
        )
        op.execute(
            "CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON document_chunks BEGIN DELETE FROM chunk_fts WHERE chunk_id=old.id; INSERT INTO chunk_fts(chunk_id,document_id,content) VALUES(new.id,new.document_id,new.content); END"
        )


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS chunks_ai")
        op.execute("DROP TRIGGER IF EXISTS chunks_ad")
        op.execute("DROP TRIGGER IF EXISTS chunks_au")
        op.execute("DROP TABLE IF EXISTS chunk_fts")
    for n in ("document_chunks", "documents", "users"):
        Base.metadata.tables[n].drop(op.get_bind(), checkfirst=True)
