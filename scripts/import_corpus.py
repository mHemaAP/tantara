#!/usr/bin/env python3
"""Opt-in download of a small official India arbitration statute corpus."""
import hashlib,json,sys,uuid
from datetime import datetime,timezone
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/"backend"))
from app.db import init_db,connect
from app.security import current_user

SOURCES=[{"url":"https://www.indiacode.nic.in/bitstream/123456789/1978/1/a1996-26.pdf","publisher":"India Code","title":"The Arbitration and Conciliation Act, 1996","date":"1996-08-16","license":"Government of India legislation; verify reuse terms at source."}]
def main():
    init_db(); reports=[]; dest=ROOT/"backend/data/corpus"; dest.mkdir(parents=True,exist_ok=True)
    for item in SOURCES:
        try:
            with httpx.Client(follow_redirects=True,timeout=25,headers={"User-Agent":"TANTARA-local-corpus-import/1.0 (single official document)"}) as client:
                robots=client.get("https://www.indiacode.nic.in/robots.txt")
                if robots.status_code==200 and "Disallow: /" in robots.text: raise RuntimeError("robots.txt disallows retrieval")
                response=client.get(item["url"]); response.raise_for_status()
            if not response.content.startswith(b"%PDF"): raise RuntimeError("Unexpected response content")
            digest=hashlib.sha256(response.content).hexdigest(); path=dest/(digest+".pdf"); path.write_bytes(response.content)
            reports.append({**item,"sha256":digest,"stored_original":str(path.relative_to(ROOT)),"retrieved_at":datetime.now(timezone.utc).isoformat(),"jurisdiction":"India","doc_type":"statute","citation":"Arbitration and Conciliation Act, 1996 (India)"})
        except Exception as exc: reports.append({**item,"error":type(exc).__name__+": "+str(exc)[:160]})
    manifest=dest/"manifest.json"; manifest.write_text(json.dumps(reports,indent=2)); print(json.dumps({"items":reports,"manifest":str(manifest.relative_to(ROOT))},indent=2))
if __name__=="__main__": main()
