#!/usr/bin/env python3
"""Provision and reset the shared demo accounts on a deployed Tantra workspace.

Accounts are the four identities used by the walkthrough deck and the browser
end-to-end run. All of them share one password so the deck can publish a single
login line; the password is read from TANTARA_DEMO_PASSWORD and never printed.

    set -a; . <(kubectl get secret ...); set +a
    backend/.venv/bin/python deploy/manage-demo-users.py --ensure

Flags:
  --ensure            create missing accounts and set the shared password
  --set-password PASS override the env-provided password (avoid: shell history)
  --list              print accounts and roles only
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

DEMO_ACCOUNTS = [
    # email, name, role, initials, title
    ("advocate@tantara.local", "Workspace Advocate", "advocate", "WA", "Advocate"),
    ("researcher@tantara.local", "Mira Shah", "researcher", "MS", "Researcher"),
    ("staff@tantara.local", "Dev Patel", "staff", "DP", "Matters Staff"),
    ("associate@tantara.local", "Aarav Nair", "advocate", "AN", "Associate Advocate"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ensure", action="store_true", help="create accounts and set the shared password")
    parser.add_argument("--list", action="store_true", help="print existing accounts")
    parser.add_argument("--set-password", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    password = args.set_password or os.environ.get("TANTARA_DEMO_PASSWORD", "")
    if args.ensure and not password:
        print("Set TANTARA_DEMO_PASSWORD (or pass --set-password) before --ensure.", file=sys.stderr)
        return 2
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL must point at the deployed workspace database.", file=sys.stderr)
        return 2

    init_db()
    s = SessionLocal()
    try:
        if args.ensure:
            for email, name, role, initials, title in DEMO_ACCOUNTS:
                user = s.scalar(select(User).where(User.email == email))
                if user is None:
                    user = User(
                        id=str(uuid.uuid4()),
                        name=name,
                        email=email,
                        password_hash=hash_password(password),
                        role=role,
                        avatar_initials=initials,
                        title=title,
                    )
                    s.add(user)
                    s.flush()
                    print(f"created  {email:32s} role={role}")
                else:
                    user.password_hash = hash_password(password)
                    user.role = role
                    if not user.avatar_initials:
                        user.avatar_initials = initials
                    print(f"updated  {email:32s} role={role}")
            s.commit()
        for user in s.scalars(select(User).order_by(User.created_at)):
            print(f"account  {user.email:32s} role={user.role:10s} name={user.name}")
        return 0
    finally:
        s.close()


if __name__ == "__main__":
    raise SystemExit(main())
