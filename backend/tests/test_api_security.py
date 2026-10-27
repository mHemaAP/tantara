import uuid
from fastapi.testclient import TestClient
from app import config,db
from app.main import app
from app.models import User,Document,Draft,FilingBundle
from app.security import hash_password,create_token

def _headers(email,password):
    with TestClient(app) as c:
        login=c.post("/api/v1/auth/login",json={"email":email,"password":password})
        assert login.status_code==200
        return {"Authorization":"Bearer "+login.json()["access_token"]}

def test_cross_owner_records_are_hidden_and_researcher_is_read_only(client):
    login=client.post("/api/v1/auth/login",json={"email":"advocate@tantara.local","password":"tantara-local"}).json()
    a={"Authorization":"Bearer "+login["access_token"]}
    case=client.post("/api/v1/cases",headers=a,json={"title":"Owned Case","status":"active"}).json()
    from app.db import session_scope
    with session_scope() as s:
        u=User(id=str(uuid.uuid4()),name="Research User",email="research@example.local",password_hash=hash_password("password-long"),role="advocate")
        s.add(u);s.flush();token=create_token(u.id)
        doc=Document(id=str(uuid.uuid4()),owner_id=login["user"]["id"],case_id=case["id"],title="Private PDF",document_type="Award",filename="a.pdf",stored_path="/tmp/a.pdf",content_hash=uuid.uuid4().hex,status="ready")
        draft=Draft(id=str(uuid.uuid4()),owner_id=login["user"]["id"],case_id=case["id"],title="Private Draft",document_type="Pleading")
        bundle=FilingBundle(id=str(uuid.uuid4()),owner_id=login["user"]["id"],case_id=case["id"],name="Private Bundle",settings={})
        s.add_all([doc,draft,bundle]);ids=(doc.id,draft.id,bundle.id)
        researcher=User(id=str(uuid.uuid4()),name="Read Only",email="read-only@example.local",password_hash=hash_password("password-long"),role="researcher")
        s.add(researcher);s.flush();research_token=create_token(researcher.id)
    b={"Authorization":"Bearer "+token}
    assert client.get(f"/api/v1/cases/{case['id']}",headers=b).status_code==404
    assert client.patch(f"/api/v1/cases/{case['id']}",headers=b,json={"title":"steal"}).status_code==404
    assert client.get(f"/api/v1/documents/{ids[0]}",headers=b).status_code==404
    assert client.get(f"/api/v1/drafts/{ids[1]}",headers=b).status_code==404
    assert client.get(f"/api/v1/bundles/{ids[2]}",headers=b).status_code==404
    assert client.post("/api/v1/cases",headers={"Authorization":"Bearer "+research_token},json={"title":"Forbidden"}).status_code==403

def test_no_evidence_is_honest_and_validation_has_error_envelope(client):
    login=client.post("/api/v1/auth/login",json={"email":"advocate@tantara.local","password":"tantara-local"}).json()
    headers={"Authorization":"Bearer "+login["access_token"]}
    response=client.post("/api/v1/ai/ask",headers=headers,json={"question":"What does the evidence establish?"})
    assert response.status_code==200 and response.json()["status"]=="no_evidence"
    assert response.json()["citations"]==[]
    invalid=client.post("/api/v1/ai/ask",headers=headers,json={"question":"?"})
    assert invalid.status_code==422 and "error" in invalid.json()
