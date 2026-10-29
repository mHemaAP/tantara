"""PostgreSQL workspace extensions: generated tsvector lexical index and in-database vectors.

No-op on SQLite workspaces, which keep FTS5 for lexical search and the local
FAISS index for vectors. On PostgreSQL both indexes live in the database:
`document_chunks.search_tsv` (GIN) feeds hybrid retrieval and `chunk_vectors`
holds the normalized embedding, scored by the immutable `tantara_dot` helper,
which the app keeps identical to cosine similarity by normalizing at write time.
"""

from alembic import op

revision = "0011_postgres_search"
down_revision = "0010_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        CREATE OR REPLACE FUNCTION tantara_dot(a real[], b real[])
        RETURNS double precision
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        AS $$
            -- Widen before multiplying: float4 products of small embedding
            -- components underflow into an error on modern PostgreSQL.
            SELECT coalesce(sum(x::double precision * y::double precision), 0::double precision)
            FROM unnest(a, b) AS t(x, y)
        $$
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS chunk_vectors (
            chunk_id text PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
            embedding real[] NOT NULL
        )
        """
    )
    op.execute(
        """
        ALTER TABLE document_chunks
        ADD COLUMN IF NOT EXISTS search_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_document_chunks_search_tsv ON document_chunks USING gin (search_tsv)"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_search_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS search_tsv")
    op.execute("DROP TABLE IF EXISTS chunk_vectors")
    op.execute("DROP FUNCTION IF EXISTS tantara_dot(real[], real[])")
