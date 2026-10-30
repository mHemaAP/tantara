"""Add explicit private and shared law-library document visibility."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

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
    op.execute(
        """
        UPDATE documents SET visibility = 'library'
        WHERE title IN (
            'ARBITRATION AND CONCILIATION ACT 1996',
            'Code of Civil Procedure, 1908',
            'Specific Relief Act, 1963',
            'Limitation Act',
            'Bharatiya Sakshya Adhiniyam, 2023',
            'indian contracts act 1872',
            'Information Technology Act, 2000',
            'Commercial Courts Act, 2015',
            'Sale of Goods Act, 1930'
        ) OR title LIKE 'Relevant state stamp legislation%'
        """
    )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("documents")}
    if "ix_documents_visibility" in indexes:
        op.drop_index("ix_documents_visibility", table_name="documents")
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("documents")}
    if "visibility" in columns:
        op.drop_column("documents", "visibility")
