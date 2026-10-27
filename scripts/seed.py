#!/usr/bin/env python3
"""Create a typed demo workspace with real locally generated and indexed PDFs."""
import argparse,io,sys,uuid,os
from datetime import date,datetime,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/"backend"))
os.chdir(ROOT/"backend")
from app.db import init_db,SessionLocal,session_scope
from app.config import get_settings
from app.security import hash_password
from app.models import (User,Client,Case,CaseParticipant,Hearing,Task,Note,Draft,DraftVersion,
                        FilingBundle,BundleItem,Document,IngestionJob,ResearchSession,ResearchMessage,CommunityPost,AuditEvent,AppPreference,SavedItem,AIConversation,ExtractionField,CaseEvent,CaseParticipant,DraftVersion,CommunityReply)
from app.services.vector_store import store
from app.routers.documents import process_job
from sqlalchemy import select,delete,func

def make_pdf(path,title,paragraphs):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    c=canvas.Canvas(str(path),pagesize=letter);c.setTitle(title);y=740
    c.setFont("Helvetica-Bold",15);c.drawString(52,y,title);y-=35;c.setFont("Helvetica",11)
    for paragraph in paragraphs:
        words=paragraph.split();line=""
        for word in words:
            trial=(line+" "+word).strip()
            if len(trial)>92:c.drawString(52,y,line);y-=17;line=word
            else:line=trial
        if line:c.drawString(52,y,line);y-=22
        if y<65:c.showPage();y=740;c.setFont("Helvetica",11)
    c.save()

def make_scanned_pdf(path):
    from PIL import Image,ImageDraw,ImageFont
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    img=Image.new("RGB",(1275,1650),"white");draw=ImageDraw.Draw(img)
    font=ImageFont.load_default(size=35);y=150
    lines=["ARBITRATION AGREEMENT","","The parties agree that disputes shall be referred","to arbitration under the Arbitration and","Conciliation Act, 1996. The seat shall be Mumbai.","The tribunal shall consist of one arbitrator."]
    for line in lines:draw.text((115,y),line,fill="black",font=font);y+=100
    buf=io.BytesIO();img.save(buf,format="PNG");buf.seek(0)
    c=canvas.Canvas(str(path),pagesize=letter);c.drawImage(ImageReader(buf),0,0,width=612,height=792);c.save()

def main():
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True);group.add_argument("--demo",action="store_true");group.add_argument("--empty",action="store_true");args=parser.parse_args();init_db();s=get_settings()
    with session_scope() as db:
        root=db.scalar(select(User).where(User.email=="advocate@tantara.local"))
        if root is None:
            root=User(id=str(uuid.uuid4()),name="Aarav Mehta",email="advocate@tantara.local",password_hash=hash_password(s.tantara_admin_password),role="advocate",avatar_initials="AM",title="Advocate");db.add(root);db.flush()
        owner=root.id
        if args.empty:
            paths=[x[0] for x in db.execute(select(Document.stored_path).where(Document.owner_id==owner)).all()]
            for model in (AuditEvent,AppPreference,SavedItem,AIConversation,ExtractionField,CaseEvent,CaseParticipant,DraftVersion,CommunityReply,IngestionJob,ResearchMessage,ResearchSession,BundleItem,FilingBundle,Document,Draft,Task,Hearing,Note,CommunityPost,Case,Client):
                if hasattr(model,"owner_id"):db.execute(delete(model).where(model.owner_id==owner))
            db.execute(delete(User).where(User.email.in_(["researcher@tantara.local","staff@tantara.local"])))
            for stored in paths:
                path=Path(stored)
                if path.parent==(s.data_dir/"uploads").resolve():path.unlink(missing_ok=True)
            db.flush()
            from app.services.index_maintenance import rebuild_index
            print("Empty typed workspace ready; local advocate account retained; vector index:",rebuild_index());return
        if db.scalar(select(func.count(Case.id)).where(Case.owner_id==owner,Case.is_demo.is_(True))):print("Demo workspace already seeded.");return
        users=[]
        for email,name,role in (("researcher@tantara.local","Mira Shah","researcher"),("staff@tantara.local","Dev Patel","staff")):
            u=db.scalar(select(User).where(User.email==email))
            if not u:u=User(id=str(uuid.uuid4()),name=name,email=email,password_hash=hash_password(s.tantara_admin_password),role=role,avatar_initials="".join(x[0] for x in name.split()),title=role.title());db.add(u);db.flush()
            users.append(u)
        clients=[]
        for name in ("ABC Pvt. Ltd.","TechBuild Ltd.","Global Traders","Solaris Energy","Apex Construction","Meridian Ports"):
            row=Client(id=str(uuid.uuid4()),owner_id=owner,name=name,organization=name,email="legal@"+name.lower().replace(" ","").replace(".","")+".example",status="active",notes="Demo client",is_demo=True);db.add(row);clients.append(row)
        db.flush()
        pairs=[("ABC Pvt. Ltd. vs. XYZ Ltd.","SIAC"),("TechBuild vs. Metro Infra","ICC"),("Global Traders vs. Oceanic","LCIA"),("Solaris Energy vs. Volt India","DIAC"),("Apex Construction vs. State","Ad hoc"),("Meridian Ports vs. Eastern Shipping","SIIA"),("Orion Systems vs. Nova Data","SIAC"),("Cedar Infrastructure vs. Riverworks","ICC"),("BluePeak Energy vs. Gridline","LCIA"),("Vantage Retail vs. Northstar","DIAC"),("Pioneer Mining vs. Terra Materials","ICC"),("Crown Hotels vs. Summit Hospitality","Ad hoc")]
        cases=[]
        for i,(title,forum) in enumerate(pairs):
            claimant,respondent=title.split(" vs. ",1);cid=str(uuid.uuid4())
            case=Case(id=cid,owner_id=owner,title=title,reference_number=f"ARB/2025/{i+1:03}",claimant=claimant,respondent=respondent,client_id=clients[i%len(clients)].id,forum=forum,seat="Mumbai, India",governing_law="Indian law",arbitration_agreement_details="Section 7 arbitration agreement",dispute_category=("Construction" if i%2 else "Commercial"),claim_amount=1250000+i*50000,claim_currency="INR",status="pending" if i==2 else "active",description="Sample arbitration matter for local demo only.",is_demo=True);db.add(case);cases.append(case)
            db.add(CaseParticipant(id=str(uuid.uuid4()),owner_id=owner,case_id=cid,name="Aarav Mehta",party_role="counsel",organization="TANTARA",is_demo=True))
            db.add(CaseParticipant(id=str(uuid.uuid4()),owner_id=owner,case_id=cid,name=claimant,party_role="claimant",is_demo=True))
            due=datetime.combine(date.today()+timedelta(days=i-3),datetime.min.time())
            db.add(Task(id=str(uuid.uuid4()),owner_id=owner,case_id=cid,title="Review pleadings and evidence",notes="Demo task.",due_at=due,priority=("high" if i%3==0 else "medium"),status="todo",assignee="Aarav Mehta",is_demo=True))
            db.add(Note(id=str(uuid.uuid4()),owner_id=owner,case_id=cid,title="Initial review",body="Demo note. Confirm all matter details against source records.",kind="case_note",is_demo=True))
            if i<7:
                at=datetime.combine(date.today()+timedelta(days=i%7+1),datetime.min.time()).replace(hour=10)
                db.add(Hearing(id=str(uuid.uuid4()),owner_id=owner,case_id=cid,title="Procedural hearing",at=at,mode="online",forum=forum,status="scheduled",notes="Demo calendar item.",is_demo=True))
        db.flush()
        data_dir=s.data_dir;fixture_dir=data_dir/"demo-fixtures";fixture_dir.mkdir(parents=True,exist_ok=True)
        specs=[
            ("agreement.pdf","Arbitration Agreement",["Arbitration agreement", "Section 7 of the Arbitration and Conciliation Act, 1996. The parties agree to submit disputes arising from this contract to arbitration seated in Mumbai, India."]),
            ("award.pdf","Arbitral Award",["Sample arbitral award", "This locally generated demo award records a hypothetical award dated 14 January 2025. It is not a real case, authority, or legal source."]),
            ("contract.pdf","Construction Contract",["Sample construction contract", "The parties agree on project milestones, payment terms, notice obligations, and dispute resolution by arbitration."])
        ]
        files=[]
        for name,title,paragraphs in specs:
            path=fixture_dir/name;make_pdf(path,title,paragraphs);files.append((name,title,path.read_bytes()))
        scanned=fixture_dir/"scanned-agreement.pdf";make_scanned_pdf(scanned);files.append(("scanned-agreement.pdf","Scanned Arbitration Agreement",scanned.read_bytes()))
        bundle=FilingBundle(id=str(uuid.uuid4()),owner_id=owner,case_id=cases[0].id,name="ABC Arbitration Filing Bundle",settings={"cover_page":True,"index":True,"synopsis":True,"list_of_dates":True},status="draft",is_demo=True);db.add(bundle)
        research=ResearchSession(id=str(uuid.uuid4()),owner_id=owner,title="Section 7 agreement review",case_id=cases[0].id,is_demo=True);db.add(research)
        post=CommunityPost(id=str(uuid.uuid4()),owner_id=owner,title="Demo: preparing a procedural calendar",body="Sample workspace discussion. Replace with your team's own notes and questions.",kind="discussion",tags=["procedure","calendar"],case_ref=cases[0].id,is_demo=True);db.add(post)
        draft=Draft(id=str(uuid.uuid4()),owner_id=owner,case_id=cases[0].id,title="Statement of Claim Outline",document_type="Statement of Claim",status="draft",content_markdown="# Statement of Claim\n\n[REVIEW: Replace every placeholder with verified case facts and supported legal submissions.]\n",is_demo=True);db.add(draft)
        db.flush();db.add(DraftVersion(id=str(uuid.uuid4()),owner_id=owner,draft_id=draft.id,version_number=1,content_markdown=draft.content_markdown,change_note="Demo outline",is_demo=True))
        db.flush();case_id=cases[0].id;bundle_id=bundle.id
        docs=[]
        for order,(filename,title,blob) in enumerate(files):
            did,jid=str(uuid.uuid4()),str(uuid.uuid4());digest=__import__("hashlib").sha256(blob).hexdigest();stored=__import__("app.ingestion",fromlist=["DocumentStorage"]).DocumentStorage().save(blob)
            doc=Document(id=did,owner_id=owner,case_id=case_id,title=title,document_type="Arbitration Agreement" if "Agreement" in title else title,jurisdiction="India",filename=filename,stored_path=stored,content_hash=digest,status="queued",is_demo=True)
            db.add(doc);db.flush();db.add(IngestionJob(id=jid,owner_id=owner,document_id=did,status="queued",steps=[],warnings=[],is_demo=True));db.add(BundleItem(id=str(uuid.uuid4()),owner_id=owner,bundle_id=bundle_id,document_id=did,section="Core Documents",order=order,is_demo=True));docs.append((did,jid,filename,blob))
        db.flush()
        session_id=research.id
    for did,jid,filename,blob in docs:process_job(did,jid,owner,blob,filename)
    from app.routers.bundles import generate as generate_bundle
    generated=generate_bundle(bundle_id,{"id":owner,"role":"advocate","name":"Aarav Mehta"})
    with session_scope() as db:
        session=db.get(ResearchSession,session_id);db.add(ResearchMessage(id=str(uuid.uuid4()),owner_id=owner,session_id=session.id,role="assistant",content="Demo session initialized. Ask a question to search the locally indexed fixture files.",status="ok",model={"provider":"local"},is_demo=True))
    print(f"Seeded {len(clients)} clients, {len(cases)} cases, {len(docs)} generated/indexed PDFs; bundle has {generated.get('pages')} pages.")
if __name__=="__main__":main()
