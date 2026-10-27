import time
from fastapi.testclient import TestClient

def _auth(client):
    r=client.post("/api/v1/auth/login",json={"email":"advocate@tantara.local","password":"tantara-local"})
    assert r.status_code==200
    return {"Authorization":"Bearer "+r.json()["access_token"]}

def test_reviewable_extraction_page_refs_range_and_hybrid_search(client):
    h=_auth(client);text=b"Agreement clause: disputes shall be referred to arbitration. Seat of arbitration is Mumbai, India."
    uploaded=client.post("/api/v1/documents/upload",headers=h,files={"file":("agreement.txt",text,"text/plain")})
    assert uploaded.status_code==202
    did=uploaded.json()["document_id"]
    for _ in range(120):
        job=client.get(f"/api/v1/documents/{did}/job",headers=h).json()
        if job["status"] in {"ready","failed"}:break
        time.sleep(.05)
    assert job["status"]=="ready" and job["pages"]==1
    pages=client.get(f"/api/v1/documents/{did}/pages",headers=h).json()["pages"]
    assert pages[0]["page_number"]==1
    preview=client.get(f"/api/v1/documents/{did}/file",headers={**h,"Range":"bytes=0-9"})
    assert preview.status_code==206 and preview.content==text[:10]
    candidate=client.post(f"/api/v1/documents/{did}/ai-read",headers=h).json()
    assert candidate["review_required"] is True
    assert candidate["fields"]["arbitration_clause"]["provenance"]=="ai_suggested"
    reviewed=client.patch(f"/api/v1/documents/{did}/extraction",headers=h,json={"fields":{"arbitration_clause":{"found":True,"page":1}}})
    assert reviewed.status_code==200
    assert reviewed.json()["fields"]["arbitration_clause"]["provenance"]=="extracted_reviewed"
    results=client.get("/api/v1/search/documents",headers=h,params={"query":"arbitration Mumbai","page":1,"page_size":1})
    assert results.status_code==200 and results.json()["total"]>=1
    assert results.json()["items"][0]["document_id"]==did and results.json()["items"][0]["page_number"]==1

def test_upload_rejections_and_duplicate_error_details(client):
    h=_auth(client)
    assert client.post("/api/v1/documents/upload",headers=h,files={"file":("x.exe",b"x","application/octet-stream")}).status_code==400
    assert client.post("/api/v1/documents/upload",headers=h,files={"file":("x.pdf",b"not pdf","application/pdf")}).status_code==400
    body=b"duplicate check is database enforced across this local workspace"
    first=client.post("/api/v1/documents/upload",headers=h,files={"file":("one.txt",body,"text/plain")})
    assert first.status_code==202
    second=client.post("/api/v1/documents/upload",headers=h,files={"file":("two.txt",body,"text/plain")})
    assert second.status_code==409
    details=second.json()["error"]["details"]["existing_document"]
    assert details["id"]==first.json()["document_id"]
