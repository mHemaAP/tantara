"""Add explicit private and shared law-library document visibility."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op
from app.reference_library import reference_library_title_predicate

revision = "0012_document_visibility"
down_revision = "0011_postgres_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("documents")}
    if "visibility" not in columns:
        op.add_column(
            "documents",
            sa.Column("visibility", sa.String(length=16), nullable=False, server_default="private"),
        )
    indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("documents")}
    if "ix_documents_visibility" not in indexes:
        op.create_index("ix_documents_visibility", "documents", ["visibility"])
    documents = sa.table("documents", sa.column("title"), sa.column("visibility"))
    op.get_bind().execute(
        sa.update(documents)
        .where(reference_library_title_predicate(documents.c.title))
        .values(visibility="library")
    )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("documents")}
    if "ix_documents_visibility" in indexes:
        op.drop_index("ix_documents_visibility", table_name="documents")
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("documents")}
    if "visibility" in columns:
        op.drop_column("documents", "visibility")
