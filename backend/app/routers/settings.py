"""Local workspace profile, preferences, database operations, and audit views."""
import shutil,uuid
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict
from sqlalchemy import select,func
from app.config import get_settings
from app.db import SessionLocal,session_scope
from app.models import User,AppPreference,AuditEvent,Client,Case,Document,DocumentChunk,Draft,Task
from app.security import current_user,hash_password
from app.services.audit import record
router=APIRouter(prefix="/api/v1/settings",tags=["settings"])
class Payload(BaseModel):model_config=ConfigDict(extra="allow")
@router.get("/profile")
def profile(user=Depends(current_user)):return user
@router.patch("/profile")
def profile_patch(payload:Payload,user=Depends(current_user)):
    vals=payload.model_dump(exclude_unset=True);vals={k:v for k,v in vals.items() if k in {"name","title","avatar_initials"}}
    with session_scope() as s:
        u=s.get(User,user["id"])
        for k,v in vals.items():setattr(u,k,v)
        record(s,user["id"],"update","profile",u.id)
        return {**user,**vals}
def _get(s,owner,key,default):
    row=s.scalar(select(AppPreference).where(AppPreference.owner_id==owner,AppPreference.key==key))
    return row.value if row else default
def _set(s,owner,key,value):
    row=s.scalar(select(AppPreference).where(AppPreference.owner_id==owner,AppPreference.key==key))
    if row:row.value=value
    else:s.add(AppPreference(id=str(uuid.uuid4()),owner_id=owner,key=key,value=value))
    return value
@router.get("/workspace")
def workspace(user=Depends(current_user)):
    with SessionLocal() as s:return _get(s,user["id"],"workspace",{"name":"TANTARA Local Workspace"})
@router.patch("/workspace")
def workspace_patch(payload:Payload,user=Depends(current_user)):
    with session_scope() as s:value=_set(s,user["id"],"workspace",payload.model_dump());record(s,user["id"],"update","workspace",user["id"]);return value
@router.get("/appearance")
def appearance(user=Depends(current_user)):
    with SessionLocal() as s:return _get(s,user["id"],"appearance",{"theme":"light"})
@router.patch("/appearance")
def appearance_patch(payload:Payload,user=Depends(current_user)):
    with session_scope() as s:return _set(s,user["id"],"appearance",payload.model_dump())
@router.get("/ai")
def ai_settings(user=Depends(current_user)):
    s=get_settings();default={"base_url":s.local_llm_base_url,"model":s.local_llm_model,"top_k":s.default_top_k,"temperature":0.1}
    with SessionLocal() as db:return _get(db,user["id"],"ai",default)
@router.patch("/ai")
def ai_settings_patch(payload:Payload,user=Depends(current_user)):
    values=payload.model_dump();allowed={"base_url","model","top_k","temperature"}
    if set(values)-allowed:raise HTTPException(400,"Unsupported AI setting")
    with session_scope() as s:return _set(s,user["id"],"ai",values)
@router.get("/database")
def database(user=Depends(current_user)):return {"backend":"sqlite","path":"backend/data/tantara.db","journal_mode":"WAL"}
@router.get("/database/stats")
def db_stats(user=Depends(current_user)):
    with SessionLocal() as s:return {name:s.scalar(select(func.count()).select_from(cls).where(cls.owner_id==user["id"])) or 0 for name,cls in (("clients",Client),("cases",Case),("documents",Document),("document_chunks",DocumentChunk),("drafts",Draft),("tasks",Task))}
@router.post("/database/backup")
def backup(user=Depends(current_user)):
    src=get_settings().data_dir/"tantara.db"
    if not src.exists():raise HTTPException(404,"Database not initialized")
    dest=get_settings().data_dir/f"backup-{datetime.utcnow():%Y%m%d%H%M%S}.db";shutil.copy2(src,dest)
    return {"path":dest.name,"bytes":dest.stat().st_size}
@router.get("/security")
def security(page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=100),user=Depends(current_user)):
    with SessionLocal() as s:
        stmt=select(AuditEvent).where(AuditEvent.owner_id==user["id"]);total=s.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows=s.scalars(stmt.order_by(AuditEvent.created_at.desc()).offset((page-1)*page_size).limit(page_size)).all()
        return {"items":[{"id":x.id,"action":x.action,"object_type":x.object_type,"object_id":x.object_id,"at":x.created_at.isoformat()} for x in rows],"total":total,"page":page,"page_size":page_size,"pages":(total+page_size-1)//page_size}
class Password(BaseModel):current_password:str;new_password:str
@router.post("/password")
def password(payload:Password,user=Depends(current_user)):
    with session_scope() as s:
        u=s.get(User,user["id"])
        from app.security import verify_password
        if not verify_password(payload.current_password,u.password_hash):raise HTTPException(403,"Current password is incorrect")
        if len(payload.new_password)<8:raise HTTPException(400,"Password must be at least 8 characters")
        u.password_hash=hash_password(payload.new_password);record(s,user["id"],"update","password",u.id)
    return {"updated":True}
