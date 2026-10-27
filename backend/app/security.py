"""Password hashing and locally persisted HS256 signing key."""
import base64, hashlib, hmac, json, os, time, uuid
from pathlib import Path
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.config import get_settings

def hash_password(password: str) -> str:
    salt=os.urandom(16); dk=hashlib.scrypt(password.encode(),salt=salt,n=2**14,r=8,p=1)
    return base64.urlsafe_b64encode(salt).decode()+"$"+base64.urlsafe_b64encode(dk).decode()
def verify_password(password: str, encoded: str) -> bool:
    try:
        salt,expected=encoded.split("$"); salt=base64.urlsafe_b64decode(salt); expected=base64.urlsafe_b64decode(expected)
        return hmac.compare_digest(hashlib.scrypt(password.encode(),salt=salt,n=2**14,r=8,p=1),expected)
    except Exception: return False
def _key():
    p=get_settings().data_dir/".secret"; p.parent.mkdir(parents=True,exist_ok=True)
    if not p.exists():
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"wb") as f: f.write(os.urandom(48))
    return p.read_bytes()
def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def create_token(uid):
    head=_b64(b'{"alg":"HS256","typ":"JWT"}'); body=_b64(json.dumps({"sub":uid,"exp":int(time.time())+86400}).encode())
    sig=_b64(hmac.new(_key(),f"{head}.{body}".encode(),hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"
bearer=HTTPBearer(auto_error=False)
def current_user(creds: HTTPAuthorizationCredentials|None=Depends(bearer)):
    from app.db import connect
    if not creds: raise HTTPException(401,"Authentication required")
    try:
        a,b,sig=creds.credentials.split("."); expected=_b64(hmac.new(_key(),f"{a}.{b}".encode(),hashlib.sha256).digest())
        payload=json.loads(base64.urlsafe_b64decode(b+"="*((4-len(b)%4)%4)))
        if not hmac.compare_digest(sig,expected) or payload["exp"]<time.time(): raise ValueError()
        with connect() as c: row=c.exec_driver_sql("SELECT id,name,email,role,avatar_initials,title FROM users WHERE id=?",(payload["sub"],)).mappings().first()
        if not row: raise ValueError()
        return dict(row)
    except Exception: raise HTTPException(401,"Invalid or expired token")
def audit(user,action,obj_type,obj_id):
    from app.db import connect
    with connect() as c:
        c.exec_driver_sql("INSERT INTO audit_events(id,owner_id,data) VALUES(?,?,?)",(str(uuid.uuid4()),user["id"],json.dumps({"actor":user["id"],"action":action,"object_type":obj_type,"object_id":obj_id})))
