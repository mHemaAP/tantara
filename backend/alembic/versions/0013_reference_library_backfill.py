"""Backfill reference-library titles missed by the original exact-case selector."""

import sqlalchemy as sa

from alembic import op
from app.reference_library import reference_library_title_predicate

revision = "0013_reference_library_backfill"
down_revision = "0012_document_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    documents = sa.table("documents", sa.column("title"), sa.column("visibility"))
    op.get_bind().execute(
        sa.update(documents)
        .where(
            reference_library_title_predicate(documents.c.title),
            documents.c.visibility == "private",
        )
        .values(visibility="library")
    )


def downgrade() -> None:
    # Promotion is intentionally irreversible: there is no reliable way to
    # distinguish rows promoted by this backfill from library rows set earlier.
    pass
