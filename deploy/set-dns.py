#!/usr/bin/env python3
"""Create or update the Cloudflare DNS record that routes the public hostname to the tunnel.

The record is a proxied CNAME to <tunnel-id>.cfargotunnel.com, which is how a
Cloudflare Tunnel is reached from the public internet. The API token is read from a
private local file, never passed on the command line.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
TOKEN_FILE = Path.home() / ".config" / "tantara" / "cf-token.txt"


def request(method: str, path: str, token: str, payload: dict | None = None) -> list | dict:
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"Cloudflare API {method} {path} failed: HTTP {exc.code} {detail[:400]}")
    if not data.get("success"):
        raise SystemExit(f"Cloudflare API {method} {path} failed: {data.get('errors')}")
    return data["result"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials-dir", type=Path, help="directory rendered by deploy/render-config.py")
    parser.add_argument("--hostname", help="public hostname (default: first hostname in config.yml)")
    parser.add_argument("--token-file", type=Path, default=TOKEN_FILE)
    args = parser.parse_args()

    if not args.token_file.is_file():
        raise SystemExit(f"Cloudflare API token file not found: {args.token_file}")
    token = args.token_file.read_text(encoding="utf-8").strip()

    hostname = args.hostname
    tunnel_id = None
    if args.credentials_dir:
        config = (args.credentials_dir / "config.yml").read_text(encoding="utf-8")
        # Ingress hostnames may carry a path prefix; the bare one is the DNS name.
        candidates = re.findall(r"^\s*-\s*hostname:\s*(\S+)", config, re.MULTILINE)
        bare = [value.split("/")[0] for value in candidates if "/" not in value]
        if not bare:
            raise SystemExit("no bare hostname found in the rendered config.yml")
        hostname = hostname or bare[0]
        credentials = json.loads((args.credentials_dir / "credentials.json").read_text(encoding="utf-8"))
        tunnel_id = credentials["TunnelID"]
    if not hostname or not tunnel_id:
        raise SystemExit("both --hostname and --credentials-dir (or a tunnel id) are required")

    target = f"{tunnel_id}.cfargotunnel.com"
    zone_name = ".".join(hostname.split(".")[-2:])
    zones = request("GET", f"/zones?name={zone_name}", token)
    if not zones:
        raise SystemExit(f"no Cloudflare zone found for {zone_name}")
    zone_id = zones[0]["id"]

    records = request("GET", f"/zones/{zone_id}/dns_records?name={hostname}&type=CNAME", token)
    payload = {"type": "CNAME", "name": hostname, "content": target, "proxied": True, "ttl": 1}
    if records:
        record_id = records[0]["id"]
        result = request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", token, payload)
        action = "updated"
    else:
        result = request("POST", f"/zones/{zone_id}/dns_records", token, payload)
        action = "created"
    print(f"dns {action}: {result['name']} -> {result['content']} proxied={result['proxied']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
