"""TANTARA local-first API wiring. Domain state is persisted through typed ORM models."""
import hashlib, json, logging, mimetypes, os, re, uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from app.config import get_settings
from app.db import init_db, SessionLocal, session_scope
from app.security import current_user, verify_password, hash_password, create_token
from app.models import *
from app.repositories.domain import ENTITY_MODELS, fields_for, serialize, get_owned, list_owned, create as repo_create, update as repo_update
from app.services.audit import record
from app.services.vector_store import store
from app.ingestion import DocumentExtractor, DocumentStorage
from app.chunking import chunk_text
from app.embeddings import embed_documents, embed_query

logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
app=FastAPI(title="TANTARA Local Workspace API",version="1.1.0")
settings=get_settings()
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()],allow_credentials=True,allow_methods=["GET","POST","PATCH","PUT","DELETE","OPTIONS"],allow_headers=["Authorization","Content-Type","Range"],expose_headers=["Content-Range","Accept-Ranges"])
pool=ThreadPoolExecutor(max_workers=2,thread_name_prefix="tantara-ingest")

@app.on_event("startup")
def startup():
    init_db()
    from app.services.index_maintenance import reconcile_index
    state=reconcile_index()
    logging.info("TANTARA started: AI=%s embeddings=%s vector=faiss consistent=%s database=sqlite",get_settings().ai_provider,get_settings().embedding_provider,state["consistent"])
@app.exception_handler(HTTPException)
async def http_error(request,exc):
    code={401:"unauthorized",403:"forbidden",404:"not_found",409:"duplicate",413:"too_large",422:"validation_error",429:"rate_limited",503:"model_unavailable"}.get(exc.status_code,"request_error")
    return JSONResponse(status_code=exc.status_code,content={"error":{"code":code,"message":str(exc.detail)}})
@app.exception_handler(RequestValidationError)
async def validation_error(request,exc):return JSONResponse(status_code=422,content={"error":{"code":"validation_error","message":"Request validation failed","details":exc.errors()}})
@app.exception_handler(IntegrityError)
async def integrity_error(request,exc):return JSONResponse(status_code=409,content={"error":{"code":"conflict","message":"A record conflicts with existing data or violates a domain constraint"}})
@app.get("/health")
@app.get("/api/v1/health")
def health():return {"status":"ok","service":"TANTARA Local Workspace API","version":"1.1.0"}

from app.routers.auth import router as auth_router
from app.routers.meta import router as meta_router
app.include_router(auth_router);app.include_router(meta_router)
from app.routers.drafts import router as drafts_router
app.include_router(drafts_router)
from app.routers.bundles import router as bundles_router
app.include_router(bundles_router)
class Payload(BaseModel):model_config=ConfigDict(extra="allow")
class Ask(Payload):question:str=Field(min_length=3,max_length=8000);top_k:int=Field(5,ge=1,le=30);case_id:str|None=None;collection_id:str|None=None;jurisdiction:str|None=None;document_types:list[str]|None=None

def audit(actor,action,kind,rid):
    with session_scope() as s:record(s,actor["id"],action,kind,rid)
def owned(session,cls,rid,user):
    item=get_owned(session,cls,rid,user["id"])
    if item is None:raise HTTPException(404,"Record not found")
    return item
def paginate(cls, q=None,status=None,case_id=None,page=1,page_size=20,sort="created_at",user=Depends(current_user)):
    with SessionLocal() as s:return list_owned(s,cls,user["id"],q=q,status=status,case_id=case_id,page=page,page_size=page_size,sort=sort)

def install_crud(path,cls, *, allow_delete=True):
    async def listing(q:str|None=None,status:str|None=None,case_id:str|None=None,page:int=Query(1,ge=1),page_size:int=Query(20,ge=1,le=100),sort:str="created_at",user=Depends(current_user)):
        with SessionLocal() as s:return list_owned(s,cls,user["id"],q=q,status=status,case_id=case_id,page=page,page_size=page_size,sort=sort)
    def create(payload:Payload,user=Depends(current_user)):
        data=payload.model_dump(exclude_unset=True);allowed=fields_for(cls)-{"id","created_at","updated_at","owner_id","is_demo"};data={k:v for k,v in data.items() if k in allowed}
        if data.get("case_id"):
            with SessionLocal() as s:owned(s,Case,data["case_id"],user)
        with session_scope() as s:row=repo_create(s,cls,user["id"],data);rid=row.id;out=serialize(row);record(s,user["id"],"create",cls.__tablename__,rid)
        return out
    def get(rid:str,user=Depends(current_user)):
        with SessionLocal() as s:return serialize(owned(s,cls,rid,user))
    def patch(rid:str,payload:Payload,user=Depends(current_user)):
        with session_scope() as s:
            row=owned(s,cls,rid,user);repo_update(s,row,payload.model_dump(exclude_unset=True));record(s,user["id"],"update",cls.__tablename__,rid);out=serialize(row)
        return out
    def delete(rid:str,user=Depends(current_user)):
        with session_scope() as s:
            row=owned(s,cls,rid,user)
            if cls is Case:row.status="archived";out={"deleted":False,"archived":True}
            else:s.delete(row);out={"deleted":True}
            record(s,user["id"],"delete",cls.__tablename__,rid)
        return out
    app.add_api_route("/api/v1/"+path,listing,methods=["GET"],name=path+"_list")
    app.add_api_route("/api/v1/"+path,create,methods=["POST"],name=path+"_create")
    app.add_api_route("/api/v1/"+path+"/{rid}",get,methods=["GET"],name=path+"_get")
    app.add_api_route("/api/v1/"+path+"/{rid}",patch,methods=["PATCH"],name=path+"_patch")
    if allow_delete:app.add_api_route("/api/v1/"+path+"/{rid}",delete,methods=["DELETE"],name=path+"_delete")
for path,cls in ENTITY_MODELS.items():install_crud(path,cls)

@app.get("/api/v1/clients/{cid}/cases")
def client_cases(cid:str,user=Depends(current_user)):
    with SessionLocal() as s:
        owned(s,Client,cid,user);return list_owned(s,Case,user["id"],page=1,page_size=100,extra_filters=(Case.client_id==cid,))
@app.get("/api/v1/cases/{cid}/overview")
def case_overview(cid:str,user=Depends(current_user)):
    with SessionLocal() as s:
        case=owned(s,Case,cid,user);out=serialize(case)
        for key,cls in (("participants",CaseParticipant),("tasks",Task),("hearings",Hearing)):
            out[key]=list_owned(s,cls,user["id"],case_id=cid,page=1,page_size=100)["items"]
        out["documents_count"]=s.scalar(select(func.count(Document.id)).where(Document.owner_id==user["id"],Document.case_id==cid)) or 0
        out["drafts_count"]=s.scalar(select(func.count(Draft.id)).where(Draft.owner_id==user["id"],Draft.case_id==cid)) or 0
        return out

# Case participants and timeline use their own typed tables.
@app.post("/api/v1/cases/{cid}/participants")
def add_participant(cid:str,payload:Payload,user=Depends(current_user)):
    data=payload.model_dump(exclude_unset=True)
    with session_scope() as s:
        owned(s,Case,cid,user);row=repo_create(s,CaseParticipant,user["id"],data,case_id=cid);record(s,user["id"],"create","case_participant",row.id);return serialize(row)
@app.patch("/api/v1/cases/{cid}/participants/{pid}")
def update_participant(cid:str,pid:str,payload:Payload,user=Depends(current_user)):
    with session_scope() as s:
        row=owned(s,CaseParticipant,pid,user)
        if row.case_id!=cid:raise HTTPException(404,"Participant not found")
        repo_update(s,row,payload.model_dump(exclude_unset=True));return serialize(row)
@app.delete("/api/v1/cases/{cid}/participants/{pid}")
def delete_participant(cid:str,pid:str,user=Depends(current_user)):
    with session_scope() as s:
        row=owned(s,CaseParticipant,pid,user)
        if row.case_id!=cid:raise HTTPException(404,"Participant not found")
        s.delete(row);return {"deleted":True}
@app.get("/api/v1/cases/{cid}/events")
def case_events(cid:str,page:int=Query(1,ge=1),page_size:int=Query(20,ge=1,le=100),user=Depends(current_user)):
    with SessionLocal() as s:owned(s,Case,cid,user);return list_owned(s,CaseEvent,user["id"],case_id=cid,page=page,page_size=page_size)
@app.post("/api/v1/cases/{cid}/events")
def add_case_event(cid:str,payload:Payload,user=Depends(current_user)):
    with session_scope() as s:
        owned(s,Case,cid,user);row=repo_create(s,CaseEvent,user["id"],payload.model_dump(exclude_unset=True),case_id=cid);record(s,user["id"],"create","case_event",row.id);return serialize(row)

@app.get("/api/v1/dashboard/summary")
def dashboard(user=Depends(current_user)):
    today=date.today();week=datetime.combine(today+timedelta(days=7),datetime.min.time())
    with SessionLocal() as s:
        cnt=lambda cls,*criteria:s.scalar(select(func.count()).select_from(cls).where(cls.owner_id==user["id"],*criteria)) or 0
        return {"greeting":"Good day","first_name":user["name"].split()[0],"today":today.isoformat(),"active_cases":cnt(Case,Case.status=="active"),"pending_arbitrations":cnt(Case,Case.status=="pending"),"hearings_this_week":cnt(Hearing,Hearing.at>=datetime.combine(today,datetime.min.time()),Hearing.at<week),"documents_processed":cnt(Document,Document.status=="ready"),"drafts_in_progress":cnt(Draft,Draft.status!="done"),"tasks_due":cnt(Task,Task.status!="done",Task.due_at<=week),"tasks_overdue":cnt(Task,Task.status!="done",Task.due_at<datetime.combine(today,datetime.min.time()))}
@app.get("/api/v1/dashboard/activity")
def activity(user=Depends(current_user)):
    with SessionLocal() as s:rows=s.scalars(select(AuditEvent).where(AuditEvent.owner_id==user["id"]).order_by(AuditEvent.created_at.desc()).limit(20)).all()
    return [{"id":r.id,"type":r.action,"actor":user["name"],"title":f"{r.action.title()} {r.object_type}","case_id":None,"at":r.created_at.isoformat()} for r in rows]
@app.get("/api/v1/dashboard/upcoming")
def upcoming(days:int=Query(30,ge=1,le=365),user=Depends(current_user)):
    start=datetime.now();end=start+timedelta(days=days)
    with SessionLocal() as s:
        hs=s.scalars(select(Hearing).where(Hearing.owner_id==user["id"],Hearing.at>=start,Hearing.at<=end)).all();ts=s.scalars(select(Task).where(Task.owner_id==user["id"],Task.due_at>=start,Task.due_at<=end,Task.status!="done")).all()
        out=[{"id":x.id,"type":"hearing","title":x.title,"case_id":x.case_id,"case_title":None,"at":x.at.isoformat(),"due_in_days":(x.at.date()-date.today()).days} for x in hs]+[{"id":x.id,"type":"deadline","title":x.title,"case_id":x.case_id,"case_title":None,"at":x.due_at.isoformat(),"due_in_days":(x.due_at.date()-date.today()).days} for x in ts if x.due_at]
    return sorted(out,key=lambda x:x["at"])
@app.get("/api/v1/calendar")
def calendar(from_:datetime|None=Query(None,alias="from"),to:datetime|None=None,user=Depends(current_user)):
    start=from_ or datetime.min;end=to or datetime.max
    with SessionLocal() as s:
        hs=s.scalars(select(Hearing).where(Hearing.owner_id==user["id"],Hearing.at>=start,Hearing.at<=end)).all();tasks=s.scalars(select(Task).where(Task.owner_id==user["id"],Task.due_at>=start,Task.due_at<=end)).all()
    return sorted([{"id":x.id,"type":"hearing","title":x.title,"case_id":x.case_id,"at":x.at.isoformat()} for x in hs]+[{"id":x.id,"type":"deadline","title":x.title,"case_id":x.case_id,"at":x.due_at.isoformat()} for x in tasks if x.due_at],key=lambda x:x["at"])

# Background ingestion keeps request handling short and persists every job step.
INDEX_LOCK=__import__("threading").RLock()
def _job_update(job_id,**values):
    with session_scope() as s:
        job=s.get(IngestionJob,job_id)
        if job:
            for k,v in values.items():setattr(job,k,v)
def process_job(doc_id,job_id,owner_id,data,filename):
    try:
        _job_update(job_id,status="extracting",progress=10,steps=[{"key":"extract","label":"Extracting pages","state":"active"}])
        pages,warnings=DocumentExtractor().extract(filename,data);all_text="\n".join(p["text"] for p in pages)
        if not all_text.strip():raise ValueError("No text could be extracted")
        chunks=[];offset=0
        for p in pages:
            for ch in chunk_text(p["text"],get_settings().chunk_size_chars,get_settings().chunk_overlap_chars):chunks.append({**ch,"page_number":p["page_number"],"start_char":ch["start_char"]+offset,"end_char":ch["end_char"]+offset})
            offset+=len(p["text"])+1
        vectors=embed_documents([x["content"] for x in chunks]);_job_update(job_id,status="indexing",progress=75,steps=[{"key":"extract","label":"Extracting pages","state":"complete"},{"key":"embed","label":"Creating local embeddings","state":"complete"},{"key":"index","label":"Writing search index","state":"active"}])
        indexed=[]
        with session_scope() as s:
            doc=s.get(Document,doc_id);doc.text_content=all_text;doc.page_count=len(pages);doc.warnings=warnings;doc.status="ready"
            for p in pages:s.add(DocumentPage(id=str(uuid.uuid4()),owner_id=owner_id,document_id=doc_id,page_number=p["page_number"],text=p["text"],ocr_confidence=p.get("ocr_confidence"),warnings=[]))
            for ix,(ch,vec) in enumerate(zip(chunks,vectors)):
                row=DocumentChunk(id=str(uuid.uuid4()),document_id=doc_id,chunk_index=ix,content=ch["content"],page_number=ch["page_number"],start_char=ch["start_char"],end_char=ch["end_char"],embedding_blob=__import__("numpy").asarray(vec,dtype="float32").tobytes())
                s.add(row);indexed.append((row.id,vec))
        with INDEX_LOCK:store().add(indexed)
        _job_update(job_id,status="ready",progress=100,steps=[{"key":"extract","label":"Extracting pages","state":"complete"},{"key":"embed","label":"Creating local embeddings","state":"complete"},{"key":"index","label":"Writing search index","state":"complete"}],warnings=warnings,pages=len(pages),chars=len(all_text),error=None)
    except Exception as exc:
        logging.warning("Document processing failed (%s)",type(exc).__name__)
        with SessionLocal() as s:doc=s.get(Document,doc_id);doc.status="failed" if doc else "failed"
        _job_update(job_id,status="failed",progress=0,error=f"{type(exc).__name__}: processing failed",warnings=[])

@app.post("/api/v1/documents/upload",status_code=202)
async def upload(file:UploadFile=File(...),title:str|None=Form(None),document_type:str|None=Form(None),jurisdiction:str|None=Form(None),case_id:str|None=Form(None),user=Depends(current_user)):
    filename=Path(file.filename or "upload").name;ext=Path(filename).suffix.lower()
    if ext not in {".pdf",".docx",".txt",".md"}:raise HTTPException(400,"Unsupported document type")
    data=await file.read(get_settings().max_upload_mb*1024*1024+1)
    if len(data)>get_settings().max_upload_mb*1024*1024:raise HTTPException(413,"File too large")
    if not data or (ext==".pdf" and not data.startswith(b"%PDF")) or (ext==".docx" and not data.startswith(b"PK")):raise HTTPException(400,"File content does not match its extension")
    if case_id:
        with SessionLocal() as s:owned(s,Case,case_id,user)
    digest=hashlib.sha256(data).hexdigest()
    with SessionLocal() as s:old=s.scalar(select(Document).where(Document.owner_id==user["id"],Document.content_hash==digest))
    if old:raise HTTPException(409,"Duplicate document",headers={"X-Existing-Document":old.id})
    did,jid=str(uuid.uuid4()),str(uuid.uuid4());path=DocumentStorage().save(data)
    with session_scope() as s:
        doc=Document(id=did,owner_id=user["id"],case_id=case_id,title=title or filename,document_type=document_type or "Other",jurisdiction=jurisdiction or "India",filename=filename,stored_path=path,content_hash=digest,status="queued")
        job=IngestionJob(id=jid,owner_id=user["id"],document_id=did,status="queued",progress=0,steps=[],warnings=[])
        s.add_all([doc,job]);record(s,user["id"],"create","document",did)
    pool.submit(process_job,did,jid,user["id"],data,filename)
    return {"document_id":did,"job_id":jid,"status":"queued","duplicate":False,"document":{"id":did,"title":title or filename,"status":"queued"}}

@app.get("/api/v1/documents")
def documents(q:str|None=None,status:str|None=None,type:str|None=None,case_id:str|None=None,page:int=Query(1,ge=1),page_size:int=Query(20,ge=1,le=100),sort:str="-created_at",user=Depends(current_user)):
    from sqlalchemy import or_
    with SessionLocal() as s:
        stmt=select(Document).where(Document.owner_id==user["id"])
        if q:stmt=stmt.where(Document.title.ilike(f"%{q}%"))
        if status:stmt=stmt.where(Document.status==status)
        if type:stmt=stmt.where(Document.document_type==type)
        if case_id:stmt=stmt.where(Document.case_id==case_id)
        total=s.scalar(select(func.count()).select_from(stmt.subquery())) or 0;rows=s.scalars(stmt.order_by(Document.created_at.desc()).offset((page-1)*page_size).limit(page_size)).all()
        return {"items":[{k:v for k,v in serialize(x).items() if k not in {"stored_path","text_content"}} for x in rows],"total":total,"page":page,"page_size":page_size,"pages":(total+page_size-1)//page_size}
def get_document(did,user):
    with SessionLocal() as s:return owned(s,Document,did,user)
@app.get("/api/v1/documents/{did}")
def document(did:str,user=Depends(current_user)):
    with SessionLocal() as s:d=owned(s,Document,did,user);out=serialize(d);out.pop("stored_path");out.pop("text_content");return out
@app.patch("/api/v1/documents/{did}")
def patch_document(did:str,payload:Payload,user=Depends(current_user)):
    with session_scope() as s:
        d=owned(s,Document,did,user);repo_update(s,d,payload.model_dump(exclude_unset=True));record(s,user["id"],"update","document",did);out=serialize(d);out.pop("stored_path");out.pop("text_content");return out
@app.delete("/api/v1/documents/{did}")
def delete_document(did:str,user=Depends(current_user)):
    with session_scope() as s:d=owned(s,Document,did,user);path=d.stored_path;chunk_ids=list(s.scalars(select(DocumentChunk.id).where(DocumentChunk.document_id==did)));s.delete(d);record(s,user["id"],"delete","document",did)
    with INDEX_LOCK:store().remove(chunk_ids)
    if path and Path(path).parent==(get_settings().data_dir/"uploads").resolve():Path(path).unlink(missing_ok=True)
    return {"deleted":True}
@app.get("/api/v1/documents/{did}/job")
def doc_job(did:str,user=Depends(current_user)):
    with SessionLocal() as s:
        owned(s,Document,did,user);j=s.scalar(select(IngestionJob).where(IngestionJob.document_id==did,IngestionJob.owner_id==user["id"]).order_by(IngestionJob.created_at.desc()))
        if not j:raise HTTPException(404,"Job not found")
        return {k:getattr(j,k) for k in ("status","progress","steps","warnings","pages","chars","error")}
@app.post("/api/v1/documents/{did}/retry",status_code=202)
def retry_doc(did:str,user=Depends(current_user)):
    with session_scope() as s:
        d=owned(s,Document,did,user)
        if not Path(d.stored_path).exists():raise HTTPException(404,"Stored upload is unavailable")
        data=Path(d.stored_path).read_bytes();jid=str(uuid.uuid4());d.status="queued";s.add(IngestionJob(id=jid,owner_id=user["id"],document_id=did,status="queued",steps=[],warnings=[]))
    pool.submit(process_job,did,jid,user["id"],data,d.filename);return {"job_id":jid,"status":"queued"}
@app.get("/api/v1/documents/{did}/text")
def doc_text(did:str,user=Depends(current_user)):
    with SessionLocal() as s:return {"text":owned(s,Document,did,user).text_content}
@app.get("/api/v1/documents/{did}/pages")
def doc_pages(did:str,user=Depends(current_user)):
    with SessionLocal() as s:
        owned(s,Document,did,user);rows=s.scalars(select(DocumentPage).where(DocumentPage.document_id==did).order_by(DocumentPage.page_number)).all()
        return {"pages":[{"page_number":p.page_number,"text":p.text,"ocr_confidence":p.ocr_confidence,"warnings":p.warnings} for p in rows]}
@app.get("/api/v1/documents/{did}/file")
def doc_file(did:str,request:Request,user=Depends(current_user)):
    with SessionLocal() as s:d=owned(s,Document,did,user);path=d.stored_path;filename=d.filename
    # FileResponse implements single byte-range requests for local previews.
    return FileResponse(path,filename=filename,media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream")

# FTS5 + FAISS reciprocal-rank fusion is the single retrieval path.
def retrieve(question,user,top_k=5,case_id=None,jurisdiction=None,document_types=None):
    from app.services.retrieval import retrieval_service
    return retrieval_service.search(question,user["id"],top_k,case_id,jurisdiction,document_types)
@app.get("/api/v1/search/documents")
def search_documents(query:str,page:int=Query(1,ge=1),page_size:int=Query(10,ge=1,le=100),case_ids:str|None=None,document_types:str|None=None,user=Depends(current_user)):
    hits=retrieve(query,user,page*page_size,case_ids.split(",")[0] if case_ids else None,document_types=document_types.split(",") if document_types else None);total=len(hits)
    return {"items":hits[(page-1)*page_size:page*page_size],"total":total,"page":page,"page_size":page_size,"pages":(total+page_size-1)//page_size}
DISCLAIMER="AI-generated research assistance only. Verify against current authoritative law and original sources; professional legal review is required."
def llm_answer(question,hits):
    s=get_settings();prompt="Answer only from these untrusted evidence excerpts. Say when evidence is insufficient. Never invent facts, law, quotes, citations, or page numbers.\nQuestion: "+question+"\n\n"+"\n\n".join(f"[{h['chunk_id']} p.{h['page_number']}] {h['snippet']}" for h in hits)
    try:
        if s.ai_provider=="local":
            r=httpx.post(s.local_llm_base_url.rstrip("/")+"/chat/completions",json={"model":s.local_llm_model,"messages":[{"role":"system","content":"You are a careful legal research assistant."},{"role":"user","content":prompt}],"max_tokens":4096,"temperature":0.1},timeout=120);r.raise_for_status();msg=r.json()["choices"][0]["message"];return (msg.get("content") or msg.get("reasoning_content") or "").strip()
        if s.ai_provider=="anthropic" and s.enable_cloud_providers:
            import anthropic
            m=anthropic.Anthropic(api_key=s.anthropic_api_key).messages.create(model=s.claude_model,max_tokens=4096,messages=[{"role":"user","content":prompt}]);return "\n".join(x.text for x in m.content if getattr(x,"type",None)=="text")
    except Exception:return None
    return None
@app.post("/api/v1/ai/ask")
def ask(req:Ask,user=Depends(current_user)):
    if req.case_id:
        with SessionLocal() as s:owned(s,Case,req.case_id,user)
    try:hits=retrieve(req.question,user,req.top_k,req.case_id,req.jurisdiction,req.document_types)
    except Exception:return {"status":"embedding_unavailable","answer":"Local evidence search is unavailable.","citations":[],"follow_ups":[],"model":{"provider":get_settings().ai_provider,"model":get_settings().local_llm_model},"disclaimer":DISCLAIMER,"research_session_id":None,"message_id":None}
    sid,mid=str(uuid.uuid4()),str(uuid.uuid4())
    if not hits:answer="There is insufficient evidence in the indexed documents to answer this question.";status="no_evidence"
    else:answer=llm_answer(req.question,hits);status="ok" if answer else "model_unavailable";answer=answer or "Relevant documents were found, but the configured language model is unavailable."
    citations=[{"citation_ref":f"[{h['chunk_id']}]","document_id":h["document_id"],"document_title":h["document_title"],"chunk_id":h["chunk_id"],"page_number":h["page_number"],"excerpt":h["snippet"],"retreival_score":h["score"],"source_type":h["source_type"],"jurisdiction":h["jurisdiction"]} for h in hits] if status=="ok" else []
    with session_scope() as s:
        s.add(ResearchSession(id=sid,owner_id=user["id"],title=req.question[:120],case_id=req.case_id));s.add(ResearchMessage(id=mid,owner_id=user["id"],session_id=sid,role="assistant",content=answer,status=status,model={"provider":get_settings().ai_provider,"model":get_settings().local_llm_model}))
        for c in citations:s.add(Citation(id=str(uuid.uuid4()),owner_id=user["id"],message_id=mid,document_id=c["document_id"],chunk_id=c["chunk_id"],page_number=c["page_number"],excerpt=c["excerpt"],retrieval_score=c["retreival_score"]))
        record(s,user["id"],"generate","ai_answer",mid)
    return {"status":status,"answer":answer,"citations":citations,"follow_ups":[],"model":{"provider":get_settings().ai_provider,"model":get_settings().local_llm_model},"disclaimer":DISCLAIMER,"research_session_id":sid,"message_id":mid}
@app.get("/api/v1/ai/status")
def ai_status(user=Depends(current_user)):
    s=get_settings();start=__import__("time").monotonic()
    try:r=httpx.get(s.local_llm_base_url.rstrip("/")+"/models",timeout=2);reachable=r.is_success
    except Exception:reachable=False
    with SessionLocal() as db:n=db.scalar(select(func.count(DocumentChunk.id))) or 0
    vectors=store().count()
    return {"llm":{"provider":s.ai_provider,"base_url":s.local_llm_base_url,"model":s.local_llm_model,"reachable":reachable,"latency_ms":round((__import__("time").monotonic()-start)*1000)},"embeddings":{"provider":s.embedding_provider,"model":s.fastembed_model,"dims":s.embedding_dimensions,"ready":True},"vector":{"backend":"faiss","chunks":n,"vectors":vectors,"consistent":n==vectors}}
@app.get("/api/v1/settings/embeddings")
def settings_embeddings(user=Depends(current_user)):return ai_status(user)["vector"]|{"provider":get_settings().embedding_provider,"model":get_settings().fastembed_model,"dimensions":get_settings().embedding_dimensions}

# Legacy root adapters retain their API names.
@app.post("/ingest/file")
async def legacy_ingest(file:UploadFile=File(...),title:str=Form(...),document_type:str=Form("template"),jurisdiction:str=Form("India"),source_label:str|None=Form(None),user=Depends(current_user)):
    return await upload(file,title,document_type,jurisdiction,None,user)
@app.post("/query")
def legacy_query(req:Ask,user=Depends(current_user)):return ask(req,user)
