import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient
from app import config,db
from app.main import app

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv("DATA_DIR",str(tmp_path))
    monkeypatch.setenv("DATABASE_URL",f"sqlite:///{tmp_path}/test.db")
    config.get_settings.cache_clear();db._engine=None
    with TestClient(app) as c:yield c
    db._engine=None;config.get_settings.cache_clear()
