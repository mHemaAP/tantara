#!/usr/bin/env python3
"""Operator tool: return the deployed workspace to a pristine, unseeded state.

It deletes application rows (users and the Alembic stamp are kept), the vectors
held in PostgreSQL, and every object under the workspace buckets. Run it before
`deploy/apply.sh --seed` to publish a clean demo workspace.

Take a backup first: POST /api/v1/settings/database/backup stores a SQL dump
under backups/ in the workspace bucket (the reset clears that prefix too, so
download the dump before running it).

Usage: backend/.venv/bin/python deploy/reset-workspace.py --yes [--no-objects]
Run it with DATABASE_URL plus the S3 settings of the deployed workspace; it needs
the backend virtualenv, where SQLAlchemy, psycopg and minio are installed.
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Kept rows: login identities and the migration stamp.
KEEP_TABLES = {"alembic_version", "users"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="required: confirm the destructive reset")
    parser.add_argument("--no-objects", action="store_true", help="skip object-storage deletion")
    args = parser.parse_args()
    if not args.yes:
        raise SystemExit("refusing to reset without --yes")
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("set DATABASE_URL to the deployed workspace database")

    from sqlalchemy import create_engine, text

    from app.models import Base  # noqa: F401  (populates the table metadata)
    from app.object_store import CATEGORIES, object_store

    engine = create_engine(os.environ["DATABASE_URL"])

    # Children first, exactly the order the application's own metadata describes.
    tables = [t.name for t in reversed(Base.metadata.sorted_tables) if t.name not in KEEP_TABLES]
    # Created by migration 0011 without a model class.
    with engine.connect() as probe:
        exists = probe.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_name = 'chunk_vectors'")
        ).scalar()
    if exists:
        tables.insert(0, "chunk_vectors")

    with engine.begin() as conn:
        counts = {
            name: conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar() for name in tables
        }
        print(f"rows before: {sum(counts.values())}")
        for name in tables:
            if counts[name]:
                conn.execute(text(f'DELETE FROM "{name}"'))
        remaining = sum(
            conn.execute(text(f'SELECT count(*) FROM "{name}"')).scalar() for name in tables
        )
        print(f"tables cleared: {sum(1 for v in counts.values() if v)}, rows after: {remaining}")

    if not args.no_objects:
        store = object_store()
        removed = 0
        for category in CATEGORIES:
            for key in list(store.list_keys(category)):
                store.delete(key)
                removed += 1
        print(f"objects removed: {removed}")

    print("reset complete; reseed with: deploy/apply.sh --seed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
