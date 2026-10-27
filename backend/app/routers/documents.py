"""Reviewable AI Read candidates for indexed documents."""
import uuid,re
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select
from app.db import SessionLocal,session_scope
from app.models import Document,DocumentPage,ExtractionField
from app.repositories.domain import get_owned
from app.security import current_user
from app.services.audit import record
router=APIRouter(prefix="/api/v1/documents/{did}",tags=["documents"])
class Review(BaseModel):fields:dict[str,object]=Field(default_factory=dict)
def _doc(s,did,user):
    d=get_owned(s,Document,did,user["id"])
    if not d:raise HTTPException(404,"Document not found")
    return d
@router.get("/ai-read")
def get_read(did:str,user=Depends(current_user)):
    with SessionLocal() as s:
        _doc(s,did,user);rows=s.scalars(select(ExtractionField).where(ExtractionField.document_id==did,ExtractionField.owner_id==user["id"]).order_by(ExtractionField.created_at)).all()
        fields={r.key:{"value":r.value,"provenance":r.provenance,"source":r.source,"review_required":r.review_required} for r in rows}
        return {"fields":fields,"review_required":any(x["review_required"] for x in fields.values()) if fields else True}
@router.post("/ai-read")
def run_read(did:str,user=Depends(current_user)):
    with SessionLocal() as s:
        d=_doc(s,did,user);pages=s.scalars(select(DocumentPage).where(DocumentPage.document_id==did).order_by(DocumentPage.page_number)).all()
        candidate=None
        for page in pages:
            m=re.search(r".{0,180}(?:arbitration agreement|refer(?:red)? to arbitration|arbitrator).{0,260}",page.text,re.I|re.S)
            if m:candidate={"found":True,"quote":m.group(0).strip(),"page":page.page_number};break
        values={"document_type":d.document_type,"parties":[],"key_dates":[],"contract_references":[],"arbitration_clause":candidate or {"found":False,"quote":None,"page":None},"jurisdiction":d.jurisdiction,"governing_law":None,"key_provisions":[],"possible_legal_issues":[],"summary":(d.text_content[:700] if d.text_content else "")}
    with session_scope() as s:
        _doc(s,did,user)
        for key,value in values.items():s.add(ExtractionField(id=str(uuid.uuid4()),owner_id=user["id"],document_id=did,key=key,value=value,provenance="ai_suggested",source="Local text extraction; candidate only",review_required=True))
        record(s,user["id"],"generate","ai_read",did)
    return {"fields":{k:{"value":v,"provenance":"ai_suggested","source":"Local text extraction; candidate only","review_required":True} for k,v in values.items()},"review_required":True}
@router.patch("/extraction")
def review(did:str,payload:Review,user=Depends(current_user)):
    with session_scope() as s:
        _doc(s,did,user)
        rows=[]
        for key,value in payload.fields.items():
            row=ExtractionField(id=str(uuid.uuid4()),owner_id=user["id"],document_id=did,key=key,value=value,provenance="extracted_reviewed",source="User reviewed",review_required=False);s.add(row);rows.append(row)
        record(s,user["id"],"update","extraction_fields",did,{"fields":list(payload.fields)})
        return {"fields":{r.key:{"value":r.value,"provenance":r.provenance,"source":r.source,"review_required":False} for r in rows},"review_required":False}
