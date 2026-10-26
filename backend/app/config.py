from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    anthropic_api_key: str
    voyage_api_key: str
    claude_model: str = "claude-sonnet-4-20250514"
    voyage_embedding_model: str = "voyage-3.5"
    embedding_dimensions: int = 1024
    max_upload_mb: int = 25
    chunk_size_chars: int = 1800
    chunk_overlap_chars: int = 250
    default_top_k: int = 5
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache
def get_settings():
    return Settings()
