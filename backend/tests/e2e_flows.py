"""Live-server workflow smoke flows. Run after starting uvicorn on 127.0.0.1:8010."""
import httpx,sys
BASE="http://127.0.0.1:8010/api/v1"
def main():
 c=httpx.Client(base_url=BASE,timeout=90); l=c.post("/auth/login",json={"email":"advocate@tantara.local","password":"tantara-local"}); l.raise_for_status(); c.headers["Authorization"]="Bearer "+l.json()["access_token"]
 if "--a" in sys.argv: print("Upload a representative legal PDF before running workflow A; this script requires that source document id to cite verified pagination."); return 2
 client=c.post("/clients",json={"name":"E2E Persistence Client"}); client.raise_for_status(); case=c.post("/cases",json={"title":"E2E Case","status":"active","client_id":client.json()["id"]}); case.raise_for_status(); cid=case.json()["id"]
 participant=c.post(f"/cases/{cid}/participants",json={"name":"Counsel","party_role":"counsel"}); participant.raise_for_status()
 task=c.post("/tasks",json={"case_id":cid,"title":"Persisted task","status":"todo"}); task.raise_for_status()
 hearing=c.post("/hearings",json={"case_id":cid,"title":"Persisted hearing","at":"2030-01-01T10:00:00Z","mode":"online"}); hearing.raise_for_status()
 reopened=c.get(f"/cases/{cid}/overview"); reopened.raise_for_status(); assert reopened.json()["tasks"] and reopened.json()["hearings"]
 print("Workflow B passed: client, case, participant, task, hearing persisted."); return 0
if __name__=="__main__": raise SystemExit(main())
