from functools import lru_cache
from supabase import create_client
from app.config import get_settings

@lru_cache
def db():
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)

def insert_document(title, doc_type, jurisdiction, source_label, filename, content_hash):
    row = {"title": title, "document_type": doc_type, "jurisdiction": jurisdiction,
           "source_label": source_label, "filename": filename, "content_hash": content_hash,
           "status": "ingested"}
    return db().table("documents").insert(row).execute().data[0]

def insert_chunks(rows):
    for i in range(0, len(rows), 100):
        db().table("document_chunks").insert(rows[i:i+100]).execute()

def search(embedding, top_k, jurisdiction, document_types):
    r = db().rpc("match_document_chunks", {"query_embedding": embedding, "match_count": top_k,
        "filter_jurisdiction": jurisdiction, "filter_document_types": document_types or []}).execute()
    return r.data or []
