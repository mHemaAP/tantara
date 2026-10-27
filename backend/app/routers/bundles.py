"""PDF bundle preview, assembly, bookmarks, and download."""
import io,uuid
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field,ConfigDict
from sqlalchemy import select
from app.config import get_settings
from app.db import SessionLocal,session_scope
from app.models import FilingBundle,BundleItem,BundleSection,Document,Case
from app.repositories.domain import get_owned,serialize
from app.security import current_user
from app.services.audit import record
router=APIRouter(prefix="/api/v1/bundles",tags=["bundles"])
class Items(BaseModel):items:list[dict]=Field(default_factory=list)
class Sections(BaseModel):sections:list[dict]=Field(default_factory=list)

def _items(s,bundle,user):
    rows=s.scalars(select(BundleItem).where(BundleItem.bundle_id==bundle.id,BundleItem.owner_id==user["id"]).order_by(BundleItem.order)).all();out=[]
    for x in rows:
        d=s.scalar(select(Document).where(Document.id==x.document_id,Document.owner_id==user["id"]))
        if not d:continue
        try:
            from pypdf import PdfReader
            upload_path=Path(d.stored_path).resolve()
            if upload_path.parent!=(get_settings().data_dir/"uploads").resolve():raise ValueError("Unsafe source path")
            pages=len(PdfReader(upload_path).pages)
        except Exception:pages=0
        out.append({"document_id":d.id,"title":d.title,"section":x.section,"order":x.order,"pages":pages})
    return out
@router.put("/{rid}/items")
def set_items(rid:str,payload:Items,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    with session_scope() as s:
        b=get_owned(s,FilingBundle,rid,user["id"])
        if not b:raise HTTPException(404,"Bundle not found")
        incoming=[]
        for i,x in enumerate(payload.items):
            d=s.scalar(select(Document).where(Document.id==x.get("document_id"),Document.owner_id==user["id"],Document.case_id==b.case_id))
            if not d:raise HTTPException(404,"Document not found in this case")
            incoming.append((d,x,i))
        s.query(BundleItem).filter_by(bundle_id=rid,owner_id=user["id"]).delete(synchronize_session=False)
        for d,x,i in incoming:s.add(BundleItem(id=str(uuid.uuid4()),owner_id=user["id"],bundle_id=rid,document_id=d.id,section=x.get("section","Documents"),order=x.get("order",i)))
        b.status="draft";record(s,user["id"],"update","bundle_items",rid)
        return {"items":[{"document_id":d.id,"order":x.get("order",i),"section":x.get("section","Documents")} for d,x,i in incoming]}
@router.put("/{rid}/sections")
def set_sections(rid:str,payload:Sections,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    with session_scope() as s:
        b=get_owned(s,FilingBundle,rid,user["id"])
        if not b:raise HTTPException(404,"Bundle not found")
        s.query(BundleSection).filter_by(bundle_id=rid,owner_id=user["id"]).delete(synchronize_session=False)
        for i,item in enumerate(payload.sections):
            title=item.get("title")
            if not isinstance(title,str) or not title.strip():raise HTTPException(400,"Each bundle section requires a title")
            s.add(BundleSection(id=str(uuid.uuid4()),owner_id=user["id"],bundle_id=rid,title=title.strip(),order=item.get("order",i)))
        b.status="draft";record(s,user["id"],"update","bundle_sections",rid)
        return {"sections":[{"title":x.get("title"),"order":x.get("order",i)} for i,x in enumerate(payload.sections)]}
@router.get("/{rid}/preview")
def preview(rid:str,user=Depends(current_user)):
    from pypdf import PdfReader
    with SessionLocal() as s:
        b=get_owned(s,FilingBundle,rid,user["id"])
        if not b:raise HTTPException(404,"Bundle not found")
        items=_items(s,b,user);settings={"cover_page":True,"index":True,"synopsis":True,"list_of_dates":True,**(b.settings or {})};front=sum(bool(settings.get(k)) for k in ("cover_page","index","synopsis","list_of_dates"));offset=front+1
        sections={};warnings=[]
        for x in items:
            d=s.get(Document,x["document_id"])
            if x["pages"]==0:warnings.append(f"Could not read PDF: {x['title']}");continue
            section=x["section"];entry={"document_id":x["document_id"],"title":x["title"],"start_page":offset,"end_page":offset+x["pages"]-1,"pages":x["pages"]}
            sections.setdefault(section,[]).append(entry);offset+=x["pages"]
        stored=s.scalars(select(BundleSection).where(BundleSection.bundle_id==rid,BundleSection.owner_id==user["id"]).order_by(BundleSection.order)).all()
        section_order={x.title:i for i,x in enumerate(stored)}
        ordered=sorted(sections.items(),key=lambda x:section_order.get(x[0],len(section_order)))
        return {"sections":[{"title":k,"items":v} for k,v in ordered],"total_pages":offset-1,"warnings":warnings}
@router.post("/{rid}/generate",status_code=202)
def generate(rid:str,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    from pypdf import PdfReader,PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    with SessionLocal() as s:
        b=get_owned(s,FilingBundle,rid,user["id"])
        if not b:raise HTTPException(404,"Bundle not found")
        items=_items(s,b,user);settings={"cover_page":True,"index":True,"synopsis":True,"list_of_dates":True,**(b.settings or {})};case=s.get(Case,b.case_id) if b.case_id else None;case_title=case.title if case else "Arbitration Filing"
        docs=[]
        for x in items:
            d=s.get(Document,x["document_id"])
            try:
                upload_path=Path(d.stored_path).resolve()
                if upload_path.parent!=(get_settings().data_dir/"uploads").resolve():continue
                reader=PdfReader(upload_path)
            except Exception:continue
            docs.append((x,reader))
    front=[]
    for key,title in (("cover_page","Cover Page"),("index","Index"),("synopsis","Synopsis"),("list_of_dates","List of Dates")):
        if settings.get(key):
            buf=io.BytesIO();c=canvas.Canvas(buf,pagesize=letter);c.setFont("Helvetica-Bold",18);c.drawString(54,740,title);c.setFont("Helvetica",11);c.drawString(54,710,case_title)
            y=675
            if title=="Index":
                for x,_ in docs:c.drawString(54,y,f"{x['section']} — {x['title']} ({x['pages']} pages)");y-=18
            elif title=="Synopsis":c.drawString(54,y,"Bundle generated from selected case documents. Review the source documents for full context.")
            elif title=="List of Dates":c.drawString(54,y,"Dates should be verified against source documents before filing.")
            c.save();buf.seek(0);front.append((title,PdfReader(buf)))
    writer=PdfWriter();bookmarks=[]
    for title,reader in front:
        page_start=len(writer.pages);writer.append(reader);bookmarks.append((title,page_start))
    section_bookmarks={}
    for item,reader in docs:
        title=item["section"]
        if title not in section_bookmarks:section_bookmarks[title]=len(writer.pages)
        bookmarks.append((item["title"],len(writer.pages)));writer.append(reader)
    # Section bookmarks lead each section and document bookmarks identify originals.
    for title,page in section_bookmarks.items():writer.add_outline_item(title,page)
    for title,page in bookmarks:writer.add_outline_item(title,page)
    output=get_settings().data_dir/"bundles"/f"{rid}.pdf";output.parent.mkdir(parents=True,exist_ok=True)
    with output.open("wb") as f:writer.write(f)
    with session_scope() as s:
        b=get_owned(s,FilingBundle,rid,user["id"]);b.output_path=str(output);b.status="ready";record(s,user["id"],"generate","bundle",rid)
    return {"job_id":str(uuid.uuid4()),"status":"ready","pages":len(writer.pages),"download_url":f"/api/v1/bundles/{rid}/download"}
@router.get("/{rid}/download")
def download(rid:str,user=Depends(current_user)):
    with SessionLocal() as s:b=get_owned(s,FilingBundle,rid,user["id"]);path=b.output_path if b else None
    if not b:raise HTTPException(404,"Bundle not found")
    safe_path=Path(path).resolve() if path else None
    if not safe_path or safe_path.parent!=(get_settings().data_dir/"bundles").resolve() or not safe_path.is_file():raise HTTPException(404,"Bundle has not been generated")
    return FileResponse(safe_path,filename=f"{rid}.pdf",media_type="application/pdf")
