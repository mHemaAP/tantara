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
from fastapi.encoders import jsonable_encoder
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
_RATE_BUCKETS={};_RATE_LOCK=__import__("threading").Lock()
@app.middleware("http")
async def route_rate_limit(request:Request,call_next):
    if request.url.path in {"/health","/api/v1/health"}:return await call_next(request)
    key=(request.client.host if request.client else "local",request.url.path,int(__import__("time").time()//60))
    limit=20 if request.url.path.endswith("/documents/upload") else 300
    with _RATE_LOCK:
        count=_RATE_BUCKETS.get(key,0)+1;_RATE_BUCKETS[key]=count
        if len(_RATE_BUCKETS)>5000:
            minute=int(__import__("time").time()//60)
            for bucket in list(_RATE_BUCKETS):
                if bucket[2]<minute-1:_RATE_BUCKETS.pop(bucket,None)
    if count>limit:return JSONResponse(status_code=429,content={"error":{"code":"rate_limited","message":"Request rate limit exceeded"}})
    return await call_next(request)


@app.on_event("startup")
def startup():
    init_db()
    from app.services.index_maintenance import reconcile_index
    state=reconcile_index()
    logging.info("TANTARA started: AI=%s embeddings=%s vector=faiss consistent=%s database=sqlite",get_settings().ai_provider,get_settings().embedding_provider,state["consistent"])
@app.exception_handler(HTTPException)
async def http_error(request,exc):
    code={401:"unauthorized",403:"forbidden",404:"not_found",409:"duplicate",413:"too_large",422:"validation_error",429:"rate_limited",503:"model_unavailable"}.get(exc.status_code,"request_error")
    detail=exc.detail
    if isinstance(detail,dict):
        message=detail.get("message","Request failed");extra={k:v for k,v in detail.items() if k!="message"}
    else:message=str(detail);extra={}
    error={"code":code,"message":message}
    if extra:error["details"]=extra
    return JSONResponse(status_code=exc.status_code,content={"error":error})
@app.exception_handler(RequestValidationError)
async def validation_error(request,exc):return JSONResponse(status_code=422,content={"error":{"code":"validation_error","message":"Request validation failed","details":jsonable_encoder(exc.errors())}})
@app.exception_handler(IntegrityError)
async def integrity_error(request,exc):
    message=str(getattr(exc,"orig",exc))
    if "UNIQUE constraint failed" in message or "unique constraint" in message.lower():
        return JSONResponse(status_code=409,content={"error":{"code":"duplicate","message":"A record with these values already exists"}})
    return JSONResponse(status_code=400,content={"error":{"code":"validation_error","message":"A domain constraint was not satisfied"}})
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
from app.routers.settings import router as settings_router
app.include_router(settings_router)
from app.routers.community import router as community_router
app.include_router(community_router)
from app.routers.strategy import router as strategy_router
app.include_router(strategy_router)
from app.routers.documents import router as document_review_router
app.include_router(document_review_router)
from app.routers.ai import router as ai_router
app.include_router(ai_router)
from app.routers.search import router as search_router
app.include_router(search_router)
class Payload(BaseModel):model_config=ConfigDict(extra="allow")
class Ask(Payload):question:str=Field(min_length=3,max_length=8000);top_k:int=Field(5,ge=1,le=30);case_id:str|None=None;collection_id:str|None=None;jurisdiction:str|None=None;document_types:list[str]|None=None

def audit(actor,action,kind,rid):
    with session_scope() as s:record(s,actor["id"],action,kind,rid)
from app.routers.domain import router as domain_router,owned
app.include_router(domain_router)
from app.routers.cases import router as cases_router
app.include_router(cases_router)
from app.routers.dashboard import router as dashboard_router
app.include_router(dashboard_router)

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
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    filename=Path(file.filename or "upload").name;ext=Path(filename).suffix.lower()
    if ext not in {".pdf",".docx",".txt",".md"}:raise HTTPException(400,"Unsupported document type")
    data=await file.read(get_settings().max_upload_mb*1024*1024+1)
    if len(data)>get_settings().max_upload_mb*1024*1024:raise HTTPException(413,"File too large")
    if not data:raise HTTPException(400,"Uploaded file is empty")
    if ext==".pdf" and not data.startswith(b"%PDF"):raise HTTPException(400,"File content does not match its extension")
    if ext==".docx":
        try:
            import zipfile,io
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "[Content_Types].xml" not in z.namelist() or "word/document.xml" not in z.namelist():raise ValueError()
        except Exception:raise HTTPException(400,"File content does not match its extension")
    if ext in {".txt",".md"}:
        try:
            if b"\x00" in data:raise UnicodeDecodeError("utf8",data,0,1,"NUL")
            data.decode("utf-8")
        except UnicodeDecodeError:raise HTTPException(400,"Text document must be valid UTF-8")
    filename="".join(ch for ch in filename if ch.isprintable())[:200] or "upload" 
    if case_id:
        with SessionLocal() as s:owned(s,Case,case_id,user)
    digest=hashlib.sha256(data).hexdigest()
    with SessionLocal() as s:old=s.scalar(select(Document).where(Document.owner_id==user["id"],Document.content_hash==digest))
    if old:raise HTTPException(409,{"message":"Duplicate document","existing_document":{"id":old.id,"title":old.title}})
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
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
    values=payload.model_dump(exclude_unset=True)
    if values.get("case_id"):
        with SessionLocal() as s:owned(s,Case,values["case_id"],user)
    with session_scope() as s:
        d=owned(s,Document,did,user);repo_update(s,d,values);record(s,user["id"],"update","document",did);out=serialize(d);out.pop("stored_path");out.pop("text_content");return out
@app.delete("/api/v1/documents/{did}")
def delete_document(did:str,user=Depends(current_user)):
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
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
    if user.get("role")=="researcher":raise HTTPException(403,"This role is read-only")
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
        s.add(ResearchSession(id=sid,owner_id=user["id"],title=req.question[:120],case_id=req.case_id));s.flush();s.add(ResearchMessage(id=mid,owner_id=user["id"],session_id=sid,role="assistant",content=answer,status=status,model={"provider":get_settings().ai_provider,"model":get_settings().local_llm_model}));s.flush()
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
