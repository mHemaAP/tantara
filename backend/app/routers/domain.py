"""Typed paginated CRUD routes for clients, cases, hearings, tasks, drafts, and bundles."""
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict
from sqlalchemy import select,func
from app.db import SessionLocal,session_scope
from app.models import *
from app.repositories.domain import ENTITY_MODELS,fields_for,serialize,get_owned,list_owned,create as repo_create,update as repo_update
from app.security import current_user
from app.services.audit import record
router=APIRouter(prefix="/api/v1")
class Payload(BaseModel):model_config=ConfigDict(extra="allow")
def owned(session,cls,rid,user):
    item=get_owned(session,cls,rid,user["id"])
    if item is None:raise HTTPException(404,"Record not found")
    return item
def assert_write_role(user,cls):
    role=user.get("role")
    if role=="researcher":raise HTTPException(403,"This role is read-only")
    if role=="staff" and cls in {Client,Case,Draft,FilingBundle,CommunityPost}:raise HTTPException(403,"This role cannot modify this resource")
def list_domain(cls,user,**kwargs):
    with SessionLocal() as s:return list_owned(s,cls,user["id"],**kwargs)
def register_crud(path,cls):
    async def listing(q:str|None=None,status:str|None=None,case_id:str|None=None,page:int=Query(1,ge=1),page_size:int=Query(20,ge=1,le=100),sort:str="created_at",from_:str|None=Query(None,alias="from"),to:str|None=None,user=Depends(current_user)):
        filters=[]
        if cls is Hearing:
            try:
                if from_:filters.append(Hearing.at>=datetime.fromisoformat(from_.replace("Z","+00:00")).replace(tzinfo=None))
                if to:filters.append(Hearing.at<=datetime.fromisoformat(to.replace("Z","+00:00")).replace(tzinfo=None))
            except ValueError:raise HTTPException(400,"from and to must be ISO dates")
        with SessionLocal() as s:
            result=list_owned(s,cls,user["id"],q=q,status=status,case_id=case_id,page=page,page_size=page_size,sort=sort,extra_filters=filters)
            for item in result["items"]:
                for key in ("owner_id","output_path","stored_path","text_content","embedding_blob"):item.pop(key,None)
                if cls is FilingBundle:
                    item["downloadable"]=item.get("status")=="ready";item["download_url"]=f"/api/v1/bundles/{item['id']}/download" if item["downloadable"] else None
            return result
    def create(payload:Payload,user=Depends(current_user)):
        assert_write_role(user,cls);values=payload.model_dump(exclude_unset=True);allowed=fields_for(cls)-{"id","created_at","updated_at","owner_id","is_demo"};values={k:v for k,v in values.items() if k in allowed}
        if cls is Case and values.get("client_id"):
            with SessionLocal() as s:owned(s,Client,values["client_id"],user)
        if values.get("case_id"):
            with SessionLocal() as s:owned(s,Case,values["case_id"],user)
        with session_scope() as s:
            row=repo_create(s,cls,user["id"],values);record(s,user["id"],"create",cls.__tablename__,row.id);return serialize(row)
    def get(rid:str,user=Depends(current_user)):
        with SessionLocal() as s:
            row=owned(s,cls,rid,user);out=serialize(row)
            for key in ("owner_id","output_path","stored_path","text_content","embedding_blob"):out.pop(key,None)
            if cls is FilingBundle:
                out["downloadable"]=bool(row.output_path and Path(row.output_path).is_file());out["download_url"]=f"/api/v1/bundles/{rid}/download" if out["downloadable"] else None
            return out
    def patch(rid:str,payload:Payload,user=Depends(current_user)):
        assert_write_role(user,cls);values=payload.model_dump(exclude_unset=True)
        if values.get("case_id"):
            with SessionLocal() as s:owned(s,Case,values["case_id"],user)
        if cls is Case and values.get("client_id"):
            with SessionLocal() as s:owned(s,Client,values["client_id"],user)
        with session_scope() as s:
            row=owned(s,cls,rid,user);repo_update(s,row,values);record(s,user["id"],"update",cls.__tablename__,rid);return serialize(row)
    def delete(rid:str,user=Depends(current_user)):
        assert_write_role(user,cls)
        with session_scope() as s:
            row=owned(s,cls,rid,user)
            if cls is Case:row.status="archived";result={"deleted":False,"archived":True}
            else:s.delete(row);result={"deleted":True}
            record(s,user["id"],"delete",cls.__tablename__,rid);return result
    router.add_api_route("/"+path,listing,methods=["GET"],name=path+"_list")
    router.add_api_route("/"+path,create,methods=["POST"],name=path+"_create")
    router.add_api_route("/"+path+"/{rid}",get,methods=["GET"],name=path+"_get")
    router.add_api_route("/"+path+"/{rid}",patch,methods=["PATCH"],name=path+"_patch")
    router.add_api_route("/"+path+"/{rid}",delete,methods=["DELETE"],name=path+"_delete")
for route,model in ENTITY_MODELS.items():register_crud(route,model)
