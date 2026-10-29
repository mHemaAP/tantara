#!/usr/bin/env python3
"""Upload a folder of documents into a running Tantra workspace through its public API.

Exercises the real ingestion path: multipart upload -> extraction job -> page rows ->
chunks -> embeddings -> Postgres tsvector + vector store -> MinIO object. Uploads are
sequential because the backend serialises index writes behind one lock.

    TANTARA_BASE_URL=https://tantra.theessencetimes.com \
    TANTARA_EMAIL=advocate@tantara.local \
    TANTARA_PASSWORD_FILE=~/.config/tantara/tantara-demo-password \
    backend/.venv/bin/python deploy/upload-corpus.py legal_docs \
        --collection "Statutes of India" --document-type Statute

Prints one line per file and a JSON summary on stdout's last line.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
from pathlib import Path

import httpx

ACCEPTED = {".pdf", ".docx", ".txt", ".md"}


def login(client: httpx.Client, base: str, email: str, password: str) -> str:
    r = client.post(f"{base}/api/v1/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def ensure_collection(client: httpx.Client, base: str, name: str) -> str:
    existing = client.get(f"{base}/api/v1/collections", timeout=30).json().get("items", [])
    for row in existing:
        if row.get("name") == name:
            return row["id"]
    created = client.post(f"{base}/api/v1/collections", json={"name": name, "description": ""}, timeout=30)
    created.raise_for_status()
    return created.json()["id"]


def wait_for_job(client: httpx.Client, base: str, doc_id: str, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        try:
            job = client.get(f"{base}/api/v1/documents/{doc_id}/job", timeout=30).json()
            doc = client.get(f"{base}/api/v1/documents/{doc_id}", timeout=30).json()
        except (json.JSONDecodeError, httpx.HTTPError) as exc:
            # A gateway blip (node restart, tunnel reconnect) must not abort the sweep.
            last = {"status": last.get("status"), "note": f"poll error {type(exc).__name__}"}
            time.sleep(5.0)
            continue
        last = {
            "status": doc.get("status"),
            "job_status": job.get("status"),
            "progress": job.get("progress"),
            "pages": job.get("pages") or doc.get("page_count"),
            "chars": job.get("chars"),
            "error": job.get("error"),
        }
        if last["status"] in {"ready", "failed"}:
            return last
        time.sleep(3.0)
    last["status"] = last.get("status") or "timeout"
    return last


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="directory of documents to upload")
    parser.add_argument("--collection", default=None, help="knowledge collection name to file them under")
    parser.add_argument("--document-type", default="Statute")
    parser.add_argument("--jurisdiction", default="India")
    parser.add_argument("--ext", default=",".join(sorted(ACCEPTED)), help="comma-separated extensions")
    parser.add_argument("--per-file-timeout", type=float, default=1800.0)
    parser.add_argument(
        "--retry-stale",
        action="store_true",
        help="requeue workspace documents left mid-pipeline by a backend restart",
    )
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="SUBSTRING",
        help="only touch files whose name contains this (repeatable); the worker node "
        "reboots every ~20 minutes, so the library is indexed in waves that fit inside one uptime",
    )
    parser.add_argument(
        "--sweep-limit",
        type=int,
        default=0,
        help="requeue at most this many stalled documents (0 = all); each one runs two "
        "extraction workers at once on the backend, so a wave is easier to survive than the lot",
    )
    args = parser.parse_args()

    base = os.environ.get("TANTARA_BASE_URL", "https://tantra.theessencetimes.com").rstrip("/")
    email = os.environ.get("TANTARA_EMAIL", "advocate@tantara.local")
    pw_file = os.environ.get("TANTARA_PASSWORD_FILE", "")
    password = os.environ.get("TANTARA_PASSWORD") or (
        Path(pw_file).expanduser().read_text().strip() if pw_file else ""
    )
    if not password:
        print("Set TANTARA_PASSWORD or TANTARA_PASSWORD_FILE.", file=sys.stderr)
        return 2
    exts = {e if e.startswith(".") else f".{e}" for e in args.ext.split(",")}
    folder = args.folder.expanduser().resolve()
    # Smallest first: the big statute PDFs are the risky ones, so everything else is
    # already indexed if one of them needs a retry.
    files = sorted(
        (p for p in (folder.rglob("*") if args.recursive else folder.glob("*")) if p.suffix.lower() in exts),
        key=lambda p: (p.stat().st_size, p.name),
    )
    needles = [needle.lower() for needle in args.only]
    if needles:
        files = [p for p in files if any(needle in p.name.lower() for needle in needles)]
    if not files:
        print(f"No {sorted(exts)} files under {folder}", file=sys.stderr)
        return 2

    with httpx.Client(headers={"user-agent": "tantra-corpus/1.0"}) as client:
        token = login(client, base, email, password)
        client.headers["authorization"] = f"Bearer {token}"
        collection_id = ensure_collection(client, base, args.collection) if args.collection else None
        print(f"base={base} account={email} files={len(files)} collection={args.collection or '-'}")
        listing = {"items": []}
        # page_size is capped at 100 server-side; ask for a rejected 200 and the
        # listing comes back as a validation error, which silently disables retries.
        for page in range(1, 11):
            batch = client.get(f"{base}/api/v1/documents", params={"page": page, "page_size": 100}, timeout=30)
            if batch.status_code != 200:
                print(f"note   document listing HTTP {batch.status_code}: {batch.text[:120]}")
                break
            payload = batch.json()
            listing["items"].extend(payload.get("items", []))
            if page >= (payload.get("pages") or 1):
                break
        known = {str(row.get("filename") or "").lower(): row for row in listing["items"]}
        # Documents the sweep has already put back in flight, so the file loop below
        # waits on them instead of submitting the same document a second time — two
        # live jobs on one document would write its pages and chunks twice.
        in_flight: set[str] = set()
        if args.retry_stale:
            stalled = [
                row
                for row in listing["items"]
                # A reboot or a crashed worker leaves a document parked in
                # queued/extracting/indexing, and an extraction that died leaves it
                # failed. Re-submit any of them instead of letting the upload below
                # report the file as "already indexed".
                if row.get("status") in {"queued", "extracting", "indexing", "failed"}
            ]
            if needles:
                stalled = [r for r in stalled if any(n in str(r.get("filename") or "").lower() for n in needles)]
            if args.sweep_limit:
                stalled = stalled[: args.sweep_limit]
            for row in stalled:
                rr = client.post(f"{base}/api/v1/documents/{row['id']}/retry", timeout=60)
                if rr.status_code in (200, 202):
                    in_flight.add(str(row["id"]))
                print(f"retry  {str(row.get('title', '?'))[:58]:58s} HTTP {rr.status_code}")
        rows = []
        for path in files:
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            started = time.monotonic()
            r = None
            for attempt in range(1, 4):
                try:
                    with path.open("rb") as fh:
                        r = client.post(
                            f"{base}/api/v1/documents/upload",
                            files={"file": (path.name, fh, mime)},
                            data={
                                "title": path.stem[:300],
                                "document_type": args.document_type,
                                "jurisdiction": args.jurisdiction,
                                **({"collection_id": collection_id} if collection_id else {}),
                            },
                            timeout=httpx.Timeout(300.0, connect=15.0),
                        )
                    if r.status_code < 500:
                        break
                    print(f"retry  {path.name:58s} HTTP {r.status_code} attempt={attempt}")
                except httpx.HTTPError as exc:
                    print(f"retry  {path.name:58s} {type(exc).__name__} attempt={attempt}")
                r = None
                time.sleep(10.0)
            if r is None:
                print(f"FAIL   {path.name:58s} upload never reached the API")
                rows.append({"file": path.name, "status": "unreachable"})
                continue
            if r.status_code == 409:
                row = known.get(path.name.lower())
                status = str(row.get("status") or "") if row else ""
                if row and status != "ready" and args.retry_stale:
                    if str(row["id"]) not in in_flight and status not in {"extracting", "indexing"}:
                        rr = client.post(f"{base}/api/v1/documents/{row['id']}/retry", timeout=60)
                        if rr.status_code not in (200, 202):
                            print(f"note   retry refused for {path.name}: HTTP {rr.status_code} {rr.text[:120]}")
                    state = wait_for_job(client, base, row["id"], args.per_file_timeout)
                    secs = time.monotonic() - started
                    flag = "ok    " if state["status"] == "ready" else "FAIL  "
                    print(
                        f"{flag} {path.name:58s} pages={state.get('pages', 0):>4} "
                        f"{state['status']} ({secs:.0f}s) existing document"
                    )
                    rows.append({"file": path.name, "status": state["status"], "seconds": round(secs, 1)})
                    continue
                print(f"skip   {path.name:58s} already indexed")
                rows.append({"file": path.name, "status": "duplicate"})
                continue
            if r.status_code not in (200, 202):
                print(f"FAIL   {path.name:58s} HTTP {r.status_code} {r.text[:160]}")
                rows.append({"file": path.name, "status": f"http-{r.status_code}"})
                continue
            payload = r.json()
            state = wait_for_job(client, base, payload["document_id"], args.per_file_timeout)
            secs = time.monotonic() - started
            state.update({"file": path.name, "document_id": payload["document_id"], "seconds": round(secs, 1)})
            flag = "ok    " if state["status"] == "ready" else "FAIL  "
            print(
                f"{flag} {path.name:58s} pages={state.get('pages')} chunks->chars={state.get('chars')} "
                f"{state['status']} ({secs:.0f}s)"
            )
            rows.append(state)

        docs = client.get(f"{base}/api/v1/documents", params={"page_size": 200}, timeout=30).json()
        pending = [
            {"title": d.get("title"), "status": d.get("status")}
            for d in docs.get("items", [])
            if d.get("status") != "ready"
        ]
        summary = {
            "base": base,
            "account": email,
            "uploaded": sum(1 for r in rows if r["status"] == "ready"),
            "duplicates": sum(1 for r in rows if r["status"] == "duplicate"),
            "failed": [r for r in rows if r["status"] not in {"ready", "duplicate"}],
            "pages_total": sum(r.get("pages") or 0 for r in rows),
            "workspace_pending": pending,
            "workspace_documents": docs.get("total"),
        }
        print(json.dumps(summary))
        return 0 if not summary["failed"] and not summary["workspace_pending"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
