#!/usr/bin/env python3
"""Create a repeatable local demo workspace or an empty local user."""
import argparse,json,uuid,os
from datetime import date,timedelta
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"backend"))
from app.db import init_db,connect
from app.config import get_settings
from app.security import hash_password

def put(c,table,owner,data,case_id=None):
    c.exec_driver_sql(f"INSERT INTO {table}(id,owner_id,case_id,data,is_demo) VALUES(?,?,?,?,1)",(str(uuid.uuid4()),owner,case_id,json.dumps(data)))
def main():
    os.chdir(Path(__file__).resolve().parents[1]/"backend")
    p=argparse.ArgumentParser(); g=p.add_mutually_exclusive_group(required=True); g.add_argument("--demo",action="store_true"); g.add_argument("--empty",action="store_true"); a=p.parse_args(); init_db()
    with connect() as c:
        root=c.exec_driver_sql("SELECT id FROM users WHERE email='advocate@tantara.local'").first()
        if not root:
            uid=str(uuid.uuid4()); c.exec_driver_sql("INSERT INTO users(id,name,email,password_hash,role,avatar_initials,title) VALUES(?,?,?,?,?,?,?)",(uid,"Aarav Mehta","advocate@tantara.local",hash_password(get_settings().tantara_admin_password),"advocate","AM","Advocate")); root=(uid,)
        owner=root[0]
        if not a.demo: print("Empty workspace ready; primary local user retained."); return
        if c.exec_driver_sql("SELECT count(*) FROM cases WHERE owner_id=? AND is_demo=1",(owner,)).scalar(): print("Demo workspace already seeded."); return
        clients=[]
        for name in ["ABC Pvt. Ltd.","TechBuild Ltd.","Global Traders","Solaris Energy","Apex Construction","Meridian Ports"]:
            cid=str(uuid.uuid4()); clients.append(cid); put(c,"clients",owner,{"name":name,"status":"active"})
        names=[("ABC Pvt. Ltd. vs. XYZ Ltd.","SIAC"),("TechBuild vs. Metro Infra","ICC"),("Global Traders vs. Oceanic","LCIA"),("Solaris Energy vs. Volt India","DIAC"),("Apex Construction vs. State","Ad hoc")]
        names += [(f"Commercial Dispute {i} vs. Counterparty {i}",INSTITUTION) for i,INSTITUTION in enumerate(["SIAC","ICC","LCIA","DIAC","SIIA","Ad hoc","ICC"],6)]
        cases=[]
        for i,(title,forum) in enumerate(names):
            cid=str(uuid.uuid4()); cases.append(cid); put(c,"cases",owner,{"title":title,"reference_number":f"ARB/2025/{i+1:03}","claimant":title.split(" vs.")[0],"respondent":title.split(" vs.")[-1],"client_id":clients[i%len(clients)],"forum":forum,"institution":forum,"seat":"Mumbai, India","governing_law":"Indian law","status":"pending" if i==2 else "active","dispute_category":"Commercial","description":"Demo matter for local workspace display.","assigned_team_members":[owner]},cid)
            put(c,"case_participants",owner,{"name":"Aarav Mehta","party_role":"counsel"},cid)
            put(c,"tasks",owner,{"title":"Review case materials","status":"todo","priority":"medium","due_at":(date.today()+timedelta(days=i-3)).isoformat()},cid)
            if i<4: put(c,"hearings",owner,{"title":"Procedural hearing","at":(date.today()+timedelta(days=i+2)).isoformat()+"T10:00:00Z","mode":"online","forum":forum,"status":"scheduled"},cid)
            put(c,"notes",owner,{"title":"Initial review","body":"Demo note; replace with workspace notes."},cid)
        print(f"Seeded demo workspace: {len(clients)} clients, {len(cases)} cases.")
if __name__=="__main__":main()
