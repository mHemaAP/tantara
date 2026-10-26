import voyageai
from app.config import get_settings
_client = None

def client():
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=get_settings().voyage_api_key)
    return _client

def embed_documents(texts):
    if not texts:
        return []
    s = get_settings()
    r = client().embed(texts, model=s.voyage_embedding_model, input_type="document",
                       output_dimension=s.embedding_dimensions)
    return [list(v) for v in r.embeddings]

def embed_query(text):
    s = get_settings()
    r = client().embed([text], model=s.voyage_embedding_model, input_type="query",
                       output_dimension=s.embedding_dimensions)
    return list(r.embeddings[0])
