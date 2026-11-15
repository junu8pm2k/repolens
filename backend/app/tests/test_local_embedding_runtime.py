import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.rag import embeddings


@pytest.fixture(autouse=True)
def clear_model_cache(monkeypatch):
    monkeypatch.setitem(sys.modules, "sentence_transformers.util", SimpleNamespace(get_device_name=lambda: "cpu"))
    embeddings._local_sentence_transformer.cache_clear()
    yield
    embeddings._local_sentence_transformer.cache_clear()


def test_local_model_cache_resolves_from_project_root(monkeypatch, tmp_path):
    monkeypatch.setattr(embeddings, "__file__", str(tmp_path / "backend/app/services/rag/embeddings.py"))
    monkeypatch.setattr(settings, "local_embedding_cache_dir", ".data/models")
    monkeypatch.setattr(settings, "local_embedding_local_files_only", True)
    monkeypatch.chdir(tmp_path.parent)
    calls = []
    model = object()

    def load(name, **kwargs):
        calls.append((name, kwargs))
        return model

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=load))
    assert embeddings._local_sentence_transformer("Qwen/Qwen3-Embedding-0.6B", "cpu") is model
    assert embeddings._local_sentence_transformer("Qwen/Qwen3-Embedding-0.6B", "cpu") is model
    assert calls == [("Qwen/Qwen3-Embedding-0.6B", {
        "device": "cpu",
        "cache_folder": str(tmp_path / ".data/models"),
        "local_files_only": True,
        "model_kwargs": {"dtype": "float32"},
    })]
    assert (tmp_path / ".data/models").is_dir()


@pytest.mark.parametrize("device", [None, ""])
def test_model_permission_failure_is_actionable_and_retryable(monkeypatch, tmp_path, device):
    monkeypatch.setattr(settings, "local_embedding_cache_dir", str(tmp_path / "models"))

    def fail(*args, **kwargs):
        raise PermissionError("private/user/cache")

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=fail))
    with pytest.raises(embeddings.EmbeddingUnavailableError, match="LOCAL_EMBEDDING_CACHE_DIR") as error:
        embeddings._local_sentence_transformer("configured-model", None)
    assert isinstance(error.value.__cause__, PermissionError)
    model = object()
    def load(*args, **kwargs):
        assert kwargs["device"] == "cpu"
        return model

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=load))
    assert embeddings._local_sentence_transformer("configured-model", device) is model


def test_cuda_keeps_model_default_precision(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "local_embedding_cache_dir", str(tmp_path / "models"))

    def load(*args, **kwargs):
        assert kwargs["device"] == "cuda:0"
        assert kwargs["model_kwargs"] == {}

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=load))
    embeddings._local_sentence_transformer("configured-model", "cuda:0")


def test_ask_model_failure_returns_json_with_cors(monkeypatch):
    from app.api.routes import rag
    from app.db.session import get_db
    from app.main import create_app

    monkeypatch.setattr(rag, "_repo_or_404", lambda *args: object())

    async def fail(*args, **kwargs):
        raise embeddings.EmbeddingUnavailableError("本地 Embedding 模型加载失败，请检查模型缓存。")

    monkeypatch.setattr(rag, "answer_question", fail)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: object()
    response = TestClient(app).post(
        "/api/rag/00000000-0000-0000-0000-000000000001/ask",
        json={"question": "这个项目是干什么的"},
        headers={"Origin": "http://localhost:3000"},
    )
    assert response.status_code == 503
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.json() == {
        "detail": "本地 Embedding 模型加载失败，请检查模型缓存。",
        "service": "embedding",
        "status": "degraded",
    }
