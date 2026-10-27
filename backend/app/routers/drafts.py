"""Grounded draft generation, version history, and real export endpoints."""
import io,uuid
from fastapi import APIRouter,Depends,HTTPException,Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select,func
from app.db import SessionLocal,session_scope
from app.models import Draft,DraftVersion,Case,Document,DocumentChunk
from app.repositories.domain import get_owned,serialize
from app.security import current_user
from app.services.audit import record
router=APIRouter(prefix="/api/v1",tags=["drafts"])
TEMPLATES=["Statement of Claim","Statement of Defence","Rejoinder","Notice Invoking Arbitration","Request for Arbitration","Procedural Application","Interim Relief Application","Written Submissions","Chronology of Events","List of Dates","Case Summary","Legal Research Memorandum"]
class Generate(BaseModel):model_config=ConfigDict(extra="forbid");case_id:str;document_type:str;template_id:str|None=None;instructions:str="";source_document_ids:list[str]=Field(default_factory=list);language:str="English"
class VersionBody(BaseModel):content_markdown:str;change_note:str|None=None
class SectionBody(BaseModel):section_heading:str;instructions:str=""
@router.get("/draft-templates")
def templates(user=Depends(current_user)):return {"items":[{"id":str(i+1),"name":name,"document_type":name} for i,name in enumerate(TEMPLATES)]}
@router.get("/drafts/{rid}/versions")
def versions(rid:str,user=Depends(current_user)):
    with SessionLocal() as s:
        if not get_owned(s,Draft,rid,user["id"]):raise HTTPException(404,"Draft not found")
        rows=s.scalars(select(DraftVersion).where(DraftVersion.draft_id==rid,DraftVersion.owner_id==user["id"]).order_by(DraftVersion.version_number)).all()
        return {"items":[serialize(x) for x in rows]}
@router.post("/drafts/{rid}/versions")
def save_version(rid:str,payload:VersionBody,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    with session_scope() as s:
        draft=get_owned(s,Draft,rid,user["id"])
        if not draft:raise HTTPException(404,"Draft not found")
        num=(s.scalar(select(func.max(DraftVersion.version_number)).where(DraftVersion.draft_id==rid)) or 0)+1
        row=DraftVersion(id=str(uuid.uuid4()),owner_id=user["id"],draft_id=rid,version_number=num,content_markdown=payload.content_markdown,change_note=payload.change_note)
        draft.content_markdown=payload.content_markdown;s.add(row);record(s,user["id"],"create","draft_version",row.id);return serialize(row)
@router.post("/drafts/generate")
def generate(payload:Generate,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    with SessionLocal() as s:
        case=get_owned(s,Case,payload.case_id,user["id"])
        if not case:raise HTTPException(404,"Case not found")
        docs=s.scalars(select(Document).where(Document.owner_id==user["id"],Document.case_id==case.id,Document.status=="ready")).all()
        if payload.source_document_ids:
            selected=set(payload.source_document_ids);docs=[d for d in docs if d.id in selected]
            if len(docs)!=len(selected):raise HTTPException(404,"One or more source documents not found")
        evidence=bool(docs);title=payload.document_type
        content=f"# {title}\n\n**Case:** {case.title}\n\n## Parties\n\n{case.claimant or '[REVIEW: claimant not verified]'} v. {case.respondent or '[REVIEW: respondent not verified]'}\n\n## Background\n\n[REVIEW: Add a verified chronology from case records and cited documents.]\n\n## Submissions\n\n[REVIEW: Add arguments supported by verified authorities and evidence.]\n\n## Relief sought\n\n[REVIEW: Confirm requested relief with counsel.]\n"
        if not evidence:content=content.replace("[REVIEW: Add a verified chronology from case records and cited documents.]","[REVIEW: No indexed case documents were available; add verified chronology and citations.]")
    did,vid=str(uuid.uuid4()),str(uuid.uuid4())
    with session_scope() as s:
        d=Draft(id=did,owner_id=user["id"],case_id=payload.case_id,title=title,document_type=title,status="draft",content_markdown=content,template_id=payload.template_id);s.add(d)
        s.add(DraftVersion(id=vid,owner_id=user["id"],draft_id=did,version_number=1,content_markdown=content,change_note="Generated outline"));record(s,user["id"],"generate","draft",did)
    markers=[line.strip() for line in content.splitlines() if "[REVIEW:" in line]
    return {"draft_id":did,"version_id":vid,"content_markdown":content,"warnings":["Draft requires legal review; verify facts, law, and citations."],"review_markers":markers}
@router.post("/drafts/{rid}/regenerate-section")
def regenerate(rid:str,payload:SectionBody,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    # A new marked section version preserves the preceding version unchanged.
    with SessionLocal() as s:d=get_owned(s,Draft,rid,user["id"])
    if not d:raise HTTPException(404,"Draft not found")
    content=d.content_markdown+f"\n\n## {payload.section_heading}\n\n[REVIEW: Replace with verified material. {payload.instructions}]\n"
    with session_scope() as s:
        draft=get_owned(s,Draft,rid,user["id"]);num=(s.scalar(select(func.max(DraftVersion.version_number)).where(DraftVersion.draft_id==rid)) or 0)+1
        row=DraftVersion(id=str(uuid.uuid4()),owner_id=user["id"],draft_id=rid,version_number=num,content_markdown=content,change_note=f"Regenerated section: {payload.section_heading}");draft.content_markdown=content;s.add(row);record(s,user["id"],"generate","draft_section",row.id);return {"id":row.id,"version_number":num,"content_markdown":content,"review_required":True}
@router.get("/drafts/{rid}/export")
def export(rid:str,format:str=Query("docx",pattern="^(docx|pdf)$"),user=Depends(current_user)):
    with SessionLocal() as s:d=get_owned(s,Draft,rid,user["id"])
    if not d:raise HTTPException(404,"Draft not found")
    output=io.BytesIO()
    if format=="docx":
        from docx import Document as WordDoc
        doc=WordDoc()
        for line in d.content_markdown.splitlines():doc.add_paragraph(line)
        doc.save(output);media="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
        c=canvas.Canvas(output,pagesize=letter);y=740
        for line in d.content_markdown.splitlines():
            c.drawString(48,y,line[:110]);y-=15
            if y<48:c.showPage();y=740
        c.save();media="application/pdf"
    output.seek(0);return StreamingResponse(output,media_type=media,headers={"Content-Disposition":f'attachment; filename="{rid}.{format}"'})
