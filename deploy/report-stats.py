#!/usr/bin/env python3
"""Summarise a running Tantra deployment as JSON for reports and slide decks.

  TANTARA_BASE_URL=https://tantra.theessencetimes.com \
  TANTARA_EMAIL=advocate@tantara.local \
  TANTARA_PASSWORD_FILE=~/.config/tantara/tantara-demo-password \
  backend/.venv/bin/python deploy/report-stats.py --out reports/walkthrough/stats.json

Only counts and document metadata are printed; passwords are read, never emitted.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx


def login(client: httpx.Client, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    if response.status_code != 200:
        raise SystemExit(f"login failed for {email}: HTTP {response.status_code}")
    return response.json()["access_token"]


def list_all(client: httpx.Client, path: str, token: str) -> list[dict]:
    items, page = [], 1
    while True:
        response = client.get(path, params={"page": page, "page_size": 100}, headers={"authorization": f"Bearer {token}"})
        if response.status_code == 404:
            return items
        response.raise_for_status()
        payload = response.json()
        batch = payload.get("items", payload.get("posts", []))
        items.extend(batch)
        if page >= int(payload.get("pages") or 1) or not batch:
            return items
        page += 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("TANTARA_BASE_URL", "http://tantra.local:8082"))
    parser.add_argument("--email", default=os.environ.get("TANTARA_EMAIL", "advocate@tantara.local"))
    parser.add_argument("--password", default=os.environ.get("TANTARA_PASSWORD"))
    parser.add_argument("--password-file", default=os.environ.get("TANTARA_PASSWORD_FILE"))
    parser.add_argument("--out", default="reports/walkthrough/stats.json")
    parser.add_argument("--probe-query", default="interim measures ordered by the court before arbitration")
    args = parser.parse_args()

    if args.password_file:
        args.password = Path(args.password_file).read_text(encoding="utf-8").strip()
    if not args.password:
        raise SystemExit("a password is required (--password or --password-file)")

    base = args.base_url.rstrip("/")
    with httpx.Client(base_url=base, timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        token = login(client, args.email, args.password)
        headers = {"authorization": f"Bearer {token}"}

        me = client.get("/api/v1/auth/me", headers=headers).json()
        documents = list_all(client, "/api/v1/documents", token)
        cases = list_all(client, "/api/v1/cases", token)
        clients = list_all(client, "/api/v1/clients", token)
        tasks = list_all(client, "/api/v1/tasks", token)
        collections = client.get("/api/v1/collections", headers=headers)
        collections = collections.json().get("items", []) if collections.status_code == 200 else []

        by_type: dict[str, dict[str, int]] = {}
        for document in documents:
            bucket = by_type.setdefault(
                document.get("document_type") or "Unclassified", {"documents": 0, "pages": 0, "ready": 0}
            )
            bucket["documents"] += 1
            bucket["pages"] += int(document.get("page_count") or 0)
            bucket["ready"] += 1 if document.get("status") == "ready" else 0

        search = client.get("/api/v1/search/documents", params={"query": args.probe_query, "limit": 8}, headers=headers)
        search_payload = search.json() if search.status_code == 200 else {}
        hits = search_payload.get("items", [])
        top_pages = sorted({int(h.get("page_number") or 0) for h in hits if h.get("page_number")})

        stats = {
            "base_url": base,
            "account": {"email": me.get("email"), "name": me.get("name"), "role": me.get("role")},
            "totals": {
                "documents": len(documents),
                "documents_ready": sum(1 for d in documents if d.get("status") == "ready"),
                "pages": sum(int(d.get("page_count") or 0) for d in documents),
                "cases": len(cases),
                "clients": len(clients),
                "tasks": len(tasks),
                "collections": len(collections),
            },
            "documents_by_type": by_type,
            "collections": [{"name": c.get("name"), "documents": c.get("document_count")} for c in collections],
            "documents": [
                {
                    "title": d.get("title"),
                    "type": d.get("document_type"),
                    "pages": d.get("page_count"),
                    "status": d.get("status"),
                    "filename": d.get("filename"),
                }
                for d in sorted(documents, key=lambda d: (d.get("document_type") or "", -(d.get("page_count") or 0)))
            ],
            "search_probe": {
                "query": args.probe_query,
                "status": search_payload.get("status"),
                "total": search_payload.get("total"),
                "top_pages": top_pages[:12],
                "first_hit": {
                    k: hits[0].get(k)
                    for k in ("document_title", "page_number", "score", "snippet")
                }
                if hits
                else None,
            },
        }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    totals = stats["totals"]
    print(
        f"{base}  documents={totals['documents']} (ready {totals['documents_ready']}) "
        f"pages={totals['pages']} cases={totals['cases']} clients={totals['clients']} "
        f"tasks={totals['tasks']} collections={totals['collections']}"
    )
    print(f"search probe status={stats['search_probe']['status']} total={stats['search_probe']['total']}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
