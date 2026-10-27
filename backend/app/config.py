"""Environment configuration; local providers are the default."""
from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]

class Settings(BaseSettings):
    database_url: str = f"sqlite:///{ROOT / 'data' / 'tantara.db'}"
    data_dir: Path = ROOT / "data"
    ai_provider: str = "local"
    local_llm_base_url: str = "http://192.168.0.101:8080/v1"
    local_llm_model: str = "MiniCPM5-2B"
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-20250514"
    embedding_provider: str = "fastembed"
    fastembed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    voyage_api_key: str = ""
    voyage_embedding_model: str = "voyage-3.5"
    embedding_dimensions: int = 384
    vector_backend: str = "faiss"
    analytics_backend: str = "none"
    enable_cloud_providers: bool = False
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    max_upload_mb: int = 25
    chunk_size_chars: int = 1800
    chunk_overlap_chars: int = 250
    default_top_k: int = 5
    tantara_admin_password: str = "tantara-local"
    cors_origins: str = "http://localhost:3010"
    model_config = SettingsConfigDict(env_file=(str(ROOT / ".env"), str(ROOT / "env_example")), extra="ignore")

@lru_cache
def get_settings() -> Settings:
    return Settings()
