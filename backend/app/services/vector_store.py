"""Persistent vector index for the workspace.

FAISS (SQLite workspaces) keeps a local flat inner-product index; PostgreSQL
workspaces keep the same normalized vectors in the database so search, backup
and the corpus live together. Both expose the same exact-cosine ranking.
"""

import json
import threading

import numpy as np

from app.config import get_settings

# Serializes DB chunk mutations with index updates/reconciliation.
INDEX_LOCK = threading.RLock()


def _normalized(rows):
    """Return (chunk_ids, L2-normalized float32 vectors) so dot == cosine."""
    matrix = np.asarray([row[1] for row in rows], dtype="float32")
    if matrix.ndim != 2:
        return [], []
    norms = np.linalg.norm(matrix, axis=1)
    matrix = matrix / np.where(norms == 0, 1.0, norms)[:, None]
    return [row[0] for row in rows], matrix


class FaissStore:
    backend = "faiss"

    def __init__(self):
        import faiss

        self.faiss = faiss
        self.root = get_settings().data_dir / "index"
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "chunks.faiss"
        self.map_path = self.root / "chunk_ids.json"
        self.lock = threading.RLock()
        self.index = None
        self.ids = []
        self._load()

    def _load(self):
        if self.index_path.exists() and self.map_path.exists():
            self.index = self.faiss.read_index(str(self.index_path))
            self.ids = json.loads(self.map_path.read_text())
        else:
            self.index = self.faiss.IndexFlatIP(get_settings().embedding_dimensions)
            self.ids = []

    def _save(self):
        self.faiss.write_index(self.index, str(self.index_path))
        tmp = self.map_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.ids))
        tmp.replace(self.map_path)

    def rebuild(self, rows):
        with self.lock:
            self.index = self.faiss.IndexFlatIP(get_settings().embedding_dimensions)
            self.ids = []
            if rows:
                vec = np.asarray([r[1] for r in rows], dtype="float32")
                self.faiss.normalize_L2(vec)
                self.index.add(vec)
                self.ids = [r[0] for r in rows]
            self._save()

    def add(self, rows):
        with self.lock:
            if not rows:
                return
            vec = np.asarray([r[1] for r in rows], dtype="float32")
            self.faiss.normalize_L2(vec)
            self.index.add(vec)
            self.ids.extend(r[0] for r in rows)
            self._save()

    def remove(self, chunk_ids):
        remove = set(chunk_ids)
        with self.lock:
            if not remove:
                return
            keep = [cid for cid in self.ids if cid not in remove]
            if len(keep) != len(self.ids):
                rows = self._load_vectors()
                self.rebuild([(cid, rows[cid]) for cid in keep if cid in rows])

    def _load_vectors(self):
        return {cid: self.index.reconstruct(i).copy() for i, cid in enumerate(self.ids)}

    def search(self, vector, k=30):
        with self.lock:
            if not self.ids:
                return []
            v = np.asarray([vector], dtype="float32")
            self.faiss.normalize_L2(v)
            scores, idx = self.index.search(v, min(k, len(self.ids)))
            return [(self.ids[i], float(score)) for score, i in zip(scores[0], idx[0], strict=True) if i >= 0]

    def count(self):
        with self.lock:
            return len(self.ids)

    def id_set(self):
        with self.lock:
            return set(self.ids)


class PostgresVectorStore:
    """Exact cosine search over embeddings held in the `chunk_vectors` table.

    Created by Alembic revision `0011_postgres_search`; vectors are normalized
    here so the SQL `tantara_dot` helper is already a cosine score.
    """

    backend = "postgres"

    def __init__(self):
        from sqlalchemy import bindparam, text

        from app.db import engine

        self._bindparam = bindparam
        self._text = text
        self.engine = engine()
        self.dimensions = get_settings().embedding_dimensions
        self.lock = threading.RLock()
        with self.engine.connect() as conn:
            if not conn.exec_driver_sql("select to_regclass('chunk_vectors')").scalar():
                raise RuntimeError(
                    "PostgreSQL vector store requires Alembic revision 0011_postgres_search (run alembic upgrade head)"
                )

    def _write(self, rows):
        chunk_ids, matrix = _normalized(rows)
        if not chunk_ids:
            return
        statement = self._text(
            "INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (:chunk_id, CAST(:embedding AS real[])) "
            "ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding"
        )
        with self.engine.begin() as conn:
            conn.execute(
                statement,
                [
                    {"chunk_id": chunk_id, "embedding": [float(value) for value in vector]}
                    for chunk_id, vector in zip(chunk_ids, matrix, strict=True)
                ],
            )

    def rebuild(self, rows):
        with self.lock:
            with self.engine.begin() as conn:
                conn.exec_driver_sql("DELETE FROM chunk_vectors")
            self._write(rows)

    def add(self, rows):
        with self.lock:
            self._write(rows)

    def remove(self, chunk_ids):
        targets = list(dict.fromkeys(chunk_ids))
        if not targets:
            return
        with self.lock:
            statement = self._text("DELETE FROM chunk_vectors WHERE chunk_id IN :ids").bindparams(
                self._bindparam("ids", expanding=True)
            )
            with self.engine.begin() as conn:
                conn.execute(statement, {"ids": targets})

    def search(self, vector, k=30):
        with self.lock:
            values = [float(value) for value in np.asarray(vector, dtype="float32").reshape(-1)]
            norm = float(np.linalg.norm(values))
            if not values or norm == 0:
                return []
            values = [value / norm for value in values]
            statement = self._text(
                "SELECT chunk_id, tantara_dot(embedding, CAST(:embedding AS real[])) AS score "
                "FROM chunk_vectors ORDER BY score DESC, chunk_id LIMIT :limit"
            )
            with self.engine.connect() as conn:
                return [
                    (row.chunk_id, float(row.score))
                    for row in conn.execute(statement, {"embedding": values, "limit": int(k)})
                ]

    def count(self):
        with self.lock, self.engine.connect() as conn:
            return int(conn.exec_driver_sql("SELECT count(*) FROM chunk_vectors").scalar() or 0)

    def id_set(self):
        with self.lock, self.engine.connect() as conn:
            return {row[0] for row in conn.exec_driver_sql("SELECT chunk_id FROM chunk_vectors")}


def store():
    global _store
    try:
        return _store
    except NameError:
        _store = (
            PostgresVectorStore() if get_settings().effective_vector_backend == "postgres" else FaissStore()
        )
        return _store
