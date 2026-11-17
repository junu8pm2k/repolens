import asyncio
import threading

import httpx
import pytest

from app.api.routes import rag
from app.core.config import settings
from app.db.session import get_db
from app.main import create_app


@pytest.mark.asyncio
async def test_reindex_does_not_block_health_requests(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    monkeypatch.setattr(rag, "_repo_or_404", lambda *args: object())
    config = type(
        "Config",
        (),
        {
            "embedding_provider": settings.embedding_provider,
            "embedding_model": settings.embedding_model,
        },
    )()
    monkeypatch.setattr(rag, "get_or_create_config", lambda *args: config)

    def reindex(*args):
        started.set()
        release.wait(timeout=3)
        return 1

    monkeypatch.setattr(rag, "reindex_documents", reindex)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: object()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        task = asyncio.create_task(
            client.post(
                "/api/rag/00000000-0000-0000-0000-000000000001/reindex"
            )
        )
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert (await client.get("/health")).status_code == 200
            assert not task.done(), (
                "reindex must still be waiting while health remains responsive"
            )
        finally:
            release.set()
        response = await task
        assert response.status_code == 200
        assert response.json()["indexed_documents"] == 1
