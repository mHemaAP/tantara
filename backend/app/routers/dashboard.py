"""Database-backed dashboard and calendar endpoints."""
from datetime import date,datetime,timedelta
from fastapi import APIRouter,Depends,Query
from sqlalchemy import select,func
from app.db import SessionLocal
from app.models import Case,CaseEvent,Hearing,Task,Document,Draft,AuditEvent
from app.security import current_user
router=APIRouter(prefix="/api/v1",tags=["dashboard","calendar"])
@router.get("/dashboard/summary")
def dashboard(user=Depends(current_user)):
    today=date.today();week=datetime.combine(today+timedelta(days=7),datetime.min.time())
    with SessionLocal() as s:
        cnt=lambda cls,*criteria:s.scalar(select(func.count()).select_from(cls).where(cls.owner_id==user["id"],*criteria)) or 0
        return {"greeting":"Good day","first_name":user["name"].split()[0],"today":today.isoformat(),"active_cases":cnt(Case,Case.status=="active"),"pending_arbitrations":cnt(Case,Case.status=="pending"),"hearings_this_week":cnt(Hearing,Hearing.at>=datetime.combine(today,datetime.min.time()),Hearing.at<week),"documents_processed":cnt(Document,Document.status=="ready"),"drafts_in_progress":cnt(Draft,Draft.status!="done"),"tasks_due":cnt(Task,Task.status!="done",Task.due_at<=week),"tasks_overdue":cnt(Task,Task.status!="done",Task.due_at<datetime.combine(today,datetime.min.time()))}
@router.get("/dashboard/activity")
def activity(user=Depends(current_user)):
    with SessionLocal() as s:rows=s.scalars(select(AuditEvent).where(AuditEvent.owner_id==user["id"]).order_by(AuditEvent.created_at.desc()).limit(20)).all()
    return [{"id":r.id,"type":r.action,"actor":user["name"],"title":f"{r.action.title()} {r.object_type}","case_id":None,"at":r.created_at.isoformat()} for r in rows]
@router.get("/dashboard/upcoming")
def upcoming(days:int=Query(30,ge=1,le=365),user=Depends(current_user)):
    start=datetime.now();end=start+timedelta(days=days)
    with SessionLocal() as s:
        hs=s.scalars(select(Hearing).where(Hearing.owner_id==user["id"],Hearing.at>=start,Hearing.at<=end)).all();ts=s.scalars(select(Task).where(Task.owner_id==user["id"],Task.due_at>=start,Task.due_at<=end,Task.status!="done")).all();events=s.scalars(select(CaseEvent).where(CaseEvent.owner_id==user["id"],CaseEvent.occurred_at>=start,CaseEvent.occurred_at<=end)).all()
        out=[{"id":x.id,"type":"hearing","title":x.title,"case_id":x.case_id,"case_title":None,"at":x.at.isoformat(),"due_in_days":(x.at.date()-date.today()).days} for x in hs]+[{"id":x.id,"type":"deadline","title":x.title,"case_id":x.case_id,"case_title":None,"at":x.due_at.isoformat(),"due_in_days":(x.due_at.date()-date.today()).days} for x in ts if x.due_at]+[{"id":x.id,"type":"event","title":x.type,"case_id":x.case_id,"case_title":None,"at":x.occurred_at.isoformat(),"due_in_days":(x.occurred_at.date()-date.today()).days} for x in events]
    return sorted(out,key=lambda x:x["at"])
@router.get("/calendar")
def calendar(from_:datetime|None=Query(None,alias="from"),to:datetime|None=None,user=Depends(current_user)):
    start=from_ or datetime.min;end=to or datetime.max
    with SessionLocal() as s:
        hs=s.scalars(select(Hearing).where(Hearing.owner_id==user["id"],Hearing.at>=start,Hearing.at<=end)).all();tasks=s.scalars(select(Task).where(Task.owner_id==user["id"],Task.due_at>=start,Task.due_at<=end)).all();events=s.scalars(select(CaseEvent).where(CaseEvent.owner_id==user["id"],CaseEvent.occurred_at>=start,CaseEvent.occurred_at<=end)).all()
    items=[{"id":x.id,"type":"hearing","title":x.title,"case_id":x.case_id,"at":x.at.isoformat()} for x in hs]+[{"id":x.id,"type":"deadline","title":x.title,"case_id":x.case_id,"at":x.due_at.isoformat()} for x in tasks if x.due_at]+[{"id":x.id,"type":"event","title":x.type,"case_id":x.case_id,"at":x.occurred_at.isoformat()} for x in events]
    return sorted(items,key=lambda x:x["at"])

