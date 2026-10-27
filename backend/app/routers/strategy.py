"""Auditable case strategy and explicit autofill preview/apply workflows."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.db import SessionLocal, session_scope
from app.models import AppPreference, Case, Document, ExtractionField, Hearing
from app.repositories.domain import get_owned
from app.security import current_user
from app.services.audit import record

router = APIRouter(prefix="/api/v1/cases/{cid}", tags=["strategy", "autofill"])


class Keys(BaseModel):
    keys: list[str] = Field(default_factory=list)


class Fields(BaseModel):
    fields: list[dict] = Field(default_factory=list)


class StrategyBody(BaseModel):
    case_theory: str = ""
    key_issues: list[str] = Field(default_factory=list)
    legal_arguments: list[dict] = Field(default_factory=list)
    counterarguments: list[str] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)
    strategy_plan: str = ""


def _case(s, cid, user):
    c = get_owned(s, Case, cid, user["id"])
    if not c:
        raise HTTPException(404, "Case not found")
    return c


@router.get("/autofill")
def autofill(cid: str, user=Depends(current_user)):
    with SessionLocal() as s:
        c = _case(s, cid, user)
        keys = (
            "title",
            "reference_number",
            "claimant",
            "respondent",
            "forum",
            "seat",
            "governing_law",
            "dispute_category",
            "claim_amount",
            "claim_currency",
            "description",
            "filed_at",
            "notice_date",
            "limitation_date",
        )
        fields = [
            {
                "key": k,
                "label": k.replace("_", " ").title(),
                "value": getattr(c, k),
                "provenance": "verified",
                "source": "Case record",
            }
            for k in keys
            if getattr(c, k) is not None
        ]
        next_hearing = s.scalar(
            select(Hearing.at)
            .where(
                Hearing.owner_id == user["id"],
                Hearing.case_id == cid,
                Hearing.at >= datetime.now(UTC).replace(tzinfo=None),
            )
            .order_by(Hearing.at)
            .limit(1)
        )
        if next_hearing:
            fields.append(
                {
                    "key": "next_hearing_at",
                    "label": "Next Hearing",
                    "value": next_hearing,
                    "provenance": "verified",
                    "source": "Hearing record",
                }
            )
        docs = s.scalars(
            select(Document).where(Document.owner_id == user["id"], Document.case_id == cid)
        ).all()
        doc_ids = [d.id for d in docs]
        if doc_ids:
            rows = s.scalars(
                select(ExtractionField)
                .where(ExtractionField.owner_id == user["id"], ExtractionField.document_id.in_(doc_ids))
                .order_by(ExtractionField.created_at.desc())
            ).all()
            seen = {x["key"] for x in fields}
            for row in rows:
                if row.key not in seen:
                    doc = next((d for d in docs if d.id == row.document_id), None)
                    fields.append(
                        {
                            "key": row.key,
                            "label": row.key.replace("_", " ").title(),
                            "value": row.value,
                            "provenance": row.provenance,
                            "source": doc.title if doc else row.source,
                        }
                    )
                    seen.add(row.key)
        return {"status": "record_based", "model": None, "fields": fields}


@router.post("/autofill/preview")
def autofill_preview(cid: str, payload: Keys, user=Depends(current_user)):
    current = autofill(cid, user)
    wanted = set(payload.keys)
    return {"fields": [x for x in current["fields"] if x["key"] in wanted]}


@router.post("/autofill/apply")
def autofill_apply(cid: str, payload: Fields, user=Depends(current_user)):
    if user.get("role") == "researcher":
        raise HTTPException(403, "This role is read-only")
    allowed = {
        "claimant",
        "respondent",
        "forum",
        "seat",
        "governing_law",
        "arbitration_agreement_details",
        "dispute_category",
        "claim_amount",
        "claim_currency",
        "description",
        "filed_at",
        "notice_date",
        "limitation_date",
        "reference_number",
        "title",
    }
    applied = []
    skipped = []
    with session_scope() as s:
        c = _case(s, cid, user)
        for item in payload.fields:
            key = item.get("key")
            provenance = item.get("provenance")
            if key not in allowed or provenance not in {"verified", "extracted_reviewed", "ai_suggested"}:
                skipped.append(key)
                continue
            if getattr(c, key) is not None and provenance != "verified":
                skipped.append(key)
                continue
            if provenance == "ai_suggested":
                skipped.append(key)
                continue
            setattr(c, key, item.get("value"))
            applied.append(key)
        record(s, user["id"], "apply", "case_autofill", cid, {"applied": applied, "skipped": skipped})
    return {"applied": applied, "skipped": skipped}


def _get_strategy(s, cid, owner):
    row = s.scalar(
        select(AppPreference).where(AppPreference.owner_id == owner, AppPreference.key == f"strategy:{cid}")
    )
    return (
        row.value
        if row
        else {
            "case_theory": "",
            "key_issues": [],
            "legal_arguments": [],
            "counterarguments": [],
            "evidence_gaps": [],
            "strategy_plan": "",
            "updated_at": None,
        }
    )


@router.get("/strategy")
def strategy(cid: str, user=Depends(current_user)):
    with SessionLocal() as s:
        _case(s, cid, user)
        return _get_strategy(s, cid, user["id"])


@router.post("/strategy/generate")
def generate_strategy(cid: str, user=Depends(current_user)):
    from app.services.retrieval import retrieval_service

    with SessionLocal() as s:
        c = _case(s, cid, user)
        title = c.title
        docs = s.scalar(select(Document.id).where(Document.owner_id == user["id"], Document.case_id == cid))
    hits = (
        retrieval_service.search(f"issues evidence claims arbitration {title}", user["id"], 8, cid)
        if docs
        else []
    )
    if not hits:
        result = {
            "case_theory": "",
            "key_issues": [],
            "legal_arguments": [],
            "counterarguments": [],
            "evidence_gaps": ["No indexed evidence was available for this case."],
            "strategy_plan": "",
            "updated_at": datetime.now(UTC).isoformat(),
        }
    else:
        result = {
            "case_theory": "Review the source-supported excerpts below before adopting any case theory.",
            "key_issues": [],
            "legal_arguments": [
                {
                    "statement": f"Evidence excerpt: {x['snippet']}",
                    "support": [
                        {
                            "document_id": x["document_id"],
                            "chunk_id": x["chunk_id"],
                            "page_number": x["page_number"],
                        }
                    ],
                    "confidence_note": "Direct excerpt; legal significance requires counsel review.",
                }
                for x in hits
            ],
            "counterarguments": [],
            "evidence_gaps": ["Review opposing evidence and governing law."],
            "strategy_plan": "Verify each source, identify contrary evidence, then develop counsel-approved submissions.",
            "updated_at": datetime.now(UTC).isoformat(),
        }
    with session_scope() as s:
        _case(s, cid, user)
        row = s.scalar(
            select(AppPreference).where(
                AppPreference.owner_id == user["id"], AppPreference.key == f"strategy:{cid}"
            )
        )
        if row:
            row.value = result
        else:
            s.add(
                AppPreference(id=str(uuid.uuid4()), owner_id=user["id"], key=f"strategy:{cid}", value=result)
            )
        record(s, user["id"], "generate", "case_strategy", cid)
    return {
        **result,
        "status": "template" if hits else "no_evidence",
        "generation_kind": "excerpt_listing" if hits else "empty_review_template",
        "model": None,
    }


@router.put("/strategy")
def strategy_put(cid: str, payload: StrategyBody, user=Depends(current_user)):
    if user.get("role") == "researcher":
        raise HTTPException(403, "This role is read-only")
    result = {**payload.model_dump(), "updated_at": datetime.now(UTC).isoformat()}
    with session_scope() as s:
        _case(s, cid, user)
        row = s.scalar(
            select(AppPreference).where(
                AppPreference.owner_id == user["id"], AppPreference.key == f"strategy:{cid}"
            )
        )
        if row:
            row.value = result
        else:
            s.add(
                AppPreference(id=str(uuid.uuid4()), owner_id=user["id"], key=f"strategy:{cid}", value=result)
            )
        record(s, user["id"], "update", "case_strategy", cid)
    return result
