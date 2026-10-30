import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import User
from app.security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class Login(BaseModel):
    email: str
    password: str


class Register(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=2, max_length=160)
    email: str = Field(max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)
    title: str = Field(default="Advocate", max_length=160)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        if isinstance(value, str):
            value = re.sub(r"\s+", " ", value).strip()
        return value


@router.post("/login")
def login(payload: Login):
    with SessionLocal() as s:
        user = s.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    public = {k: getattr(user, k) for k in ("id", "name", "email", "role", "avatar_initials", "title")}
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": public}


@router.post("/register")
def register(payload: Register):
    email = payload.email.lower()
    words = payload.name.split()
    initials = "".join(word[0] for word in words[:2]).upper()[:8]
    user = User(
        id=str(uuid.uuid4()),
        name=payload.name,
        email=email,
        password_hash=hash_password(payload.password),
        role="advocate",
        avatar_initials=initials,
        title=payload.title,
    )
    with SessionLocal() as s:
        if s.scalar(select(User.id).where(User.email == email)):
            raise HTTPException(409, "An account with this email already exists")
        s.add(user)
        public = {k: getattr(user, k) for k in ("id", "name", "email", "role", "avatar_initials", "title")}
        try:
            s.commit()
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, "An account with this email already exists") from None
        token = create_token(user.id)
    return {"access_token": token, "token_type": "bearer", "user": public}


@router.get("/me")
def me(user=Depends(current_user)):
    return user
