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
from app.routers.documents import router as document_router,upload as document_upload
app.include_router(document_router)
from app.routers.ai import router as ai_router
app.include_router(ai_router)
from app.routers.search import router as search_router
app.include_router(search_router)
class Payload(BaseModel):model_config=ConfigDict(extra="allow")
class Ask(Payload):question:str=Field(min_length=3,max_length=8000);top_k:int=Field(5,ge=1,le=30);case_id:str|None=None;collection_id:str|None=None;jurisdiction:str|None=None;document_types:list[str]|None=None;session_id:str|None=None

def audit(actor,action,kind,rid):
    with session_scope() as s:record(s,actor["id"],action,kind,rid)
from app.routers.domain import router as domain_router,owned
app.include_router(domain_router)
from app.routers.cases import router as cases_router
app.include_router(cases_router)
from app.routers.dashboard import router as dashboard_router
app.include_router(dashboard_router)

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
    if req.session_id:
        with SessionLocal() as s:
            if not s.scalar(select(ResearchSession).where(ResearchSession.id==req.session_id,ResearchSession.owner_id==user["id"])):raise HTTPException(404,"Research session not found")
    try:hits=retrieve(req.question,user,req.top_k,req.case_id,req.jurisdiction,req.document_types)
    except Exception:return {"status":"embedding_unavailable","answer":"Local evidence search is unavailable.","citations":[],"follow_ups":[],"model":{"provider":get_settings().ai_provider,"model":get_settings().local_llm_model},"disclaimer":DISCLAIMER,"research_session_id":None,"message_id":None}
    sid,mid=req.session_id or str(uuid.uuid4()),str(uuid.uuid4())
    if not hits:answer="There is insufficient evidence in the indexed documents to answer this question.";status="no_evidence"
    else:answer=llm_answer(req.question,hits);status="ok" if answer else "model_unavailable";answer=answer or "Relevant documents were found, but the configured language model is unavailable."
    citations=[{"citation_ref":f"[{h['chunk_id']}]","document_id":h["document_id"],"document_title":h["document_title"],"chunk_id":h["chunk_id"],"page_number":h["page_number"],"excerpt":h["snippet"],"retreival_score":h["score"],"source_type":h["source_type"],"jurisdiction":h["jurisdiction"]} for h in hits] if status=="ok" else []
    with session_scope() as s:
        if req.session_id is None:s.add(ResearchSession(id=sid,owner_id=user["id"],title=req.question[:120],case_id=req.case_id));s.flush()
        s.add(ResearchMessage(id=str(uuid.uuid4()),owner_id=user["id"],session_id=sid,role="user",content=req.question,status=None,model={}));s.flush()
        s.add(ResearchMessage(id=mid,owner_id=user["id"],session_id=sid,role="assistant",content=answer,status=status,model={"provider":get_settings().ai_provider,"model":get_settings().local_llm_model}));s.flush()
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
    return await document_upload(file,title,document_type,jurisdiction,None,user)
@app.post("/query")
def legacy_query(req:Ask,user=Depends(current_user)):return ask(req,user)
